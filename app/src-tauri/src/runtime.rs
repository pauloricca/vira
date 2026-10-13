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
    cancel: AtomicBool,
    worker_cancel: AtomicBool,
    requested: [AtomicU64; 2],
    sequence: AtomicU64,
    positions: [AtomicU64; 2],
    position_epochs: [AtomicU64; 2],
    generations: [AtomicU64; 2],
    playing: [AtomicBool; 2],
    gains: [AtomicU64; 2],
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
impl Shared {
    fn new() -> Self {
        Self {
            cancel: false.into(),
            worker_cancel: false.into(),
            requested: std::array::from_fn(|_| 0.into()),
            sequence: 0.into(),
            positions: std::array::from_fn(|_| 0.into()),
            position_epochs: std::array::from_fn(|_| 0.into()),
            generations: std::array::from_fn(|_| 0.into()),
            playing: std::array::from_fn(|_| false.into()),
            gains: std::array::from_fn(|_| (0.8_f32.to_bits() as u64).into()),
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
                position_epochs: std::array::from_fn(|d| self.position_epochs[d].load(Relaxed)),
                positions: position,
                generations: generation,
                playing,
                gains: gain,
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
    fn fail(&self, error: String) {
        *self.error.lock().unwrap() = Some(error);
        self.running.store(false, Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        engine.shared.generations[0].store(7, Relaxed);
        let full = engine.state_for_frontend(Some([6, 0]));
        let compact = engine.state_for_frontend(Some([7, 0]));
        assert_eq!(full["decks"][0]["track"]["title"], "Test song");
        assert_eq!(compact["decks"][0]["track_unchanged"], true);
        assert!(compact["decks"][0]["track"].is_null());
        assert!(
            serde_json::to_vec(&compact).unwrap().len()
                < serde_json::to_vec(&full).unwrap().len() / 3
        );
        engine.shared.generations[0].store(0, Relaxed);
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
    pub gain: f32,
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
    shared: Arc<Shared>,
    commands: Mutex<rtrb::Producer<Command>>,
    wake: Option<Arc<Wake>>,
    metadata: Mutex<[Metadata; 2]>,
    sources: Mutex<HashMap<String, Weak<Source>>>,
    download: Mutex<()>,
    loads: [Mutex<()>; 2],
}
impl EngineHandle {
    pub fn new() -> Arc<Self> {
        let shared = Arc::new(Shared::new());
        let (tx, rx) = rtrb::RingBuffer::new(32);
        let wake = Wake::new().map(Arc::new);
        let handle = Arc::new(Self {
            shared: shared.clone(),
            commands: Mutex::new(tx),
            wake: wake.as_ref().ok().cloned(),
            metadata: Mutex::new(std::array::from_fn(|_| Metadata::default())),
            sources: Mutex::new(HashMap::new()),
            download: Mutex::new(()),
            loads: std::array::from_fn(|_| Mutex::new(())),
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
    pub fn load(&self, deck: usize, generation: u64, track_id: &str) -> Result<()> {
        let outcome = self.prepare_and_install(deck, generation, track_id);
        if let Err(error) = &outcome {
            if self.shared.requested[deck].load(Acquire) == generation {
                let mut meta = self.metadata.lock().unwrap();
                meta[deck].loading = false;
                meta[deck].error = Some(format!("{error:#}"));
            }
        }
        outcome
    }
    fn prepare_and_install(&self, deck: usize, generation: u64, track_id: &str) -> Result<()> {
        let _load = self.loads[deck].lock().unwrap();
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        let mut prepared = source::prepare_track(track_id)?;
        ensure!(
            self.shared.requested[deck].load(Acquire) == generation,
            "Load superseded by a newer selection"
        );
        let source = {
            let _download = self.download.lock().unwrap();
            let cached = {
                let mut cache = self.sources.lock().unwrap();
                cache.retain(|_, value| value.strong_count() > 0);
                cache.get(&prepared.artifact_id).and_then(Weak::upgrade)
            };
            if let Some(source) = cached {
                source
            } else {
                let source = prepared.download()?;
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
            prepared.fine_features.clear();
            prepared.fine_features.shrink_to_fit();
            prepared.fine_peaks.clear();
            prepared.fine_peaks.shrink_to_fit();
            meta[deck].records.insert(generation, prepared);
        }
        self.send(Command::Install {
            deck,
            generation,
            voice,
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
            expected.is_none_or(|g| g == snapshot.generations[deck]),
            "Source replaced; retry this control on the current deck"
        );
        let generations = snapshot.generations;
        let frames = self.metadata.lock().unwrap()[deck]
            .records
            .get(&generations[deck])
            .map(|t| t.frames)
            .unwrap_or(0);
        ensure!(
            frames > 0 || matches!(action, "master_tempo" | "drift_rate" | "sync_quantum"),
            "Load a track before using transport"
        );
        let command = match action {
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
            "pause" => Command::Pause(deck, generations[deck]),
            "stop" => Command::Stop(deck, generations[deck]),
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
                    gain: gains[d],
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
        json!({"master_bpm":snapshot.master_bpm,"drift_rate":snapshot.drift_rate,"sync_quantum":snapshot.sync_quantum,"drift_target":snapshot.drift_target,"output_frame":snapshot.output_frame,"global_beat":snapshot.global_beat,"decks":decks,"running":self.shared.running.load(Acquire),"error":self.shared.error.lock().unwrap().clone(),
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
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
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
    let (mut retire_tx, mut retire_rx) = rtrb::RingBuffer::<Box<Voice>>::new(64);
    let finished = Arc::new(AtomicBool::new(false));
    let retired_finished = finished.clone();
    let retirement = thread::spawn(move || {
        loop {
            while let Ok(voice) = retire_rx.pop() {
                drop(voice);
            }
            if retired_finished.load(Acquire) {
                break;
            }
            thread::sleep(Duration::from_millis(2));
        }
        while let Ok(voice) = retire_rx.pop() {
            drop(voice);
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
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow::anyhow!("No default output device"))?;
        let name = device.name()?;
        ensure!(
            device.supported_output_configs()?.any(|c| c.channels() == 2
                && c.sample_format() == cpal::SampleFormat::F32
                && c.min_sample_rate().0 <= 48000
                && c.max_sample_rate().0 >= 48000),
            "Output must support stereo float32 48 kHz"
        );
        let config = cpal::StreamConfig {
            channels: 2,
            sample_rate: cpal::SampleRate(48000),
            buffer_size: cpal::BufferSize::Fixed(256),
        };
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
                for samples in data.chunks_exact_mut(2) {
                    match state.consumer.pop() {
                        Ok(frame) => {
                            samples.copy_from_slice(&frame.samples);
                            state.last = frame;
                        }
                        Err(_) => {
                            samples.fill(0.);
                            missing += 1;
                        }
                    }
                }
                let last = state.last;
                cb.sequence
                    .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
                for d in 0..2 {
                    cb.positions[d].store(last.positions[d], Relaxed);
                    cb.position_epochs[d].store(last.position_epochs[d], Relaxed);
                    cb.generations[d].store(last.generations[d], Relaxed);
                    cb.playing[d].store(last.playing[d], Relaxed);
                    cb.gains[d].store(last.gains[d].to_bits() as u64, Relaxed);
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
                cb.sync_quantum.store(last.sync_quantum as u64, Relaxed);
                cb.drift_target
                    .store(last.drift_target.unwrap_or(2) as u64, Relaxed);
                cb.output_frame.store(last.output_frame, Relaxed);
                cb.global_beat.store(last.global_beat.to_bits(), Relaxed);
                cb.sequence.fetch_add(1, Release);
                cb.stats.frames.fetch_add((data.len() / 2) as u64, Relaxed);
                cb.stats.starved_frames.fetch_add(missing, Relaxed);
                cb_wake.notify();
                cb.stats
                    .record(began.elapsed().as_nanos() as u64, (data.len() / 2) as u64);
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
    let mut error = None;
    if let Ok(()) = setup {
        let mut sample_at = Instant::now();
        let mut progress_at = Instant::now();
        let mut previous_frames = 0;
        let mut previous_errors = 0;
        let mut stream: Option<cpal::Stream> = None;
        let mut device_name: Option<String> = None;
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
            let current_device = host.default_output_device().and_then(|d| d.name().ok());
            let needs_stream = stream.is_none()
                || device_errors != previous_errors
                || progress_at.elapsed() > Duration::from_secs(1)
                || current_device != device_name;
            if needs_stream {
                // Keep the producer, decks, commands and buffered frames alive.
                // During sleep the full queue naturally pauses their timeline.
                drop(stream.take());
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
