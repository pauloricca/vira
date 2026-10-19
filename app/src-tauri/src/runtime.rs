//! Long-lived two-deck producer, bounded queues and thin native output callback.
use crate::{
    decks::{Command, Decks, Frame, Voice, PRODUCER_FRAMES, QUEUE_FRAMES},
    metrics::{self, CallbackStats},
    scheduling::Wake,
    source::{self, Prepared, Source},
};
use anyhow::{ensure, Result};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{
            AtomicBool, AtomicU64,
            Ordering::{Acquire, Relaxed, Release},
        },
        Arc, Mutex, Weak,
    },
    time::Instant,
};

struct Shared {
    master_volume: AtomicU64,
    cue_volume: AtomicU64,
    routes: Mutex<crate::audio_devices::Routes>,
    inputs: crate::audio_inputs::Inputs,
    cue_running: AtomicBool,
    cue_error: Mutex<Option<String>>,
    cue_device_errors: AtomicU64,
    headphone_cue: [AtomicBool; 2],
    auto_mode: [AtomicU64; 2],
    auto_fast: AtomicBool,
    auto_points: [[AtomicU64; 5]; 2],
    auto_remaining: [AtomicU64; 5],
    auto_style: AtomicU64,
    auto_started: AtomicBool,
    crossfader: AtomicU64,
    crossfader_enabled: AtomicBool,
    cancel: AtomicBool,
    worker_cancel: AtomicBool,
    requested: [AtomicU64; 2],
    audition_generation: AtomicU64,
    audition_position: AtomicU64,
    audition_index: AtomicU64,
    audition_playing: AtomicBool,
    sequence: AtomicU64,
    positions: [AtomicU64; 2],
    position_epochs: [AtomicU64; 2],
    generations: [AtomicU64; 2],
    playing: [AtomicBool; 2],
    rejected_load: [AtomicU64; 2],
    cue_positions: [AtomicU64; 2],
    cue_preview: [AtomicBool; 2],
    loop_starts: [AtomicU64; 2],
    loop_ends: [AtomicU64; 2],
    loop_lengths: [AtomicU64; 2],
    loop_release_pending: [AtomicBool; 2],
    slip_enabled: [AtomicBool; 2],
    gains: [AtomicU64; 2],
    meter_decks: [AtomicU64; 2],
    meter_master: [AtomicU64; 2],
    mixer: [[AtomicU64; 5]; 2],
    grid_bpm: [AtomicU64; 2],
    grid_anchor: [AtomicU64; 2],
    reviewed: [AtomicBool; 2],
    targets: [AtomicU64; 2],
    pitches: [AtomicU64; 2],
    synced: [AtomicBool; 2],
    launch_pending: [AtomicBool; 2],
    clicks: [AtomicU64; 2],
    timing_errors: [AtomicU64; 2],
    reposition: [AtomicU64; 2],
    master_bpm: AtomicU64,
    master_bpm_set: AtomicBool,
    drift_rate: AtomicU64,
    sync_quantum: AtomicU64,
    drift_target: AtomicU64,
    output_frame: AtomicU64,
    global_beat: AtomicU64,
    running: AtomicBool,
    realtime: AtomicBool,
    realtime_at_end: AtomicBool,
    worker_max_ns: AtomicU64,
    worker_slow_chunks: AtomicU64,
    scheduling_errors: AtomicU64,
    wait_errors: AtomicU64,
    max_callback_interval_us: AtomicU64,
    stats: CallbackStats,
    error: Mutex<Option<String>>,
    device: Mutex<Option<String>>,
    resources: Mutex<Value>,
}

#[derive(Serialize)]
pub struct AudioLevels {
    pub decks: [f32; 2],
    pub master: [f32; 2],
    pub running: bool,
}

