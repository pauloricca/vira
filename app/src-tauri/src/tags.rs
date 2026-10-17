//! User tags live separately from scan/analysis data and never modify music files.
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::Path, sync::Mutex};

static SAVE: Mutex<()> = Mutex::new(());

#[derive(Clone, Default, Deserialize, Serialize)]
pub struct Tag {
    pub name: String,
    pub tracks: Vec<String>,
}

fn read(path: &Path) -> Result<Vec<Tag>, String> {
    match fs::read(path) {
        Ok(bytes) => {
            serde_json::from_slice(&bytes).map_err(|e| format!("Cannot read saved tags: {e}"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(vec![]),
        Err(e) => Err(format!("Cannot read saved tags: {e}")),
    }
}

pub fn get() -> Result<Vec<Tag>, String> {
    let _guard = SAVE.lock().map_err(|e| e.to_string())?;
    read(&crate::paths::support().join("tags.json"))
}

fn change(
    tags: &mut Vec<Tag>,
    action: &str,
    name: &str,
    track_id: Option<&str>,
) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err(
            "Use a tag name between 1 and 80 characters without control characters.".into(),
        );
    }
    if action == "create" {
        if tags
            .iter()
            .any(|tag| tag.name.to_lowercase() == name.to_lowercase())
        {
            return Err("A tag with that name already exists.".into());
        }
        tags.push(Tag {
            name: name.into(),
            tracks: vec![],
        });
        return Ok(());
    }
    let tag = tags
        .iter_mut()
        .find(|tag| tag.name == name)
        .ok_or("Tag no longer exists.")?;
    match action {
        "delete" => tags.retain(|tag| tag.name != name),
        "assign" | "unassign" => {
            let id = track_id
                .filter(|id| crate::valid_id(id))
                .ok_or("Choose a library track.")?;
            if action == "assign" {
                if !tag.tracks.iter().any(|track| track == id) {
                    tag.tracks.push(id.into());
                }
            } else {
                tag.tracks.retain(|track| track != id);
            }
        }
        _ => return Err("Unknown tag action.".into()),
    }
    Ok(())
}

pub fn update(action: &str, name: &str, track_id: Option<&str>) -> Result<Vec<Tag>, String> {
    let _guard = SAVE.lock().map_err(|e| e.to_string())?;
    let path = crate::paths::support().join("tags.json");
    update_at(&path, action, name, track_id)
}

fn update_at(
    path: &Path,
    action: &str,
    name: &str,
    track_id: Option<&str>,
) -> Result<Vec<Tag>, String> {
    save_changes(path, |tags| change(tags, action, name, track_id))
}

pub fn update_tracks(action: &str, name: &str, track_ids: &[String]) -> Result<Vec<Tag>, String> {
    let _guard = SAVE.lock().map_err(|e| e.to_string())?;
    update_tracks_at(
        &crate::paths::support().join("tags.json"),
        action,
        name,
        track_ids,
    )
}

fn update_tracks_at(
    path: &Path,
    action: &str,
    name: &str,
    track_ids: &[String],
) -> Result<Vec<Tag>, String> {
    if !matches!(action, "assign" | "unassign")
        || track_ids.is_empty()
        || track_ids.iter().any(|id| !crate::valid_id(id))
    {
        return Err("Choose library tracks and an assignment action.".into());
    }
    save_changes(path, |tags| {
        for id in track_ids {
            change(tags, action, name, Some(id))?;
        }
        Ok(())
    })
}

fn save_changes(
    path: &Path,
    change_tags: impl FnOnce(&mut Vec<Tag>) -> Result<(), String>,
) -> Result<Vec<Tag>, String> {
    let mut tags = read(path)?;
    change_tags(&mut tags)?;
    let save = || -> Result<(), Box<dyn std::error::Error>> {
        fs::create_dir_all(path.parent().ok_or("Missing tags directory")?)?;
        let tmp = path.with_extension("json.tmp");
        let mut file = fs::File::create(&tmp)?;
        file.write_all(&serde_json::to_vec_pretty(&tags)?)?;
        file.sync_all()?;
        drop(file);
        fs::rename(tmp, &path)?;
        Ok(())
    };
    save().map_err(|e| format!("Cannot save tags: {e}"))?;
    Ok(tags)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tags_are_many_to_many_and_assignment_is_idempotent() {
        let mut tags = vec![];
        let id = "a".repeat(64);
        for name in ["House", "Warm up"] {
            change(&mut tags, "create", name, None).unwrap();
            change(&mut tags, "assign", name, Some(&id)).unwrap();
            change(&mut tags, "assign", name, Some(&id)).unwrap();
        }
        assert!(tags.iter().all(|tag| tag.tracks == vec![id.clone()]));
        change(&mut tags, "unassign", "House", Some(&id)).unwrap();
        assert!(tags[0].tracks.is_empty());
        change(&mut tags, "delete", "House", None).unwrap();
        assert_eq!(tags[0].tracks, vec![id]);
    }
    #[test]
    fn saves_survive_reload_and_bad_files_are_not_overwritten() {
        let directory = std::env::temp_dir().join(format!("vira-tags-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("tags.json");
        update_at(&path, "create", "House", None).unwrap();
        update_at(&path, "assign", "House", Some(&"a".repeat(64))).unwrap();
        assert_eq!(read(&path).unwrap()[0].tracks, vec!["a".repeat(64)]);
        assert!(update_at(&path, "create", "HOUSE", None).is_err());
        assert_eq!(read(&path).unwrap().len(), 1);
        fs::write(&path, b"broken json").unwrap();
        assert!(update_at(&path, "create", "Other", None).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"broken json");
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn bulk_updates_are_atomic_and_preserve_other_tracks() {
        let directory =
            std::env::temp_dir().join(format!("vira-bulk-tags-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("tags.json");
        update_at(&path, "create", "House", None).unwrap();
        let ids = vec!["a".repeat(64), "b".repeat(64)];
        update_tracks_at(&path, "assign", "House", &ids).unwrap();
        assert_eq!(read(&path).unwrap()[0].tracks, ids);
        let before = fs::read(&path).unwrap();
        assert!(update_tracks_at(
            &path,
            "assign",
            "House",
            &["c".repeat(64), "invalid".into()]
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), before);
        update_tracks_at(&path, "unassign", "House", &[ids[0].clone()]).unwrap();
        assert_eq!(read(&path).unwrap()[0].tracks, vec![ids[1].clone()]);
        fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn validation_and_serialization_preserve_assignments() {
        let mut tags = vec![];
        change(&mut tags, "create", " House ", None).unwrap();
        assert!(change(&mut tags, "create", "house", None).is_err());
        assert!(change(&mut tags, "create", " ", None).is_err());
        assert!(change(&mut tags, "assign", "House", Some("../song")).is_err());
        change(&mut tags, "assign", "House", Some(&"b".repeat(64))).unwrap();
        let restored: Vec<Tag> =
            serde_json::from_slice(&serde_json::to_vec(&tags).unwrap()).unwrap();
        assert_eq!(restored[0].name, "House");
        assert_eq!(restored[0].tracks, tags[0].tracks);
    }
}
