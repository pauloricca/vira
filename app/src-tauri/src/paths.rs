//! Persistent library locations. A running process keeps its startup roots.
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Locations {
    pub music: PathBuf,
    pub patches: PathBuf,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub selected: Locations,
    pub active: Locations,
    pub restart_required: bool,
}
static ACTIVE: OnceLock<Locations> = OnceLock::new();
static SERVICE: Mutex<()> = Mutex::new(());
static SAVE: Mutex<()> = Mutex::new(());
pub fn support() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
        .join("Library/Application Support/uk.ricca.vira")
}
fn defaults() -> Locations {
    Locations {
        music: PathBuf::from(crate::MUSIC_BIN),
        patches: std::env::var_os("VIRA_TEIA_PATCH_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| support().join("patches")),
    }
}
fn read(path: &Path, fallback: Locations) -> Result<Locations> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).context("Cannot read saved library folder settings")
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(fallback),
        Err(e) => Err(e.into()),
    }
}
pub fn active() -> &'static Locations {
    ACTIVE.get_or_init(|| {
        read(&support().join("paths.json"), defaults()).unwrap_or_else(|_| defaults())
    })
}
pub fn settings() -> Result<Settings> {
    let active = active().clone();
    let selected = read(&support().join("paths.json"), defaults())?;
    Ok(Settings {
        restart_required: selected != active,
        selected,
        active,
    })
}
fn save(path: &Path, locations: &Locations) -> Result<()> {
    fs::create_dir_all(path.parent().context("Missing settings directory")?)?;
    let tmp = path.with_extension("json.tmp");
    use std::io::Write;
    let mut file = fs::File::create(&tmp)?;
    file.write_all(&serde_json::to_vec_pretty(locations)?)?;
    file.sync_all()?;
    drop(file);
    fs::rename(tmp, path)?;
    Ok(())
}
fn selected_directory(path: &Path) -> Result<PathBuf> {
    ensure!(path.is_absolute(), "Choose an absolute folder path");
    let path = path
        .canonicalize()
        .context("The selected folder is unavailable")?;
    ensure!(path.is_dir(), "Choose a folder");
    fs::read_dir(&path).context("The selected folder cannot be read")?;
    Ok(path)
}
pub fn select(kind: &str, path: &Path) -> Result<Settings> {
    let _save = SAVE.lock().unwrap();
    let mut settings = settings()?; // Freeze active locations before persisting.
    let path = selected_directory(path)?;
    match kind {
        "music" => settings.selected.music = path,
        "patches" => {
            // Verify write access without changing an existing patch or asset.
            let probe = path.join(format!(
                ".vira-write-check-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_nanos()
            ));
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&probe)
                .context("The patch folder must be writable")?;
            fs::remove_file(probe)?;
            settings.selected.patches = path;
        }
        _ => bail!("Unknown library folder"),
    }
    save(&support().join("paths.json"), &settings.selected)?;
    settings.restart_required = settings.selected != settings.active;
    Ok(settings)
}

/// Compose remounts only the chosen directory, read-only. No broad host mount or
/// path-accepting HTTP API is introduced. This runs on an ordinary startup thread.
pub fn ensure_music_mount() -> Result<()> {
    let _service = SERVICE.lock().unwrap();
    let music = &active().music;
    selected_directory(music)?;
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let matches = || {
        client
            .get("http://127.0.0.1:47831/health")
            .send()
            .ok()
            .filter(|r| r.status().is_success())
            .and_then(|r| r.json::<serde_json::Value>().ok())
            .is_some_and(|v| v["schema_version"] == 2 && v["music_bin"].as_str() == music.to_str())
    };
    if matches() {
        return Ok(());
    }
    let docker = ["/usr/local/bin/docker", "/opt/homebrew/bin/docker", "/Applications/Docker.app/Contents/Resources/bin/docker"]
        .into_iter().find(|path| Path::new(path).is_file())
        .context("Docker is required to prepare the selected music folder. Start Docker Desktop, then reopen VIRA.")?;
    let app = std::env::var_os("VIRA_APP_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/Users/pauloricca/Desktop/projects/vira/app"));
    ensure!(
        app.join("compose.yaml").is_file(),
        "Cannot find VIRA's preparation service. Set VIRA_APP_DIR to the app directory."
    );
    fs::create_dir_all(support())?;
    let log = fs::File::create(support().join("preparation-start.log"))?;
    let mut search_paths = vec![
        PathBuf::from("/Applications/Docker.app/Contents/Resources/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
    ];
    if let Some(existing) = std::env::var_os("PATH") {
        search_paths.extend(std::env::split_paths(&existing));
    }
    let mut child = std::process::Command::new(docker)
        .args(["compose", "-f"])
        .arg(app.join("compose.yaml"))
        .args(["up", "-d", "--build", "--wait", "preparation"])
        .env("VIRA_MUSIC_DIR", music)
        .env("PATH", std::env::join_paths(search_paths)?)
        .stdout(log.try_clone()?)
        .stderr(log)
        .spawn()
        .context("Cannot start the music preparation service")?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            ensure!(status.success() && matches(), "Cannot mount the selected music folder. Check Docker Desktop file sharing and ~/Library/Application Support/uk.ricca.vira/preparation-start.log, then reopen VIRA.");
            return Ok(());
        }
        if start.elapsed() > Duration::from_secs(100) {
            let _ = child.kill();
            let _ = child.wait();
            bail!("Starting the music preparation service timed out. Check Docker Desktop, then reopen VIRA.");
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locations_roundtrip_spaces_and_unicode_and_reject_files() {
        let root = std::env::temp_dir().join(format!("vira-paths-{}", std::process::id()));
        fs::create_dir_all(root.join("Music é")).unwrap();
        let location = selected_directory(&root.join("Music é")).unwrap();
        let paths = Locations {
            music: location.clone(),
            patches: location,
        };
        let config = root.join("settings/paths.json");
        assert_eq!(read(&config, paths.clone()).unwrap(), paths);
        save(&config, &paths).unwrap();
        assert_eq!(read(&config, defaults()).unwrap(), paths);
        assert!(selected_directory(&config).is_err());
        assert!(selected_directory(Path::new("relative")).is_err());
        fs::write(&config, "broken").unwrap();
        assert!(read(&config, defaults()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
