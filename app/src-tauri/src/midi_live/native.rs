use super::*;
use crate::{
    pattern_routing::Node,
    patterns::{self, Bank},
};
use serde_json::{json, Value};
use std::{
    ffi::{c_char, c_void, CStr},
    sync::{
        atomic::{AtomicBool, Ordering::SeqCst},
        mpsc::{sync_channel, Receiver, SyncSender},
    },
    time::{Duration, Instant},
};
unsafe extern "C" {
    fn vira_midi_open_raw(
        callback: extern "C" fn(*mut c_void, *const u8, usize, u64),
        context: *mut c_void,
    ) -> *mut c_void;
    fn vira_midi_select(handle: *mut c_void, input: i32, output: i32) -> i32;
    fn vira_midi_close(handle: *mut c_void);
    fn vira_midi_connected(handle: *mut c_void) -> bool;
    fn vira_midi_count(output: bool) -> usize;
    fn vira_midi_endpoint(
        output: bool,
        index: usize,
        id: *mut i32,
        name: *mut c_char,
        len: usize,
    ) -> bool;
}
#[derive(Clone, Copy)]
struct Packet {
    bytes: [u8; 256],
    len: usize,
    ns: u64,
}
struct Context {
    queue: SyncSender<Packet>,
    overflow: AtomicBool,
}
extern "C" fn receive(context: *mut c_void, data: *const u8, len: usize, ns: u64) {
    let c = unsafe { &*(context as *const Context) };
    if len == 0 || len > 256 {
        c.overflow.store(true, SeqCst);
        return;
    }
    let mut p = Packet {
        bytes: [0; 256],
        len,
        ns,
    };
    p.bytes[..len].copy_from_slice(unsafe { std::slice::from_raw_parts(data, len) });
    if c.queue.try_send(p).is_err() {
        c.overflow.store(true, SeqCst);
    }
}
struct Input {
    handle: *mut c_void,
    context: Box<Context>,
    rx: Receiver<Packet>,
    stream: Stream,
}
impl Input {
    fn open(id: i32) -> Option<Self> {
        let (tx, rx) = sync_channel(1024);
        let mut context = Box::new(Context {
            queue: tx,
            overflow: AtomicBool::new(false),
        });
        let handle =
            unsafe { vira_midi_open_raw(receive, &mut *context as *mut Context as *mut c_void) };
        if handle.is_null() {
            return None;
        }
        if unsafe { vira_midi_select(handle, id, 0) } != 0 {
            unsafe { vira_midi_close(handle) };
            return None;
        }
        Some(Self {
            handle,
            context,
            rx,
            stream: Stream::default(),
        })
    }
}
impl Drop for Input {
    fn drop(&mut self) {
        unsafe { vira_midi_close(self.handle) };
    }
}
#[derive(Clone)]
struct Endpoint {
    id: i32,
    name: String,
}
fn endpoints(output: bool) -> Vec<Endpoint> {
    (0..unsafe { vira_midi_count(output) })
        .filter_map(|index| {
            let mut id = 0;
            let mut name = [0 as c_char; 256];
            unsafe { vira_midi_endpoint(output, index, &mut id, name.as_mut_ptr(), name.len()) }
                .then(|| Endpoint {
                    id,
                    name: unsafe { CStr::from_ptr(name.as_ptr()) }
                        .to_string_lossy()
                        .into_owned(),
                })
        })
        .collect()
}
pub struct Router {
    core: Core,
    inputs: HashMap<i32, Input>,
    available: Vec<Endpoint>,
    outputs: Vec<Endpoint>,
    last: Instant,
    teia: Vec<Source>,
    pub error: Option<String>,
    pub notes: HashMap<String, u8>,
    pattern_events: Vec<(u64, String, [u8; 3])>,
}
impl Router {
    pub fn new() -> Self {
        Self {
            core: Core::default(),
            inputs: HashMap::new(),
            available: vec![],
            outputs: vec![],
            last: Instant::now() - Duration::from_secs(2),
            teia: vec![],
            error: None,
            notes: HashMap::new(),
            pattern_events: Vec::new(),
        }
    }
    pub fn inputs(&self) -> Value {
        json!(self
            .available
            .iter()
            .map(|e| json!({"id":e.id,"name":e.name}))
            .collect::<Vec<_>>())
    }
    fn source(&self, n: &Node) -> Option<Source> {
        if n.kind == "deck" {
            return n.deck.map(Source::Deck);
        }
        if n.kind == "pattern" {
            return n.pattern.clone().map(Source::Pattern);
        }
        match n.destination.as_ref()? {
            Destination::Midi { output } => {
                let id = if let Some(id) = n.input {
                    id
                } else {
                    let name = self
                        .outputs
                        .iter()
                        .find(|e| e.id == *output)
                        .map(|e| e.name.as_str())
                        .unwrap_or(&n.label);
                    self.available.iter().find(|e| e.name == name)?.id
                };
                self.available
                    .iter()
                    .any(|e| e.id == id)
                    .then_some(Source::Midi(id))
            }
            Destination::Teia { slot } => {
                let host = patterns::teia_host(*slot)?;
                let generation = host.generation.load(SeqCst);
                (generation != 0 && !host.muted.load(SeqCst))
                    .then_some(Source::Teia(*slot, generation))
            }
            _ => None,
        }
    }
    pub fn pattern_note(&mut self, id: &str, channel: u8, note: u8, velocity: u8, ns: u64) {
        self.pattern_events
            .push((ns, id.to_owned(), [0x90 | (channel - 1), note, velocity]));
    }
    pub fn tick(
        &mut self,
        bank: &Bank,
        sink: &mut impl Sink,
        ns: u64,
        active: usize,
        decks: [Option<crate::pattern_routing::Harmony>; 2],
    ) -> HashMap<String, u8> {
        self.error = None;
        if self.last.elapsed() > Duration::from_secs(1) {
            self.available = endpoints(false);
            self.outputs = endpoints(true);
            self.last = Instant::now();
        }
        let monitored: std::collections::HashSet<_> = bank
            .graph
            .as_ref()
            .into_iter()
            .flat_map(|g| g.nodes.iter())
            .filter(|n| ["instrument", "pattern"].contains(&n.kind.as_str()))
            .filter_map(|n| self.source(n))
            .collect();
        let mut routes = Vec::new();
        if let Some(graph) = &bank.graph {
            for (index, (w, transformations)) in crate::pattern_routing::signal_paths(graph)
                .iter()
                .enumerate()
            {
                let Some(from) = graph.nodes.iter().find(|n| {
                    n.id == w.from
                        && (n.kind == "instrument"
                            || ["pattern", "deck"].contains(&n.kind.as_str()) && w.kind == "notes")
                }) else {
                    continue;
                };
                let Some(source) = self.source(from) else {
                    continue;
                };
                let Some(to) = graph.nodes.iter().find(|n| n.id == w.to) else {
                    continue;
                };
                let dest = if to.kind == "pattern" {
                    None
                } else if to.kind == "deck" {
                    crate::pattern_routing::deck_index(to.deck, active)
                        .map(|deck| Destination::Deck { deck })
                } else {
                    to.destination.clone()
                };
                if let (Source::Midi(input), Some(Destination::Midi { output })) = (&source, &dest)
                {
                    if self.available.iter().any(|e| {
                        e.id == *input
                            && self
                                .outputs
                                .iter()
                                .any(|o| o.id == *output && o.name == e.name)
                    }) {
                        self.error =
                            Some("Cannot route a MIDI source back to the same device port.".into());
                        continue;
                    }
                }
                let generation = dest
                    .as_ref()
                    .and_then(patterns::internal_host)
                    .map_or(0, |h| h.generation.load(SeqCst));
                routes.push(Route {
                    id: w.id.clone(),
                    source,
                    kind: w.kind.clone(),
                    target: w.to.clone(),
                    destination: dest,
                    owner: w.route.unwrap_or(index as u16),
                    generation,
                    source_channel: from.channel,
                    destination_channel: to.channel,
                    transformations: transformations.clone(),
                });
            }
        }
        // Publish deck note values so transformed deck roots use the same path as live MIDI.
        for deck in 0..=2 {
            let physical = if deck == 2 { active.min(1) } else { deck };
            if let Some(harmony) = decks[physical] {
                self.core.message(
                    &Source::Deck(deck),
                    &[0x90, 60 + harmony.key, 100],
                    ns,
                    sink,
                );
            } else {
                self.core.reset(&Source::Deck(deck), sink, ns);
            }
        }
        self.core.reconcile(routes, sink, ns);
        let desired: Vec<_> = monitored
            .iter()
            .filter_map(|s| {
                if let Source::Midi(id) = s {
                    Some(*id)
                } else {
                    None
                }
            })
            .collect();
        let removed: Vec<_> = self
            .inputs
            .keys()
            .filter(|id| !desired.contains(id))
            .copied()
            .collect();
        for id in removed {
            self.core.reset(&Source::Midi(id), sink, ns);
            self.inputs.remove(&id);
        }
        for id in desired {
            if self
                .inputs
                .get(&id)
                .is_some_and(|i| !unsafe { vira_midi_connected(i.handle) })
            {
                self.core.reset(&Source::Midi(id), sink, ns);
                self.inputs.remove(&id);
            }
            if let std::collections::hash_map::Entry::Vacant(entry) = self.inputs.entry(id) {
                if let Some(input) = Input::open(id) {
                    entry.insert(input);
                } else {
                    self.error = Some("Selected MIDI source is unavailable.".into());
                }
            }
        }
        for (&id, input) in &mut self.inputs {
            let source = Source::Midi(id);
            if input.context.overflow.swap(false, SeqCst) {
                self.core.reset(&source, sink, ns);
                while input.rx.try_recv().is_ok() {}
                input.stream = Stream::default();
                self.error = Some("MIDI input queue overflow: released routed notes.".into());
            }
            for _ in 0..1024 {
                let Ok(packet) = input.rx.try_recv() else {
                    break;
                };
                for message in input.stream.feed(&packet.bytes[..packet.len]) {
                    self.core.message(
                        &source,
                        &message,
                        packet.ns.clamp(ns, ns + 40_000_000),
                        sink,
                    );
                }
            }
        }
        let sources: Vec<_> = monitored
            .iter()
            .cloned()
            .filter(|s| matches!(s, Source::Teia(..)))
            .collect();
        for old in &self.teia {
            if !sources.contains(old) {
                self.core.reset(old, sink, ns);
            }
        }
        for source in &sources {
            let Source::Teia(slot, generation) = *source else {
                continue;
            };
            let Some(host) = patterns::teia_host(slot) else {
                continue;
            };
            let events = host.take_output();
            if !self.teia.contains(source) {
                continue;
            }
            let Ok(events) = events else {
                self.core.reset(source, sink, ns);
                continue;
            };
            for output in events {
                if output.generation != generation || output.epoch != host.epoch.load(SeqCst) {
                    continue;
                }
                let e = output.event;
                use teia_kernel::hosted::MidiOutputKind::*;
                let status = match e.kind {
                    NoteOn => 0x90,
                    NoteOff => 0x80,
                    ControlChange => 0xb0,
                } | (e.channel - 1);
                self.core.message(
                    source,
                    &[
                        status,
                        e.number,
                        (e.value.clamp(0., 1.) * 127.).round() as u8,
                    ],
                    host.time_at(output.frame).clamp(ns, ns + 40_000_000),
                    sink,
                );
            }
        }
        self.pattern_events.sort_by_key(|e| e.0);
        let due = self.pattern_events.partition_point(|e| e.0 <= ns);
        for (stamp, id, bytes) in self.pattern_events.drain(..due) {
            if monitored.contains(&Source::Pattern(id.clone())) {
                self.core.message(&Source::Pattern(id), &bytes, stamp, sink);
            }
        }
        self.teia = sources;
        self.notes = bank
            .graph
            .as_ref()
            .into_iter()
            .flat_map(|g| g.nodes.iter())
            .filter(|n| ["instrument", "pattern"].contains(&n.kind.as_str()))
            .filter_map(|n| {
                self.source(n)
                    .and_then(|s| self.core.value(&s, n.channel))
                    .map(|note| (n.id.clone(), note))
            })
            .collect();
        self.core.roots()
    }
    pub fn clear(&mut self, sink: &mut impl Sink, ns: u64) {
        self.core.reconcile(vec![], sink, ns);
        self.inputs.clear();
        self.teia.clear();
        self.pattern_events.clear();
    }
}
