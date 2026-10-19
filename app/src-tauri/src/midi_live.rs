//! Live canvas MIDI routing. Parsing and patch changes run on the MIDI worker;
//! callbacks only copy bounded packets. Note ownership survives cable fan-out.
use crate::pattern_routing::Destination;
use std::collections::HashMap;
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Source {
    Midi(i32),
    Deck(usize),
    Pattern(String),
    Teia(usize, u64),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub id: String,
    pub source: Source,
    pub kind: String,
    pub target: String,
    pub destination: Option<Destination>,
    pub owner: u16,
    pub generation: u64,
    pub source_channel: Option<u8>,
    pub destination_channel: Option<u8>,
    pub transformations: Vec<crate::pattern_routing::Transformation>,
}
pub trait Sink {
    fn note(
        &mut self,
        destination: &Destination,
        owner: u16,
        channel: u8,
        note: u8,
        velocity: u8,
        on: bool,
        ns: u64,
    );
    fn midi_note(&mut self, destination: &Destination, owner: u16, bytes: &[u8], ns: u64) {
        self.note(
            destination,
            owner,
            (bytes[0] & 15) + 1,
            bytes[1],
            bytes[2],
            bytes[0] & 0xf0 == 0x90 && bytes[2] > 0,
            ns,
        );
    }
    fn raw(&mut self, destination: &Destination, owner: u16, bytes: &[u8], ns: u64);
    fn cancel(&mut self, destination: &Destination, owner: u16, notes: &[(u8, u8, u16)], ns: u64);
}
#[derive(Default)]
pub struct Core {
    pub routes: Vec<Route>,
    last_note: HashMap<Source, (u8, u8, u8)>,
    channel_notes: HashMap<(Source, u8), (u8, u8, u8)>,
    owned: HashMap<String, HashMap<(u8, u8), u16>>,
    last_ns: HashMap<String, u64>,
    root_values: HashMap<String, u8>,
}
impl Core {
    pub fn reconcile(&mut self, routes: Vec<Route>, sink: &mut impl Sink, ns: u64) {
        for old in &self.routes {
            if routes.contains(old) {
                continue;
            }
            if let Some(dest) = &old.destination {
                let notes = self
                    .owned
                    .remove(&old.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|((ch, n), count)| (ch, n, count))
                    .collect::<Vec<_>>();
                sink.cancel(
                    dest,
                    old.owner,
                    &notes,
                    ns.max(self.last_ns.remove(&old.id).unwrap_or(0).saturating_add(1)),
                );
            }
        }
        self.root_values.retain(|id, _| {
            routes
                .iter()
                .any(|r| &r.id == id && self.routes.contains(r))
        });
        for route in &routes {
            if route.destination.is_none() && !self.routes.contains(route) {
                if let Some(note) = self
                    .last_value(&route.source, route.source_channel)
                    .and_then(|(_, n, _)| {
                        crate::pattern_routing::transform(*n, &route.transformations)
                    })
                {
                    self.root_values.insert(route.id.clone(), note);
                }
            }
            if route.kind == "notes" && !self.routes.contains(route) {
                if let (Some(dest), Some(&(ch, n, velocity))) = (
                    &route.destination,
                    self.last_value(&route.source, route.source_channel),
                ) {
                    let Some(n) = crate::pattern_routing::transform(n, &route.transformations)
                    else {
                        continue;
                    };
                    let ch = route.destination_channel.unwrap_or(ch);
                    sink.note(dest, route.owner, ch, n, velocity, true, ns);
                    self.owned
                        .entry(route.id.clone())
                        .or_default()
                        .insert((ch, n), 1);
                    self.last_ns.insert(route.id.clone(), ns);
                }
            }
        }
        self.routes = routes;
    }
    pub fn reset(&mut self, source: &Source, sink: &mut impl Sink, ns: u64) {
        self.last_note.remove(source);
        for route in self.routes.iter().filter(|r| &r.source == source) {
            self.root_values.remove(&route.id);
        }
        self.channel_notes.retain(|(s, _), _| s != source);
        for route in self.routes.iter().filter(|r| &r.source == source) {
            if let Some(dest) = &route.destination {
                let notes = self
                    .owned
                    .remove(&route.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|((ch, n), count)| (ch, n, count))
                    .collect::<Vec<_>>();
                sink.cancel(
                    dest,
                    route.owner,
                    &notes,
                    ns.max(
                        self.last_ns
                            .remove(&route.id)
                            .unwrap_or(0)
                            .saturating_add(1),
                    ),
                );
            }
        }
    }
    fn last_value(&self, source: &Source, channel: Option<u8>) -> Option<&(u8, u8, u8)> {
        match channel {
            Some(ch) => self.channel_notes.get(&(source.clone(), ch)),
            None => self.last_note.get(source),
        }
    }
    pub fn value(&self, source: &Source, channel: Option<u8>) -> Option<u8> {
        self.last_value(source, channel).map(|(_, note, _)| *note)
    }
    pub fn roots(&self) -> HashMap<String, u8> {
        self.routes
            .iter()
            .filter(|r| r.destination.is_none() && ["notes", "root"].contains(&r.kind.as_str()))
            .filter_map(|r| self.root_values.get(&r.id).map(|n| (r.target.clone(), *n)))
            .collect()
    }

