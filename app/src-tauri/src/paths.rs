//! Persistent library locations. Music collections can be changed while running.
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
    #[serde(default)]
    pub music_folders: Option<Vec<PathBuf>>,
    pub patches: PathBuf,
}
impl Locations {
    pub fn collections(&self) -> Vec<PathBuf> {
        self.music_folders
            .clone()
            .unwrap_or_else(|| vec![self.music.clone()])
    }
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
        music_folders: None,
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
    let mut active = active().clone();
    let selected = read(&support().join("paths.json"), defaults())?;
    active.music_folders = Some(selected.collections());
    Ok(Settings {
        restart_required: selected.patches != active.patches,
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
        "music" => {
            let mut folders = settings.selected.collections();
            ensure!(
                !folders.contains(&path),
                "This music folder is already added"
            );
            folders.push(path);
            settings.selected.music_folders = Some(folders);
        }
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
    settings.active.music_folders = Some(settings.selected.collections());
    settings.restart_required = settings.selected.patches != settings.active.patches;
    Ok(settings)
}

pub fn remove_music(path: &Path) -> Result<Settings> {
    let _save = SAVE.lock().unwrap();
    let mut settings = settings()?;
    let mut folders = settings.selected.collections();
    ensure!(
        folders.iter().any(|folder| folder == path),
        "Music folder is not configured"
    );
    folders.retain(|folder| folder != path);
    settings.selected.music_folders = Some(folders);
    save(&support().join("paths.json"), &settings.selected)?;
    settings.active.music_folders = Some(settings.selected.collections());
    settings.restart_required = settings.selected.patches != settings.active.patches;
    Ok(settings)
}

/// Compose mounts only the configured directories, read-only. No broad host mount or
/// path-accepting HTTP API is introduced. This runs on an ordinary startup thread.
pub fn ensure_music_mount() -> Result<()> {
    let _service = SERVICE.lock().unwrap();
    let folders = available_music_folders(&read(&support().join("paths.json"), defaults())?);
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
            .is_some_and(|v| {
                v["schema_version"] == 2
                    && v["content_cache"] == 1
                    && v["load_priority"] == 1
                    && v["music_folders"] == serde_json::json!(folders)
            })
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
    // Compose override replaces the legacy single mount with the exact configured roots.
    let mounts: Vec<_> = folders.iter().enumerate().map(|(index, folder)| {
        serde_json::json!({"type": "bind", "source": folder, "target": format!("/collections/{index}"), "read_only": true})
    }).chain(std::iter::once(serde_json::json!({"type": "bind", "source": app.join("generated"), "target": "/generated"}))).collect();
    let collections: Vec<_> = folders.iter().enumerate().map(|(index, folder)| {
        serde_json::json!({"path": folder, "mount": format!("/collections/{index}")})
    }).collect();
    let override_path = support().join("collections.compose.yaml");
    // !override needs YAML, while JSON safely encodes user-controlled paths.
    let yaml = format!("services:\n  preparation:\n    volumes: !override {}\n    environment:\n      VIRA_COLLECTIONS: {}\n", serde_json::to_string(&mounts)?, serde_json::to_string(&serde_json::to_string(&collections)?)?);
    fs::write(&override_path, yaml)?;
    let mut child = std::process::Command::new(docker)
        .args(["compose", "-f"])
        .arg(app.join("compose.yaml"))
        .arg("-f")
        .arg(&override_path)
        .args(["up", "-d", "--build", "--wait", "preparation"])
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

fn available_music_folders(locations: &Locations) -> Vec<PathBuf> {
    // Keep disconnected drives saved, but never let one block the other collections
    // or let Docker create an empty directory at a missing mount source.
    locations
        .collections()
        .into_iter()
        .filter(|folder| selected_directory(folder).is_ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_music_folders_are_skipped_without_changing_saved_order() {
        let root =
            std::env::temp_dir().join(format!("vira-available-paths-{}", std::process::id()));
        fs::create_dir_all(root.join("Dance")).unwrap();
        fs::create_dir_all(root.join("Jazz")).unwrap();
        fs::write(root.join("file"), "not a directory").unwrap();
        let mut locations = Locations {
            music: root.join("disconnected"),
            music_folders: Some(vec![
                root.join("disconnected"),
                root.join("Dance"),
                root.join("file"),
                root.join("Jazz"),
            ]),
            patches: root.join("patches"),
        };
        let saved = locations.clone();
        assert_eq!(
            available_music_folders(&locations),
            vec![root.join("Dance"), root.join("Jazz")]
        );
        assert_eq!(locations, saved);
        fs::create_dir_all(root.join("disconnected")).unwrap();
        assert_eq!(
            available_music_folders(&locations)[0],
            root.join("disconnected")
        );
        locations.music_folders = Some(vec![root.join("missing")]);
        assert!(available_music_folders(&locations).is_empty());
        locations.music_folders = Some(vec![]);
        assert!(available_music_folders(&locations).is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_single_folder_migrates_and_explicit_empty_stays_empty() {
        let legacy: Locations =
            serde_json::from_str(r#"{"music":"/Music é","patches":"/Patches"}"#).unwrap();
        assert_eq!(legacy.collections(), vec![PathBuf::from("/Music é")]);
        let mut multiple = legacy.clone();
        multiple.music_folders = Some(vec![PathBuf::from("/Music é"), PathBuf::from("/Dance")]);
        let restored: Locations =
            serde_json::from_slice(&serde_json::to_vec(&multiple).unwrap()).unwrap();
        assert_eq!(restored.collections().len(), 2);
        multiple.music_folders = Some(vec![]);
        let restored: Locations =
            serde_json::from_slice(&serde_json::to_vec(&multiple).unwrap()).unwrap();
        assert!(restored.collections().is_empty());
    }
    #[test]
    fn locations_roundtrip_spaces_and_unicode_and_reject_files() {
        let root = std::env::temp_dir().join(format!("vira-paths-{}", std::process::id()));
        fs::create_dir_all(root.join("Music é")).unwrap();
        let location = selected_directory(&root.join("Music é")).unwrap();
        let paths = Locations {
            music: location.clone(),
            music_folders: None,
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
