//! Scale-relative patterns. The audio callback publishes a lock-free playback clock;
//! an ordinary worker schedules timestamped CoreMIDI events, never the webview.
use crate::pattern_routing::{self, Destination, Harmony};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering::SeqCst},
        Arc, Mutex, OnceLock,
    },
};

pub const SCALES: [[i16; 7]; 4] = [
    [0, 2, 4, 5, 7, 9, 11],
    [0, 2, 3, 5, 7, 8, 10],
    [0, 2, 3, 5, 7, 9, 10],
    [0, 2, 4, 5, 7, 9, 10],
];
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub beat: f64,
    pub duration: f64,
    pub degree: u8,
    pub octave: i8,
    pub velocity: u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub mode: String,
    pub output: i32,
    pub channel: u8,
    pub bars: u8,
    #[serde(default)]
    pub steps: Option<u32>,
    #[serde(default = "default_step_division")]
    pub step_division: u8,
    #[serde(default = "default_phrase_sync")]
    pub phrase_sync: bool,
    pub grid: u8,
    pub key: u8,
    pub scale: usize,
    pub octave: i8,
    pub quantum: u8,
    pub compensation: Option<f64>,
    pub notes: Vec<Note>,
    #[serde(skip)]
    pub destination: Option<Destination>,
    #[serde(skip)]
    pub owner: Option<String>,
    #[serde(skip)]
    pub route: u16,
    #[serde(skip)]
    pub target_generation: u64,
    #[serde(skip)]
    pub note_source: bool,
    #[serde(skip)]
    pub transformations: Vec<pattern_routing::Transformation>,
}
fn default_step_division() -> u8 {
    4
}
fn default_phrase_sync() -> bool {
    true
}
impl Pattern {
    fn length_beats(&self) -> f64 {
        self.steps.map_or(self.bars as f64 * 4., |steps| {
            steps as f64 / self.step_division as f64
        })
    }
    fn pitch(&self, n: &Note) -> u8 {
        (12 * (self.octave as i16 + 1 + n.octave as i16)
            + self.key as i16
            + SCALES[self.scale][n.degree as usize - 1]) as u8
    }
    fn validate(&self) -> Result<()> {
        ensure!(
            !self.id.is_empty()
                && self.id.len() <= 100
                && !self.name.trim().is_empty()
                && self.name.len() <= 200,
            "Invalid pattern name or ID"
        );
        ensure!(
            self.kind == "melodic" && self.mode == "relative",
            "Unsupported pattern type"
        );
        ensure!(
            (1..=16).contains(&self.channel)
                && (1..=16).contains(&self.bars)
                && self.steps.is_none_or(|steps| (1..=65536).contains(&steps))
                && [1, 2, 4, 8].contains(&self.step_division)
                && [1, 2, 4, 8].contains(&self.grid)
                && self.key < 12
                && self.scale < SCALES.len()
                && (0..=7).contains(&self.octave)
                && [1, 4].contains(&self.quantum),
            "Invalid pattern settings"
        );
        ensure!(
            self.compensation
                .is_none_or(|v| v.is_finite() && (0. ..=100.).contains(&v)),
            "Compensation must be 0–100 ms"
        );
        ensure!(self.notes.len() <= 1024, "At most 1024 notes per pattern");
        let mut ids = HashSet::new();
        for n in &self.notes {
            ensure!(
                ids.insert(&n.id)
                    && !n.id.is_empty()
                    && n.id.len() <= 100
                    && n.beat.is_finite()
                    && n.duration.is_finite()
                    && n.beat >= 0.
                    && n.duration >= 0.03125
                    && n.beat + n.duration <= self.length_beats() + 1e-8
                    && (1..=7).contains(&n.degree)
                    && (-2..=2).contains(&n.octave)
                    && (1..=127).contains(&n.velocity),
                "Invalid note"
            );
            let pitch = 12 * (self.octave as i16 + 1 + n.octave as i16)
                + self.key as i16
                + SCALES[self.scale][n.degree as usize - 1];
            ensure!(
                (0..=127).contains(&pitch),
                "Note falls outside MIDI pitch range"
            );
        }
        Ok(())
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bank {
    pub patterns: Vec<Pattern>,
    pub output_compensation: HashMap<i32, f64>,
    #[serde(default)]
    pub graph: Option<pattern_routing::Graph>,
}
impl Bank {
    fn validate(&self) -> Result<()> {
        ensure!(
            self.patterns.len() <= 128 && self.output_compensation.len() <= 256,
            "Pattern bank too large"
        );
        if let Some(graph) = &self.graph {
            graph.validate(self)?;
        }
        let mut ids = HashSet::new();
        for p in &self.patterns {
            ensure!(ids.insert(&p.id), "Duplicate pattern ID");
            p.validate()?;
        }
        ensure!(
            self.output_compensation
                .values()
                .all(|v| v.is_finite() && (0. ..=100.).contains(v)),
            "Compensation must be 0–100 ms"
        );
        Ok(())
    }
}
#[derive(Default)]
struct Voice {
    start: Option<f64>,
    stop: Option<f64>,
    cursor: f64,
    active: HashMap<String, u8>,
    stop_sent: bool,
}
// A held note can survive an edit only if its scheduled note-off is unchanged.
fn keeps_held_note(old: &Pattern, new: &Pattern, id: &str) -> bool {
    old.length_beats() == new.length_beats()
        && old.notes.iter().find(|n| n.id == id).is_some_and(|a| {
            new.notes.iter().find(|n| n.id == id).is_some_and(|b| {
                a.beat == b.beat
                    && a.duration == b.duration
                    && pattern_routing::transform(old.pitch(a), &old.transformations)
                        == pattern_routing::transform(new.pitch(b), &new.transformations)
            })
        })
}
struct State {
    bank: Arc<Bank>,
    voices: HashMap<String, Voice>,
    outputs: Value,
    inputs: Value,
    live_roots: HashMap<String, u8>,
    device_notes: HashMap<String, u8>,
    error: Option<String>,
    load_error: bool,
    commands: Vec<(String, bool)>,
    decks: [Option<Harmony>; 2],
}
pub struct Host {
    playing: AtomicBool,
    halt: AtomicBool,
    seq: AtomicU64,
    beat: AtomicU64,
    bpm: AtomicU64,
    ns: AtomicU64,
    state: Mutex<State>,
}
static ACTIVE_DECK: AtomicU64 = AtomicU64::new(0);
pub fn active_deck() -> usize {
    ACTIVE_DECK.load(SeqCst) as usize
}
pub fn publish_active_deck(deck: usize) {
    ACTIVE_DECK.store(deck as u64, SeqCst);
}
static HOST: OnceLock<Host> = OnceLock::new();
static INSTRUMENTS: OnceLock<Vec<std::sync::Weak<crate::teia::Host>>> = OnceLock::new();
static DECKS: std::sync::Mutex<Vec<std::sync::Weak<crate::teia_midi::Host>>> =
    std::sync::Mutex::new(Vec::new());
pub fn attach_decks(hosts: &[Arc<crate::teia_midi::Host>]) {
    *DECKS.lock().unwrap() = hosts.iter().map(Arc::downgrade).collect();
}
pub(crate) fn internal_host(dest: &Destination) -> Option<Arc<crate::teia_midi::Host>> {
    match dest {
        Destination::Teia { slot } => teia_host(*slot),
        Destination::Deck { deck } => DECKS.lock().unwrap().get(*deck)?.upgrade(),
        _ => None,
    }
}
pub fn attach_instruments(hosts: &[Arc<crate::teia::Host>]) {
    let _ = INSTRUMENTS.set(hosts.iter().map(Arc::downgrade).collect());
}
pub fn deck_keys(keys: [Option<Harmony>; 2]) -> Result<()> {
    ensure!(
        keys.iter()
            .flatten()
            .all(|h| h.key < 12 && h.scale < SCALES.len()),
        "Invalid deck key"
    );
    host().state.lock().unwrap().decks = keys;
    Ok(())
}
fn instruments() -> Value {
    json!(INSTRUMENTS
        .get()
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(slot, weak)| weak.upgrade().map(|host| {
            let s = host.instrument_info();
            json!({"slot":slot,"name":s["name"],"loaded":s["loaded"],"running":s["running"]})
        }))
        .collect::<Vec<_>>())
}
pub(crate) fn teia_host(slot: usize) -> Option<Arc<crate::teia_midi::Host>> {
    INSTRUMENTS
        .get()?
        .get(slot)?
        .upgrade()
        .map(|h| h.midi.clone())
}
fn destination(p: &Pattern) -> Destination {
    p.destination
        .clone()
        .unwrap_or(Destination::Midi { output: p.output })
}
fn lead(p: &Pattern) -> f64 {
    if matches!(
        destination(p),
        Destination::Teia { .. } | Destination::Deck { .. }
    ) {
        40.
    } else {
        5.
    }
}

fn host() -> &'static Host {
    HOST.get_or_init(|| {
        let loaded = match std::fs::read(crate::paths::support().join("patterns.json")) {
            Ok(bytes) => serde_json::from_slice::<Bank>(&bytes)
                .map_err(anyhow::Error::from)
                .and_then(|b| {
                    let mut b = b;
                    pattern_routing::migrate(&mut b);
                    b.validate()?;
                    Ok(b)
                }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Bank::default()),
            Err(e) => Err(e.into()),
        };
        let error = loaded
            .as_ref()
            .err()
            .map(|e| format!("Cannot load patterns: {e}"));
        Host {
            playing: false.into(),
            halt: false.into(),
            seq: 0.into(),
            beat: 0.into(),
            bpm: 120_f64.to_bits().into(),
            ns: 0.into(),
            state: Mutex::new(State {
                bank: Arc::new({
                    let mut b = loaded.unwrap_or_default();
                    pattern_routing::migrate(&mut b);
                    b
                }),
                voices: HashMap::new(),
                outputs: json!([]),
                inputs: json!([]),
                live_roots: HashMap::new(),
                device_notes: HashMap::new(),
                load_error: error.is_some(),
                error,
                commands: Vec::new(),
                decks: [None, None],
            }),
        }
    })
}
pub fn clock_running() -> bool {
    HOST.get().is_some_and(|h| h.playing.load(SeqCst))
}
pub fn shutdown() {
    if let Some(h) = HOST.get() {
        h.halt.store(true, SeqCst);
        for _ in 0..50 {
            if !h.halt.load(SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        // Releases follow the bounded 40 ms live MIDI / 5 ms pattern horizons.
        // Keep the process alive until CoreMIDI has delivered those final offs.
        std::thread::sleep(std::time::Duration::from_millis(45));
    }
}
/// Single writer: Core Audio callback. No allocation, lock or device call.
pub fn anchor(beat: f64, bpm: f64, ns: u64) {
    if let Some(h) = HOST.get() {
        h.seq.fetch_add(1, SeqCst);
        h.beat.store(beat.to_bits(), SeqCst);
        h.bpm.store(bpm.to_bits(), SeqCst);
        h.ns.store(ns, SeqCst);
        h.seq.fetch_add(1, SeqCst);
    }
}
fn clock(h: &Host) -> (f64, f64, u64) {
    loop {
        let seq = h.seq.load(SeqCst);
        if seq % 2 != 0 {
            continue;
        }
        let v = (
            f64::from_bits(h.beat.load(SeqCst)),
            f64::from_bits(h.bpm.load(SeqCst)),
            h.ns.load(SeqCst),
        );
        if seq == h.seq.load(SeqCst) {
            return v;
        }
    }
}
static START: std::sync::Once = std::sync::Once::new();
pub(crate) fn start() {
    let _ = host();
    START.call_once(|| {
        #[cfg(target_os = "macos")]
        std::thread::spawn(mac::run);
    });
}
pub fn state() -> Value {
    start();
    let h = host();
    let s = h.state.lock().unwrap();
    let (beat, bpm, ns) = clock(h);
    #[cfg(target_os = "macos")]
    let ready = ns != 0 && unsafe { crate::teia_midi::now_ns() }.saturating_sub(ns) < 100_000_000;
    #[cfg(not(target_os = "macos"))]
    let ready = false;
    let _ = ns;
    let mut voices = HashMap::new();
    let resolved = pattern_routing::resolve(&s.bank, s.decks);
    for (id, v) in &s.voices {
        let owner = resolved
            .patterns
            .iter()
            .find(|p| p.id == *id)
            .and_then(|p| p.owner.clone())
            .unwrap_or(id.clone());
        voices
            .entry(owner)
            .or_insert(json!({"start":v.start,"stop":v.stop}));
    }
    json!({"inputs":s.inputs,"liveRoots":s.live_roots,"deviceNotes":s.device_notes,"instruments":instruments(),"deckKeys":s.decks,"activeDeck":active_deck(),"bank":s.bank.as_ref(),"outputs":s.outputs,"error":s.error,"clockReady":ready,"beat":beat,"bpm":bpm,"voices":voices})
}
pub fn save(bank: Bank) -> Result<()> {
    bank.validate()?;
    start();
    let mut s = host().state.lock().unwrap();
    ensure!(
        !s.load_error,
        "Cannot overwrite unreadable patterns.json; restore the file first"
    );
    let path = crate::paths::support().join("patterns.json");
    std::fs::create_dir_all(path.parent().unwrap())?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&bank)?)?;
    std::fs::rename(tmp, path)?;
    s.bank = Arc::new(bank);
    Ok(())
}
pub fn transport(id: String, play: bool) -> Result<()> {
    start();
    let mut s = host().state.lock().unwrap();
    ensure!(
        s.bank.patterns.iter().any(|p| p.id == id),
        "Unknown pattern"
    );
    ensure!(s.commands.len() < 256, "Pattern command queue full");
    s.commands.push((id, play));
    Ok(())
}
fn launch_boundary(bank: &Bank, p: &Pattern, beat: f64, bpm: f64) -> f64 {
    let owner = p.owner.as_ref().unwrap_or(&p.id);
    let advance = bank
        .patterns
        .iter()
        .filter(|route| route.owner.as_ref().unwrap_or(&route.id) == owner)
        .map(|route| {
            route
                .compensation
                .unwrap_or(*bank.output_compensation.get(&route.output).unwrap_or(&0.))
                + lead(route)
                + 1.
        })
        .fold(0., f64::max);
    let earliest = beat + advance / 1000. * bpm / 60.;
    if p.phrase_sync {
        boundary(earliest, p.quantum)
    } else {
        earliest
    }
}
fn boundary(beat: f64, quantum: u8) -> f64 {
    ((beat + 1e-7) / quantum as f64).ceil() * quantum as f64
}
fn recovery_start(
    bank: &Bank,
    p: &Pattern,
    v: &Voice,
    last_beat: Option<f64>,
    beat: f64,
    bpm: f64,
) -> f64 {
    if !v
        .start
        .zip(last_beat)
        .is_some_and(|(start, last)| start <= last)
    {
        return launch_boundary(bank, p, beat, bpm);
    }
    if !p.phrase_sync {
        // Carry the local loop phase across a master seek/reset.
        let elapsed = last_beat.unwrap() - v.start.unwrap();
        return beat - elapsed.rem_euclid(p.length_beats());
    }
    // A clock reset restarts an already playing pattern without launch quantization.
    // Allow the old MIDI horizon to drain and its note-offs to precede new ons.
    // Share the restart time across routes, including compensated outputs.
    let owner = p.owner.as_ref().unwrap_or(&p.id);
    let compensation = bank
        .patterns
        .iter()
        .filter(|route| route.owner.as_ref().unwrap_or(&route.id) == owner)
        .map(|route| {
            route
                .compensation
                .unwrap_or(*bank.output_compensation.get(&route.output).unwrap_or(&0.))
        })
        .fold(0., f64::max);
    beat + (compensation + 6.) / 1000. * bpm / 60.
}
#[derive(Debug)]
struct Edge {
    beat: f64,
    on: bool,
    id: String,
    pitch: u8,
    velocity: u8,
}
fn edges(p: &Pattern, start: f64, from: f64, to: f64, stop: Option<f64>) -> Vec<Edge> {
    let length = p.length_beats();
    let mut result = Vec::new();
    let first = ((from - start) / length).floor().max(0.) as u64;
    let last = ((to - start) / length).floor().max(0.) as u64;
    for cycle in first.saturating_sub(1)..=last {
        for n in &p.notes {
            let Some(pitch) = pattern_routing::transform(p.pitch(n), &p.transformations) else {
                continue;
            };
            let on = start + cycle as f64 * length + n.beat;
            let off = (on + n.duration).min(start + (cycle + 1) as f64 * length);
            for (beat, on_event) in [(on, true), (off, false)] {
                if beat > from
                    && beat <= to
                    && stop.is_none_or(|s| if on_event { beat < s } else { beat <= s })
                {
                    result.push(Edge {
                        beat,
                        on: on_event,
                        id: n.id.clone(),
                        pitch,
                        velocity: n.velocity,
                    });
                }
            }
        }
    }
    result.sort_by(|a, b| a.beat.total_cmp(&b.beat).then(a.on.cmp(&b.on)));
    result
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::{
        ffi::{c_char, c_void, CStr},
        time::Duration,
    };
    unsafe extern "C" {
        fn vira_midi_open(
            callback: extern "C" fn(*mut c_void, u8, u8, u8, u64),
            context: *mut c_void,
        ) -> *mut c_void;
        fn vira_midi_select(handle: *mut c_void, input: i32, output: i32) -> i32;
        fn vira_midi_send_raw(handle: *mut c_void, bytes: *const u8, length: usize, ns: u64)
            -> i32;
        fn vira_midi_send(handle: *mut c_void, status: u8, a: u8, b: u8, ns: u64) -> i32;
        fn vira_midi_count(output: bool) -> usize;
        fn vira_midi_endpoint(
            output: bool,
            index: usize,
            id: *mut i32,
            name: *mut c_char,
            len: usize,
        ) -> bool;
        fn vira_midi_close(handle: *mut c_void);
    }
    extern "C" fn ignore(_: *mut c_void, _: u8, _: u8, _: u8, _: u64) {}
    struct Ports {
        handles: HashMap<i32, *mut c_void>,
        refs: HashMap<(Destination, u8, u8), usize>,
        live_error: Option<String>,
        controllers: HashMap<(Destination, u8, u8), HashMap<u16, (u8, u64)>>,
    }
    impl Ports {
        fn send(
            &mut self,
            p: &Pattern,
            channel: u8,
            pitch: u8,
            velocity: u8,
            on: bool,
            ns: u64,
        ) -> Result<()> {
            if p.note_source {
                return Ok(());
            }
            self.send_to(&destination(p), p.route, channel, pitch, velocity, on, ns)
        }
        fn send_to(
            &mut self,
            dest: &Destination,
            route: u16,
            channel: u8,
            pitch: u8,
            velocity: u8,
            on: bool,
            ns: u64,
        ) -> Result<()> {
            self.send_note(dest, route, channel, pitch, velocity, on, ns, None)
        }
        fn send_note(
            &mut self,
            dest: &Destination,
            route: u16,
            channel: u8,
            pitch: u8,
            velocity: u8,
            on: bool,
            ns: u64,
            raw: Option<&[u8]>,
        ) -> Result<()> {
            let dest = dest.clone();
            if !matches!(dest, Destination::Midi { .. }) {
                let host = internal_host(&dest)
                    .ok_or_else(|| anyhow::anyhow!("Note destination removed"))?;
                let kind = if on {
                    teia_kernel::hosted::EventKind::NoteOn {
                        channel,
                        note: pitch,
                        velocity: velocity as f64 / 127.,
                    }
                } else {
                    teia_kernel::hosted::EventKind::NoteOff {
                        channel,
                        note: pitch,
                    }
                };
                ensure!(
                    host.enqueue_routed_time(ns, kind, route),
                    "Teia MIDI queue unavailable"
                );
                return Ok(());
            }
            let key = (dest.clone(), channel, pitch);
            if on {
                let count = self.refs.entry(key).or_default();
                *count += 1;
                if *count > 1 {
                    return Ok(());
                }
            } else {
                let Some(count) = self.refs.get_mut(&key) else {
                    return Ok(());
                };
                *count -= 1;
                if *count > 0 {
                    return Ok(());
                }
                self.refs.remove(&key);
            }
            let Destination::Midi { output } = dest else {
                unreachable!()
            };
            let handle = self.handles.entry(output).or_insert_with(|| unsafe {
                let h = vira_midi_open(ignore, std::ptr::null_mut());
                if !h.is_null() && vira_midi_select(h, 0, output) != 0 {
                    vira_midi_close(h);
                    std::ptr::null_mut()
                } else {
                    h
                }
            });
            ensure!(!handle.is_null(), "MIDI output {output} unavailable");
            ensure!(
                unsafe {
                    if let Some(bytes) = raw {
                        vira_midi_send_raw(*handle, bytes.as_ptr(), bytes.len(), ns)
                    } else {
                        vira_midi_send(
                            *handle,
                            (if on { 0x90 } else { 0x80 }) | (channel - 1),
                            pitch,
                            if on { velocity } else { 0 },
                            ns,
                        )
                    }
                } == 0,
                "MIDI send failed on output {output}"
            );
            Ok(())
        }
        fn finish(&mut self, p: &Pattern, v: &mut Voice, ns: u64) {
            for (_, pitch) in v.active.drain() {
                let _ = self.send(p, p.channel, pitch, 0, false, ns);
            }
        }
        fn release(&mut self, p: &Pattern, v: &mut Voice, ns: u64) {
            if !matches!(destination(p), Destination::Midi { .. }) {
                if let Some(host) = internal_host(&destination(p)) {
                    host.cancel_route(p.route);
                }
                v.active.clear();
                return;
            }
            for (_, pitch) in v.active.drain() {
                let mut release = p.clone();
                release.route = u16::MAX;
                let _ = self.send(&release, p.channel, pitch, 0, false, ns);
            }
        }
    }
    impl crate::midi_live::Sink for Ports {
        fn note(
            &mut self,
            dest: &Destination,
            owner: u16,
            ch: u8,
            n: u8,
            velocity: u8,
            on: bool,
            ns: u64,
        ) {
            if let Err(e) = self.send_to(dest, owner, ch, n, velocity, on, ns) {
                self.live_error = Some(e.to_string());
            }
        }
        fn midi_note(&mut self, dest: &Destination, owner: u16, bytes: &[u8], ns: u64) {
            if let Err(e) = self.send_note(
                dest,
                owner,
                (bytes[0] & 15) + 1,
                bytes[1],
                bytes[2],
                bytes[0] & 0xf0 == 0x90 && bytes[2] > 0,
                ns,
                Some(bytes),
            ) {
                self.live_error = Some(e.to_string());
            }
        }
        fn raw(&mut self, dest: &Destination, owner: u16, bytes: &[u8], ns: u64) {
            if owner != u16::MAX
                && bytes.len() == 3
                && bytes[0] & 0xf0 == 0xb0
                && [64, 66, 69].contains(&bytes[1])
            {
                self.controllers
                    .entry((dest.clone(), (bytes[0] & 15) + 1, bytes[1]))
                    .or_default()
                    .insert(owner, (bytes[2], ns));
            }
            if let Destination::Midi { output } = dest {
                let handle = self.handles.entry(*output).or_insert_with(|| unsafe {
                    let h = vira_midi_open(ignore, std::ptr::null_mut());
                    if !h.is_null() && vira_midi_select(h, 0, *output) != 0 {
                        vira_midi_close(h);
                        std::ptr::null_mut()
                    } else {
                        h
                    }
                });
                if handle.is_null()
                    || unsafe { vira_midi_send_raw(*handle, bytes.as_ptr(), bytes.len(), ns) } != 0
                {
                    self.live_error = Some("Live MIDI send failed".into());
                }
            } else if let Some(host) = internal_host(dest) {
                if bytes.len() == 3 {
                    if let Some(kind) = crate::teia_midi::decode(bytes[0], bytes[1], bytes[2]) {
                        if !host.enqueue_routed_time(ns, kind, owner) {
                            self.live_error = Some("Live MIDI queue unavailable".into());
                        }
                    }
                }
            }
        }
        fn cancel(&mut self, dest: &Destination, owner: u16, notes: &[(u8, u8, u16)], ns: u64) {
            let mut restore = Vec::new();
            self.controllers.retain(|(destination, ch, cc), owners| {
                if destination == dest && owners.remove(&owner).is_some() {
                    let value = owners
                        .values()
                        .max_by_key(|(_, stamp)| stamp)
                        .map_or(0, |(value, _)| *value);
                    restore.push((*ch, *cc, value));
                }
                !owners.is_empty()
            });
            for (ch, cc, value) in restore {
                self.raw(dest, u16::MAX, &[0xb0 | (ch - 1), cc, value], ns);
            }
            if let Some(host) = internal_host(dest) {
                host.cancel_route(owner);
            } else {
                for &(ch, n, count) in notes {
                    for _ in 0..count {
                        let _ = self.send_to(dest, owner, ch, n, 0, false, ns);
                    }
                }
            }
        }
    }
    fn is_available(p: &Pattern, available: &HashSet<i32>) -> bool {
        if p.note_source {
            return true;
        }
        match destination(p) {
            Destination::Midi { output } => available.contains(&output),
            dest => internal_host(&dest)
                .is_some_and(|h| h.generation.load(SeqCst) != 0 && !h.muted.load(SeqCst)),
        }
    }
    pub fn run() {
        let h = host();
        let mut ports = Ports {
            handles: HashMap::new(),
            refs: HashMap::new(),
            live_error: None,
            controllers: HashMap::new(),
        };
        let mut live = crate::midi_live::Router::new();
        let mut live_running = true;
        let mut previous_roots = HashMap::new();
        let mut previous = Arc::new(Bank::default());
        let mut previous_source = Arc::new(Bank::default());
        let mut instrument_revision = 0;
        let mut definition_source = Arc::new(Bank::default());
        let mut resolved_source = Arc::new(Bank::default());
        let mut previous_decks = [None, None];
        let mut previous_active = usize::MAX;
        let mut generations = Vec::new();
        let mut last_beat = None;
        let mut polls = 0;
        let mut available = HashSet::new();
        loop {
            let now = unsafe { crate::teia_midi::now_ns() };
            let (base, bpm, anchor) = clock(h);
            let ready = anchor != 0 && now.saturating_sub(anchor) < 100_000_000;
            let beat = base + (now as i128 - anchor as i128) as f64 / 1e9 * bpm / 60.;
            let mut s = h.state.lock().unwrap();
            if h.halt.load(SeqCst) {
                live.clear(&mut ports, now + 6_000_000);
                live_running = false;
                for (id, mut v) in s.voices.drain() {
                    if let Some(p) = previous.patterns.iter().find(|p| p.id == id) {
                        ports.release(p, &mut v, now + 6_000_000);
                    }
                }
                s.commands.clear();
                h.playing.store(false, SeqCst);
                h.halt.store(false, SeqCst);
            }
            if polls % 1000 == 0 {
                let mut outputs = Vec::new();
                available.clear();
                for index in 0..unsafe { vira_midi_count(true) } {
                    let mut id = 0;
                    let mut name = [0 as c_char; 256];
                    if unsafe {
                        vira_midi_endpoint(true, index, &mut id, name.as_mut_ptr(), name.len())
                    } {
                        available.insert(id);
                        outputs.push(json!({"id":id,"name":unsafe{CStr::from_ptr(name.as_ptr())}.to_string_lossy()}));
                    }
                }
                s.outputs = json!(outputs);
                let removed: Vec<_> = ports
                    .handles
                    .keys()
                    .copied()
                    .filter(|id| !available.contains(id) || ports.handles[id].is_null())
                    .collect();
                for id in removed {
                    if let Some(handle) = ports.handles.remove(&id) {
                        if !handle.is_null() {
                            unsafe { vira_midi_close(handle) }
                        }
                    }
                }
            }
            polls += 1;
            let revision = crate::instruments::revision();
            if revision != instrument_revision || !Arc::ptr_eq(&definition_source, &s.bank) {
                resolved_source = Arc::new(crate::instruments::resolve(&s.bank));
                definition_source = s.bank.clone();
                instrument_revision = revision;
            }
            let active = active_deck();
            let roots = if live_running {
                live.tick(&resolved_source, &mut ports, now, active, s.decks)
            } else {
                // UI controller permissions remain useful while audio routing is halted.
                live.tick(&Bank::default(), &mut ports, now, active, [None, None]);
                HashMap::new()
            };
            s.inputs = live.inputs();
            s.live_roots = roots.clone();
            s.device_notes = live.notes.clone();
            if let Some(error) = live.error.as_ref().or(ports.live_error.as_ref()) {
                s.error = Some(error.clone());
            }
            let discontinuity =
                last_beat.is_some_and(|last: f64| beat < last - 0.01 || beat - last > 0.25);
            let mut live_generations: Vec<_> = INSTRUMENTS
                .get()
                .into_iter()
                .flatten()
                .map(|h| h.upgrade().map_or(0, |h| h.midi.generation.load(SeqCst)))
                .collect();
            live_generations.extend((0..2).map(|deck| {
                internal_host(&Destination::Deck { deck }).map_or(0, |h| h.generation.load(SeqCst))
            }));
            let bank = if Arc::ptr_eq(&previous_source, &resolved_source)
                && previous_decks == s.decks
                && previous_active == active
                && generations == live_generations
                && previous_roots == roots
            {
                previous.clone()
            } else {
                let mut effective = resolved_source.as_ref().clone();
                if let Some(graph) = &mut effective.graph {
                    for node in &mut graph.nodes {
                        if node.kind == "instrument" {
                            node.harmony = None;
                        }
                    }
                    for node in &graph.nodes {
                        if let (Some(note), Some(id)) = (roots.get(&node.id), node.pattern.as_ref())
                        {
                            if let Some(p) = effective.patterns.iter_mut().find(|p| &p.id == id) {
                                p.key = note % 12;
                            }
                        }
                    }
                }
                let mut resolved = pattern_routing::resolve_active(&effective, s.decks, active);
                previous_roots = roots;
                for p in &mut resolved.patterns {
                    if let Some(h) = internal_host(&destination(p)) {
                        p.target_generation = h.generation.load(SeqCst);
                    }
                }
                previous_source = resolved_source.clone();
                previous_decks = s.decks;
                previous_active = active;
                generations = live_generations;
                Arc::new(resolved)
            };
            let playing_owners: HashMap<_, _> = s
                .voices
                .iter()
                .filter_map(|(id, v)| {
                    previous
                        .patterns
                        .iter()
                        .find(|p| p.id == *id)
                        .map(|p| (p.owner.as_ref().unwrap_or(&p.id).clone(), (v.start, v.stop)))
                })
                .collect();
            let old_ids: Vec<_> = s.voices.keys().cloned().collect();
            for id in old_ids {
                let old = previous.patterns.iter().find(|p| p.id == id);
                let new = bank.patterns.iter().find(|p| p.id == id);
                let changed = old != new
                    || old.is_some_and(|p| {
                        previous.output_compensation.get(&p.output)
                            != s.bank.output_compensation.get(&p.output)
                    });
                // Content edits continue from the existing scheduling cursor. Only
                // transport/destination changes need to release and requeue a voice.
                if changed && ready && !discontinuity {
                    if let (Some(old), Some(new)) = (old, new) {
                        if old.destination == new.destination
                            && old.output == new.output
                            && old.channel == new.channel
                            && old.target_generation == new.target_generation
                            && is_available(new, &available)
                        {
                            let v = s.voices.get_mut(&id).unwrap();
                            let comp = old.compensation.unwrap_or(
                                *previous.output_compensation.get(&old.output).unwrap_or(&0.),
                            );
                            let stamp = (anchor as f64 + (v.cursor - base) * 60. / bpm * 1e9
                                - comp * 1e6)
                                .max((now + 6_000_000) as f64)
                                as u64;
                            let removed: Vec<_> = v
                                .active
                                .iter()
                                .filter(|(id, _)| !keeps_held_note(old, new, id))
                                .map(|(id, pitch)| (id.clone(), *pitch))
                                .collect();
                            for (id, pitch) in removed {
                                let _ = ports.send(old, old.channel, pitch, 0, false, stamp);
                                v.active.remove(&id);
                            }
                            continue;
                        }
                    }
                }
                if changed
                    || !ready
                    || discontinuity
                    || new.is_some_and(|p| !is_available(p, &available))
                {
                    let mut v = s.voices.remove(&id).unwrap();
                    if let Some(p) = old {
                        ports.release(p, &mut v, now + 6_000_000);
                    }
                    if v.stop.is_some() {
                        continue;
                    }
                    if !ready {
                        s.error = Some(
                            "Audio clock stopped; patterns released. Start audio and launch again."
                                .into(),
                        );
                    } else if new.is_some_and(|p| !is_available(p, &available)) {
                        s.error = Some("MIDI destination disconnected; pattern stopped.".into());
                    } else if let Some(p) = new {
                        let start = if discontinuity {
                            recovery_start(&bank, p, &v, last_beat, beat, bpm)
                        } else {
                            launch_boundary(&bank, p, beat, bpm)
                        };
                        s.voices.insert(
                            id,
                            Voice {
                                start: Some(start),
                                cursor: if start < beat {
                                    launch_boundary(&bank, p, beat, bpm) - 1e-8
                                } else {
                                    start - 1e-8
                                },
                                ..Voice::default()
                            },
                        );
                    }
                }
            }
            // Adding a second output to a running pattern joins at a quantised
            // boundary without disturbing its existing routes.
            for p in &bank.patterns {
                if s.voices.contains_key(&p.id)
                    || previous.patterns.iter().any(|old| old.id == p.id)
                {
                    continue;
                }
                if let Some((Some(start), None)) =
                    playing_owners.get(p.owner.as_ref().unwrap_or(&p.id))
                {
                    if ready && is_available(p, &available) {
                        let comp = p
                            .compensation
                            .unwrap_or(*bank.output_compensation.get(&p.output).unwrap_or(&0.));
                        let cursor = if p.phrase_sync {
                            boundary(beat + (comp + lead(p) + 1.) / 1000. * bpm / 60., p.quantum)
                        } else {
                            beat + (comp + lead(p) + 1.) / 1000. * bpm / 60.
                        } - 1e-8;
                        s.voices.insert(
                            p.id.clone(),
                            Voice {
                                start: Some(*start),
                                cursor,
                                ..Voice::default()
                            },
                        );
                    }
                }
            }
            let timing_changes: std::collections::HashSet<_> = bank
                .patterns
                .iter()
                .filter(|p| {
                    previous
                        .patterns
                        .iter()
                        .find(|old| old.id == p.id)
                        .is_some_and(|old| old.compensation != p.compensation)
                })
                .map(|p| p.id.clone())
                .collect();
            previous = bank.clone();
            let commands = std::mem::take(&mut s.commands);
            for (id, play) in commands {
                let routes: Vec<_> = bank
                    .patterns
                    .iter()
                    .filter(|p| p.owner.as_ref().unwrap_or(&p.id) == &id)
                    .cloned()
                    .collect();
                if play && routes.is_empty() {
                    s.error =
                        Some("Connect the pattern MIDI output to an instrument first.".into());
                }
                for p in routes {
                    let id = p.id.clone();
                    let at = launch_boundary(&bank, &p, beat, bpm);
                    if play {
                        if !ready || !is_available(&p, &available) {
                            s.error=Some("Start audio and select an available MIDI destination before launching.".into());
                            continue;
                        }
                        s.error = None;
                        live_running = true;
                        s.voices.entry(id).or_insert_with(|| Voice {
                            start: Some(at),
                            cursor: at - 1e-8,
                            ..Voice::default()
                        });
                    } else if let Some(v) = s.voices.get_mut(&id) {
                        if v.stop.is_some() {
                            continue;
                        }
                        if v.start.is_some_and(|start| start >= at) {
                            v.stop = v.start;
                        } else {
                            v.stop = Some(at)
                        }
                    }
                }
            }
            let mut finished = Vec::new();
            let mut send_error = None;
            for p in &bank.patterns {
                let Some(v) = s.voices.get_mut(&p.id) else {
                    continue;
                };
                let start = v.start.unwrap();
                let comp = p
                    .compensation
                    .unwrap_or(*bank.output_compensation.get(&p.output).unwrap_or(&0.));
                let horizon = beat + (comp + lead(p)) / 1000. * bpm / 60.;
                if horizon < v.cursor {
                    continue;
                }
                // Late worker wakeups release notes instead of bursting stale note-ons.
                if horizon - v.cursor > 0.5 && v.cursor >= start && !timing_changes.contains(&p.id)
                {
                    ports.release(p, v, now + 6_000_000);
                    v.cursor = horizon;
                }
                for edge in edges(p, start, v.cursor, horizon, v.stop) {
                    let stamp = (anchor as f64 + (edge.beat - base) * 60. / bpm * 1e9 - comp * 1e6)
                        .max(now as f64) as u64;
                    if edge.on {
                        v.active.insert(edge.id, edge.pitch);
                    } else if v.active.remove(&edge.id).is_none() {
                        continue;
                    }
                    if p.note_source && edge.on {
                        live.pattern_note(
                            p.owner.as_deref().unwrap_or(&p.id),
                            p.channel,
                            edge.pitch,
                            edge.velocity,
                            stamp,
                        );
                    }
                    if let Err(e) =
                        ports.send(p, p.channel, edge.pitch, edge.velocity, edge.on, stamp)
                    {
                        send_error = Some(e.to_string());
                        finished.push(p.id.clone());
                        break;
                    }
                }
                v.cursor = horizon;
                if v.stop.is_some_and(|stop| stop <= horizon) {
                    let stamp = (anchor as f64 + (v.stop.unwrap() - base) * 60. / bpm * 1e9
                        - comp * 1e6)
                        .max(now as f64) as u64;
                    if !v.stop_sent {
                        ports.finish(p, v, stamp);
                        v.stop_sent = true;
                    }
                    if beat + comp / 1000. * bpm / 60. >= v.stop.unwrap() {
                        finished.push(p.id.clone());
                    }
                }
            }
            if send_error.is_some() {
                s.error = send_error;
            }
            for id in finished {
                if let Some(mut v) = s.voices.remove(&id) {
                    if let Some(p) = bank.patterns.iter().find(|p| p.id == id) {
                        ports.release(p, &mut v, now + 6_000_000);
                    }
                }
            }
            h.playing.store(!s.voices.is_empty(), SeqCst);
            last_beat = Some(beat);
            drop(s);
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pattern() -> Pattern {
        serde_json::from_value(json!({"id":"a","name":"Melody","kind":"melodic","mode":"relative","output":1,"channel":1,"bars":1,"grid":4,"key":0,"scale":0,"octave":4,"quantum":4,"compensation":null,"notes":[{"id":"n","beat":0.,"duration":4.,"degree":3,"octave":0,"velocity":100}]})).unwrap()
    }
    #[test]
    fn step_lengths_loop_without_realigning_to_bars_and_validate() {
        let mut p = pattern();
        assert_eq!(p.length_beats(), 4.); // Legacy bar-based files.
        assert!(p.phrase_sync);
        p.steps = Some(7);
        p.notes[0].duration = 1.75;
        p.validate().unwrap();
        let events = edges(&p, 0.3, 0.29, 5.6, None);
        let ons: Vec<_> = events.iter().filter(|e| e.on).map(|e| e.beat).collect();
        assert_eq!(ons, vec![0.3, 2.05, 3.8, 5.55]);
        assert!(!events[1].on); // Note-off before the next loop's note-on.
        p.notes[0].duration = 2.;
        assert!(p.validate().is_err());
        p.notes.clear();
        for steps in [0, 65537] {
            p.steps = Some(steps);
            assert!(p.validate().is_err());
        }
        p.steps = Some(65536);
        p.validate().unwrap();
    }
    #[test]
    fn tempo_only_launches_share_route_timing_and_preserve_phase_on_master_reset() {
        let mut p = pattern();
        p.phrase_sync = false;
        p.steps = Some(7);
        p.owner = Some("owner".into());
        let mut second = p.clone();
        second.id = "second".into();
        second.compensation = Some(20.);
        let bank = Bank {
            patterns: vec![p.clone(), second.clone()],
            ..Bank::default()
        };
        let start = launch_boundary(&bank, &p, 3.2, 120.);
        assert!(start > 3.2 && start < 3.3);
        assert_eq!(start, launch_boundary(&bank, &second, 3.2, 120.));
        let voice = Voice {
            start: Some(1.),
            ..Voice::default()
        };
        let recovered = recovery_start(&bank, &p, &voice, Some(4.), 0.2, 120.);
        assert!((0.2 - recovered - 1.25).abs() < 1e-9);
        assert!((recovery_start(&bank, &p, &voice, Some(4.), 100., 120.) - 98.75).abs() < 1e-9);
    }
    #[test]
    fn transformed_edges_match_note_offs_and_setting_edits_release_held_notes() {
        use crate::pattern_routing::Transformation::*;
        let p = pattern();
        let mut shifted = p.clone();
        shifted.transformations = vec![OctaveShift { octaves: 1 }];
        let original = edges(&p, 0., -0.01, 8., None);
        let mapped = edges(&shifted, 0., -0.01, 8., None);
        assert_eq!(original.len(), mapped.len());
        for (a, b) in original.iter().zip(&mapped) {
            assert_eq!((a.beat, a.on, a.velocity), (b.beat, b.on, b.velocity));
            assert_eq!(a.pitch + 12, b.pitch);
        }
        assert!(!keeps_held_note(&p, &shifted, &p.notes[0].id));
        shifted.transformations.push(Filter {
            direction: "below".into(),
            note: 0,
        });
        assert!(edges(&shifted, 0., -0.01, 8., None).is_empty());
        assert!(!keeps_held_note(&p, &shifted, &p.notes[0].id));
    }
    #[test]
    fn live_edits_keep_unaffected_notes_and_release_changed_notes() {
        let old = pattern();
        let mut new = old.clone();
        new.name = "Edited".into();
        new.notes.push(Note {
            id: "added".into(),
            beat: 2.,
            duration: 1.,
            degree: 1,
            octave: 0,
            velocity: 100,
        });
        assert!(keeps_held_note(&old, &new, "n"));
        new.notes[0].velocity = 70;
        assert!(keeps_held_note(&old, &new, "n"));
        new.notes[0].duration = 2.;
        assert!(!keeps_held_note(&old, &new, "n"));
        new = old.clone();
        new.key = 2;
        assert!(!keeps_held_note(&old, &new, "n"));
        new = old.clone();
        new.notes.clear();
        assert!(!keeps_held_note(&old, &new, "n"));
    }
    #[test]
    fn relative_mapping_and_octaves() {
        let mut p = pattern();
        assert_eq!(p.pitch(&p.notes[0]), 64);
        p.key = 7;
        p.scale = 1;
        assert_eq!(p.pitch(&p.notes[0]), 70);
        p.notes[0].octave = -1;
        assert_eq!(p.pitch(&p.notes[0]), 58);
        p.validate().unwrap();
    }
    #[test]
    fn loops_order_off_before_on_and_stop_excludes_on() {
        let p = pattern();
        let e = edges(&p, 4., 3.99, 8., None);
        assert_eq!(e.len(), 3);
        assert!(!e[1].on);
        assert!(e[2].on);
        let e = edges(&p, 4., 3.99, 8., Some(8.));
        assert_eq!(e.len(), 2);
        assert!(!e[1].on);
        assert_eq!(boundary(4., 4), 8.);
    }
    #[test]
    fn validation_rejects_bad_pitch_and_durations() {
        let mut p = pattern();
        p.notes[0].duration = 5.;
        assert!(p.validate().is_err());
        p.notes[0].duration = 1.;
        p.octave = 7;
        p.key = 11;
        p.notes[0].octave = 2;
        assert!(p.validate().is_err());
    }
    #[test]
    fn serialization_keeps_mapping_separate() {
        let p = pattern();
        let n = serde_json::to_value(&p.notes[0]).unwrap();
        assert!(n.get("pitch").is_none());
        assert_eq!(n["degree"], 3);
        let restored: Pattern = serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
        assert_eq!(p, restored);
    }
    #[test]
    fn all_destinations_launch_and_stop_at_one_common_boundary() {
        let mut p = pattern();
        p.owner = Some("owner".into());
        p.quantum = 4;
        p.destination = Some(Destination::Midi { output: 1 });
        let mut teia = p.clone();
        teia.id = "teia-route".into();
        teia.destination = Some(Destination::Teia { slot: 0 });
        let bank = Bank {
            patterns: vec![p.clone(), teia.clone()],
            ..Bank::default()
        };
        assert_eq!(launch_boundary(&bank, &p, 3.95, 120.), 8.);
        assert_eq!(launch_boundary(&bank, &teia, 3.95, 120.), 8.);
    }
    #[test]
    fn clock_reset_restarts_running_pattern_without_waiting_for_quantum() {
        let p = pattern();
        let bank = Bank {
            patterns: vec![p.clone()],
            ..Bank::default()
        };
        let voice = Voice {
            start: Some(4.),
            cursor: 12.1,
            ..Voice::default()
        };
        // Both backward resets and forward jumps restart from the first note.
        for beat in [0.03, 25.03] {
            let start = recovery_start(&bank, &p, &voice, Some(12.), beat, 120.);
            assert!((start - beat - 0.012).abs() < 1e-9);
            let events = edges(&p, start, start - 1e-8, start + 0.01, None);
            assert_eq!(events.len(), 1);
            assert!(events[0].on);
            assert_eq!(events[0].beat, start);
        }
        let pending = Voice {
            start: Some(16.),
            ..Voice::default()
        };
        assert_eq!(
            recovery_start(&bank, &p, &pending, Some(12.), 0.03, 120.),
            4.
        );
    }
    #[test]
    fn clock_reset_keeps_compensated_destinations_together() {
        let mut p = pattern();
        p.owner = Some("owner".into());
        let mut teia = p.clone();
        teia.id = "teia-route".into();
        teia.destination = Some(Destination::Teia { slot: 0 });
        teia.compensation = Some(10.);
        let bank = Bank {
            patterns: vec![p.clone(), teia.clone()],
            ..Bank::default()
        };
        let voice = Voice {
            start: Some(4.),
            ..Voice::default()
        };
        let start = recovery_start(&bank, &p, &voice, Some(12.), 0.03, 120.);
        assert_eq!(
            start,
            recovery_start(&bank, &teia, &voice, Some(12.), 0.03, 120.)
        );
        assert!((start - 0.062).abs() < 1e-9);
    }
}
