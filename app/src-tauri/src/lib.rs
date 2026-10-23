use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};
mod active_deck;
mod audition_stream;
pub mod audio_benchmark;
mod audio_devices;
mod plugin_host;
mod progressive;
pub mod vst;
#[cfg(target_os = "macos")]
mod vst_window;
#[cfg(target_os = "macos")]
pub use audio_devices::check as check_audio_device;
#[cfg(target_os = "macos")]
pub use vst_window::check_editor as vst_editor_check;
mod audio_inputs;
mod cue_output;
mod deck_notes;
pub mod decks;
mod dsp;
#[cfg(target_os = "macos")]
mod history_menu;
mod instrument_output;
mod instruments;
#[cfg(target_os = "macos")]
mod keep_awake;
mod metrics;
mod midi_live;
mod midi_mapping;
mod midi_sync;
mod mixer;
pub mod native_check;
pub mod paths;
mod pattern_routing;
pub mod patterns;
mod rolling;
pub mod routing;
pub mod runtime;
pub mod sample_rate;
mod scheduling;
mod smart;
pub mod source;
mod tags;
pub mod teia;
pub mod teia_audio;
mod teia_bridge;
pub mod teia_facilities;
pub mod teia_midi;
pub mod teia_resources;
#[cfg(target_os = "macos")]
mod teia_window;
pub mod timing;
mod track_meta;

// Default location for existing installations; selected roots live in paths.json.
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
    #[serde(default)]
    pub timing_bpm: Option<f64>,
    #[serde(default)]
    pub metadata_key: Option<String>,
    pub analysis: Analysis,
    #[serde(default)]
    pub artwork_available: bool,
    #[serde(default)]
    pub collection: String,
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
    #[serde(default)]
    pub collections: Vec<String>,
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
                || track
                    .source_hash
                    .as_ref()
                    .is_some_and(|hash| !valid_id(hash))
                || (matches!(
                    track.analysis.state,
                    AnalysisState::Analysed | AnalysisState::NeedsReview | AnalysisState::Approved
                ) && track.analysis.result.is_none())
                || (!matches!(
                    track.analysis.state,
                    AnalysisState::Analysed
                        | AnalysisState::NeedsReview
                        | AnalysisState::Approved
                        | AnalysisState::Stale
                ) && track.analysis.result.is_some())
            {
                return Err("Preparation service returned invalid track metadata.".into());
            }
        }
        self.music_bin = paths::active().music.to_string_lossy().into_owned();
        Ok(self)
    }
}

pub fn scan_library() -> Result<Library, String> {
    paths::ensure_music_mount().map_err(|e| format!("{e:#}"))?;
    service_request("/v1/library/scan", None, true)
}

