//! Long-lived two-deck producer, bounded queues and thin native output callback.
use crate::{
    decks::{Command, Decks, Frame, Voice, PRODUCER_FRAMES, QUEUE_FRAMES},
    metrics::{self, CallbackStats},
    scheduling::Wake,
    source::{self, Prepared, Source, RATE},
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
    routes: Mutex<crate::audio_devices::Routes>,
    cue_running: AtomicBool,
    cue_error: Mutex<Option<String>>,
    cue_device_errors: AtomicU64,
    headphone_cue: [AtomicBool; 2],
    crossfader: AtomicU64,
    crossfader_enabled: AtomicBool,
    cancel: AtomicBool,
    worker_cancel: AtomicBool,
    requested: [AtomicU64; 2],
    sequence: AtomicU64,
    positions: [AtomicU64; 2],
    position_epochs: [AtomicU64; 2],
    generations: [AtomicU64; 2],
    playing: [AtomicBool; 2],
    cue_positions: [AtomicU64; 2],
    cue_preview: [AtomicBool; 2],
    loop_starts: [AtomicU64; 2],
    loop_ends: [AtomicU64; 2],
    loop_lengths: [AtomicU64; 2],
    slip_enabled: [AtomicBool; 2],
    gains: [AtomicU64; 2],
    meter_decks: [AtomicU64; 2],
    meter_master: [AtomicU64; 2],
    mixer: [[AtomicU64; 5]; 2],
    grid_bpm: [AtomicU64; 2],
    grid_anchor: [AtomicU64; 2],
    reviewed: [AtomicBool; 2],
    targets: [AtomicU64; 2],
    synced: [AtomicBool; 2],
    launch_pending: [AtomicBool; 2],
    clicks: [AtomicU64; 2],
    timing_errors: [AtomicU64; 2],
    reposition: [AtomicU64; 2],
    master_bpm: AtomicU64,
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
            cancel: false.into(),
            routes: Mutex::new(crate::audio_devices::Routes::load()),
            cue_running: false.into(),
            cue_error: Mutex::new(None),
            cue_device_errors: 0.into(),
            headphone_cue: std::array::from_fn(|_| false.into()),
            crossfader: (0_f32.to_bits() as u64).into(),
            crossfader_enabled: true.into(),
            worker_cancel: false.into(),
            requested: std::array::from_fn(|_| 0.into()),
            sequence: 0.into(),
            positions: std::array::from_fn(|_| 0.into()),
            position_epochs: std::array::from_fn(|_| 0.into()),
            generations: std::array::from_fn(|_| 0.into()),
            playing: std::array::from_fn(|_| false.into()),
            cue_positions: std::array::from_fn(|_| 0.into()),
            cue_preview: std::array::from_fn(|_| false.into()),
            loop_starts: std::array::from_fn(|_| u64::MAX.into()),
            loop_ends: std::array::from_fn(|_| u64::MAX.into()),
            loop_lengths: std::array::from_fn(|_| 0_f64.to_bits().into()),
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
            synced: std::array::from_fn(|_| false.into()),
            launch_pending: std::array::from_fn(|_| false.into()),
            clicks: std::array::from_fn(|_| 0.into()),
            timing_errors: std::array::from_fn(|_| 0.into()),
            reposition: std::array::from_fn(|_| 0.into()),
            master_bpm: 120_f64.to_bits().into(),
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
                synced: std::array::from_fn(|d| self.synced[d].load(Relaxed)),
                launch_pending: std::array::from_fn(|d| self.launch_pending[d].load(Relaxed)),
                clicks: std::array::from_fn(
                    |d| f32::from_bits(self.clicks[d].load(Relaxed) as u32),
                ),
                timing_errors: std::array::from_fn(|d| self.timing_errors[d].load(Relaxed) as u8),
                reposition: std::array::from_fn(|d| {
                    f64::from_bits(self.reposition[d].load(Relaxed))
                }),
                master_bpm: f64::from_bits(self.master_bpm.load(Relaxed)),
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
        engine.metadata.lock().unwrap()[0].waveform = Some((7, Waveform {
            artifact_id: "artifact".into(),
            fine_peak_frames: 240,
            fine_peaks: vec![[0.2, 0.1]],
            fine_features: vec![[0.3, 0.4]],
        }));
        engine.shared.generations[0].store(7, Relaxed);
        engine.shared.loop_starts[0].store(12000, Relaxed);
        engine.shared.loop_ends[0].store(24000, Relaxed);
        engine.shared.loop_lengths[0].store(0.5_f64.to_bits(), Relaxed);
        engine.shared.slip_enabled[0].store(true, Relaxed);
        let full = engine.state_for_frontend(Some([6, 0]));
        let compact = engine.state_for_frontend(Some([7, 0]));
        assert_eq!(full["decks"][0]["track"]["title"], "Test song");
        assert_eq!(compact["decks"][0]["track_unchanged"], true);
        assert!(full["decks"][0]["track"]["fine_peaks"].as_array().unwrap().is_empty());
        let peak = serde_json::to_value(engine.waveform_for_generation(0, 7).unwrap()).unwrap()["fine_peaks"][0][0].as_f64().unwrap();
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
    pub speed: f64,
    pub synced: bool,
    pub launch_pending: bool,
    pub click_gain: f32,
    pub reposition_seconds: f64,
    pub timing_error: Option<&'static str>,
}

