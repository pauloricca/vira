//! Bounded, lock-free peak history written by the audio producer, read off-thread.
use crate::routing::{Graph, Kind};
use serde_json::{json, Value};
use std::sync::atomic::{
    AtomicU64,
    Ordering::{Acquire, Release},
};

pub fn peak_frames() -> u64 {
    crate::sample_rate::fine_frames() as u64
}
const CAPACITY: usize = 16384; // 81.92 seconds, independent of UI polling.
struct Peak {
    frame: AtomicU64,
    value: AtomicU64,
}
struct Source {
    pub index: usize,
    output: usize,
    id: String,
    label: String,
    peaks: Box<[Peak]>,
}
static GENERATION: AtomicU64 = AtomicU64::new(1);
pub struct History {
    generation: u64,
    sources: Vec<Source>,
}
impl History {
    pub fn new(graph: &Graph) -> Self {
        let mut connected = std::collections::HashSet::from(["master".to_string()]);
        loop {
            let before = connected.len();
            for wire in &graph.wires {
                if wire.gain != 0. && connected.contains(&wire.to) {
                    connected.insert(wire.from.clone());
                }
            }
            if connected.len() == before {
                break;
            }
        }
        Self {
            generation: GENERATION.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            sources: graph
                .nodes
                .iter()
                .enumerate()
                .filter(|(_, n)| {
                    let line =
                        n.kind == Kind::Fader && (n.deck.is_some() || n.id.starts_with("line-"));
                    line || (n.deck.is_none()
                        && !n.id.starts_with("line-")
                        && n.kind != Kind::Output
                        && connected.contains(&n.id))
                })
                .map(|(index, n)| Source {
                    index,
                    output: n
                        .outputs()
                        .iter()
                        .position(|port| {
                            graph.wires.iter().any(|w| {
                                w.from == n.id
                                    && w.output == *port
                                    && w.gain != 0.
                                    && connected.contains(&w.to)
                            })
                        })
                        .unwrap_or(0),
                    id: n.id.clone(),
                    label: if n.kind == Kind::Fader
                        && (n.deck.is_some() || n.id.starts_with("line-"))
                    {
                        let line = n.deck.unwrap_or_else(|| {
                            n.id.split('-')
                                .nth(1)
                                .and_then(|s| s.parse().ok())
                                .unwrap_or(0)
                        });
                        format!("Mixer line {}", (b'A' + line as u8) as char)
                    } else {
                        n.display_label().to_string()
                    },
                    peaks: (0..CAPACITY)
                        .map(|_| Peak {
                            frame: AtomicU64::new(u64::MAX),
                            value: AtomicU64::new(0),
                        })
                        .collect(),
                })
                .collect(),
        }
    }
    pub fn indices(&self) -> impl Iterator<Item = usize> + '_ {
        self.sources.iter().map(|s| s.index)
    }
    pub fn output(&self, index: usize) -> usize {
        self.sources
            .iter()
            .find(|s| s.index == index)
            .map_or(0, |s| s.output)
    }
    pub fn write(&self, index: usize, frame: u64, peak: f32) {
        let Some(source) = self.sources.iter().find(|s| s.index == index) else {
            return;
        };
        let slot = &source.peaks[(frame / peak_frames() % CAPACITY as u64) as usize];
        // Mark the slot unavailable while replacing it, so readers never pair
        // a recycled timestamp with a newer peak.
        slot.frame.store(u64::MAX, Release);
        slot.value.store(peak.to_bits() as u64, Release);
        slot.frame.store(frame, Release);
    }
    pub fn snapshot(&self, selected: &[String], after: u64, audible: u64) -> Value {
        let sources: Vec<_> = self
            .sources
            .iter()
            .map(|s| {
                let mut peaks = Vec::new();
                if selected.contains(&s.id) {
                    let start = after.max(audible.saturating_sub(CAPACITY as u64 * peak_frames()));
                    let mut frame = start.div_ceil(peak_frames()) * peak_frames();
                    while frame + peak_frames() <= audible {
                        let slot = &s.peaks[(frame / peak_frames() % CAPACITY as u64) as usize];
                        let stamp = slot.frame.load(Acquire);
                        let peak = f32::from_bits(slot.value.load(Acquire) as u32);
                        if stamp == frame && slot.frame.load(Acquire) == stamp {
                            peaks.push((frame, peak));
                        }
                        frame += peak_frames();
                    }
                }
                json!({"id":s.id,"label":s.label,"peaks":peaks})
            })
            .collect();
        json!({"generation":self.generation,"sources":sources,"output_frame":audible,"sample_rate":crate::sample_rate::get(),"peak_frames":peak_frames()})
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_names_persist_and_label_rolling_sources() {
        let mut graph = Graph::default();
        let node = graph.nodes.iter_mut().find(|n| n.id == "mix").unwrap();
        node.custom_label = Some("Main mix".into());
        let saved = serde_json::to_string(&graph).unwrap();
        let restored: Graph = serde_json::from_str(&saved).unwrap();
        assert_eq!(graph, restored);
        let plan = restored.compile().unwrap();
        let snapshot = plan.history.snapshot(&[], 0, 0);
        assert!(snapshot["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["label"] == "Main mix"));
        graph
            .nodes
            .iter_mut()
            .find(|n| n.id == "mix")
            .unwrap()
            .custom_label = Some(" ".into());
        assert!(graph.compile().is_err());
    }

    #[test]
    fn rolling_sources_follow_master_paths_and_ignore_cue_only_and_muted_paths() {
        let mut graph = Graph::default();
        graph.nodes.push(crate::routing::Node {
            id: "source".into(),
            kind: Kind::Oscillator,
            label: "Synth".into(),
            deck: None,
            x: 0.,
            y: 0.,
            value: 440.,
            custom_label: None,
            vst: None,
            patch_inputs: None,
            eq: None,
        });
        let wire = crate::routing::Wire {
            from: "source".into(),
            to: "headphones".into(),
            input: "audio".into(),
            output: "audio".into(),
            gain: 1.,
        };
        graph.wires.push(wire.clone());
        let labels = |g: &Graph| {
            History::new(g).snapshot(&[], 0, 0)["sources"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["id"].as_str().unwrap().to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(labels(&graph), vec!["a-fader", "b-fader", "mix"]);
        graph.wires.push(crate::routing::Wire {
            to: "master".into(),
            input: "audio".into(),
            gain: 0.,
            ..wire
        });
        assert_eq!(labels(&graph), vec!["a-fader", "b-fader", "mix"]);
        graph.wires.last_mut().unwrap().gain = 1.;
        assert_eq!(labels(&graph), vec!["a-fader", "b-fader", "mix", "source"]);
    }
    #[test]
    fn rolling_history_filters_future_audio_and_survives_ring_wrap() {
        let history = History::new(&Graph::default());
        let index = Graph::default()
            .nodes
            .iter()
            .position(|n| n.id == "mix")
            .unwrap();
        let selected = vec!["mix".into()];
        history.write(index, 0, 0.7);
        history.write(index, peak_frames(), 0.9);
        let snapshot = history.snapshot(&selected, 0, peak_frames());
        assert_eq!(snapshot["sources"][2]["peaks"].as_array().unwrap().len(), 1);
        assert!((snapshot["sources"][2]["peaks"][0][1].as_f64().unwrap() - 0.7).abs() < 1e-6);
        let wrapped = CAPACITY as u64 * peak_frames();
        history.write(index, wrapped, 0.2);
        assert!(
            history.snapshot(&selected, 0, peak_frames())["sources"][2]["peaks"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            history.snapshot(&selected, wrapped, wrapped + peak_frames())["sources"][2]["peaks"][0]
                [0],
            wrapped
        );
    }
}