pub fn open_library() -> Result<Library, String> {
    paths::ensure_music_mount().map_err(|e| format!("{e:#}"))?;
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

pub fn request_key_analysis(track_id: &str) -> Result<Library, String> {
    if !valid_id(track_id) {
        return Err("Key analysis requires a library track ID.".into());
    }
    service_request(
        "/v1/analysis/key",
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
    // Share the runtime and connection pool across library/artwork requests. A
    // client per cover creates a burst of runtimes and descriptors on macOS.
    static CLIENT: std::sync::OnceLock<Result<reqwest::blocking::Client, String>> =
        std::sync::OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::blocking::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(120))
                .pool_max_idle_per_host(4)
                .build()
                .map_err(|e| format!("Cannot create preparation client: {e}"))
        })
        .as_ref()
        .map_err(Clone::clone)?;
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
    // The artwork endpoint resolves and validates the opaque ID itself. Fetching
    // the whole library here multiplies analysis payloads by the number of covers.
    let response = service_response(&format!("/v1/artwork/{track_id}"), None, false)?;
    if response.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(None);
    }
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
    let mut keep_awake = match keep_awake::KeepAwake::start() {
        Ok(guard) => Some(guard),
        Err(error) => {
            eprintln!("VIRA could not start sleep prevention: {error}");
            None
        }
    };
    // The first CoreMIDI client must belong to the running main event loop.
    if let Err(error) = midi_live::initialize() {
        eprintln!("{error}");
    }
    // Saved MIDI sync outputs must work before Instruments or Patterns is opened.
    patterns::start();
    #[tauri::command]
    async fn get_tags() -> Result<Vec<tags::Tag>, String> {
        tauri::async_runtime::spawn_blocking(tags::get)
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn update_tag(
        action: String,
        name: String,
        track_id: Option<String>,
    ) -> Result<Vec<tags::Tag>, String> {
        tauri::async_runtime::spawn_blocking(move || {
            tags::update(&action, &name, track_id.as_deref())
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    async fn update_tag_tracks(
        action: String,
        name: String,
        track_ids: Vec<String>,
    ) -> Result<Vec<tags::Tag>, String> {
        tauri::async_runtime::spawn_blocking(move || {
            tags::update_tracks(&action, &name, &track_ids)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    #[tauri::command]
    async fn refresh_library() -> Result<Library, String> {
        // Refresh verifies in the background, just like startup, so probing a
        // large library or yielding to deck loads cannot time out the request.
        tauri::async_runtime::spawn_blocking(crate::open_library)
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
    async fn analyse_track_key(track_id: String) -> Result<Library, String> {
        tauri::async_runtime::spawn_blocking(move || request_key_analysis(&track_id))
            .await
            .map_err(|e| format!("Key analysis request worker failed: {e}"))?
    }
    #[tauri::command]
    async fn save_track_metadata(
        track_id: String,
        metadata: serde_json::Value,
    ) -> Result<Library, String> {
        if !valid_id(&track_id) {
            return Err("Metadata requires a library track ID.".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            service_request(
                "/v1/metadata/save",
                Some(serde_json::json!({"track_id": track_id, "metadata": metadata})),
                true,
            )
        })
        .await
        .map_err(|e| format!("Metadata worker failed: {e}"))?
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
    fn get_instruments() -> Vec<instruments::Instrument> {
        instruments::list()
    }
    #[tauri::command]
    fn get_instrument_devices() -> Result<serde_json::Value, String> {
        instruments::devices().map_err(|e| e.to_string())
    }
    #[tauri::command]
    async fn save_instruments(
        items: Vec<instruments::Instrument>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let previous = instruments::list();
            instruments::save(items).map_err(|e| e.to_string())?;
            let mut graph = engine.routing_graph();
            graph.nodes.retain(|node| {
                if node.id.starts_with("instrument-in-") {
                    instruments::audio(&node.id, true).is_ok()
                } else if node.id.starts_with("instrument-out-") {
                    instruments::audio(&node.id, false).is_ok()
                } else {
                    true
                }
            });
            graph.wires.retain(|w| {
                graph.nodes.iter().any(|n| n.id == w.from)
                    && graph.nodes.iter().any(|n| n.id == w.to)
            });
            if let Err(error) = engine.set_routing_graph(graph) {
                instruments::save(previous).map_err(|rollback| format!("Audio routing failed: {error}; restoring instrument definitions also failed: {rollback}"))?;
                return Err(format!("Changes not saved; audio routing could not be reopened: {error}"));
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn default_routing_graph() -> routing::Graph {
        routing::Graph::default()
    }
    #[tauri::command]
    fn get_audio_inputs() -> Result<Vec<routing::Node>, String> {
        crate::audio_inputs::nodes().map_err(|e| e.to_string())
    }
    #[tauri::command]
    fn get_routing_graph(
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> routing::Graph {
        state.routing_graph()
    }
    #[tauri::command]
    fn get_rolling_waveforms(
        selected: Vec<String>,
        after: u64,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> serde_json::Value {
        state.rolling_waveforms(&selected, after)
    }
    #[tauri::command]
    async fn set_routing_parameters(
        window: tauri::WebviewWindow,
        parameters: routing::Parameters,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<routing::Graph, String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .set_routing_parameters(parameters)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn set_routing_graph(
        graph: routing::Graph,
        app: tauri::AppHandle,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let prepare_graph = graph.clone();
        crate::vst_window::ui(app, move |_| {
            for node in &prepare_graph.nodes {
                let Some(descriptor) = &node.vst else {
                    continue;
                };
                if crate::vst::instance(&node.id).is_none() {
                    if let Err(e) = crate::vst::prepare(&node.id, descriptor) {
                        crate::vst::report_error(format!("{} remains offline: {e:#}", node.label));
                    }
                }
            }
            crate::vst::snapshot(&prepare_graph)
        })
        .await?;
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .apply_session_routing(graph)
                .map_err(|e| e.to_string())
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
        app: tauri::AppHandle,
        master: Option<String>,
        cue: Option<String>,
        master_channels: Option<[u16; 2]>,
        cue_channels: Option<[u16; 2]>,
        working_rate: Option<u32>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let engine = state.inner().clone();
        let restart = tauri::async_runtime::spawn_blocking(move || {
            engine
                .set_audio_devices(crate::audio_devices::Routes {
                    master,
                    cue,
                    working_rate,
                    master_channels: master_channels.unwrap_or([1, 2]),
                    cue_channels: cue_channels.unwrap_or([1, 2]),
                })
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;
        if restart {
            app.restart();
        }
        Ok(())
    }
    #[tauri::command]
    async fn get_audio_levels(
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<runtime::AudioLevels, String> {
        Ok(state.audio_levels())
    }
    #[tauri::command]
    async fn get_deck_positions(
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<serde_json::Value, String> {
        Ok(state.deck_positions())
    }
    #[tauri::command]
    async fn audition_track(
        track_id: String,
        output: Option<String>,
        start_seconds: Option<f64>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<u64, String> {
        let engine = state.inner().clone();
        let master = output.as_deref() == Some("master");
        let generation = engine.begin_audition(master).map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .load_audition_at(generation, &track_id, master, start_seconds.unwrap_or(0.))
                .map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn queue_audition(
        generation: u64,
        index: u64,
        track_id: String,
        output: Option<String>,
        current_track_id: Option<String>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        let engine = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            engine
                .queue_audition(
                    generation,
                    index,
                    &track_id,
                    output.as_deref() == Some("master"),
                    current_track_id.as_deref(),
                )
                .map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn audition_control(
        action: String,
        generation: u64,
        value: Option<f64>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        state
            .audition_control(&action, generation, value)
            .map_err(|e| format!("{e:#}"))
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
                .load_progressive(
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
        preserve_speed: Option<bool>,
        follow_clock: Option<bool>,
        tapped: Option<bool>,
        state: tauri::State<'_, std::sync::Arc<runtime::EngineHandle>>,
    ) -> Result<(), String> {
        state
            .apply_grid(
                deck,
                generation,
                grid,
                preserve_speed.unwrap_or(false),
                follow_clock.unwrap_or(false),
                tapped.unwrap_or(false),
            )
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
    #[tauri::command]
    async fn get_path_settings(window: tauri::WebviewWindow) -> Result<paths::Settings, String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        tauri::async_runtime::spawn_blocking(|| paths::settings().map_err(|e| format!("{e:#}")))
            .await
            .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn reveal_track_in_finder(
        window: tauri::WebviewWindow,
        track_id: String,
    ) -> Result<(), String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            if !valid_id(&track_id) {
                return Err("Invalid library track ID".into());
            }
            let library = library_state()?;
            let track = library
                .tracks
                .iter()
                .find(|track| track.id == track_id)
                .ok_or("The selected track is no longer in the library")?;
            let root = if track.collection.is_empty() {
                &library.music_bin
            } else {
                &track.collection
            };
            let path = std::path::Path::new(root).join(&track.filename);
            if !path.is_absolute() || !path.is_file() {
                return Err("The selected track file is unavailable".into());
            }
            let output = std::process::Command::new("/usr/bin/open")
                .arg("-R")
                .arg(&path)
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).into_owned());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn open_settings_folder(
        window: tauri::WebviewWindow,
        path: String,
    ) -> Result<(), String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            let folder = std::path::Path::new(&path);
            if !folder.is_absolute() || !folder.is_dir() {
                return Err("The selected folder is unavailable".into());
            }
            let output = std::process::Command::new("/usr/bin/open")
                .args(["-a", "Finder", &path])
                .output()
                .map_err(|e| e.to_string())?;
            if !output.status.success() {
                return Err(String::from_utf8_lossy(&output.stderr).into_owned());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn remove_music_folder(
        window: tauri::WebviewWindow,
        path: String,
    ) -> Result<paths::Settings, String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            paths::remove_music(std::path::Path::new(&path)).map_err(|e| format!("{e:#}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    async fn choose_library_folder(
        window: tauri::WebviewWindow,
        kind: String,
    ) -> Result<Option<paths::Settings>, String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            let prompt = match kind.as_str() { "music" => "Choose VIRA's music folder", "patches" => "Choose VIRA's Teia patch folder", _ => return Err("Unknown library folder".into()) };
            // Static AppleScript with an argument; folder names never become code.
            let output = std::process::Command::new("/usr/bin/osascript").args(["-e", "on run argv\ntry\nreturn POSIX path of (choose folder with prompt (item 1 of argv))\non error number -128\nreturn \"\"\nend try\nend run", prompt]).output().map_err(|e| e.to_string())?;
            if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).into_owned()); }
            let path = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
            let path = path.trim_end_matches('\n');
            if path.is_empty() { return Ok(None); }
            paths::select(&kind, std::path::Path::new(path)).map(Some).map_err(|e| format!("{e:#}"))
        }).await.map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn patterns_state(window: tauri::WebviewWindow) -> Result<serde_json::Value, String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        Ok(patterns::state())
    }
    #[tauri::command]
    async fn patterns_save(
        window: tauri::WebviewWindow,
        bank: patterns::Bank,
    ) -> Result<(), String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        tauri::async_runtime::spawn_blocking(move || {
            patterns::save(bank).map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[tauri::command]
    fn patterns_transport(
        window: tauri::WebviewWindow,
        id: String,
        play: bool,
    ) -> Result<(), String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        patterns::transport(id, play).map_err(|e| e.to_string())
    }
    #[tauri::command]
    fn patterns_select_deck(window: tauri::WebviewWindow, deck: usize) -> Result<(), String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        if deck > 1 {
            return Err("Select deck A or B".into());
        }
        patterns::publish_selected_deck(deck);
        Ok(())
    }
    #[tauri::command]
    fn patterns_deck_keys(
        window: tauri::WebviewWindow,
        keys: [Option<pattern_routing::Harmony>; 2],
    ) -> Result<(), String> {
        if window.label() != "main" {
            return Err("Main-window command".into());
        }
        patterns::deck_keys(keys).map_err(|e| e.to_string())
    }
    vst_window::restore();
    std::thread::spawn(vst::scan);
    tauri::Builder::default()
        .menu(history_menu::menu)
        .on_menu_event(history_menu::handle)
        .manage(runtime::EngineHandle::new())
        .invoke_handler(tauri::generate_handler![
            vst_window::vst_catalog,
            vst_window::vst_paths,
            vst_window::vst_default_paths,
            vst_window::vst_choose_folder,
            vst_window::vst_save_paths,
            vst_window::vst_rescan,
            vst_window::vst_prepare,
            vst_window::vst_open_editor,
            vst_window::vst_retain,
            vst_window::vst_parameters,
            vst_window::vst_set_parameter,
            vst_window::vst_recover,
            midi_mapping::midi_mapping_poll,
            midi_mapping::get_midi_devices,
            patterns_deck_keys,
            patterns_select_deck,
            patterns_state,
            patterns_save,
            patterns_transport,
            get_tags,
            update_tag,
            update_tag_tracks,
            get_path_settings,
            open_settings_folder,
            reveal_track_in_finder,
            remove_music_folder,
            choose_library_folder,
            open_library,
            refresh_library,
            get_library_state,
            analyse_track,
            approve_track_analysis,
            save_track_metadata,
            analyse_track_key,
            get_track_artwork,
            get_audio_state,
            get_routing_graph,
            get_rolling_waveforms,
            get_audio_inputs,
            default_routing_graph,
            get_instruments,
            get_instrument_devices,
            save_instruments,
            set_routing_graph,
            set_routing_parameters,
            get_audio_levels,
            get_deck_positions,
            get_audio_devices,
            set_audio_devices,
            load_track,
            audition_track,
            queue_audition,
            audition_control,
            deck_control,
            track_timing,
            apply_timing,
            timing_waveform,
            record_render_metrics,
            teia_window::patches_state,
            teia_window::patches_add,
            teia_window::patches_control,
            teia_window::patches_remove,
            teia_window::teia_library,
            teia_window::teia_read,
            teia_window::teia_import,
            teia_window::teia_load,
            teia_window::teia_state,
            teia_window::teia_control,
            teia_window::teia_open_editor,
            teia_window::teia_editor_init,
            teia_window::teia_feedback,
            teia_window::teia_request,
            teia_window::teia_import_media,
            teia_window::teia_media_preview,
            teia_window::teia_midi_configure,
            teia_window::teia_load_draft
        ])
        .setup(|app| {
            vst_window::maintenance(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Unable to start VIRA")
        .run(move |_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                vst_window::save_all();
                drop(keep_awake.take());
                patterns::shutdown();
            }
        });
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
    fn library_round_trip_preserves_saved_timing_bpm() {
        let legacy = library("test.wav");
        assert_eq!(legacy.tracks[0].timing_bpm, None);
        let mut payload = serde_json::to_value(legacy).unwrap();
        payload["tracks"][0]["timing_bpm"] = serde_json::json!(171.93946);
        let decoded = serde_json::from_value::<Library>(payload)
            .unwrap()
            .validate()
            .unwrap();
        assert_eq!(decoded.tracks[0].timing_bpm, Some(171.93946));
        let frontend_payload = serde_json::to_value(decoded).unwrap();
        assert_eq!(frontend_payload["tracks"][0]["timing_bpm"], 171.93946);
    }
    #[test]
    fn library_preserves_manual_key_without_analysis() {
        let mut value = library("test.wav");
        value.tracks[0].metadata_key = Some("F# minor".into());
        let payload = serde_json::to_value(value.validate().unwrap()).unwrap();
        assert_eq!(payload["tracks"][0]["metadata_key"], "F# minor");
        assert!(payload["tracks"][0]["analysis"]["result"].is_null());
    }
    #[test]
    fn validates_identity_and_configured_bin() {
        assert_eq!(
            library("test.wav").validate().unwrap().music_bin,
            paths::active().music.to_string_lossy()
        );
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
        let mut stale = library("test.wav");
        stale.tracks[0].analysis.state = AnalysisState::Stale;
        stale.tracks[0].analysis.result = Some(serde_json::json!({"grid": {"bpm": 120}}));
        assert!(stale.validate().is_ok());
        let mut bad = library("test.wav");
        bad.tracks[0].source_hash = None;
        assert!(bad.validate().is_ok()); // Collection rows are not hashed until use.
        let mut bad = library("test.wav");
        bad.tracks[0].source_hash = Some("invalid".into());
        assert!(bad.validate().is_err());
    }

    #[test]
    fn base64_encoding_handles_padding() {
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
    }
}
