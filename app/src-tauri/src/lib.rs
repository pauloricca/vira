use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};
pub mod audio_benchmark;
mod audio_devices;
mod cue_output;
pub mod decks;
mod dsp;
mod metrics;
mod mixer;
pub mod native_check;
pub mod routing;
pub mod runtime;
mod scheduling;
pub mod source;
pub mod timing;

// The single application configuration constant; never derive the bin from cwd.
pub const MUSIC_BIN: &str = "/Users/pauloricca/Desktop/projects/vira/music";
const SERVICE_URL: &str = "http://127.0.0.1:47831";
const START_SERVICE: &str = "Start the preparation service: cd /Users/pauloricca/Desktop/projects/vira/app && docker compose up -d preparation. Then click Refresh.";

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Ready,
    Unsupported,
    Unreadable,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Track {
    pub id: String,
    pub filename: String,
    pub title: String,
    pub artist: String,
    pub duration_seconds: Option<f64>,
    pub size_bytes: u64,
    pub modified_ns: String,
    pub status: FileStatus,
    pub error: Option<String>,
    pub source_hash: Option<String>,
    pub analysis: Analysis,
    #[serde(default)]
    pub artwork_available: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AnalysisState {
    NotAnalysed,
    Queued,
    Analysing,
    Analysed,
    NeedsReview,
    Approved,
    Stale,
    Failed,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Analysis {
    pub state: AnalysisState,
    pub error: Option<String>,
    pub result: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Library {
    pub schema_version: u32,
    #[serde(default)]
    pub music_bin: String,
    pub tracks: Vec<Track>,
    pub revision: u64,
    pub instance_id: String,
    #[serde(default)]
    pub scan_pending: bool,
    #[serde(default)]
    pub scan_error: Option<String>,
}

impl Library {
    fn validate(mut self) -> Result<Self, String> {
        if self.schema_version != 2 {
            return Err(
                "Preparation service version mismatch. Rebuild the preparation service.".into(),
            );
        }
        let mut ids = HashSet::new();
        for track in &self.tracks {
            if track.filename.is_empty()
                || track.filename.contains('/')
                || matches!(track.filename.as_str(), "." | "..")
                || track.id.len() != 64
                || !track.id.bytes().all(|c| c.is_ascii_hexdigit())
                || !ids.insert(&track.id)
                || track
                    .duration_seconds
                    .is_some_and(|d| !d.is_finite() || d <= 0.0)
                || (matches!(track.status, FileStatus::Ready) && track.duration_seconds.is_none())
                || (matches!(track.status, FileStatus::Ready)
                    && !track
                        .source_hash
                        .as_ref()
                        .is_some_and(|hash| valid_id(hash)))
                || (matches!(
                    track.analysis.state,
                    AnalysisState::Analysed | AnalysisState::NeedsReview | AnalysisState::Approved
                ) && track.analysis.result.is_none())
                || (!matches!(
                    track.analysis.state,
                    AnalysisState::Analysed | AnalysisState::NeedsReview | AnalysisState::Approved
                ) && track.analysis.result.is_some())
            {
                return Err("Preparation service returned invalid track metadata.".into());
            }
        }
        self.music_bin = MUSIC_BIN.into();
        Ok(self)
    }
}

pub fn scan_library() -> Result<Library, String> {
    service_request("/v1/library/scan", None, true)
}

pub fn open_library() -> Result<Library, String> {
    service_request("/v1/library/open", None, true)
}

pub fn library_state() -> Result<Library, String> {
    service_request("/v1/library/state", None, false)
}

fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

pub fn request_analysis(track_id: &str) -> Result<Library, String> {
    if !valid_id(track_id) {
        return Err("Analysis requires a library track ID.".into());
    }
    let library = library_state()?;
    if !library
        .tracks
        .iter()
        .any(|track| track.id == track_id && matches!(track.status, FileStatus::Ready))
    {
        return Err("Track is unavailable or changed. Refresh the library.".into());
    }
    service_request(
        "/v1/analysis",
        Some(serde_json::json!({ "track_id": track_id })),
        true,
    )
}

pub fn approve_analysis(track_id: &str) -> Result<Library, String> {
    if !valid_id(track_id) {
        return Err("Analysis approval requires a library track ID.".into());
    }
    service_request(
        "/v1/analysis/approve",
        Some(serde_json::json!({ "track_id": track_id })),
        true,
    )
}

fn service_request(
    endpoint: &str,
    body: Option<serde_json::Value>,
    post: bool,
) -> Result<Library, String> {
    service_response(endpoint, body, post)?
        .json::<Library>()
        .map_err(|_| "Invalid response from preparation service. Rebuild the service.".to_string())?
        .validate()
}

fn service_response(
    endpoint: &str,
    body: Option<serde_json::Value>,
    post: bool,
) -> Result<reqwest::blocking::Response, String> {
    // Called on an ordinary background thread, never the webview or audio callback.
    let client = reqwest::blocking::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Cannot create preparation client: {e}"))?;
    let url = format!("{SERVICE_URL}{endpoint}");
    let mut request = if post {
        client.post(url)
    } else {
        client.get(url)
    };
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().map_err(|_| {
        format!("Preparation service unavailable or scan timed out. {START_SERVICE}")
    })?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response
            .json::<serde_json::Value>()
            .ok()
            .and_then(|v| v.get("error")?.as_str().map(str::to_owned))
            .unwrap_or_else(|| "Check the preparation service logs.".into());
        return Err(format!("Preparation service ({status}): {detail}"));
    }
    Ok(response)
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        encoded.push(TABLE[((value >> 18) & 63) as usize] as char);
        encoded.push(TABLE[((value >> 12) & 63) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            TABLE[((value >> 6) & 63) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            TABLE[(value & 63) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

pub fn track_artwork(track_id: &str) -> Result<Option<String>, String> {
    if !valid_id(track_id) {
        return Err("Artwork requires a library track ID.".into());
    }
    let library = library_state()?;
    let track = library
        .tracks
        .iter()
        .find(|track| track.id == track_id)
        .ok_or("Track is unavailable or changed. Refresh the library.")?;
    if !matches!(track.status, FileStatus::Ready) || !track.artwork_available {
        return Ok(None);
    }
    let response = service_response(&format!("/v1/artwork/{track_id}"), None, false)?;
    let mime = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_owned();
    let bytes = response
        .bytes()
        .map_err(|_| "Cannot read embedded artwork.".to_string())?;
    if bytes.is_empty() || bytes.len() > 5 * 1024 * 1024 {
        return Err("Embedded artwork is empty or too large.".into());
    }
    Ok(Some(format!(
        "data:{mime};base64,{}",
        encode_base64(&bytes)
    )))
}

#[cfg(target_os = "macos")]
pub fn run() {
    #[tauri::command]
    async fn refresh_library() -> Result<Library, String> {
        tauri::async_runtime::spawn_blocking(scan_library)
            .await
            .map_err(|e| format!("Library scan worker failed: {e}"))?
    }
    #[tauri::command]
    async fn open_library() -> Result<Library, String> {
        tauri::async_runtime::spawn_blocking(crate::open_library)
            .await
            .map_err(|e| format!("Library opening worker failed: {e}"))?
    }
    #[tauri::command]
    async fn get_library_state() -> Result<Library, String> {
        tauri::async_runtime::spawn_blocking(library_state)
            .await
            .map_err(|e| format!("Library state worker failed: {e}"))?
    }
    #[tauri::command]
    async fn analyse_track(track_id: String) -> Result<Library, String> {
        tauri::async_runtime::spawn_blocking(move || request_analysis(&track_id))
            .await
            .map_err(|e| format!("Analysis request worker failed: {e}"))?
    }
    #[tauri::command]
    async fn approve_track_analysis(track_id: String) -> Result<Library, String> {
        tauri::async_runtime::spawn_blocking(move || approve_analysis(&track_id))
            .await
            .map_err(|e| format!("Analysis approval worker failed: {e}"))?
    }
    #[tauri::command]
    async fn get_track_artwork(track_id: String) -> Result<Option<String>, String> {
        tauri::async_runtime::spawn_blocking(move || track_artwork(&track_id))
            .await
            .map_err(|e| format!("Artwork worker failed: {e}"))?
    }
    #[tauri::command]
    fn default_routing_graph() -> routing::Graph {
        routing::Graph::default()
    }
    #[tauri::command]
    fn get_routing_graph(
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> routing::Graph {
        state.routing_graph()
    }
    #[tauri::command]
    async fn set_routing_graph(
        graph: routing::Graph,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine.set_routing_graph(graph).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn get_audio_state(
        known_generations: Option<[u64; 2]>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<serde_json::Value, String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || engine.state_for_frontend(known_generations))
            .await
            .map_err(|e| e.to_string())
    }
    #[tauri::command]
    async fn get_audio_devices(
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<serde_json::Value, String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine.audio_devices().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn set_audio_devices(
        master: Option<String>,
        cue: Option<String>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .set_audio_devices(crate::audio_devices::Routes { master, cue })
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn get_audio_levels(
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<runtime::AudioLevels, String> {
        Ok(state.audio_levels())
    }
    #[tauri::command]
    async fn load_track(
        deck: usize,
        track_id: String,
        preserve_lock: Option<bool>,
        reset_mixer: Option<bool>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let engine = state.inner().clone();
        let generation = engine.begin_load(deck).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .load(
                    deck,
                    generation,
                    &track_id,
                    preserve_lock.unwrap_or(true),
                    reset_mixer.unwrap_or(true),
                )
                .map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn deck_control(
        deck: usize,
        action: String,
        value: Option<f64>,
        generation: u64,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        state
            .control_for_generation(deck, &action, value, Some(generation))
            .map_err(|e| format!("{e:#}"))
    }
    #[tauri::command]
    async fn track_timing(
        track_id: String,
        grid: Option<timing::Grid>,
        reference_beats: Option<Vec<f64>>,
    ) -> Result<serde_json::Value, String> {
        tauri::async_runtime::spawn_blocking(move || {
            if !valid_id(&track_id) {
                return Err("Timing requires a library track ID".into());
            }
            let body = match grid {
                Some(grid) if reference_beats.is_some() => serde_json::json!({"track_id": track_id, "grid": grid, "reference_beats": reference_beats}),
                Some(grid) => serde_json::json!({"track_id": track_id, "grid": grid}),
                None => serde_json::json!({"track_id": track_id}),
            };
            service_response(
                if grid.is_some() {
                    "/v1/timing/save"
                } else {
                    "/v1/timing/get"
                },
                Some(body),
                true,
            )?
            .json()
            .map_err(|e| format!("Invalid timing response: {e}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn timing_waveform(
        deck: usize,
        generation: u64,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<runtime::Waveform, String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .waveform_for_generation(deck, generation)
                .map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn apply_timing(
        deck: usize,
        generation: u64,
        grid: timing::Grid,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        state
            .apply_grid(deck, generation, grid)
            .map_err(|e| format!("{e:#}"))
    }
    #[tauri::command]
    async fn record_render_metrics(
        mut metrics: serde_json::Value,
        app: tauri::AppHandle,
    ) -> Result<(), String> {
        use tauri::Manager;
        metrics["native_window_focused"] = serde_json::json!(app
            .get_webview_window("main")
            .is_some_and(|w| w.is_focused().unwrap_or(false)));
        tauri::async_runtime::spawn_blocking(move || {
            let stage = metrics["stage"].as_str().ok_or("Missing rendering stage")?;
            if !matches!(stage, "svg-baseline" | "canvas") {
                return Err("Invalid rendering stage".to_string());
            }
            let dir = std::path::Path::new("/Users/pauloricca/Desktop/projects/vira/app/output");
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            let path = dir.join(format!("render-{stage}.jsonl"));
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .map_err(|e| e.to_string())?;
            writeln!(file, "{}", metrics).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    tauri::Builder::default()
        .manage(runtime::EngineHandle::new())
        .invoke_handler(tauri::generate_handler![
            open_library,
            refresh_library,
            get_library_state,
            analyse_track,
            approve_track_analysis,
            get_track_artwork,
            get_audio_state,
            get_routing_graph,
            default_routing_graph,
            set_routing_graph,
            get_audio_levels,
            get_audio_devices,
            set_audio_devices,
            load_track,
            deck_control,
            track_timing,
            apply_timing,
            timing_waveform,
            record_render_metrics
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start VIRA");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn library(filename: &str) -> Library {
        serde_json::from_value(serde_json::json!({
            "schema_version": 2, "revision": 1, "instance_id": "test", "tracks": [{ "id": "a".repeat(64), "filename": filename,
            "title": "Test", "artist": "Unknown artist", "duration_seconds": 2.0,
            "size_bytes": 1, "modified_ns": "2", "status": "ready", "error": null,
            "source_hash": "b".repeat(64), "analysis": {"state":"not_analysed", "result":null,"error":null} }]
        }))
        .unwrap()
    }
    #[test]
    fn validates_identity_and_fixed_bin() {
        assert_eq!(library("test.wav").validate().unwrap().music_bin, MUSIC_BIN);
        assert!(library("../test.wav").validate().is_err());
        let mut bad = library("test.wav");
        bad.tracks[0].duration_seconds = None;
        assert!(bad.validate().is_err());
    }
    #[test]
    fn rejects_incompatible_schema_and_duplicate_ids() {
        let mut bad = library("test.wav");
        bad.schema_version = 3;
        assert!(bad.validate().is_err());
        let mut bad = library("test.wav");
        bad.tracks.push(library("other.wav").tracks.remove(0));
        assert!(bad.validate().is_err());
    }
    #[test]
    fn rejects_paths_and_results_for_incomplete_jobs() {
        assert!(request_analysis("../music/track.mp3").is_err());
        let mut bad = library("test.wav");
        bad.tracks[0].analysis.result = Some(serde_json::json!({"grid": {"bpm": 120}}));
        assert!(bad.validate().is_err());
        let mut bad = library("test.wav");
        bad.tracks[0].source_hash = None;
        assert!(bad.validate().is_err());
    }

    #[test]
    fn base64_encoding_handles_padding() {
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
    }
}
