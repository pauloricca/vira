//! Per-content user metadata. Never writes to the source music files.
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, sync::Mutex};

static SAVE: Mutex<()> = Mutex::new(());

#[derive(Default, Deserialize, Serialize)]
struct Metadata {
    #[serde(default)]
    gain_db: f32,
    #[serde(flatten)]
    other: serde_json::Map<String, serde_json::Value>,
}

fn validate(gain: f32) -> Result<()> {
    ensure!(
        gain.is_finite() && (-12.0..=12.0).contains(&gain),
        "Saved track gain must be between -12 and +12 dB"
    );
    Ok(())
}

fn read(path: &Path) -> Result<Metadata> {
    let metadata: Metadata = match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).context("Cannot read saved track metadata")?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Metadata::default(),
        Err(error) => return Err(error).context("Cannot read saved track metadata"),
    };
    validate(metadata.gain_db)?;
    Ok(metadata)
}

fn path(root: &Path, source_hash: &str) -> Result<std::path::PathBuf> {
    ensure!(
        crate::valid_id(source_hash),
        "Invalid track content identity"
    );
    Ok(root.join(format!("{source_hash}.json")))
}

pub fn gain(source_hash: &str) -> Result<f32> {
    let _guard = SAVE.lock().unwrap();
    Ok(read(&path(
        &crate::paths::support().join("track-metadata"),
        source_hash,
    )?)?
    .gain_db)
}

pub fn save_gain(source_hash: &str, gain: f32) -> Result<()> {
    let _guard = SAVE.lock().unwrap();
    save_at(
        &path(&crate::paths::support().join("track-metadata"), source_hash)?,
        gain,
    )
}

fn save_at(path: &Path, gain: f32) -> Result<()> {
    validate(gain)?;
    let mut metadata = read(path)?;
    metadata.gain_db = gain;
    fs::create_dir_all(path.parent().context("Missing track metadata directory")?)?;
    let temporary = path.with_extension("json.tmp");
    let mut file = fs::File::create(&temporary).context("Cannot save track gain")?;
    file.write_all(&serde_json::to_vec_pretty(&metadata)?)?;
    file.sync_all()?;
    drop(file);
    fs::rename(temporary, path).context("Cannot save track gain")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gain_survives_reopening_and_is_scoped_to_content() {
        let root = std::env::temp_dir().join(format!(
            "vira-track-meta-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first = path(&root, &"a".repeat(64)).unwrap();
        let second = path(&root, &"b".repeat(64)).unwrap();
        assert_eq!(read(&first).unwrap().gain_db, 0.);
        save_at(&first, -4.5).unwrap();
        assert_eq!(read(&first).unwrap().gain_db, -4.5);
        assert_eq!(read(&second).unwrap().gain_db, 0.);
        save_at(&second, 3.).unwrap();
        save_at(&first, 0.).unwrap();
        assert_eq!(read(&first).unwrap().gain_db, 0.);
        assert_eq!(read(&second).unwrap().gain_db, 3.);
        for invalid in [f32::NAN, f32::INFINITY, -12.1, 12.1] {
            assert!(save_at(&second, invalid).is_err());
        }
        assert_eq!(read(&second).unwrap().gain_db, 3.);
        assert!(path(&root, "../bad").is_err());
        fs::write(&first, br#"{"gain_db":20}"#).unwrap();
        assert!(read(&first).is_err());
        fs::write(&first, br#"{"notes":"keep me"}"#).unwrap();
        save_at(&first, 2.).unwrap();
        assert_eq!(read(&first).unwrap().other["notes"], "keep me");
        fs::remove_dir_all(root).unwrap();
    }
}