pub struct EngineHandle {
    graph: Mutex<crate::routing::Graph>,
    shared: Arc<Shared>,
    commands: Mutex<rtrb::Producer<Command>>,
    wake: Option<Arc<Wake>>,
    metadata: Mutex<[Metadata; 2]>,
    sources: Mutex<HashMap<String, Weak<Source>>>,
    download: Mutex<()>,
}
impl EngineHandle {
    pub fn new() -> Arc<Self> {
        let shared = Arc::new(Shared::new());
        let (tx, rx) = rtrb::RingBuffer::new(32);
        let wake = Wake::new().map(Arc::new);
        let handle = Arc::new(Self {
            graph: Mutex::new(crate::routing::Graph::default()),
            shared: shared.clone(),
            commands: Mutex::new(tx),
            wake: wake.as_ref().ok().cloned(),
            metadata: Mutex::new(std::array::from_fn(|_| Metadata::default())),
            sources: Mutex::new(HashMap::new()),
            download: Mutex::new(()),
        });
        match wake {
            Ok(wake) => {
                #[cfg(target_os = "macos")]
                std::thread::spawn(move || {
                    if let Err(e) = native_output(shared.clone(), rx, wake) {
                        shared.fail(format!("Native output failed: {e:#}"));
                    }
                });
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = (rx, wake);
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
    pub fn routing_graph(&self) -> crate::routing::Graph {
        self.graph.lock().unwrap().clone()
    }
    pub fn set_routing_graph(&self, graph: crate::routing::Graph) -> Result<()> {
        let plan = graph.compile()?;
        let mut current = self.graph.lock().unwrap();
        if !graph.same_audio(&current) {
            self.send(Command::Routing(plan))?;
        }
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
    pub fn set_audio_devices(&self, routes: crate::audio_devices::Routes) -> Result<()> {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        let default = host.default_output_device().and_then(|d| d.name().ok());
        routes.validate(default.as_deref())?;
        for name in [routes.master.as_deref(), routes.cue.as_deref()]
            .into_iter()
            .flatten()
        {
            crate::audio_devices::config(&crate::audio_devices::resolve(&host, Some(name))?)?;
        }
        let mut current = self.shared.routes.lock().unwrap();
        routes.save()?;
        *current = routes;
        Ok(())
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
    pub fn begin_load(&self, deck: usize) -> Result<u64> {
        ensure!(deck < 2, "Deck must be A or B");
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
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        let mut prepared = source::prepare_track(track_id, Some((deck, generation)))?;
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
        })
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
                    "master_tempo"
                        | "drift_rate"
                        | "sync_quantum"
                        | "crossfader"
                        | "crossfader_enabled"
                        | "headphone_cue"
                ),
            "Load a track before using transport"
        );
        let command = match action {
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
            "seek" | "scrub_start" | "scrub" | "scrub_pause" => {
                let seconds = value.ok_or_else(|| anyhow::anyhow!("Seek requires a position"))?;
                ensure!(
                    seconds.is_finite() && seconds >= 0. && seconds <= frames as f64 / RATE as f64,
                    "Seek position is outside the track"
                );
                let position = (seconds * RATE as f64).round() as usize;
                if action == "seek" {
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
            "tempo" => {
                let target = value.ok_or_else(|| anyhow::anyhow!("Tempo requires target BPM"))?;
                snapshot.grids[deck]
                    .ok_or_else(|| anyhow::anyhow!("Apply a source grid first"))?
                    .speed(target)?;
                Command::Tempo(deck, generations, target)
            }
            "master_tempo" => {
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
                Command::MasterTempo(target)
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
        self.send(command)
    }
    pub fn apply_grid(
        &self,
        deck: usize,
        generation: u64,
        grid: crate::timing::Grid,
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
        self.send(Command::Grid(deck, generation, grid))
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
                if generations[d] == requested && generations[d] != 0 {
                    metadata[d].loading = false;
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
                    position_seconds: positions[d] as f64 / RATE as f64,
                    playing: playing[d] && self.shared.running.load(Acquire),
                    cue_seconds: snapshot.cue_positions[d] as f64 / RATE as f64,
                    cue_preview: snapshot.cue_preview[d],
                    loop_in_seconds: snapshot.loop_starts[d].map(|p| p as f64 / RATE as f64),
                    loop_out_seconds: snapshot.loop_ends[d].map(|p| p as f64 / RATE as f64),
                    loop_length_beats: snapshot.loop_lengths[d],
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
                    speed: snapshot.grids[d].map_or(1., |g| snapshot.targets[d] / g.bpm),
                    synced: snapshot.synced[d],
                    launch_pending: snapshot.launch_pending[d],
                    click_gain: snapshot.clicks[d],
                    reposition_seconds: snapshot.reposition[d],
                    timing_error: match snapshot.timing_errors[d] {
                        1 => Some("Master lock rejected at render boundary: check grid, phase and tempo range"),
                        2 => Some("Tempo rejected at render boundary: range changed"),
                        3 => Some("No valid master phase position; lock disabled"),
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
        json!({"crossfader":snapshot.crossfader,"crossfader_enabled":snapshot.crossfader_enabled,"master_bpm":snapshot.master_bpm,"drift_rate":snapshot.drift_rate,"sync_quantum":snapshot.sync_quantum,"drift_target":snapshot.drift_target,"output_frame":snapshot.output_frame,"global_beat":snapshot.global_beat,"decks":decks,"running":self.shared.running.load(Acquire),"error":self.shared.error.lock().unwrap().clone(),
            "routing":{"master":routes.master,"cue":routes.cue,"cue_running":self.shared.cue_running.load(Acquire),"cue_error":self.shared.cue_error.lock().unwrap().clone()},
            "telemetry":{"sample_rate":RATE,"device":self.shared.device.lock().unwrap().clone(),"rubberband_engine":3,"speed_basis":"per-deck target/source BPM","pitch_semitones":0.0,
                "requested_buffer_frames":256,"producer_chunk_frames":PRODUCER_FRAMES,"queue_capacity_frames":QUEUE_FRAMES,
                "queue_capacity_ms":QUEUE_FRAMES as f64/48.,"realtime_policy_verified":self.shared.realtime.load(Acquire),
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
                    crate::decks::Retired::Voice(v) => drop(v),
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
                crate::decks::Retired::Voice(v) => drop(v),
                crate::decks::Retired::Routing(p) => drop(p),
            }
        }
    });
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<std::result::Result<(), String>>(1);
    let worker_shared = shared.clone();
    let worker_wake = wake.clone();
    let worker_finished = finished.clone();
    let worker = thread::spawn(move || -> Result<()> {
        let mut decks = Decks::new();
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
                // At most one command per producer chunk limits bursts of accepted
                // resets. No command waits and no old source/DSP drops on this path.
                if retire_tx.slots() > 0 {
                    if let Ok(command) = commands.pop() {
                        let latest =
                            std::array::from_fn(|d| worker_shared.requested[d].load(Acquire));
                        if let Some(old) = decks.command(command, latest) {
                            retire_tx.push(old).map_err(|_| {
                                anyhow::anyhow!("Retirement queue accounting error")
                            })?;
                        }
                    }
                }
                for frame in &mut block {
                    *frame = decks.next()?;
                }
                let elapsed = start.elapsed().as_nanos() as u64;
                worker_shared.worker_max_ns.fetch_max(elapsed, Relaxed);
                if elapsed > PRODUCER_FRAMES as u64 * 1_000_000_000 / 48000 {
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
        let mut config = crate::audio_devices::config(&device)?;
        config.buffer_size = cpal::BufferSize::Fixed(256);
        let channels = config.channels as usize;
        let callback_cue = cue_tx.clone();
        let cb = shared.clone();
        let error = shared.clone();
        let cb_wake = wake.clone();
        let callback_output = output.clone();
        let stream = device.build_output_stream(
            &config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
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
                data.fill(0.);
                for samples in data.chunks_exact_mut(channels) {
                    match state.consumer.pop() {
                        Ok(frame) => {
                            samples[..2].copy_from_slice(&frame.samples);
                            if let Some(cue) = cue.as_mut() {
                                let _ = cue.push(frame.cue_samples);
                            }
                            for d in 0..2 {
                                deck_peaks[d] = deck_peaks[d]
                                    .max(frame.deck_samples[d][0].abs())
                                    .max(frame.deck_samples[d][1].abs());
                            }
                            for channel in 0..2 {
                                master_peaks[channel] =
                                    master_peaks[channel].max(frame.samples[channel].abs());
                            }
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
                let last = state.last;
                cb.sequence
                    .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
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
                    cb.synced[d].store(last.synced[d], Relaxed);
                    cb.launch_pending[d].store(last.launch_pending[d], Relaxed);
                    cb.clicks[d].store(last.clicks[d].to_bits() as u64, Relaxed);
                    cb.timing_errors[d].store(last.timing_errors[d] as u64, Relaxed);
                    cb.reposition[d].store(last.reposition[d].to_bits(), Relaxed);
                }
                cb.master_bpm.store(last.master_bpm.to_bits(), Relaxed);
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
        let config = crate::audio_devices::config(&device)?;
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
