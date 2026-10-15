//! Host-owned bounded MIDI queues. No device API or locks run in the DSP producer.
use rtrb::{Consumer, Producer};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering::SeqCst},
    Arc, Mutex,
};
use teia_kernel::hosted::{EventKind, MidiOutput};
#[derive(Clone, Copy)]
pub struct Input {
    pub epoch: u64,
    pub generation: u64,
    pub frame: u64,
    pub kind: EventKind,
}
#[derive(Clone, Copy)]
pub struct Output {
    pub epoch: u64,
    pub generation: u64,
    pub frame: u64,
    pub event: MidiOutput,
}
pub struct Host {
    input: Mutex<Producer<Input>>,
    output: Mutex<Consumer<Output>>,
    pub generation: AtomicU64,
    pub epoch: AtomicU64,
    pub ready: AtomicBool,
    pub muted: AtomicBool,
    pub input_drops: AtomicU64,
    pub output_drops: AtomicU64,
    pub late_inputs: AtomicU64,
    pub reset: AtomicBool,
    pub panic: AtomicBool,
    anchor_sequence: AtomicU64,
    anchor_frame: AtomicU64,
    anchor_ns: AtomicU64,
    pub input_id: AtomicI32,
    pub output_id: AtomicI32,
    changed: AtomicBool,
    state: Mutex<Value>,
}
#[derive(Clone, Copy)]
struct Scheduled {
    input: Input,
    serial: u64,
}
impl PartialEq for Scheduled {
    fn eq(&self, other: &Self) -> bool {
        (self.input.frame, self.serial) == (other.input.frame, other.serial)
    }
}
impl Eq for Scheduled {}
impl PartialOrd for Scheduled {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Scheduled {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        (other.input.frame, other.serial).cmp(&(self.input.frame, self.serial))
    }
}
pub struct Render {
    pub host: Arc<Host>,
    input: Consumer<Input>,
    output: Producer<Output>,
    pending: std::collections::BinaryHeap<Scheduled>,
    serial: u64,
    epoch: u64,
}
pub fn channel() -> Render {
    let (tx, rx) = rtrb::RingBuffer::new(1024);
    let (out_tx, out_rx) = rtrb::RingBuffer::new(4096);
    let host = Arc::new(Host {
        input: Mutex::new(tx),
        output: Mutex::new(out_rx),
        generation: 0.into(),
        epoch: 0.into(),
        ready: true.into(),
        muted: false.into(),
        input_drops: 0.into(),
        output_drops: 0.into(),
        late_inputs: 0.into(),
        reset: false.into(),
        panic: false.into(),
        anchor_sequence: 0.into(),
        anchor_frame: 0.into(),
        anchor_ns: 0.into(),
        input_id: 0.into(),
        output_id: 0.into(),
        changed: true.into(),
        state: Mutex::new(json!({"available":false,"inputs":[],"outputs":[]})),
    });
    Render {
        host,
        input: rx,
        output: out_tx,
        pending: std::collections::BinaryHeap::with_capacity(1024),
        serial: 0,
        epoch: 0,
    }
}
impl Render {
    pub fn prepare_input(&mut self, epoch: u64) {
        if self.epoch != epoch {
            self.pending.clear();
            self.epoch = epoch;
        }
        for _ in 0..1024 {
            let Ok(input) = self.input.pop() else {
                break;
            };
            if input.epoch != epoch {
                continue;
            }
            if self.pending.len() == 1024 {
                self.host.input_drops.fetch_add(1, SeqCst);
                self.host.mute();
                break;
            }
            self.serial = self.serial.wrapping_add(1);
            self.pending.push(Scheduled {
                input,
                serial: self.serial,
            });
        }
    }
    pub fn input_before(&mut self, end: u64) -> Option<Input> {
        if self.pending.peek().is_some_and(|s| s.input.frame < end) {
            self.pending.pop().map(|s| s.input)
        } else {
            None
        }
    }
    pub fn output(&mut self, value: Output) {
        if self.output.push(value).is_err() {
            self.host.output_drops.fetch_add(1, SeqCst);
            self.host.mute();
        }
    }
}
impl Host {
    pub fn snapshot(&self) -> Value {
        let mut value = self.state.lock().unwrap().clone();
        value["input"] = json!(self.input_id.load(SeqCst));
        value["output"] = json!(self.output_id.load(SeqCst));
        value["muted"] = json!(self.muted.load(SeqCst));
        value["inputDrops"] = json!(self.input_drops.load(SeqCst));
        value["outputDrops"] = json!(self.output_drops.load(SeqCst));
        value["lateInputs"] = json!(self.late_inputs.load(SeqCst));
        value
    }
    pub fn invalidate(&self) {
        self.epoch.fetch_add(1, SeqCst);
        self.panic.store(true, SeqCst);
    }
    pub fn mute(&self) {
        self.muted.store(true, SeqCst);
        self.generation.store(0, SeqCst);
        self.invalidate();
        self.reset.store(true, SeqCst);
    }
    pub fn request_reset(&self) {
        self.generation.store(0, SeqCst);
        self.invalidate();
        self.reset.store(true, SeqCst);
    }
    pub fn configure(&self, input: i32, output: i32) {
        self.input_id.store(input, SeqCst);
        self.output_id.store(output, SeqCst);
        self.ready.store(false, SeqCst);
        self.muted.store(false, SeqCst);
        self.generation.store(0, SeqCst);
        self.invalidate();
        self.changed.store(true, SeqCst);
    }
    pub fn enqueue_control(&self, frame: u64, generation: u64, index: usize, value: f64) -> bool {
        let input = Input {
            epoch: self.epoch.load(SeqCst),
            generation,
            frame,
            kind: EventKind::Control {
                value_index: index,
                value,
                generation,
            },
        };
        if let Ok(mut queue) = self.input.try_lock() {
            if queue.push(input).is_ok() {
                return true;
            }
        }
        self.input_drops.fetch_add(1, SeqCst);
        self.mute();
        false
    }
    pub fn enqueue(&self, frame: u64, kind: EventKind) -> bool {
        let input = Input {
            epoch: self.epoch.load(SeqCst),
            generation: self.generation.load(SeqCst),
            frame,
            kind,
        };
        if input.generation == 0 {
            return false;
        }
        if let Ok(mut queue) = self.input.try_lock() {
            if queue.push(input).is_ok() {
                return true;
            }
        }
        self.input_drops.fetch_add(1, SeqCst);
        self.mute();
        false
    }
    pub fn anchor(&self, frame: u64, ns: u64) {
        self.anchor_sequence.fetch_add(1, SeqCst);
        self.anchor_frame.store(frame, SeqCst);
        self.anchor_ns.store(ns, SeqCst);
        self.anchor_sequence.fetch_add(1, SeqCst);
    }
    fn clock(&self) -> (u64, u64) {
        loop {
            let seq = self.anchor_sequence.load(SeqCst);
            if seq % 2 != 0 {
                continue;
            }
            let frame = self.anchor_frame.load(SeqCst);
            let ns = self.anchor_ns.load(SeqCst);
            if seq == self.anchor_sequence.load(SeqCst) {
                return (frame, ns);
            }
        }
    }
    fn frame_at(&self, ns: u64) -> u64 {
        let (frame, time) = self.clock();
        if time == 0 {
            return 0;
        }
        if ns >= time {
            frame.saturating_add(((ns - time) as u128 * 48000 / 1_000_000_000) as u64)
        } else {
            frame.saturating_sub(((time - ns) as u128 * 48000 / 1_000_000_000) as u64)
        }
    }
    fn time_at(&self, frame: u64) -> u64 {
        let (base, ns) = self.clock();
        if frame >= base {
            ns.saturating_add(((frame - base) as u128 * 1_000_000_000 / 48000) as u64)
        } else {
            ns.saturating_sub(((base - frame) as u128 * 1_000_000_000 / 48000) as u64)
        }
    }
}
fn decode(status: u8, a: u8, b: u8) -> Option<EventKind> {
    if a >= 128 || b >= 128 {
        return None;
    }
    let channel = (status & 15) + 1;
    Some(match status & 0xf0 {
        0x80 => EventKind::NoteOff { channel, note: a },
        0x90 if b == 0 => EventKind::NoteOff { channel, note: a },
        0x90 => EventKind::NoteOn {
            channel,
            note: a,
            velocity: b as f64 / 127.,
        },
        0xb0 => EventKind::ControlChange {
            channel,
            controller: a,
            value: b as f64 / 127.,
        },
        0xe0 => EventKind::PitchBend {
            channel,
            value: a as u16 + ((b as u16) << 7),
            range_semitones: 2.,
        },
        _ => return None,
    })
}
#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::{
        ffi::{c_char, c_void, CStr},
        path::PathBuf,
        time::{Duration, Instant},
    };
    unsafe extern "C" {
        fn vira_midi_open(
            callback: extern "C" fn(*mut c_void, u8, u8, u8, u64),
            context: *mut c_void,
        ) -> *mut c_void;
        fn vira_midi_close(handle: *mut c_void);
        fn vira_midi_count(output: bool) -> usize;
        fn vira_midi_endpoint(
            output: bool,
            index: usize,
            id: *mut i32,
            name: *mut c_char,
            len: usize,
        ) -> bool;
        fn vira_midi_select(handle: *mut c_void, input: i32, output: i32) -> i32;
        fn vira_midi_send(handle: *mut c_void, status: u8, a: u8, b: u8, ns: u64) -> i32;
        fn vira_midi_connected(handle: *mut c_void) -> bool;
        pub fn vira_midi_now_ns() -> u64;
    }
    extern "C" fn receive(context: *mut c_void, status: u8, a: u8, b: u8, ns: u64) {
        let host = unsafe { &*(context as *const Host) };
        if status == 0xff {
            host.input_drops.fetch_add(1, SeqCst);
            host.mute();
            return;
        }
        if status & 0xf0 == 0xb0 && matches!(a, 120 | 123) {
            host.request_reset();
        }
        if let Some(kind) = decode(status, a, b) {
            host.enqueue(host.frame_at(ns), kind);
        }
    }
    pub fn start(host: Arc<Host>, path: PathBuf) {
        std::thread::spawn(move || {
            if let Ok(bytes) = std::fs::read(&path) {
                if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                    host.configure(
                        value["input"].as_i64().unwrap_or(0) as i32,
                        value["output"].as_i64().unwrap_or(0) as i32,
                    );
                }
            }
            let handle = unsafe { vira_midi_open(receive, Arc::as_ptr(&host) as *mut c_void) };
            if handle.is_null() {
                *host.state.lock().unwrap() = json!({"available":false,"error":"CoreMIDI initialization failed","inputs":[],"outputs":[]});
                return;
            }
            let mut last = Instant::now() - Duration::from_secs(2);
            let mut last_sent = 0;
            let mut pending = None;
            let mut connected = true;
            let mut retry = false;
            loop {
                if Arc::strong_count(&host) == 1 {
                    break;
                }
                if last.elapsed() > Duration::from_secs(1) {
                    let list = |output| {
                        (0..unsafe{vira_midi_count(output)}).filter_map(|index|{let mut id=0;let mut name=[0 as c_char;256];if unsafe{vira_midi_endpoint(output,index,&mut id,name.as_mut_ptr(),name.len())}{Some(json!({"id":id,"name":unsafe{CStr::from_ptr(name.as_ptr())}.to_string_lossy()}))}else{None}}).collect::<Vec<_>>()
                    };
                    let mut state = host.state.lock().unwrap();
                    state["available"] = json!(true);
                    state["inputs"] = json!(list(false));
                    state["outputs"] = json!(list(true));
                    drop(state);
                    last = Instant::now();
                    if retry {
                        host.changed.store(true, SeqCst);
                    }
                    if !unsafe { vira_midi_connected(handle) } {
                        host.ready.store(false, SeqCst);
                        host.generation.store(0, SeqCst);
                        host.changed.store(true, SeqCst);
                        if connected {
                            host.request_reset();
                        }
                        connected = false;
                    } else {
                        connected = true;
                    }
                }
                let panic = |last_sent: u64| {
                    for channel in 0..16 {
                        for cc in [120, 123] {
                            unsafe {
                                vira_midi_send(
                                    handle,
                                    0xb0 | channel,
                                    cc,
                                    0,
                                    last_sent.max(vira_midi_now_ns()) + 1,
                                );
                            }
                        }
                    }
                };
                if host.panic.swap(false, SeqCst) {
                    panic(last_sent);
                    if pending.is_some_and(|event: Output| {
                        event.epoch != host.epoch.load(SeqCst)
                            || event.generation != host.generation.load(SeqCst)
                    }) {
                        pending = None;
                    }
                }
                if host.changed.swap(false, SeqCst) {
                    panic(last_sent);
                    pending = None;
                    let input = host.input_id.load(SeqCst);
                    let output = host.output_id.load(SeqCst);
                    host.ready.store(false, SeqCst);
                    host.generation.store(0, SeqCst);
                    host.invalidate();
                    let status = unsafe { vira_midi_select(handle, input, output) };
                    host.ready.store(status == 0, SeqCst);
                    host.reset.store(true, SeqCst);
                    retry = status != 0;
                    host.state.lock().unwrap()["error"] = if status == 0 {
                        Value::Null
                    } else {
                        json!("Selected MIDI endpoint is unavailable; waiting for reconnect")
                    };
                    let saved = (|| -> std::io::Result<()> {
                        let tmp = path.with_extension("json.tmp");
                        std::fs::write(
                            &tmp,
                            serde_json::to_vec(&json!({"input":input,"output":output})).unwrap(),
                        )?;
                        std::fs::rename(tmp, &path)
                    })();
                    if let Err(error) = saved {
                        host.state.lock().unwrap()["error"] =
                            json!(format!("MIDI preferences could not be saved: {error}"));
                    }
                    continue; // Release old/new endpoint notes before accepting new output.
                }
                for _ in 0..256 {
                    let event = pending
                        .take()
                        .or_else(|| host.output.lock().unwrap().pop().ok());
                    let Some(event) = event else {
                        break;
                    };
                    if event.generation != host.generation.load(SeqCst)
                        || event.epoch != host.epoch.load(SeqCst)
                    {
                        continue;
                    }
                    if host.anchor_ns.load(SeqCst) == 0 {
                        pending = Some(event);
                        break;
                    }
                    if host.panic.load(SeqCst) {
                        pending = Some(event);
                        break;
                    }
                    let stamp = host.time_at(event.frame);
                    let now = unsafe { vira_midi_now_ns() };
                    if stamp > now + 100_000_000 {
                        pending = Some(event);
                        break;
                    }
                    let e = event.event;
                    let status = match e.kind {
                        teia_kernel::hosted::MidiOutputKind::NoteOn => 0x90,
                        teia_kernel::hosted::MidiOutputKind::NoteOff => 0x80,
                        teia_kernel::hosted::MidiOutputKind::ControlChange => 0xb0,
                    } | (e.channel - 1);
                    let value = (e.value.clamp(0., 1.) * 127.).round() as u8;
                    let stamp = stamp.max(now).max(last_sent + 2);
                    if unsafe { vira_midi_send(handle, status, e.number, value, stamp) } != 0 {
                        host.output_drops.fetch_add(1, SeqCst);
                        host.mute();
                    } else {
                        last_sent = stamp;
                    }
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            for channel in 0..16 {
                unsafe {
                    vira_midi_send(
                        handle,
                        0xb0 | channel,
                        123,
                        0,
                        last_sent.max(vira_midi_now_ns()) + 1,
                    );
                }
            }
            unsafe {
                vira_midi_close(handle);
            }
        });
    }
}
#[cfg(target_os = "macos")]
pub use mac::start;
#[cfg(target_os = "macos")]
pub use mac::vira_midi_now_ns as now_ns;
#[cfg(not(target_os = "macos"))]
pub fn start(_: Arc<Host>, _: std::path::PathBuf) {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn midi_timing_decoding_and_overflow_are_bounded() {
        let mut render = channel();
        let host = render.host.clone();
        host.generation.store(3, SeqCst);
        host.anchor(48000, 1_000_000_000);
        assert_eq!(host.frame_at(1_001_000_000), 48048);
        assert_eq!(host.time_at(48048), 1_001_000_000);
        assert!(matches!(
            decode(0x91, 60, 127),
            Some(EventKind::NoteOn { channel: 2, .. })
        ));
        assert!(matches!(
            decode(0x90, 60, 0),
            Some(EventKind::NoteOff { .. })
        ));
        assert!(decode(0xf8, 0, 0).is_none());
        for i in 0..1024 {
            assert!(host.enqueue(i, decode(0x90, 60, 127).unwrap()));
        }
        assert!(!host.enqueue(2000, decode(0x80, 60, 0).unwrap()));
        assert!(host.reset.load(SeqCst));
        render.prepare_input(host.epoch.load(SeqCst));
        assert!(render.input_before(2048).is_none()); // overflow invalidates old-epoch events
        assert_eq!(host.input_drops.load(SeqCst), 1);
    }
}