    pub fn message(&mut self, source: &Source, bytes: &[u8], ns: u64, sink: &mut impl Sink) {
        if bytes.is_empty() {
            return;
        }
        let note = if bytes.len() == 3 && [0x80, 0x90].contains(&(bytes[0] & 0xf0)) {
            Some((
                (bytes[0] & 15) + 1,
                bytes[1],
                bytes[2],
                bytes[0] & 0xf0 == 0x90 && bytes[2] > 0,
            ))
        } else {
            None
        };
        if let Some((ch, n, velocity, true)) = note {
            self.last_note.insert(source.clone(), (ch, n, velocity));
            self.channel_notes
                .insert((source.clone(), ch), (ch, n, velocity));
        }
        if let Some((ch, n, _, true)) = note {
            for route in self.routes.iter().filter(|r| {
                &r.source == source
                    && r.destination.is_none()
                    && r.source_channel.is_none_or(|selected| selected == ch)
            }) {
                if let Some(n) = crate::pattern_routing::transform(n, &route.transformations) {
                    self.root_values.insert(route.id.clone(), n);
                }
            }
        }
        for route in self
            .routes
            .iter()
            .filter(|r| &r.source == source && r.destination.is_some())
        {
            if bytes[0] < 0xf0
                && route
                    .source_channel
                    .is_some_and(|ch| ch != (bytes[0] & 15) + 1)
            {
                continue;
            }
            let mut mapped = bytes.to_vec();
            if bytes.len() == 3 && [0x80, 0x90, 0xa0].contains(&(bytes[0] & 0xf0)) {
                let Some(n) = crate::pattern_routing::transform(bytes[1], &route.transformations)
                else {
                    continue;
                };
                mapped[1] = n;
            }
            if bytes[0] < 0xf0 {
                if let Some(ch) = route.destination_channel {
                    mapped[0] = (bytes[0] & 0xf0) | (ch - 1);
                }
            }
            let bytes = mapped.as_slice();
            let note = note
                .map(|(ch, _n, v, on)| (route.destination_channel.unwrap_or(ch), bytes[1], v, on));
            let dest = route.destination.as_ref().unwrap();
            self.last_ns
                .entry(route.id.clone())
                .and_modify(|last| *last = (*last).max(ns))
                .or_insert(ns);
            if let Some((ch, n, velocity, on)) = note {
                let owned = self.owned.entry(route.id.clone()).or_default();
                if route.kind == "notes" {
                    if !on || owned.contains_key(&(ch, n)) {
                        continue;
                    }
                    for ((old_ch, old_n), count) in owned.drain() {
                        for _ in 0..count {
                            sink.note(dest, route.owner, old_ch, old_n, 0, false, ns);
                        }
                    }
                    owned.insert((ch, n), 1);
                    sink.note(dest, route.owner, ch, n, velocity, true, ns);
                    continue;
                }
                if on {
                    let count = owned.entry((ch, n)).or_default();
                    *count = count.saturating_add(1);
                } else {
                    let Some(count) = owned.get_mut(&(ch, n)) else {
                        continue;
                    };
                    *count -= 1;
                    if *count == 0 {
                        owned.remove(&(ch, n));
                    }
                }
                sink.midi_note(dest, route.owner, bytes, ns);
            } else if route.kind == "midi" {
                if bytes[0] == 0xff
                    || bytes.len() == 3 && bytes[0] & 0xf0 == 0xb0 && [120, 123].contains(&bytes[1])
                {
                    let owned = self.owned.entry(route.id.clone()).or_default();
                    let release = owned
                        .iter()
                        .filter(|((ch, _), _)| bytes[0] == 0xff || *ch == (bytes[0] & 15) + 1)
                        .map(|(key, count)| (*key, *count))
                        .collect::<Vec<_>>();
                    for ((ch, n), count) in release {
                        owned.remove(&(ch, n));
                        for _ in 0..count {
                            sink.note(dest, route.owner, ch, n, 0, false, ns);
                        }
                    }
                }
                sink.raw(dest, route.owner, bytes, ns);
            }
        }
    }
}
#[derive(Default)]
pub struct Stream {
    status: u8,
    data: Vec<u8>,
    sysex: bool,
}
impl Stream {
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        let mut messages = Vec::new();
        for &b in bytes {
            if b >= 0xf8 {
                messages.push(vec![b]);
                continue;
            }
            if self.sysex {
                if b == 0xf7 {
                    self.data.push(b);
                    messages.push(std::mem::take(&mut self.data));
                    self.sysex = false;
                    self.status = 0;
                    continue;
                }
                if b & 0x80 == 0 {
                    if self.data.len() < 65534 {
                        self.data.push(b);
                    } else {
                        self.sysex = false;
                        self.data.clear();
                        self.status = 0;
                    }
                    continue;
                }
                self.sysex = false;
                self.data.clear();
            }
            if b & 0x80 != 0 {
                self.status = b;
                self.data.clear();
                if b == 0xf0 {
                    self.sysex = true;
                    self.data.push(b);
                    continue;
                }
                if matches!(b, 0xf4..=0xf7) {
                    messages.push(vec![b]);
                    self.status = 0;
                }
                continue;
            }
            let length = match self.status {
                0x80..=0xbf | 0xe0..=0xef | 0xf2 => 2,
                0xc0..=0xdf | 0xf1 | 0xf3 => 1,
                _ => continue,
            };
            self.data.push(b);
            if self.data.len() == length {
                let mut message = vec![self.status];
                message.append(&mut self.data);
                messages.push(message);
                if self.status >= 0xf0 {
                    self.status = 0;
                }
            }
        }
        messages
    }
}
#[cfg(target_os = "macos")]
mod native;
#[cfg(target_os = "macos")]
pub use native::devices;
#[cfg(target_os = "macos")]
pub use native::initialize;
#[cfg(target_os = "macos")]
pub use native::Router;
#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Default)]
    struct TestSink {
        events: Vec<String>,
    }
    impl Sink for TestSink {
        fn note(&mut self, _: &Destination, owner: u16, ch: u8, n: u8, _: u8, on: bool, _: u64) {
            self.events.push(format!("{owner}:{ch}:{n}:{on}"));
        }
        fn raw(&mut self, _: &Destination, _: u16, bytes: &[u8], _: u64) {
            self.events.push(format!("raw:{bytes:?}"));
        }
        fn cancel(&mut self, _: &Destination, owner: u16, notes: &[(u8, u8, u16)], _: u64) {
            self.events.push(format!("cancel:{owner}:{notes:?}"));
        }
    }
    fn route(kind: &str, owner: u16) -> Route {
        Route {
            id: kind.into(),
            source: Source::Midi(42),
            kind: kind.into(),
            target: "p".into(),
            destination: if kind == "root" {
                None
            } else {
                Some(Destination::Midi { output: 43 })
            },
            owner,
            generation: 0,
            source_channel: None,
            destination_channel: None,
            transformations: Vec::new(),
        }
    }
    #[test]
    fn transformations_map_note_pairs_pressure_and_preserve_other_midi() {
        use crate::pattern_routing::Transformation::*;
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let mut r = route("midi", 1);
        r.transformations = vec![
            OctaveShift { octaves: 1 },
            Filter {
                direction: "above".into(),
                note: 72,
            },
        ];
        c.reconcile(vec![r.clone()], &mut sink, 0);
        let src = Source::Midi(42);
        for bytes in [
            [0x90, 60, 100],
            [0x80, 60, 0],
            [0x90, 64, 100],
            [0xa0, 64, 40],
            [0x80, 64, 0],
            [0xb0, 1, 64],
            [0x90, 120, 100],
        ] {
            c.message(&src, &bytes, 1, &mut sink);
        }
        assert_eq!(
            sink.events,
            vec![
                "1:1:76:true",
                "raw:[160, 76, 40]",
                "1:1:76:false",
                "raw:[176, 1, 64]"
            ]
        );
        c.message(&src, &[0x90, 67, 100], 2, &mut sink);
        r.transformations = vec![OctaveShift { octaves: -1 }];
        c.reconcile(vec![r], &mut sink, 3);
        assert!(sink.events.iter().any(|s| s == "cancel:1:[(1, 79, 1)]"));
    }
    #[test]
    fn filtered_note_roots_latch_last_accepted_pitch() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let mut r = route("notes", 1);
        r.destination = None;
        r.transformations = vec![crate::pattern_routing::Transformation::Filter {
            direction: "below".into(),
            note: 60,
        }];
        c.reconcile(vec![r], &mut sink, 0);
        c.message(&Source::Midi(42), &[0x90, 48, 100], 1, &mut sink);
        c.message(&Source::Midi(42), &[0x90, 60, 100], 2, &mut sink);
        assert_eq!(c.roots()["p"], 48);
    }
    #[test]
    fn selected_channel_filters_notes_and_full_midi_and_all_preserves_channels() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let src = Source::Midi(42);
        let mut r = route("midi", 1);
        r.source_channel = Some(2);
        r.destination_channel = Some(7);
        let mut root = route("notes", 2);
        root.destination = None;
        root.source_channel = Some(2);
        c.reconcile(vec![r.clone(), root], &mut sink, 0);
        c.message(&src, &[0x90, 60, 100], 1, &mut sink);
        c.message(&src, &[0xb0, 1, 64], 2, &mut sink);
        assert!(sink.events.is_empty());
        assert!(c.roots().is_empty());
        c.message(&src, &[0x91, 67, 100], 3, &mut sink);
        c.message(&src, &[0x81, 67, 0], 4, &mut sink);
        c.message(&src, &[0xb1, 1, 64], 5, &mut sink);
        assert_eq!(c.roots()["p"], 67);
        assert_eq!(c.value(&src, Some(1)), Some(60));
        assert_eq!(
            sink.events,
            vec!["1:7:67:true", "1:7:67:false", "raw:[182, 1, 64]"]
        );
        r.source_channel = None;
        r.destination_channel = None;
        c.reconcile(vec![r], &mut sink, 6);
        sink.events.clear();
        c.message(&src, &[0x92, 72, 100], 7, &mut sink);
        assert_eq!(sink.events, vec!["1:3:72:true"]);
    }
    #[test]
    fn pattern_note_value_survives_note_off_and_new_note_connections_latch_it() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let src = Source::Pattern("p".into());
        c.message(&src, &[0x90, 64, 100], 1, &mut sink);
        c.message(&src, &[0x80, 64, 0], 2, &mut sink);
        let mut r = route("notes", 1);
        r.source = src.clone();
        let mut root = route("notes", 2);
        root.id = "pattern-root".into();
        root.source = src.clone();
        root.destination = None;
        c.reconcile(vec![r, root], &mut sink, 3);
        assert_eq!(c.roots()["p"], 64);
        assert_eq!(sink.events, vec!["1:1:64:true"]);
        c.message(&src, &[0x90, 67, 100], 4, &mut sink);
        c.message(&src, &[0x80, 67, 0], 5, &mut sink);
        assert_eq!(c.value(&src, None), Some(67));
        assert_eq!(
            sink.events,
            vec!["1:1:64:true", "1:1:64:false", "1:1:67:true"]
        );
    }
    #[test]
    fn note_cable_to_pattern_sets_root_without_sending_midi() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let mut r = route("notes", 1);
        r.destination = None;
        let target = r.target.clone();
        c.reconcile(vec![r], &mut sink, 0);
        c.message(&Source::Midi(42), &[0x90, 67, 100], 1, &mut sink);
        assert_eq!(c.roots().get(&target), Some(&67));
        assert!(sink.events.is_empty());
    }
    #[test]
    fn last_note_survives_release_and_is_available_to_new_connections() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let src = Source::Midi(42);
        c.message(&src, &[0x90, 60, 100], 1, &mut sink);
        c.message(&src, &[0x80, 60, 0], 2, &mut sink);
        c.reconcile(vec![route("root", 1), route("notes", 2)], &mut sink, 3);
        assert_eq!(c.roots()["p"], 60);
        assert_eq!(sink.events, vec!["2:1:60:true"]);
        c.message(&src, &[0x90, 64, 100], 4, &mut sink);
        c.message(&src, &[0x80, 64, 0], 5, &mut sink);
        assert_eq!(c.roots()["p"], 64);
        assert_eq!(
            sink.events,
            vec!["2:1:60:true", "2:1:60:false", "2:1:64:true"]
        );
        c.reconcile(vec![], &mut sink, 6);
        assert!(c.roots().is_empty());
        assert_eq!(c.value(&src, None), Some(64));
    }
    #[test]
    fn parses_running_status_pressure_program_clock_system_and_fragmented_sysex() {
        let mut s = Stream::default();
        assert_eq!(
            s.feed(&[0x92, 60, 0xf8, 100, 62, 0]),
            vec![vec![0xf8], vec![0x92, 60, 100], vec![0x92, 62, 0]]
        );
        assert_eq!(
            s.feed(&[0xc1, 12, 0xd1, 13, 0xa1, 60, 42, 0xf2, 1, 2]),
            vec![
                vec![0xc1, 12],
                vec![0xd1, 13],
                vec![0xa1, 60, 42],
                vec![0xf2, 1, 2]
            ]
        );
        assert!(s.feed(&[0xf0, 1, 2]).is_empty());
        assert_eq!(
            s.feed(&[3, 0xf8, 4, 0xf7]),
            vec![vec![0xf8], vec![0xf0, 1, 2, 3, 4, 0xf7]]
        );
    }
    #[test]
    fn note_output_latches_last_note_ignores_off_and_filters_other_messages() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        c.reconcile(
            vec![route("notes", 1), route("midi", 2), route("root", 3)],
            &mut sink,
            0,
        );
        let src = Source::Midi(42);
        c.message(&src, &[0x91, 67, 100], 1, &mut sink);
        assert_eq!(c.roots()["p"], 67);
        c.message(&src, &[0x91, 64, 100], 2, &mut sink);
        assert_eq!(c.roots()["p"], 64);
        c.message(&src, &[0x91, 64, 0], 3, &mut sink);
        assert_eq!(c.roots()["p"], 64);
        c.message(&src, &[0xc1, 12], 4, &mut sink);
        assert_eq!(
            sink.events.iter().filter(|s| s.starts_with("raw:")).count(),
            1
        );
        c.reconcile(vec![], &mut sink, 5);
        assert!(c.roots().is_empty());
        assert!(sink.events.iter().any(|s| s == "cancel:1:[(2, 64, 1)]"));
    }
    #[test]
    fn reconnect_releases_old_destination_and_device_loss_releases_all_routes() {
        let mut c = Core::default();
        let mut sink = TestSink::default();
        let src = Source::Midi(42);
        let r = route("midi", 7);
        c.reconcile(vec![r.clone()], &mut sink, 0);
        c.message(&src, &[0x90, 60, 100], 1, &mut sink);
        let mut changed = r;
        changed.destination = Some(Destination::Teia { slot: 0 });
        c.reconcile(vec![changed], &mut sink, 2);
        assert!(sink.events.iter().any(|s| s == "cancel:7:[(1, 60, 1)]"));
        c.message(&src, &[0x90, 64, 100], 3, &mut sink);
        c.reset(&src, &mut sink, 4);
        assert!(sink.events.iter().any(|s| s == "cancel:7:[(1, 64, 1)]"));
    }
}