impl Shared {
    fn new() -> Self {
        Self {
            master_volume: (1_f32.to_bits() as u64).into(),
            cue_volume: (1_f32.to_bits() as u64).into(),
            inputs: crate::audio_inputs::Inputs::default(),
            cancel: false.into(),
            routes: Mutex::new(crate::audio_devices::Routes::load()),
            cue_running: false.into(),
            cue_error: Mutex::new(None),
            cue_device_errors: 0.into(),
            headphone_cue: std::array::from_fn(|_| false.into()),
            auto_mode: std::array::from_fn(|_| 0.into()),
            auto_fast: false.into(),
            auto_points: std::array::from_fn(|_| std::array::from_fn(|_| 0.into())),
            auto_remaining: std::array::from_fn(|_| 0.into()),
            auto_style: 0.into(),
            auto_started: false.into(),
            crossfader: (0_f32.to_bits() as u64).into(),
            crossfader_enabled: true.into(),
            worker_cancel: false.into(),
            requested: std::array::from_fn(|_| 0.into()),
            audition_generation: 0.into(),
            audition_position: 0.into(),
            audition_index: 0.into(),
            audition_playing: false.into(),
            sequence: 0.into(),
            positions: std::array::from_fn(|_| 0.into()),
            position_epochs: std::array::from_fn(|_| 0.into()),
            generations: std::array::from_fn(|_| 0.into()),
            playing: std::array::from_fn(|_| false.into()),
            rejected_load: std::array::from_fn(|_| 0.into()),
            cue_positions: std::array::from_fn(|_| 0.into()),
            cue_preview: std::array::from_fn(|_| false.into()),
            loop_starts: std::array::from_fn(|_| u64::MAX.into()),
            loop_ends: std::array::from_fn(|_| u64::MAX.into()),
            loop_lengths: std::array::from_fn(|_| 0_f64.to_bits().into()),
            loop_release_pending: std::array::from_fn(|_| false.into()),
            slip_enabled: std::array::from_fn(|_| false.into()),
            gains: std::array::from_fn(|_| (0.8_f32.to_bits() as u64).into()),
            meter_decks: std::array::from_fn(|_| 0.into()),
            meter_master: std::array::from_fn(|_| 0.into()),
            mixer: std::array::from_fn(|_| {
                [0., 0.5_f32, 0.5, 0.5, 0.].map(|v| (v.to_bits() as u64).into())
            }),
            grid_bpm: std::array::from_fn(|_| 0.into()),
            grid_anchor: std::array::from_fn(|_| 0.into()),
            reviewed: std::array::from_fn(|_| false.into()),
            targets: std::array::from_fn(|_| 0.into()),
            pitches: std::array::from_fn(|_| 0.into()),
            synced: std::array::from_fn(|_| false.into()),
            launch_pending: std::array::from_fn(|_| false.into()),
            clicks: std::array::from_fn(|_| 0.into()),
            timing_errors: std::array::from_fn(|_| 0.into()),
            reposition: std::array::from_fn(|_| 0.into()),
            master_bpm: 120_f64.to_bits().into(),
            master_bpm_set: false.into(),
            drift_rate: 1_f64.to_bits().into(),
            sync_quantum: 4.into(),
            drift_target: 2.into(),
            output_frame: 0.into(),
            global_beat: 0.into(),
            running: false.into(),
            realtime: false.into(),
            realtime_at_end: false.into(),
            worker_max_ns: 0.into(),
            worker_slow_chunks: 0.into(),
            scheduling_errors: 0.into(),
            wait_errors: 0.into(),
            max_callback_interval_us: 0.into(),
            stats: CallbackStats::default(),
            error: Mutex::new(None),
            device: Mutex::new(None),
            resources: Mutex::new(json!({})),
        }
    }
    fn audible(&self) -> Frame {
        loop {
            let start = self.sequence.load(Acquire);
            if start % 2 != 0 {
                std::hint::spin_loop();
                continue;
            }
            let position = std::array::from_fn(|d| self.positions[d].load(Relaxed));
            let generation = std::array::from_fn(|d| self.generations[d].load(Relaxed));
            let playing = std::array::from_fn(|d| self.playing[d].load(Relaxed));
            let gain = std::array::from_fn(|d| f32::from_bits(self.gains[d].load(Relaxed) as u32));
            let frame = Frame {
                audition_generation: self.audition_generation.load(Relaxed),
                audition_position: self.audition_position.load(Relaxed),
                audition_index: self.audition_index.load(Relaxed),
                audition_playing: self.audition_playing.load(Relaxed),
                auto_mode: std::array::from_fn(|d| self.auto_mode[d].load(Relaxed) as u8),
                auto_fast: self.auto_fast.load(Relaxed),
                auto_points: std::array::from_fn(|d| {
                    std::array::from_fn(|i| f64::from_bits(self.auto_points[d][i].load(Relaxed)))
                }),
                auto_remaining: std::array::from_fn(|i| {
                    f64::from_bits(self.auto_remaining[i].load(Relaxed))
                }),
                auto_style: self.auto_style.load(Relaxed) as u8,
                auto_started: self.auto_started.load(Relaxed),
                crossfader: f32::from_bits(self.crossfader.load(Relaxed) as u32),
                crossfader_enabled: self.crossfader_enabled.load(Relaxed),
                position_epochs: std::array::from_fn(|d| self.position_epochs[d].load(Relaxed)),
                positions: position,
                generations: generation,
                playing,
                cue_positions: std::array::from_fn(|d| self.cue_positions[d].load(Relaxed)),
                headphone_cue: std::array::from_fn(|d| self.headphone_cue[d].load(Relaxed)),
                cue_preview: std::array::from_fn(|d| self.cue_preview[d].load(Relaxed)),
                loop_starts: std::array::from_fn(|d| match self.loop_starts[d].load(Relaxed) {
                    u64::MAX => None,
                    p => Some(p),
                }),
                loop_ends: std::array::from_fn(|d| match self.loop_ends[d].load(Relaxed) {
                    u64::MAX => None,
                    p => Some(p),
                }),
                loop_lengths: std::array::from_fn(|d| {
                    match f64::from_bits(self.loop_lengths[d].load(Relaxed)) {
                        0. => None,
                        beats => Some(beats),
                    }
                }),
                slip_enabled: std::array::from_fn(|d| self.slip_enabled[d].load(Relaxed)),
                gains: gain,
                mixer: std::array::from_fn(|d| {
                    let values = std::array::from_fn::<_, 5, _>(|i| {
                        f32::from_bits(self.mixer[d][i].load(Relaxed) as u32)
                    });
                    crate::mixer::Settings {
                        trim: values[0],
                        eq: [values[1], values[2], values[3]],
                        filter: values[4],
                    }
                }),
                grids: std::array::from_fn(|d| {
                    let bpm = f64::from_bits(self.grid_bpm[d].load(Relaxed));
                    (bpm > 0.).then(|| crate::timing::Grid {
                        bpm,
                        downbeat_seconds: f64::from_bits(self.grid_anchor[d].load(Relaxed)),
                        reviewed: self.reviewed[d].load(Relaxed),
                    })
                }),
                targets: std::array::from_fn(|d| f64::from_bits(self.targets[d].load(Relaxed))),
                pitches: std::array::from_fn(|d| f64::from_bits(self.pitches[d].load(Relaxed))),
                synced: std::array::from_fn(|d| self.synced[d].load(Relaxed)),
                loop_release_pending: std::array::from_fn(|d| {
                    self.loop_release_pending[d].load(Relaxed)
                }),
                launch_pending: std::array::from_fn(|d| self.launch_pending[d].load(Relaxed)),
                clicks: std::array::from_fn(
                    |d| f32::from_bits(self.clicks[d].load(Relaxed) as u32),
                ),
                timing_errors: std::array::from_fn(|d| self.timing_errors[d].load(Relaxed) as u8),
                reposition: std::array::from_fn(|d| {
                    f64::from_bits(self.reposition[d].load(Relaxed))
                }),
                master_bpm: f64::from_bits(self.master_bpm.load(Relaxed)),
                master_bpm_set: self.master_bpm_set.load(Relaxed),
                drift_rate: f64::from_bits(self.drift_rate.load(Relaxed)),
                sync_quantum: self.sync_quantum.load(Relaxed) as u8,
                drift_target: match self.drift_target.load(Relaxed) {
                    0 => Some(0),
                    1 => Some(1),
                    _ => None,
                },
                output_frame: self.output_frame.load(Relaxed),
                global_beat: f64::from_bits(self.global_beat.load(Relaxed)),
                ..Frame::default()
            };
            // Keep the frame-field reads before the closing sequence check on
            // weakly ordered CPUs (the callback is the sole publisher).
            std::sync::atomic::fence(Acquire);
            if self.sequence.load(Acquire) == start {
                return frame;
            }
        }
    }
    fn take_levels(&self) -> AudioLevels {
        // Only the fast meter request drains these maxima. Transport polling
        // must not steal transients from the meter feed.
        let decks =
            std::array::from_fn(|d| f32::from_bits(self.meter_decks[d].swap(0, Relaxed) as u32));
        let master =
            std::array::from_fn(|d| f32::from_bits(self.meter_master[d].swap(0, Relaxed) as u32));
        let running = self.running.load(Acquire);
        AudioLevels {
            decks: if running { decks } else { [0.; 2] },
            master: if running { master } else { [0.; 2] },
            running,
        }
    }
    fn fail(&self, error: String) {
        *self.error.lock().unwrap() = Some(error);
        self.running.store(false, Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn meter_feed_retains_transients_independently_of_transport_snapshots() {
        let shared = Shared::new();
        shared.running.store(true, Release);
        for peaks in [[0.8_f32, 0.2], [0.1, 0.4], [0., 0.]] {
            for (d, peak) in peaks.into_iter().enumerate() {
                shared.meter_decks[d].fetch_max(peak.to_bits() as u64, Relaxed);
                shared.meter_master[d].fetch_max((peak * 0.45).to_bits() as u64, Relaxed);
            }
        }
        let _ = shared.audible();
        let levels = shared.take_levels();
        assert_eq!(levels.decks, [0.8, 0.4]);
        assert_eq!(levels.master, [0.8 * 0.45, 0.4 * 0.45]);
        assert_eq!(shared.take_levels().decks, [0.; 2]);
        shared.meter_decks[0].store(1_f32.to_bits() as u64, Relaxed);
        shared.running.store(false, Release);
        assert_eq!(shared.take_levels().decks, [0.; 2]);
    }
    #[test]
    #[cfg(not(target_os = "macos"))]
    fn compact_telemetry_sends_metadata_only_for_a_new_generation() {
        let engine = EngineHandle::new();
        let prepared: Prepared = serde_json::from_value(json!({
            "schema_version":1,"conversion_version":"test","settings":{},"source_hash":"hash",
            "artifact_id":"artifact","track_id":"track","title":"Test song","artist":"Artist","filename":"test.wav",
            "frames":48000,"duration_seconds":1.,"peak_frames":47,"peaks":vec![[0.2,0.1];1024],
            "pcm_hash":"hash","pcm_bytes":384000
        })).unwrap();
        engine.metadata.lock().unwrap()[0]
            .records
            .insert(7, prepared);
        engine.metadata.lock().unwrap()[0].waveform = Some((
            7,
            Waveform {
                artifact_id: "artifact".into(),
                fine_peak_frames: 240,
                fine_peaks: vec![[0.2, 0.1]],
                fine_features: vec![[0.3, 0.4]],
            },
        ));
        engine.shared.generations[0].store(7, Relaxed);
        engine.shared.loop_starts[0].store(12000, Relaxed);
        engine.shared.loop_ends[0].store(24000, Relaxed);
        engine.shared.loop_lengths[0].store(0.5_f64.to_bits(), Relaxed);
        engine.shared.slip_enabled[0].store(true, Relaxed);
        let full = engine.state_for_frontend(Some([6, 0]));
        let compact = engine.state_for_frontend(Some([7, 0]));
        assert_eq!(full["decks"][0]["track"]["title"], "Test song");
        assert_eq!(compact["decks"][0]["track_unchanged"], true);
        assert!(full["decks"][0]["track"]["fine_peaks"]
            .as_array()
            .unwrap()
            .is_empty());
        let peak = serde_json::to_value(engine.waveform_for_generation(0, 7).unwrap()).unwrap()
            ["fine_peaks"][0][0]
            .as_f64()
            .unwrap();
        assert!((peak - 0.2).abs() < 1e-6);
        assert_eq!(compact["decks"][0]["loop_in_seconds"], 0.25);
        assert_eq!(compact["decks"][0]["loop_out_seconds"], 0.5);
        assert_eq!(compact["decks"][0]["loop_length_beats"], 0.5);
        assert_eq!(compact["decks"][0]["slip_enabled"], true);
        assert!(compact["decks"][0]["track"].is_null());
        assert!(
            serde_json::to_vec(&compact).unwrap().len()
                < serde_json::to_vec(&full).unwrap().len() / 3
        );
        engine.shared.generations[0].store(0, Relaxed);
        assert!(engine.waveform_for_generation(0, 7).is_err());
        let cleared = engine.state_for_frontend(Some([7, 0]));
        assert_eq!(cleared["decks"][0]["track_unchanged"], false);
        assert!(cleared["decks"][0]["track"].is_null());
    }
    #[test]
    fn audible_snapshot_never_combines_two_callback_publications() {
        let shared = Arc::new(Shared::new());
        let writer = shared.clone();
        let publishing = std::thread::spawn(move || {
            for frame in 1..50000_u64 {
                writer
                    .sequence
                    .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                for d in 0..2 {
                    writer.positions[d].store(frame, Relaxed);
                    writer.generations[d].store(frame, Relaxed);
                }
                writer.sequence.fetch_add(1, Release);
            }
        });
        while !publishing.is_finished() {
            let Frame {
                positions,
                generations,
                ..
            } = shared.audible();
            assert_eq!(positions, generations);
            assert_eq!(positions[0], positions[1]);
        }
        publishing.join().unwrap();
    }
}

#[derive(Default)]
struct Metadata {
    loading: bool,
    error: Option<String>,
    records: HashMap<u64, Prepared>,
    waveform: Option<(u64, Waveform)>,
}

#[derive(Clone, Serialize)]
pub struct Waveform {
    artifact_id: String,
    fine_peak_frames: usize,
    fine_peaks: Vec<[f32; 2]>,
    fine_features: Vec<[f32; 2]>,
}

#[derive(Serialize)]
pub struct DeckState {
    pub deck: usize,
    pub loading: bool,
    pub error: Option<String>,
    pub track: Option<Prepared>,
    pub position_seconds: f64,
    pub position_epoch: u64,
    pub track_unchanged: bool,
    pub playing: bool,
    pub cue_seconds: f64,
    pub cue_preview: bool,
    pub loop_in_seconds: Option<f64>,
    pub loop_out_seconds: Option<f64>,
    pub loop_length_beats: Option<f64>,
    pub loop_release_pending: bool,
    pub slip_enabled: bool,
    pub headphone_cue: bool,
    pub gain: f32,
    pub trim_db: f32,
    pub eq: [f32; 3],
    pub filter: f32,
    pub generation: u64,
    pub requested_generation: u64,
    pub grid: Option<crate::timing::Grid>,
    pub target_bpm: f64,
    pub pitch_semitones: f64,
    pub speed: f64,
    pub synced: bool,
    pub launch_pending: bool,
    pub click_gain: f32,
    pub reposition_seconds: f64,
    pub timing_error: Option<&'static str>,
}

pub struct EngineHandle {
    pub teia: Arc<crate::teia::Host>,
    pub patches: Vec<Arc<crate::teia::Host>>,
    pub patch_transaction: Mutex<()>,
    graph: Mutex<crate::routing::Graph>,
    rolling: Mutex<Arc<crate::rolling::History>>,
    shared: Arc<Shared>,
    commands: Mutex<rtrb::Producer<Command>>,
    wake: Option<Arc<Wake>>,
    metadata: Mutex<[Metadata; 2]>,
    trim_control: Mutex<()>,
    sources: Mutex<HashMap<String, Weak<Source>>>,
    download: Mutex<()>,
    audition_request: Mutex<u64>,
    audition_cache: Mutex<Vec<(String, Arc<Source>)>>,
}
impl EngineHandle {
    pub fn new() -> Arc<Self> {
        let _ = crate::sample_rate::get();
        let mut patches = Vec::new();
        let mut drivers = Vec::new();
        for slot in 0..crate::routing::PATCH_LIMIT {
            let (host, mut driver) =
                crate::teia::Host::new_slot(crate::teia::Host::default_root(), slot);
            driver.silent_bypass = true;
            patches.push(host);
            drivers.push(driver);
        }
        let teia = patches[0].clone();
        let saved_graph =
            std::fs::read(crate::teia::Host::default_root().join(".vira-routing.json"))
                .ok()
                .and_then(|bytes| crate::routing::Graph::from_saved(&bytes).ok())
                .filter(|g| g.compile().is_ok());
        let mut graph = saved_graph.clone().unwrap_or_default();
        if saved_graph.is_none() {
            for (slot, host) in patches.iter().enumerate() {
                let snapshot = host.snapshot();
                if let Some(name) = snapshot["record"]["name"].as_str() {
                    graph.add_patch(
                        slot,
                        name.trim_end_matches(".json").into(),
                        crate::routing::patch_audio_inputs(&snapshot["record"]["document"]),
                    );
                }
            }
        }
        for (slot, host) in patches.iter().enumerate() {
            let state = host.snapshot();
            if !state["record"].is_null() {
                graph.sync_patch_inputs(
                    slot,
                    crate::routing::patch_audio_inputs(&state["record"]["installed_document"]),
                );
            }
        }
        let initial_graph = graph.clone();
        let shared = Arc::new(Shared::new());
        let (tx, rx) = rtrb::RingBuffer::new(32);
        let wake = Wake::new().map(Arc::new);
        let handle = Arc::new(Self {
            teia,
            patches,
            patch_transaction: Mutex::new(()),
            rolling: Mutex::new(Arc::new(crate::rolling::History::new(&graph))),
            graph: Mutex::new(graph),
            shared: shared.clone(),
            commands: Mutex::new(tx),
            wake: wake.as_ref().ok().cloned(),
            metadata: Mutex::new(std::array::from_fn(|_| Metadata::default())),
            trim_control: Mutex::new(()),
            sources: Mutex::new(HashMap::new()),
            download: Mutex::new(()),
            audition_request: Mutex::new(0),
            audition_cache: Mutex::new(Vec::new()),
        });
        crate::patterns::attach_instruments(&handle.patches);
        let handle_history = handle.rolling.lock().unwrap().clone();
        match wake {
            Ok(wake) => {
                #[cfg(target_os = "macos")]
                std::thread::spawn(move || {
                    if let Err(e) = native_output(
                        shared.clone(),
                        rx,
                        wake,
                        drivers,
                        initial_graph,
                        handle_history,
                    ) {
                        shared.fail(format!("Native output failed: {e:#}"));
                    }
                });
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = (rx, wake, drivers, initial_graph, handle_history);
                    shared.fail("Native output requires macOS".into());
                }
            }
            Err(e) => shared.fail(e.to_string()),
        }
        handle
    }
    pub fn benchmark_gains(&self) -> [f32; 2] {
        self.shared.audible().gains
    }
    pub fn rolling_waveforms(&self, selected: &[String], after: u64) -> Value {
        let audible = self.shared.audible();
        let mut snapshot =
            self.rolling
                .lock()
                .unwrap()
                .snapshot(selected, after, audible.output_frame);
        snapshot["global_beat"] = audible.global_beat.into();
        snapshot["master_bpm"] = if audible.master_bpm_set {
            audible.master_bpm.into()
        } else {
            Value::Null
        };
        snapshot["clock_running"] = (audible
            .playing
            .iter()
            .enumerate()
            .any(|(d, playing)| *playing && !audible.launch_pending[d])
            || crate::patterns::clock_running())
        .into();
        let graph = self.graph.lock().unwrap();
        if let Some(sources) = snapshot["sources"].as_array_mut() {
            for source in sources {
                if let Some(node) = graph.nodes.iter().find(|n| source["id"] == n.id) {
                    source["label"] = node.display_label().into();
                }
            }
        }
        snapshot
    }
    pub fn routing_graph(&self) -> crate::routing::Graph {
        let mut graph = self.graph.lock().unwrap().clone();
        if let Some(node) = graph.nodes.iter_mut().find(|n| n.id == "headphones") {
            node.label = "Cue output".into();
        }
        #[cfg(target_os = "macos")]
        if let Ok(nodes) = crate::audio_inputs::nodes() {
            for node in &mut graph.nodes {
                if node.id.starts_with("instrument-in-") || node.id.starts_with("instrument-out-") {
                    let input = node.id.starts_with("instrument-in-");
                    let id = node
                        .id
                        .strip_prefix(if input {
                            "instrument-in-"
                        } else {
                            "instrument-out-"
                        })
                        .unwrap();
                    node.label = crate::instruments::list()
                        .iter()
                        .find(|i| i.id == id)
                        .map_or_else(
                            || "Missing instrument".into(),
                            |i| {
                                format!(
                                    "{} · {}",
                                    i.name,
                                    if input { "audio from" } else { "audio to" }
                                )
                            },
                        );
                } else if node.kind == crate::routing::Kind::Input {
                    node.label = nodes
                        .iter()
                        .find(|live| live.id == node.id)
                        .map(|live| live.label.clone())
                        .unwrap_or_else(|| {
                            format!(
                                "{} (disconnected)",
                                node.label
                                    .trim_end_matches(" (capture stopped)")
                                    .trim_end_matches(" (disconnected)")
                            )
                        });
                    if self.shared.inputs.failed(&node.id) {
                        node.label.push_str(" (capture stopped)");
                    }
                }
            }
        }
        graph
    }
    pub fn sync_patch_routing(&self, slot: usize) -> Result<Option<crate::routing::Graph>> {
        let state = self.patches[slot].snapshot();
        let mut graph = self.routing_graph();
        let before = graph.clone();
        graph.sync_patch_inputs(
            slot,
            crate::routing::patch_audio_inputs(&state["record"]["installed_document"]),
        );
        if graph == before {
            return Ok(None);
        }
        self.set_routing_graph(graph.clone())?;
        Ok(Some(graph))
    }
    pub fn set_routing_parameters(
        &self,
        parameters: crate::routing::Parameters,
    ) -> Result<crate::routing::Graph> {
        let _transaction = self.patch_transaction.lock().unwrap();
        let graph = self.routing_graph().with_parameters(parameters)?;
        self.set_routing_graph(graph.clone())?;
        Ok(graph)
    }
    pub fn apply_session_routing(&self, mut graph: crate::routing::Graph) -> Result<()> {
        let _transaction = self.patch_transaction.lock().unwrap();
        let previous = self.routing_graph();
        let removed: Vec<_> = previous
            .nodes
            .iter()
            .filter(|n| {
                n.kind == crate::routing::Kind::Patch
                    && !graph.nodes.iter().any(|next| next.id == n.id)
            })
            .filter_map(|n| crate::routing::patch_slot(&n.id))
            .collect();
        for &slot in &removed {
            let state = self.patches[slot].snapshot();
            anyhow::ensure!(
                state["editorOpen"] == false,
                "Close the patch editor before removing its routing node"
            );
        }
        for node in &graph.nodes {
            if node.kind == crate::routing::Kind::Patch {
                let slot = crate::routing::patch_slot(&node.id)
                    .ok_or_else(|| anyhow::anyhow!("Unknown patch"))?;
                anyhow::ensure!(
                    !self.patches[slot].snapshot()["record"].is_null(),
                    "Patch is no longer in this session"
                );
            }
        }
        for slot in 0..self.patches.len() {
            let state = self.patches[slot].snapshot();
            graph.sync_patch_inputs(
                slot,
                crate::routing::patch_audio_inputs(&state["record"]["installed_document"]),
            );
        }
        self.set_routing_graph(graph)?;
        for slot in removed {
            self.patches[slot].control("remove", None, None, None)?;
        }
        Ok(())
    }
    pub fn set_routing_graph(&self, graph: crate::routing::Graph) -> Result<()> {
        let mut plan = graph.compile()?;
        #[cfg(target_os = "macos")]
        plan.bind_inputs(&graph, &self.shared.inputs)?;
        let mut current = self.graph.lock().unwrap();
        if !graph.same_audio(&current)
            || graph.nodes.iter().any(|n| {
                (n.kind == crate::routing::Kind::Input || n.id.starts_with("instrument-out-"))
                    && graph.wires.iter().any(|w| w.from == n.id || w.to == n.id)
            })
        {
            let history = plan.history.clone();
            self.send(Command::Routing(plan))?;
            *self.rolling.lock().unwrap() = history;
        }
        let root = crate::teia::Host::default_root();
        std::fs::create_dir_all(&root)?;
        let temporary = root.join(".vira-routing.tmp");
        std::fs::write(&temporary, serde_json::to_vec(&graph.saved_value()?)?)?;
        std::fs::rename(temporary, root.join(".vira-routing.json"))?;
        *current = graph;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    pub fn audio_devices(&self) -> Result<Value> {
        let mut inventory = crate::audio_devices::inventory()?;
        inventory["routes"] = serde_json::to_value(self.shared.routes.lock().unwrap().clone())?;
        Ok(inventory)
    }
    #[cfg(target_os = "macos")]
    pub fn set_audio_devices(&self, routes: crate::audio_devices::Routes) -> Result<bool> {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        let default = host.default_output_device().and_then(|d| d.name().ok());
        routes.validate(default.as_deref())?;
        let device = crate::audio_devices::resolve(&host, routes.master.as_deref())?;
        let rate = crate::audio_devices::config(&device)?.sample_rate.0;
        if let Some(name) = routes.cue.as_deref() {
            crate::audio_devices::config_at(
                &crate::audio_devices::resolve(&host, Some(name))?,
                rate,
            )?;
        }
        let mut current = self.shared.routes.lock().unwrap();
        routes.save()?;
        *current = routes;
        Ok(rate as usize != crate::sample_rate::get())
    }
    fn send(&self, command: Command) -> Result<()> {
        ensure!(
            self.shared.running.load(Acquire),
            "Native audio output is unavailable; check output status"
        );
        self.commands
            .lock()
            .unwrap()
            .push(command)
            .map_err(|_| anyhow::anyhow!("Deck command queue is full. Retry shortly"))?;
        if let Some(wake) = &self.wake {
            wake.notify();
        }
        Ok(())
    }
    pub fn begin_audition(&self, master: bool) -> Result<u64> {
        ensure!(
            master || self.shared.cue_running.load(Acquire),
            "Select an available Cue headphones output on the Audio page before auditioning"
        );
        let mut request = self.audition_request.lock().unwrap();
        self.send(Command::AuditionStop)?;
        *request += 1;
        Ok(*request)
    }
    fn prepare_audition(
        &self,
        generation: u64,
        track_id: &str,
        master: bool,
    ) -> Result<Box<crate::decks::Audition>> {
        let current = || *self.audition_request.lock().unwrap() == generation;
        ensure!(current(), "Audition cancelled");
        let prepared = source::prepare_audition(track_id)?;
        let source = {
            let _download = self.download.lock().unwrap();
            ensure!(current(), "Audition cancelled");
            let cached = self
                .sources
                .lock()
                .unwrap()
                .get(&prepared.artifact_id)
                .and_then(Weak::upgrade);
            if let Some(source) = cached {
                source
            } else {
                let source = prepared.download(current)?;
                let mut cache = self.sources.lock().unwrap();
                cache.retain(|_, value| value.strong_count() > 0);
                cache.insert(prepared.artifact_id.clone(), Arc::downgrade(&source));
                source
            }
        };
        // Retain at most two recently auditioned sources, bounded to 256 MiB total.
        // Eviction and PCM destruction happen here, on the ordinary load thread.
        {
            let mut cache = self.audition_cache.lock().unwrap();
            cache.retain(|(id, _)| id != &prepared.artifact_id);
            cache.push((prepared.artifact_id.clone(), source.clone()));
            while cache.len() > 2
                || cache
                    .iter()
                    .map(|(_, source)| source.bytes())
                    .sum::<usize>()
                    > source::MAX_SOURCE_BYTES
            {
                cache.remove(0);
            }
        }
        ensure!(current(), "Audition cancelled");
        ensure!(
            master || self.shared.cue_running.load(Acquire),
            "Cue headphones output is unavailable"
        );
        let mut voice = Box::new(crate::decks::Audition::new(source, generation));
        voice.master = master;
        let timing =
            crate::service_response("/v1/timing/get", Some(json!({"track_id":track_id})), true)
                .map_err(anyhow::Error::msg)?
                .json::<Value>()?;
        let value = if timing["state"] == "stale" {
            &Value::Null
        } else if !timing["grid"].is_null() {
            &timing["grid"]
        } else {
            &timing["suggestion"]
        };
        if !value.is_null() {
            let grid: crate::timing::Grid = serde_json::from_value(value.clone())?;
            voice.set_grid(Some(grid.validate(prepared.duration_seconds)?));
        }
        Ok(voice)
    }
    pub fn load_audition(&self, generation: u64, track_id: &str, master: bool) -> Result<u64> {
        let voice = self.prepare_audition(generation, track_id, master)?;
        let request = self.audition_request.lock().unwrap();
        ensure!(*request == generation, "Audition cancelled");
        self.send(Command::AuditionInstall(voice))?;
        Ok(generation)
    }
    pub fn queue_audition(
        &self,
        generation: u64,
        index: u64,
        track_id: &str,
        master: bool,
    ) -> Result<()> {
        let mut voice = self.prepare_audition(generation, track_id, master)?;
        voice.index = index + 1;
        let request = self.audition_request.lock().unwrap();
        ensure!(*request == generation, "Audition cancelled");
        self.send(Command::AuditionQueue(generation, index, voice))
    }
    pub fn audition_control(
        &self,
        action: &str,
        generation: u64,
        value: Option<f64>,
    ) -> Result<()> {
        let mut request = self.audition_request.lock().unwrap();
        if action == "stop" {
            *request += 1;
            return self.send(Command::AuditionStop);
        }
        ensure!(*request == generation, "Audition replaced or stopped");
        match action {
            "play_pause" => self.send(Command::AuditionControl(generation, None)),
            "sequence" => {
                let bars = value.unwrap_or(-1.);
                ensure!(
                    [-1., 0., 1., 2., 4., 8., 16., 32.].contains(&bars),
                    "Invalid overlap"
                );
                self.send(Command::AuditionSequence(
                    generation,
                    bars >= 0.,
                    bars.max(0.) as u8,
                ))
            }
            "seek" => {
                let seconds = value.unwrap_or(f64::NAN);
                ensure!(
                    seconds.is_finite() && seconds >= 0.,
                    "Invalid audition position"
                );
                self.send(Command::AuditionControl(
                    generation,
                    Some((seconds * crate::sample_rate::get() as f64).round() as usize),
                ))
            }
            _ => anyhow::bail!("Unknown audition control"),
        }
    }
    pub fn begin_load(&self, deck: usize) -> Result<u64> {
        ensure!(deck < 2, "Deck must be A or B");
        let snapshot = self.shared.audible();
        ensure!(
            !snapshot.playing[deck] || snapshot.gains[deck] == 0.,
            "{}",
            crate::decks::LOAD_BLOCKED
        );
        let generation =
            self.shared.requested[deck].fetch_add(1, std::sync::atomic::Ordering::AcqRel) + 1;
        let mut meta = self.metadata.lock().unwrap();
        meta[deck].loading = true;
        meta[deck].error = None;
        Ok(generation)
    }
    pub fn load(
        &self,
        deck: usize,
        generation: u64,
        track_id: &str,
        preserve_lock: bool,
        reset_mixer: bool,
    ) -> Result<()> {
        let outcome =
            self.prepare_and_install(deck, generation, track_id, preserve_lock, reset_mixer);
        if let Err(error) = &outcome {
            if self.shared.requested[deck].load(Acquire) == generation {
                let mut meta = self.metadata.lock().unwrap();
                meta[deck].loading = false;
                meta[deck].error = Some(format!("{error:#}"));
            }
        }
        outcome
    }
    fn prepare_and_install(
        &self,
        deck: usize,
        generation: u64,
        track_id: &str,
        preserve_lock: bool,
        reset_mixer: bool,
    ) -> Result<()> {
        let _priority = source::LoadPriority::begin()?;
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        // Install decoded audio before the more expensive waveform work. The same
        // voice remains installed when that metadata arrives, even during playback.
        let mut prepared = source::prepare_playback(track_id, deck, generation)?;
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        let source = {
            let _download = self.download.lock().unwrap();
            ensure!(
                self.shared.requested[deck].load(Acquire) == generation,
                "Load superseded by a newer selection"
            );
            let cached = {
                let mut cache = self.sources.lock().unwrap();
                cache.retain(|_, value| value.strong_count() > 0);
                cache.get(&prepared.artifact_id).and_then(Weak::upgrade)
            };
            if let Some(source) = cached {
                source
            } else {
                let source = prepared
                    .download(|| self.shared.requested[deck].load(Acquire) == generation)?;
                self.sources
                    .lock()
                    .unwrap()
                    .insert(prepared.artifact_id.clone(), Arc::downgrade(&source));
                source
            }
        };
        let mut voice = Box::new(Voice::new(source, generation));
        let mut mixer = voice.mixer.settings;
        mixer.trim = crate::track_meta::gain(&prepared.source_hash)?;
        voice.mixer.set(mixer);
        let timing =
            crate::service_response("/v1/timing/get", Some(json!({"track_id":track_id})), true)
                .map_err(anyhow::Error::msg)?
                .json::<Value>()?;
        // Changed content never inherits old assertions or the fitted phase.
        let value = if timing["state"] == "stale" {
            &Value::Null
        } else if !timing["grid"].is_null() {
            &timing["grid"]
        } else {
            &timing["suggestion"]
        };
        if !value.is_null() {
            let grid: crate::timing::Grid = serde_json::from_value(value.clone())?;
            voice.apply_grid(grid.validate(prepared.duration_seconds)?);
            // The first beat is playable zero. Keep source coordinates for timing
            // edits and waveforms, but never play or seek into the leading gap.
            voice.set_start(grid.downbeat_seconds);
            prepared.start_seconds = voice.seconds();
        }
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        // Records are compact peaks/metadata, never PCM. Keep the previous audible
        // record while an installation travels through the output queue.
        {
            let mut meta = self.metadata.lock().unwrap();
            let waveform = Waveform {
                artifact_id: prepared.artifact_id.clone(),
                fine_peak_frames: prepared.fine_peak_frames,
                fine_peaks: std::mem::take(&mut prepared.fine_peaks),
                fine_features: std::mem::take(&mut prepared.fine_features),
            };
            meta[deck].waveform = Some((generation, waveform));
            meta[deck].records.insert(generation, prepared);
        }
        self.send(Command::Install {
            deck,
            generation,
            voice,
            preserve_lock,
            reset_mixer,
        })?;
        let mut complete = source::prepare_track(track_id, Some((deck, generation)))?;
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        let mut meta = self.metadata.lock().unwrap();
        let start_seconds = meta[deck]
            .records
            .get(&generation)
            .map_or(0., |p| p.start_seconds);
        complete.start_seconds = start_seconds;
        meta[deck].waveform = Some((
            generation,
            Waveform {
                artifact_id: complete.artifact_id.clone(),
                fine_peak_frames: complete.fine_peak_frames,
                fine_peaks: std::mem::take(&mut complete.fine_peaks),
                fine_features: std::mem::take(&mut complete.fine_features),
            },
        ));
        meta[deck].records.insert(generation, complete);
        Ok(())
    }
    pub fn control(&self, deck: usize, action: &str, value: Option<f64>) -> Result<()> {
        self.control_for_generation(deck, action, value, None)
    }
    pub fn control_for_generation(
        &self,
        deck: usize,
        action: &str,
        value: Option<f64>,
        expected: Option<u64>,
    ) -> Result<()> {
        ensure!(deck < 2, "Deck must be A or B");
        if matches!(action, "master_volume" | "cue_volume") {
            let gain = value.ok_or_else(|| anyhow::anyhow!("Output volume is required"))?;
            ensure!(
                gain.is_finite() && (0. ..=1.).contains(&gain),
                "Output volume must be 0–1"
            );
            let volume = if action == "master_volume" {
                &self.shared.master_volume
            } else {
                &self.shared.cue_volume
            };
            volume.store((gain as f32).to_bits() as u64, Relaxed);
            return Ok(());
        }
        // Keep command and persistence ordering identical during rapid gain drags.
        let _trim = (action == "trim").then(|| self.trim_control.lock().unwrap());
        let snapshot = self.shared.audible();
        ensure!(
            matches!(
                action,
                "crossfader" | "crossfader_enabled" | "headphone_cue"
            ) || expected.is_none_or(|g| g == snapshot.generations[deck]),
            "Source replaced; retry this control on the current deck"
        );
        let generations = snapshot.generations;
        let frames = self.metadata.lock().unwrap()[deck]
            .records
            .get(&generations[deck])
            .map(|t| t.frames)
            .unwrap_or(0);
        ensure!(
            frames > 0
                || matches!(
                    action,
                    "auto_bars"
                        | "auto_style"
                        | "auto_tempo"
                        | "master_tempo"
                        | "drift_rate"
                        | "sync_quantum"
                        | "jump_crossfade"
                        | "crossfader"
                        | "crossfader_enabled"
                        | "headphone_cue"
                ),
            "Load a track before using transport"
        );
        let command = match action {
            "jump_crossfade" => {
                let milliseconds = value.unwrap_or(-1.);
                ensure!(
                    milliseconds.is_finite() && (0. ..=100.).contains(&milliseconds),
                    "Jump crossfade must be between 0 and 100 ms"
                );
                Command::JumpCrossfade(
                    (milliseconds * crate::sample_rate::get() as f64 / 1000.).round() as usize,
                )
            }
            "auto_bars" => {
                let bars = value.unwrap_or(-1.);
                ensure!(
                    [0., 1., 2., 4., 8., 16., 32.].contains(&bars),
                    "Unsupported overlap"
                );
                Command::AutoBars(bars as u8)
            }
            "auto_style" => {
                ensure!(
                    matches!(value, Some(0.) | Some(1.) | Some(2.)),
                    "Transition mode must be Crossfade, Bass swap or Smart"
                );
                Command::AutoStyle(value.unwrap() as u8)
            }
            "auto_tempo" => {
                ensure!(
                    matches!(value, Some(0.) | Some(1.)),
                    "Tempo mode must be 0 or 1"
                );
                Command::AutoTempo(value == Some(1.))
            }
            "auto_move" | "auto_start" | "auto_swap" | "auto_finish" => {
                let seconds =
                    value.ok_or_else(|| anyhow::anyhow!("Transition edit needs a position"))?;
                ensure!(seconds.is_finite(), "Transition position must be finite");
                let kind = match action {
                    "auto_move" => 0,
                    "auto_start" => 1,
                    "auto_swap" => 2,
                    _ => 3,
                };
                Command::EditAuto(deck, generations, kind, seconds)
            }
            "auto_now" | "auto_end" | "auto_now_fast" | "auto_end_fast" => {
                let end = action.starts_with("auto_end");
                let fast = action.ends_with("_fast");
                if fast || snapshot.auto_mode[deck] != if end { 2 } else { 1 } {
                    ensure!(
                        snapshot.playing[deck] && !snapshot.playing[1 - deck],
                        "Only the outgoing deck can be playing"
                    );
                    for grid in snapshot.grids {
                        let grid =
                            grid.ok_or_else(|| anyhow::anyhow!("Both decks need timing grids"))?;
                        grid.speed(snapshot.master_bpm)?;
                    }
                    ensure!(
                        !snapshot.loop_ends.iter().any(Option::is_some),
                        "Release loops before an automatic transition"
                    );
                }
                if fast {
                    let bars = value.unwrap_or(4.);
                    ensure!(
                        [0., 1., 2., 4., 8., 16., 32.].contains(&bars),
                        "Unsupported fast overlap"
                    );
                    Command::FastAutoTransition(deck, generations, end, bars as u8)
                } else {
                    Command::AutoTransition(deck, generations, end)
                }
            }

            "headphone_cue" => {
                ensure!(
                    matches!(value, Some(0.) | Some(1.)),
                    "Headphone cue must be 0 or 1"
                );
                Command::HeadphoneCue(deck, value == Some(1.))
            }
            "crossfader" => {
                let position =
                    value.ok_or_else(|| anyhow::anyhow!("Crossfader requires a position"))?;
                ensure!(
                    position.is_finite() && (-1.0..=1.0).contains(&position),
                    "Crossfader must be −1–1"
                );
                Command::Crossfader(position as f32)
            }
            "crossfader_enabled" => {
                ensure!(
                    matches!(value, Some(0.) | Some(1.)),
                    "Crossfader enabled must be 0 or 1"
                );
                Command::CrossfaderEnabled(value == Some(1.))
            }
            "clear" => {
                // Cancel already requested preparations; a later selection has a
                // higher generation and cannot be removed by this command.
                let through =
                    self.shared.requested[deck].fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                let mut metadata = self.metadata.lock().unwrap();
                metadata[deck].loading = false;
                metadata[deck].error = None;
                Command::Remove(deck, through)
            }
            "play" => Command::Play(deck, generations[deck]),
            "play_pause" => Command::PlayPause(deck, generations[deck]),
            "cue_press" => Command::CuePress(deck, generations[deck]),
            "cue_release" => Command::CueRelease(deck, generations[deck]),
            "pause" => Command::Pause(deck, generations[deck]),
            "stop" => Command::Stop(deck, generations[deck]),
            "loop_in" | "loop_in_snapped" => {
                Command::LoopIn(deck, generations[deck], action == "loop_in_snapped")
            }
            "loop_out" | "loop_out_snapped" => {
                Command::LoopOut(deck, generations[deck], action == "loop_out_snapped")
            }
            "slip" => {
                ensure!(matches!(value, Some(0.) | Some(1.)), "Slip must be 0 or 1");
                Command::Slip(deck, generations[deck], value == Some(1.))
            }
            "loop_length" | "loop_length_aligned" => {
                let beats =
                    value.ok_or_else(|| anyhow::anyhow!("Loop length requires a beat count"))?;
                ensure!(
                    [1. / 8., 1. / 4., 1. / 2., 1., 2., 4., 8., 16., 32., 64.].contains(&beats),
                    "Unsupported loop length"
                );
                ensure!(
                    snapshot.grids[deck].is_some(),
                    "A timing grid is required for beat loops"
                );
                Command::LoopLength(
                    deck,
                    generations[deck],
                    beats,
                    action == "loop_length_aligned",
                )
            }
            "jog" => {
                let seconds =
                    value.ok_or_else(|| anyhow::anyhow!("Jog requires a displacement"))?;
                ensure!(
                    seconds.is_finite() && seconds.abs() <= 10.,
                    "Jog displacement is outside the supported range"
                );
                Command::Jog(deck, generations[deck], seconds)
            }
            "seek" | "phrase_jump" | "scrub_start" | "scrub" | "scrub_pause" => {
                let seconds = value.ok_or_else(|| anyhow::anyhow!("Seek requires a position"))?;
                ensure!(
                    seconds.is_finite()
                        && seconds >= 0.
                        && seconds <= frames as f64 / crate::sample_rate::get() as f64,
                    "Seek position is outside the track"
                );
                let position = (seconds * crate::sample_rate::get() as f64).round() as usize;
                if action == "phrase_jump" {
                    Command::PhraseJump(deck, generations[deck], position)
                } else if action == "seek" {
                    Command::Seek(deck, generations[deck], position)
                } else if action == "scrub_start" {
                    Command::ScrubStart(deck, generations[deck], position)
                } else {
                    Command::Scrub(deck, generations[deck], position, action == "scrub")
                }
            }
            "trim" | "eq_low" | "eq_mid" | "eq_high" | "filter" => {
                let v = value.ok_or_else(|| anyhow::anyhow!("Mixer control requires a value"))?;
                let (parameter, min, max) = match action {
                    "trim" => (0, -12., 12.),
                    "eq_low" => (1, 0., 1.),
                    "eq_mid" => (2, 0., 1.),
                    "eq_high" => (3, 0., 1.),
                    _ => (4, -1., 1.),
                };
                ensure!(
                    v.is_finite() && (min..=max).contains(&v),
                    "Mixer value out of range"
                );
                Command::Mixer(deck, generations[deck], parameter, v as f32)
            }
            "gain" => {
                let gain = value.ok_or_else(|| anyhow::anyhow!("Gain requires a value"))?;
                ensure!(
                    gain.is_finite() && (0.0..=1.0).contains(&gain),
                    "Volume must be between zero and one"
                );
                Command::Gain(deck, generations[deck], gain as f32)
            }
            "click" => {
                let gain = value.ok_or_else(|| anyhow::anyhow!("Click requires a volume"))?;
                ensure!(
                    gain.is_finite() && (0.0..=1.0).contains(&gain),
                    "Click volume must be 0–1"
                );
                ensure!(
                    snapshot.grids[deck].is_some(),
                    "Apply timing before enabling click"
                );
                Command::Click(deck, generations[deck], gain as f32)
            }
            "click_panel" => {
                Command::ClickPanel(deck, generations[deck], value.unwrap_or(0.) != 0.)
            }
            "pitch" => {
                let shift = value.ok_or_else(|| anyhow::anyhow!("Pitch requires semitones"))?;
                ensure!(
                    shift.is_finite() && (-6.0..=6.0).contains(&shift) && shift.fract() == 0.,
                    "Pitch must be a whole semitone between -6 and 6"
                );
                Command::Pitch(deck, generations[deck], shift)
            }
            "tempo" | "tempo_smooth" => {
                let target = value.ok_or_else(|| anyhow::anyhow!("Tempo requires target BPM"))?;
                snapshot.grids[deck]
                    .ok_or_else(|| anyhow::anyhow!("Apply a source grid first"))?
                    .speed(target)?;
                if action == "tempo_smooth" {
                    Command::SmoothTempo(deck, generations, target)
                } else {
                    Command::Tempo(deck, generations, target)
                }
            }
            "master_tempo" | "master_target" => {
                let target = value.ok_or_else(|| anyhow::anyhow!("Master tempo requires BPM"))?;
                ensure!(
                    target.is_finite() && (15.0..=600.0).contains(&target),
                    "Master BPM must be 15–600"
                );
                for d in 0..2 {
                    if snapshot.synced[d] {
                        snapshot.grids[d].unwrap().speed(target)?;
                    }
                }
                if action == "master_target" {
                    Command::MasterTarget(target)
                } else {
                    Command::MasterTempo(target)
                }
            }
            "drift" => {
                ensure!(
                    snapshot.grids[deck].is_some(),
                    "Apply a source grid before drifting to it"
                );
                for d in 0..2 {
                    if snapshot.synced[d] {
                        snapshot.grids[d]
                            .unwrap()
                            .speed(snapshot.grids[deck].unwrap().bpm)?;
                    }
                }
                Command::Drift(deck, generations)
            }
            "drift_rate" => {
                let rate =
                    value.ok_or_else(|| anyhow::anyhow!("Drift rate requires BPM per second"))?;
                ensure!(
                    rate.is_finite() && (0.01..=100.).contains(&rate),
                    "Drift rate must be 0.01–100 BPM/sec"
                );
                Command::DriftRate(rate)
            }
            "sync_quantum" => {
                let quantum =
                    value.ok_or_else(|| anyhow::anyhow!("Sync timing requires beat or bar"))?;
                ensure!(
                    quantum == 1. || quantum == 4.,
                    "Sync timing must be beat or bar"
                );
                Command::SyncQuantum(quantum as u8)
            }
            "sync" => {
                let enabled = value == Some(1.);
                if enabled {
                    ensure!(
                        snapshot.grids[deck].is_some(),
                        "Apply a timing grid before locking this deck"
                    );
                    snapshot.grids[deck].unwrap().speed(snapshot.master_bpm)?;
                }
                Command::Sync(deck, generations, enabled)
            }
            _ => anyhow::bail!("Unknown deck transport action"),
        };
        self.send(command)?;
        if action == "trim" {
            let metadata = self.metadata.lock().unwrap();
            let track = metadata[deck]
                .records
                .get(&generations[deck])
                .ok_or_else(|| anyhow::anyhow!("Load a source first"))?;
            crate::track_meta::save_gain(&track.source_hash, value.unwrap() as f32)?;
        }
        Ok(())
    }
    pub fn apply_grid(
        &self,
        deck: usize,
        generation: u64,
        grid: crate::timing::Grid,
        preserve_speed: bool,
        follow_clock: bool,
    ) -> Result<()> {
        ensure!(deck < 2, "Deck must be A or B");
        let snapshot = self.shared.audible();
        ensure!(
            snapshot.generations[deck] == generation,
            "Source replaced; reopen timing editor"
        );
        let metadata = self.metadata.lock().unwrap();
        let track = metadata[deck]
            .records
            .get(&generation)
            .ok_or_else(|| anyhow::anyhow!("Load a source first"))?;
        grid.validate(track.duration_seconds)?;
        if follow_clock {
            ensure!(
                snapshot.playing[deck] && !snapshot.playing[1 - deck],
                "Only the playing solo deck can move the master clock"
            );
        }
        self.send(if follow_clock {
            Command::ShiftBarGrid(deck, generation, grid)
        } else if preserve_speed {
            Command::ReinterpretGrid(deck, generation, grid)
        } else {
            Command::Grid(deck, generation, grid)
        })
    }
    pub fn state(&self) -> Value {
        self.state_for_frontend(None)
    }
    pub fn audio_levels(&self) -> AudioLevels {
        self.shared.take_levels()
    }
    pub fn waveform_for_generation(&self, deck: usize, generation: u64) -> Result<Waveform> {
        ensure!(deck < 2, "Deck must be A or B");
        ensure!(
            self.shared.audible().generations[deck] == generation,
            "Deck source changed while loading its waveform"
        );
        self.metadata.lock().unwrap()[deck]
            .waveform
            .as_ref()
            .filter(|(stored, _)| *stored == generation)
            .map(|(_, waveform)| waveform.clone())
            .ok_or_else(|| anyhow::anyhow!("Waveform is unavailable for this deck load"))
    }
    pub fn state_for_frontend(&self, known: Option<[u64; 2]>) -> Value {
        let snapshot = self.shared.audible();
        let Frame {
            positions,
            generations,
            playing,
            gains,
            ..
        } = snapshot;
        let mut metadata = self.metadata.lock().unwrap();
        let decks: Vec<DeckState> = (0..2)
            .map(|d| {
                let requested = self.shared.requested[d].load(Acquire);
                if generations[d] == requested && generations[d] != 0
                    && metadata[d].records.get(&requested).is_some_and(|p| !p.peaks.is_empty()) {
                    metadata[d].loading = false;
                }
                if requested != 0 && self.shared.rejected_load[d].load(Acquire) == requested {
                    metadata[d].loading = false;
                    metadata[d].error = Some(crate::decks::LOAD_BLOCKED.into());
                }
                // Old records are only small UI metadata; PCM lives solely in voices
                // and a weak cache. Bound UI history while preserving the audible one.
                if metadata[d].records.len() > 64 {
                    let floor = requested.saturating_sub(32);
                    metadata[d]
                        .records
                        .retain(|g, _| *g >= floor || *g == generations[d]);
                }
                DeckState {
                    deck: d,
                    loading: metadata[d].loading,
                    error: metadata[d].error.clone(),
                    track: if known.is_some_and(|g| g[d] == generations[d]) {
                        None
                    } else {
                        metadata[d].records.get(&generations[d]).cloned()
                    },
                    track_unchanged: known.is_some_and(|g| g[d] == generations[d]),
                    position_epoch: snapshot.position_epochs[d],
                    position_seconds: positions[d] as f64 / crate::sample_rate::get() as f64,
                    playing: playing[d] && self.shared.running.load(Acquire),
                    cue_seconds: snapshot.cue_positions[d] as f64 / crate::sample_rate::get() as f64,
                    cue_preview: snapshot.cue_preview[d],
                    loop_in_seconds: snapshot.loop_starts[d].map(|p| p as f64 / crate::sample_rate::get() as f64),
                    loop_out_seconds: snapshot.loop_ends[d].map(|p| p as f64 / crate::sample_rate::get() as f64),
                    loop_length_beats: snapshot.loop_lengths[d],
                    loop_release_pending: snapshot.loop_release_pending[d],
                    slip_enabled: snapshot.slip_enabled[d],
                    headphone_cue: snapshot.headphone_cue[d],
                    gain: gains[d],
                    trim_db: snapshot.mixer[d].trim,
                    eq: snapshot.mixer[d].eq,
                    filter: snapshot.mixer[d].filter,
                    generation: generations[d],
                    requested_generation: requested,
                    grid: snapshot.grids[d],
                    target_bpm: snapshot.targets[d],
                    pitch_semitones: snapshot.pitches[d],
                    speed: snapshot.grids[d].map_or(1., |g| snapshot.targets[d] / g.bpm),
                    synced: snapshot.synced[d],
                    launch_pending: snapshot.launch_pending[d],
                    click_gain: snapshot.clicks[d],
                    reposition_seconds: snapshot.reposition[d],
                    timing_error: match snapshot.timing_errors[d] {
                        1 => Some("Master lock rejected at render boundary: check grid, phase and tempo range"),
                        2 => Some("Tempo rejected at render boundary: range changed"),
                        3 => Some("No valid master phase position; lock disabled"),
                        4 => Some("Automatic transition unavailable: check both timing grids, tempo range, loops and remaining track length"),
                        _ => None,
                    },
                }
            })
            .collect();
        let source_bytes: usize = self
            .sources
            .lock()
            .unwrap()
            .values()
            .filter_map(Weak::upgrade)
            .map(|source| source.bytes())
            .sum();
        let routes = self.shared.routes.lock().unwrap().clone();
        let auto_transition = snapshot.auto_mode.iter().position(|mode| *mode != 0).map(|from| json!({
            "from":from, "style":match snapshot.auto_style { 2 => "smart", 1 => "bass-swap", _ => "crossfade" },
            "started":snapshot.auto_started, "points":snapshot.auto_points, "remaining_beats":snapshot.auto_remaining
        }));
        json!({"auto_fast":snapshot.auto_fast,"auto_transition":auto_transition,"audition":{"generation":snapshot.audition_generation,"index":snapshot.audition_index,"position_seconds":snapshot.audition_position as f64 / crate::sample_rate::get() as f64,"playing":snapshot.audition_playing},"auto_mode":snapshot.auto_mode,"crossfader":snapshot.crossfader,"crossfader_enabled":snapshot.crossfader_enabled,"master_bpm":snapshot.master_bpm_set.then_some(snapshot.master_bpm),"drift_rate":snapshot.drift_rate,"sync_quantum":snapshot.sync_quantum,"drift_target":snapshot.drift_target,"output_frame":snapshot.output_frame,"global_beat":snapshot.global_beat,"decks":decks,"running":self.shared.running.load(Acquire),"error":self.shared.error.lock().unwrap().clone(),
            "master_volume":f32::from_bits(self.shared.master_volume.load(Relaxed) as u32),
            "cue_volume":f32::from_bits(self.shared.cue_volume.load(Relaxed) as u32),
            "routing":{"master":routes.master,"cue":routes.cue,"cue_running":self.shared.cue_running.load(Acquire),"cue_error":self.shared.cue_error.lock().unwrap().clone()},
            "telemetry":{"sample_rate":crate::sample_rate::get(),"device":self.shared.device.lock().unwrap().clone(),"rubberband_engine":3,"speed_basis":"per-deck target/source BPM","pitch_semitones":snapshot.pitches,
                "requested_buffer_frames":256,"producer_chunk_frames":PRODUCER_FRAMES,"queue_capacity_frames":QUEUE_FRAMES,
                "queue_capacity_ms":QUEUE_FRAMES as f64 * 1000. / crate::sample_rate::get() as f64,"realtime_policy_verified":self.shared.realtime.load(Acquire),
                "realtime_policy_at_exit":self.shared.realtime_at_end.load(Acquire),
                "worker_max_chunk_us":self.shared.worker_max_ns.load(Relaxed) as f64/1000.,"worker_slow_chunks":self.shared.worker_slow_chunks.load(Relaxed),
                "workgroup_interval_errors":self.shared.scheduling_errors.load(Relaxed),"wake_wait_nonzero_returns":self.shared.wait_errors.load(Relaxed),
                "wake_signal_errors":self.wake.as_ref().map(|w|w.signal_errors.load(Relaxed)),
                "max_callback_interval_us":self.shared.max_callback_interval_us.load(Relaxed),
                "callback":self.shared.stats.report(),"live_source_pcm_bytes":source_bytes,"resources":self.shared.resources.lock().unwrap().clone(),
                "position_basis":"last source frame consumed by output callback; excludes physical speaker latency","end_to_end_latency_ms":null}})
    }
    pub fn shutdown(&self) {
        self.shared.cancel.store(true, Release);
        if let Some(wake) = &self.wake {
            wake.notify();
        }
    }
}
impl Drop for EngineHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(target_os = "macos")]
fn native_output(
    shared: Arc<Shared>,
    mut commands: rtrb::Consumer<Command>,
    wake: Arc<Wake>,
    mut drivers: Vec<crate::teia_audio::Driver>,
    initial_graph: crate::routing::Graph,
    history: Arc<crate::rolling::History>,
) -> Result<()> {
    use crate::scheduling::Realtime;
    use cpal::traits::{DeviceTrait, StreamTrait};
    use std::{thread, time::Duration};
    let host = cpal::default_host();
    let (mut producer, consumer) = rtrb::RingBuffer::<Frame>::new(QUEUE_FRAMES);
    struct OutputState {
        consumer: rtrb::Consumer<Frame>,
        previous: Option<Instant>,
        last: Frame,
    }
    let output = Arc::new(Mutex::new(OutputState {
        consumer,
        previous: None,
        last: Frame::default(),
    }));
    let (cue_tx, cue_rx) = rtrb::RingBuffer::<[f32; 2]>::new(8192);
    let cue_tx = Arc::new(Mutex::new(cue_tx));
    let cue_output = Arc::new(Mutex::new(crate::cue_output::CueOutput::new(cue_rx)));
    let (mut retire_tx, mut retire_rx) = rtrb::RingBuffer::<crate::decks::Retired>::new(64);
    let finished = Arc::new(AtomicBool::new(false));
    let retired_finished = finished.clone();
    let retirement = thread::spawn(move || {
        loop {
            while let Ok(voice) = retire_rx.pop() {
                match voice {
                    crate::decks::Retired::Audition(v) => drop(v),
                    crate::decks::Retired::Voice(v) | crate::decks::Retired::RejectedLoad(_, v) => {
                        drop(v)
                    }
                    crate::decks::Retired::Routing(p) => drop(p),
                }
            }
            if retired_finished.load(Acquire) {
                break;
            }
            thread::sleep(Duration::from_millis(2));
        }
        while let Ok(voice) = retire_rx.pop() {
            match voice {
                crate::decks::Retired::Audition(v) => drop(v),
                crate::decks::Retired::Voice(v) | crate::decks::Retired::RejectedLoad(_, v) => {
                    drop(v)
                }
                crate::decks::Retired::Routing(p) => drop(p),
            }
        }
    });
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<std::result::Result<(), String>>(1);
    let worker_shared = shared.clone();
    let worker_wake = wake.clone();
    let worker_finished = finished.clone();
    // Initialize timebase conversion off both real-time threads.
    let _ = unsafe { crate::teia_midi::now_ns() };
    let mut decks = Decks::new();
    let deck_midi: Vec<_> = decks
        .note_lanes
        .iter()
        .map(|lane| lane.midi.host.clone())
        .collect();
    crate::patterns::attach_decks(&deck_midi);
    let teia_midi_clocks: Vec<_> = drivers
        .iter()
        .map(|d| d.midi.host.clone())
        .chain(deck_midi)
        .collect();
    let mut initial_plan = initial_graph.compile()?;
    initial_plan.history = history;
    // A disconnected saved input should not prevent deck playback on launch.
    let _ = initial_plan.bind_inputs(&initial_graph, &shared.inputs);
    let worker = thread::spawn(move || -> Result<()> {
        for driver in &drivers {
            driver.telemetry.alive.store(true, Release);
        }
        drop(decks.command(Command::Routing(initial_plan), [0, 0]));
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        let rt = Realtime::new(PRODUCER_FRAMES as u32)?;
        let mut ready = false;
        let outcome = (|| -> Result<()> {
            while !worker_shared.worker_cancel.load(Acquire) {
                if producer.slots() < PRODUCER_FRAMES {
                    if !ready {
                        if let Err(e) = rt.activate() {
                            let _ = ready_tx.send(Err(e.to_string()));
                            return Err(e);
                        }
                        worker_shared.realtime.store(true, Release);
                        let _ = ready_tx.send(Ok(()));
                        ready = true;
                    }
                    worker_wake.arm();
                    if producer.slots() >= PRODUCER_FRAMES
                        || worker_shared.worker_cancel.load(Acquire)
                    {
                        worker_wake.disarm();
                        continue;
                    }
                    if worker_wake.wait() != 0 {
                        worker_shared.wait_errors.fetch_add(1, Relaxed);
                    }
                    worker_wake.disarm();
                    continue;
                }
                if ready {
                    worker_shared.scheduling_errors.fetch_add(
                        (rt.begin((QUEUE_FRAMES - producer.slots()) as u32) != 0) as u64,
                        Relaxed,
                    );
                }
                let start = Instant::now();
                for driver in &mut drivers {
                    driver.commands();
                }
                // At most one command per producer chunk limits bursts of accepted
                // resets. No command waits and no old source/DSP drops on this path.
                if retire_tx.slots() > 0 {
                    if let Ok(command) = commands.pop() {
                        let latest =
                            std::array::from_fn(|d| worker_shared.requested[d].load(Acquire));
                        if let Some(old) = decks.command(command, latest) {
                            if let crate::decks::Retired::RejectedLoad(deck, voice) = &old {
                                worker_shared.rejected_load[*deck].store(voice.generation, Release);
                            }
                            retire_tx.push(old).map_err(|_| {
                                anyhow::anyhow!("Retirement queue accounting error")
                            })?;
                        }
                    }
                }
                decks.next_block(&mut block, &mut drivers)?;
                let elapsed = start.elapsed().as_nanos() as u64;
                worker_shared.worker_max_ns.fetch_max(elapsed, Relaxed);
                if elapsed
                    > PRODUCER_FRAMES as u64 * 1_000_000_000 / crate::sample_rate::get() as u64
                {
                    worker_shared.worker_slow_chunks.fetch_add(1, Relaxed);
                }
                if ready {
                    worker_shared
                        .scheduling_errors
                        .fetch_add((rt.finish() != 0) as u64, Relaxed);
                }
                for frame in block {
                    producer
                        .push(frame)
                        .map_err(|_| anyhow::anyhow!("Output queue accounting error"))?;
                }
            }
            Ok(())
        })();
        worker_shared
            .realtime_at_end
            .store(rt.is_realtime(), Release);
        drop(rt); // Restore standard policy before source/DSP destruction or error reports.
        for driver in &drivers {
            driver.telemetry.alive.store(false, Release);
        }
        drop(drivers);
        drop(decks);
        drop(commands);
        worker_finished.store(true, Release);
        outcome
    });
    let setup = ready_rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| anyhow::anyhow!("Audio producer failed to prebuffer"))
        .and_then(|result| result.map_err(anyhow::Error::msg));
    let build_stream = || -> Result<(cpal::Stream, String)> {
        let routes = shared.routes.lock().unwrap().clone();
        let device = crate::audio_devices::resolve(&host, routes.master.as_deref())?;
        let name = device.name()?;
        let mut config =
            crate::audio_devices::config_at(&device, crate::sample_rate::get() as u32)?;
        config.buffer_size = cpal::BufferSize::Fixed(256);
        let channels = config.channels as usize;
        let callback_cue = cue_tx.clone();
        let cb = shared.clone();
        let error = shared.clone();
        let cb_wake = wake.clone();
        let callback_output = output.clone();
        let midi_clocks = teia_midi_clocks.clone();
        let mut active_deck = crate::active_deck::Tracker::default();
        let mut master_volume = f32::from_bits(shared.master_volume.load(Relaxed) as u32);
        let mut cue_volume = f32::from_bits(shared.cue_volume.load(Relaxed) as u32);
        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], info: &cpal::OutputCallbackInfo| {
                let timing = info.timestamp();
                let playback_ns = unsafe { crate::teia_midi::now_ns() }.saturating_add(
                    timing
                        .playback
                        .duration_since(&timing.callback)
                        .unwrap_or_default()
                        .as_nanos() as u64,
                );
                let mut anchored = false;
                let began = Instant::now();
                // A replaced stream is dropped before its successor starts, so
                // this lock is uncontended during normal playback.
                let Ok(mut state) = callback_output.try_lock() else {
                    data.fill(0.);
                    return;
                };
                if let Some(previous) = state.previous.replace(began) {
                    cb.max_callback_interval_us
                        .fetch_max(began.duration_since(previous).as_micros() as u64, Relaxed);
                }
                let mut missing = 0;
                let mut deck_peaks = [0_f32; 2];
                let mut master_peaks = [0_f32; 2];
                let mut cue = callback_cue.try_lock().ok();
                let master_target = f32::from_bits(cb.master_volume.load(Relaxed) as u32);
                let cue_target = f32::from_bits(cb.cue_volume.load(Relaxed) as u32);
                data.fill(0.);
                for (index, samples) in data.chunks_exact_mut(channels).enumerate() {
                    // Smooth output changes over roughly 5 ms to avoid clicks.
                    master_volume +=
                        (master_target - master_volume) / crate::sample_rate::fine_frames() as f32;
                    cue_volume +=
                        (cue_target - cue_volume) / crate::sample_rate::fine_frames() as f32;
                    match state.consumer.pop() {
                        Ok(frame) => {
                            if !anchored {
                                crate::patterns::anchor(
                                    frame.global_beat,
                                    frame.master_bpm,
                                    playback_ns
                                        + index as u64 * 1_000_000_000
                                            / crate::sample_rate::get() as u64,
                                );
                                for midi_clock in &midi_clocks {
                                    midi_clock.anchor(
                                        frame.output_frame,
                                        playback_ns
                                            + index as u64 * 1_000_000_000
                                                / crate::sample_rate::get() as u64,
                                    );
                                }
                                anchored = true;
                            }
                            for channel in 0..2 {
                                samples[channel] = frame.samples[channel] * master_volume;
                            }
                            if let Some(cue) = cue.as_mut() {
                                let _ =
                                    cue.push(frame.cue_samples.map(|sample| sample * cue_volume));
                            }
                            for d in 0..2 {
                                deck_peaks[d] = deck_peaks[d]
                                    .max(frame.deck_samples[d][0].abs())
                                    .max(frame.deck_samples[d][1].abs());
                            }
                            for channel in 0..2 {
                                master_peaks[channel] =
                                    master_peaks[channel].max(samples[channel].abs());
                            }
                            active_deck.observe(
                                std::array::from_fn(|d| {
                                    frame.playing[d] && !frame.launch_pending[d]
                                }),
                                frame.deck_samples,
                            );
                            state.last = frame;
                        }
                        Err(_) => {
                            samples.fill(0.);
                            if let Some(cue) = cue.as_mut() {
                                let _ = cue.push([0.; 2]);
                            }
                            missing += 1;
                        }
                    }
                }
                for d in 0..2 {
                    cb.meter_decks[d].fetch_max(deck_peaks[d].to_bits() as u64, Relaxed);
                    cb.meter_master[d].fetch_max(master_peaks[d].to_bits() as u64, Relaxed);
                }
                crate::patterns::publish_active_deck(active_deck.selected());
                let last = state.last;
                cb.sequence
                    .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                cb.audition_generation
                    .store(last.audition_generation, Relaxed);
                cb.audition_position.store(last.audition_position, Relaxed);
                cb.audition_index.store(last.audition_index, Relaxed);
                cb.audition_playing.store(last.audition_playing, Relaxed);
                for d in 0..2 {
                    cb.positions[d].store(last.positions[d], Relaxed);
                    cb.position_epochs[d].store(last.position_epochs[d], Relaxed);
                    cb.generations[d].store(last.generations[d], Relaxed);
                    cb.playing[d].store(last.playing[d], Relaxed);
                    cb.cue_positions[d].store(last.cue_positions[d], Relaxed);
                    cb.cue_preview[d].store(last.cue_preview[d], Relaxed);
                    cb.loop_starts[d].store(last.loop_starts[d].unwrap_or(u64::MAX), Relaxed);
                    cb.loop_ends[d].store(last.loop_ends[d].unwrap_or(u64::MAX), Relaxed);
                    cb.loop_lengths[d].store(last.loop_lengths[d].unwrap_or(0.).to_bits(), Relaxed);
                    cb.loop_release_pending[d].store(last.loop_release_pending[d], Relaxed);
                    cb.slip_enabled[d].store(last.slip_enabled[d], Relaxed);
                    cb.headphone_cue[d].store(last.headphone_cue[d], Relaxed);
                    cb.gains[d].store(last.gains[d].to_bits() as u64, Relaxed);
                    let settings = last.mixer[d];
                    for (i, value) in [
                        settings.trim,
                        settings.eq[0],
                        settings.eq[1],
                        settings.eq[2],
                        settings.filter,
                    ]
                    .into_iter()
                    .enumerate()
                    {
                        cb.mixer[d][i].store(value.to_bits() as u64, Relaxed);
                    }
                    cb.grid_bpm[d].store(last.grids[d].map_or(0., |g| g.bpm).to_bits(), Relaxed);
                    cb.grid_anchor[d].store(
                        last.grids[d].map_or(0., |g| g.downbeat_seconds).to_bits(),
                        Relaxed,
                    );
                    cb.reviewed[d].store(last.grids[d].is_some_and(|g| g.reviewed), Relaxed);
                    cb.targets[d].store(last.targets[d].to_bits(), Relaxed);
                    cb.pitches[d].store(last.pitches[d].to_bits(), Relaxed);
                    cb.synced[d].store(last.synced[d], Relaxed);
                    cb.launch_pending[d].store(last.launch_pending[d], Relaxed);
                    cb.clicks[d].store(last.clicks[d].to_bits() as u64, Relaxed);
                    cb.timing_errors[d].store(last.timing_errors[d] as u64, Relaxed);
                    cb.reposition[d].store(last.reposition[d].to_bits(), Relaxed);
                }
                for d in 0..2 {
                    cb.auto_mode[d].store(last.auto_mode[d] as u64, Relaxed);
                    for i in 0..5 {
                        cb.auto_points[d][i].store(last.auto_points[d][i].to_bits(), Relaxed);
                    }
                }
                for i in 0..5 {
                    cb.auto_remaining[i].store(last.auto_remaining[i].to_bits(), Relaxed);
                }
                cb.auto_fast.store(last.auto_fast, Relaxed);
                cb.auto_style.store(last.auto_style as u64, Relaxed);
                cb.auto_started.store(last.auto_started, Relaxed);
                cb.master_bpm.store(last.master_bpm.to_bits(), Relaxed);
                cb.master_bpm_set.store(last.master_bpm_set, Relaxed);
                cb.drift_rate.store(last.drift_rate.to_bits(), Relaxed);
                cb.crossfader
                    .store(last.crossfader.to_bits() as u64, Relaxed);
                cb.crossfader_enabled
                    .store(last.crossfader_enabled, Relaxed);
                cb.sync_quantum.store(last.sync_quantum as u64, Relaxed);
                cb.drift_target
                    .store(last.drift_target.unwrap_or(2) as u64, Relaxed);
                cb.output_frame.store(last.output_frame, Relaxed);
                cb.global_beat.store(last.global_beat.to_bits(), Relaxed);
                cb.sequence.fetch_add(1, Release);
                cb.stats
                    .frames
                    .fetch_add((data.len() / channels) as u64, Relaxed);
                cb.stats.starved_frames.fetch_add(missing, Relaxed);
                cb_wake.notify();
                cb.stats.record(
                    began.elapsed().as_nanos() as u64,
                    (data.len() / channels) as u64,
                );
            },
            move |_| {
                error.stats.device_errors.fetch_add(1, Relaxed);
            },
            None,
        )?;
        stream.play()?;
        *shared.device.lock().unwrap() = Some(name.clone());
        shared.running.store(true, Release);
        Ok((stream, name))
    };
    let build_cue = |name: &str| -> Result<cpal::Stream> {
        let device = crate::audio_devices::resolve(&host, Some(name))?;
        let config = crate::audio_devices::config_at(&device, crate::sample_rate::get() as u32)?;
        let channels = config.channels as usize;
        cue_output.lock().unwrap().reset();
        let callback = cue_output.clone();
        let cb = shared.clone();
        let errors = shared.clone();
        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                data.fill(0.);
                if let Ok(mut cue) = callback.try_lock() {
                    if cb.running.load(Acquire) {
                        cue.render(data, channels);
                    } else {
                        cue.reset();
                    }
                }
            },
            move |_| {
                errors.cue_device_errors.fetch_add(1, Relaxed);
            },
            None,
        )?;
        stream.play()?;
        Ok(stream)
    };
    let mut error = None;
    if let Ok(()) = setup {
        let mut sample_at = Instant::now();
        let mut progress_at = Instant::now();
        let mut previous_frames = 0;
        let mut previous_errors = 0;
        let mut stream: Option<cpal::Stream> = None;
        let mut device_name: Option<String> = None;
        let mut master_route: Option<String> = None;
        let mut cue_stream: Option<cpal::Stream> = None;
        let mut cue_name: Option<String> = None;
        let mut cue_errors = 0;
        let mut cue_available_before = false;
        let mut cue_valid_before = false;
        let mut cue_retry = Instant::now() - Duration::from_secs(2);
        while !shared.cancel.load(Acquire) {
            let frames = shared.stats.frames.load(Relaxed);
            if frames != previous_frames {
                previous_frames = frames;
                progress_at = Instant::now();
            }
            if worker.is_finished() {
                error = Some("Audio producer stopped".to_string());
                break;
            }
            let device_errors = shared.stats.device_errors.load(Relaxed);
            let routes = shared.routes.lock().unwrap().clone();
            let current_device = crate::audio_devices::resolve(&host, routes.master.as_deref())
                .ok()
                .and_then(|d| d.name().ok());
            let next_cue_errors = shared.cue_device_errors.load(Relaxed);
            let cue_valid = routes.cue.is_some() && routes.cue != current_device;
            let cue_available = routes
                .cue
                .as_deref()
                .and_then(|name| crate::audio_devices::resolve(&host, Some(name)).ok())
                .is_some();
            if cue_name != routes.cue
                || next_cue_errors != cue_errors
                || cue_valid != cue_valid_before
                || cue_available != cue_available_before
            {
                drop(cue_stream.take());
                shared.cue_running.store(false, Release);
                cue_name = routes.cue.clone();
                cue_available_before = cue_available;
                cue_valid_before = cue_valid;
                cue_errors = next_cue_errors;
                cue_retry = Instant::now() - Duration::from_secs(2);
            }
            if routes.cue.is_none() {
                *shared.cue_error.lock().unwrap() = None;
            } else if !cue_valid {
                *shared.cue_error.lock().unwrap() = Some("Cue suspended: master and cue resolve to the same device. Choose separate outputs.".into());
            } else if cue_stream.is_none() && cue_retry.elapsed() >= Duration::from_secs(2) {
                cue_retry = Instant::now();
                match build_cue(routes.cue.as_deref().unwrap()) {
                    Ok(stream) => {
                        cue_stream = Some(stream);
                        shared.cue_running.store(true, Release);
                        *shared.cue_error.lock().unwrap() = None;
                    }
                    Err(e) => {
                        *shared.cue_error.lock().unwrap() =
                            Some(format!("Cue output unavailable: {e:#}"))
                    }
                }
            }
            let needs_stream = stream.is_none()
                || device_errors != previous_errors
                || progress_at.elapsed() > Duration::from_secs(1)
                || current_device != device_name
                || master_route != routes.master;
            if needs_stream {
                // Keep the producer, decks, commands and buffered frames alive.
                // During sleep the full queue naturally pauses their timeline.
                drop(stream.take());
                master_route = routes.master.clone();
                output.lock().unwrap().previous = None;
                shared.running.store(false, Release);
                *shared.device.lock().unwrap() = None;
                previous_errors = device_errors;
                match build_stream() {
                    Ok((new_stream, name)) => {
                        stream = Some(new_stream);
                        device_name = Some(name);
                        progress_at = Instant::now();
                    }
                    Err(e) => {
                        *shared.error.lock().unwrap() =
                            Some(format!("Waiting for audio output: {e:#}"));
                        device_name = current_device;
                        thread::sleep(Duration::from_millis(500));
                        continue;
                    }
                }
                *shared.error.lock().unwrap() = None;
            }
            if sample_at.elapsed() >= Duration::from_secs(1) {
                *shared.resources.lock().unwrap() = metrics::resources();
                sample_at = Instant::now();
            }
            thread::sleep(Duration::from_millis(20));
        }
        drop(cue_stream);
        shared.cue_running.store(false, Release);
        drop(stream);
    } else if let Err(e) = setup {
        error = Some(format!("{e:#}"));
    }
    shared.running.store(false, Release);
    shared.cancel.store(true, Release);
    shared.worker_cancel.store(true, Release);
    wake.notify();
    let outcome = worker
        .join()
        .map_err(|_| anyhow::anyhow!("Audio producer panicked"))?;
    finished.store(true, Release);
    let _ = retirement.join();
    *shared.resources.lock().unwrap() = metrics::resources();
    outcome?;
    if let Some(error) = error {
        anyhow::bail!(error);
    }
    Ok(())
}
