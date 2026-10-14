//! Audio-only DAG compiled on an ordinary thread. The producer executes a bounded
//! schedule; the device callback still only consumes the existing stereo queue.
use crate::mixer::{MixerDsp, Settings};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Player,
    Trim,
    Eq,
    Filter,
    Fader,
    Crossfader,
    Cue,
    Output,
    Gain,
    Compressor,
    Oscillator,
    RingModulation,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub kind: Kind,
    pub deck: Option<usize>,
    pub label: String,
    pub x: f32,
    pub y: f32,
    pub value: f32,
}
impl Node {
    pub fn inputs(&self) -> &'static [&'static str] {
        match self.kind {
            Kind::Player | Kind::Oscillator => &[],
            Kind::Crossfader | Kind::Cue => &["A", "B"],
            Kind::Compressor => &["audio", "sidechain"],
            Kind::RingModulation => &["audio", "carrier"],
            _ => &["audio"],
        }
    }
    pub fn outputs(&self) -> &'static [&'static str] {
        match self.kind {
            Kind::Output => &[],
            Kind::Compressor | Kind::RingModulation => &["audio", "dry"],
            Kind::Oscillator => &["audio", "cosine"],
            _ => &["audio"],
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Wire {
    pub from: String,
    pub output: String,
    pub to: String,
    pub input: String,
    pub gain: f32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub wires: Vec<Wire>,
}
impl Default for Graph {
    fn default() -> Self {
        let mut nodes = Vec::new();
        let mut wires = Vec::new();
        let mut wire = |from: &str, to: &str, input: &str| {
            wires.push(Wire {
                from: from.into(),
                output: "audio".into(),
                to: to.into(),
                input: input.into(),
                gain: 1.,
            })
        };
        for d in 0..2 {
            let prefix = if d == 0 { "a" } else { "b" };
            let stages = [
                ("player", Kind::Player),
                ("trim", Kind::Trim),
                ("eq", Kind::Eq),
                ("filter", Kind::Filter),
                ("fader", Kind::Fader),
            ];
            for (i, (name, kind)) in stages.iter().enumerate() {
                nodes.push(Node {
                    id: format!("{prefix}-{name}"),
                    kind: *kind,
                    deck: Some(d),
                    label: name.to_uppercase(),
                    x: 40. + i as f32 * 170.,
                    y: 80. + d as f32 * 250.,
                    value: 1.,
                });
                if i > 0 {
                    wire(
                        &format!("{prefix}-{}", stages[i - 1].0),
                        &format!("{prefix}-{name}"),
                        "audio",
                    );
                }
            }
            wire(
                &format!("{prefix}-fader"),
                "mix",
                if d == 0 { "A" } else { "B" },
            );
            wire(
                &format!("{prefix}-filter"),
                "cue",
                if d == 0 { "A" } else { "B" },
            );
        }
        for (id, kind, label, x, y) in [
            ("mix", Kind::Crossfader, "Crossfader / mix", 940., 100.),
            ("cue", Kind::Cue, "Cue mix", 940., 350.),
            ("master", Kind::Output, "Master output", 1160., 100.),
            ("headphones", Kind::Output, "Headphone output", 1160., 350.),
        ] {
            nodes.push(Node {
                id: id.into(),
                kind,
                deck: None,
                label: label.into(),
                x,
                y,
                value: 1.,
            });
        }
        wire("mix", "master", "audio");
        wire("cue", "headphones", "audio");
        Self { nodes, wires }
    }
}
struct Link {
    source: usize,
    output: usize,
    port: usize,
    gain: f32,
}
struct Step {
    index: usize,
    node: Node,
    links: Vec<Link>,
    dsp: MixerDsp,
    envelope: f32,
    phase: f32,
    external_detector: bool,
}
pub struct Plan {
    pub conventional: bool,
    steps: Vec<Step>,
    master: usize,
    headphones: usize,
    faders: [usize; 2],
}
impl Graph {
    pub fn same_audio(&self, other: &Self) -> bool {
        self.nodes.len() == other.nodes.len()
            && self.wires.len() == other.wires.len()
            && self.nodes.iter().all(|n| {
                other.nodes.iter().any(|o| {
                    n.id == o.id && n.kind == o.kind && n.deck == o.deck && n.value == o.value
                })
            })
            && self.wires.iter().all(|w| other.wires.contains(w))
    }
    pub fn compile(&self) -> Result<Box<Plan>> {
        ensure!(
            self.nodes.len() <= 32 && self.wires.len() <= 128,
            "Routing limit: 32 nodes and 128 wires"
        );
        let default = Self::default();
        for (i, n) in self.nodes.iter().enumerate() {
            ensure!(
                !n.id.is_empty()
                    && n.id.len() <= 64
                    && n.label.len() <= 80
                    && n.x.is_finite()
                    && n.y.is_finite()
                    && n.value.is_finite(),
                "Invalid node"
            );
            ensure!(
                !self.nodes[..i].iter().any(|other| other.id == n.id),
                "Duplicate node ID"
            );
            if let Some(builtin) = default.nodes.iter().find(|b| b.id == n.id) {
                ensure!(
                    n.kind == builtin.kind && n.deck == builtin.deck,
                    "Built-in node identity cannot be changed"
                );
            }
            ensure!(
                default.nodes.iter().any(|b| b.id == n.id)
                    || (n.deck.is_none()
                        && matches!(
                            n.kind,
                            Kind::Gain | Kind::Compressor | Kind::Oscillator | Kind::RingModulation
                        )),
                "Unsupported processing node"
            );
            ensure!(
                match n.kind {
                    Kind::Gain => (0. ..=2.).contains(&n.value),
                    Kind::Compressor => (0.01..=1.).contains(&n.value),
                    Kind::Oscillator => (20. ..=2000.).contains(&n.value),
                    _ => true,
                },
                "Node parameter outside supported range"
            );
        }
        let index = |id: &str| {
            self.nodes
                .iter()
                .position(|n| n.id == id)
                .ok_or_else(|| anyhow::anyhow!("Unknown node {id}"))
        };
        let mut indegree = vec![0; self.nodes.len()];
        let mut links: Vec<Vec<Link>> = (0..self.nodes.len()).map(|_| Vec::new()).collect();
        for (i, w) in self.wires.iter().enumerate() {
            ensure!(
                w.gain.is_finite() && (0. ..=2.).contains(&w.gain),
                "Wire gain must be between 0 and 2"
            );
            ensure!(
                !self.wires[..i].iter().any(|v| v.from == w.from
                    && v.to == w.to
                    && v.input == w.input
                    && v.output == w.output),
                "Duplicate wire"
            );
            let source = index(&w.from)?;
            let target = index(&w.to)?;
            ensure!(
                self.nodes[source].outputs().contains(&w.output.as_str()),
                "Invalid audio output port"
            );
            let port = self.nodes[target]
                .inputs()
                .iter()
                .position(|p| *p == w.input)
                .ok_or_else(|| anyhow::anyhow!("Invalid audio input port"))?;
            links[target].push(Link {
                source,
                output: self.nodes[source]
                    .outputs()
                    .iter()
                    .position(|p| *p == w.output)
                    .unwrap(),
                port,
                gain: w.gain,
            });
            indegree[target] += 1;
        }
        let mut order = Vec::new();
        let mut done = vec![false; self.nodes.len()];
        while let Some(i) = (0..self.nodes.len()).find(|i| !done[*i] && indegree[*i] == 0) {
            done[i] = true;
            order.push(i);
            for w in &self.wires {
                if w.from == self.nodes[i].id {
                    indegree[index(&w.to)?] -= 1;
                }
            }
        }
        ensure!(
            order.len() == self.nodes.len(),
            "Feedback loops are not supported; this connection creates a cycle"
        );
        let conventional = self.nodes.len() == default.nodes.len()
            && self.wires.len() == default.wires.len()
            && default.wires.iter().all(|w| self.wires.contains(w));
        let steps = order
            .into_iter()
            .map(|i| Step {
                index: i,
                node: self.nodes[i].clone(),
                external_detector: links[i].iter().any(|l| l.port == 1),
                links: std::mem::take(&mut links[i]),
                dsp: MixerDsp::default(),
                envelope: 0.,
                phase: 0.,
            })
            .collect();
        Ok(Box::new(Plan {
            conventional,
            steps,
            // Slot 32 is immutable silence when a built-in meter/output is removed.
            master: index("master").unwrap_or(32),
            headphones: index("headphones").unwrap_or(32),
            faders: [
                index("a-fader").unwrap_or(32),
                index("b-fader").unwrap_or(32),
            ],
        }))
    }
}
impl Plan {
    // Preserve processor history across edits; bounded swaps do not allocate or free.
    pub fn inherit(&mut self, previous: &mut Self) {
        for step in &mut self.steps {
            if let Some(old) = previous
                .steps
                .iter_mut()
                .find(|n| n.node.id == step.node.id && n.node.kind == step.node.kind)
            {
                std::mem::swap(&mut step.dsp, &mut old.dsp);
                step.phase = old.phase;
                step.envelope = old.envelope;
            }
        }
    }
    pub fn render(
        &mut self,
        players: [[f32; 2]; 2],
        settings: [Settings; 2],
        gains: [f32; 2],
        cross: [f32; 2],
        cue: [f32; 2],
    ) -> ([[f32; 2]; 2], [[f32; 2]; 2]) {
        let mut outputs = [[[0.; 2]; 2]; 33];
        for step in &mut self.steps {
            let mut input = [[0.; 2]; 2];
            for link in &step.links {
                for c in 0..2 {
                    input[link.port][c] += outputs[link.source][link.output][c] * link.gain;
                }
            }
            let d = step.node.deck.unwrap_or(0);
            let value = match step.node.kind {
                Kind::Player => players[d],
                Kind::Trim | Kind::Eq | Kind::Filter => {
                    if step.dsp.settings != settings[d] {
                        step.dsp.set(settings[d]);
                    }
                    step.dsp.process_stage(
                        input[0],
                        match step.node.kind {
                            Kind::Trim => 0,
                            Kind::Eq => 1,
                            _ => 2,
                        },
                    )
                }
                Kind::Fader => input[0].map(|v| v * gains[d]),
                Kind::Crossfader => std::array::from_fn(|c| {
                    0.45 * (input[0][c] * cross[0] + input[1][c] * cross[1])
                }),
                Kind::Cue => {
                    std::array::from_fn(|c| 0.45 * (input[0][c] * cue[0] + input[1][c] * cue[1]))
                }
                Kind::Output => input[0],
                Kind::Gain => input[0].map(|v| v * step.node.value),
                Kind::Compressor => {
                    let detector = if step.external_detector {
                        input[1]
                    } else {
                        input[0]
                    };
                    let peak = detector[0].abs().max(detector[1].abs());
                    step.envelope +=
                        (peak - step.envelope) * if peak > step.envelope { 0.02 } else { 0.0004 };
                    let gain = if step.envelope > step.node.value {
                        (step.node.value / step.envelope).powf(0.75)
                    } else {
                        1.
                    };
                    input[0].map(|v| v * gain)
                }
                Kind::RingModulation => std::array::from_fn(|c| input[0][c] * input[1][c]),
                Kind::Oscillator => {
                    step.phase = (step.phase + step.node.value / 48000.).fract();
                    let v = (step.phase * std::f32::consts::TAU).sin() * 0.1;
                    [v, v]
                }
            };
            outputs[step.index][1] = if step.node.kind == Kind::Oscillator {
                [(step.phase * std::f32::consts::TAU).cos() * 0.1; 2]
            } else {
                input[0]
            };
            outputs[step.index][0] = value.map(|v| if v.is_finite() { v } else { 0. });
        }
        (
            [outputs[self.master][0], outputs[self.headphones][0]],
            [outputs[self.faders[0]][0], outputs[self.faders[1]][0]],
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_and_feedback_validation() {
        let mut g = Graph::default();
        assert!(g.compile().unwrap().conventional);
        g.wires.push(Wire {
            from: "a-filter".into(),
            output: "audio".into(),
            to: "a-eq".into(),
            input: "audio".into(),
            gain: 1.,
        });
        assert!(g.compile().is_err());
        g.wires.pop();
        g.wires[0].gain = f32::NAN;
        assert!(g.compile().is_err());
    }
    #[test]
    fn branching_sends_and_sidechain() {
        let mut g = Graph::default();
        g.nodes.push(Node {
            id: "comp".into(),
            kind: Kind::Compressor,
            deck: None,
            label: "Compressor".into(),
            x: 0.,
            y: 0.,
            value: 0.1,
        });
        g.wires
            .retain(|w| !(w.from == "a-eq" && w.to == "a-filter"));
        for (from, to, input) in [
            ("a-eq", "comp", "audio"),
            ("b-player", "comp", "sidechain"),
            ("comp", "a-filter", "audio"),
            ("a-player", "master", "audio"),
        ] {
            g.wires.push(Wire {
                from: from.into(),
                to: to.into(),
                output: "audio".into(),
                input: input.into(),
                gain: 0.5,
            });
        }
        let mut p = g.compile().unwrap();
        assert!(!p.conventional);
        for _ in 0..1000 {
            let (out, _) = p.render(
                [[0.2; 2], [1.; 2]],
                [Settings::default(); 2],
                [1.; 2],
                [1.; 2],
                [0.; 2],
            );
            assert!(out[0][0].is_finite());
            assert!(out[0][0] >= 0.1);
        }
    }
    #[test]
    fn compiled_stages_match_conventional_mixer_with_active_controls() {
        let mut graph = Graph::default();
        // An unused processor forces the general schedule without changing its signal chain.
        graph.nodes.push(Node {
            id: "unused".into(),
            kind: Kind::Gain,
            deck: None,
            label: "Gain".into(),
            x: 0.,
            y: 0.,
            value: 1.,
        });
        let mut plan = graph.compile().unwrap();
        let mut mixer = MixerDsp::default();
        let settings = Settings {
            trim: 3.,
            eq: [0.6, 0.4, 0.7],
            filter: 0.3,
        };
        mixer.set(settings);
        for i in 0..10000 {
            let x = [(i as f32 * 0.1).sin() * 0.2, (i as f32 * 0.07).sin() * 0.1];
            let expected = mixer.process(x).map(|v| v * 0.8 * 0.45);
            let (out, _) = plan.render(
                [x, [0.; 2]],
                [settings, Settings::default()],
                [0.8, 0.8],
                [1., 1.],
                [0.; 2],
            );
            for c in 0..2 {
                assert!(
                    (out[0][c] - expected[c]).abs() < 1e-6,
                    "stage mismatch at {i}"
                );
            }
        }
    }
    #[test]
    fn named_outputs_and_external_sidechain_have_distinct_signals() {
        let mut graph = Graph::default();
        graph.wires.clear();
        graph.nodes.push(Node {
            id: "comp".into(),
            kind: Kind::Compressor,
            deck: None,
            label: "Compressor".into(),
            x: 0.,
            y: 0.,
            value: 0.1,
        });
        for (from, output, to, input) in [
            ("a-player", "audio", "comp", "audio"),
            ("b-player", "audio", "comp", "sidechain"),
            ("comp", "audio", "master", "audio"),
            ("comp", "dry", "headphones", "audio"),
        ] {
            graph.wires.push(Wire {
                from: from.into(),
                output: output.into(),
                to: to.into(),
                input: input.into(),
                gain: 1.,
            });
        }
        let mut plan = graph.compile().unwrap();
        let mut out = [[0.; 2]; 2];
        for _ in 0..1000 {
            out = plan
                .render(
                    [[0.2; 2], [1.; 2]],
                    [Settings::default(); 2],
                    [1.; 2],
                    [1.; 2],
                    [0.; 2],
                )
                .0;
        }
        assert!(out[0][0] < 0.04);
        assert_eq!(out[1], [0.2; 2]);
        graph
            .wires
            .iter_mut()
            .find(|w| w.to == "comp" && w.input == "sidechain")
            .unwrap()
            .gain = 0.;
        let mut plan = graph.compile().unwrap();
        for _ in 0..1000 {
            out = plan
                .render(
                    [[0.2; 2], [1.; 2]],
                    [Settings::default(); 2],
                    [1.; 2],
                    [1.; 2],
                    [0.; 2],
                )
                .0;
        }
        assert_eq!(out[0], [0.2; 2]);
    }
    #[test]
    fn rejects_duplicate_wires_invalid_ports_and_changed_builtin_identity() {
        let mut graph = Graph::default();
        graph.wires.push(graph.wires[0].clone());
        assert!(graph.compile().is_err());
        graph.wires.pop();
        graph.wires[0].output = "MIDI".into();
        assert!(graph.compile().is_err());
        graph.wires.clear();
        graph.nodes[0].deck = Some(1);
        assert!(graph.compile().is_err());
    }
    #[test]
    fn removed_builtin_stages_and_outputs_compile_without_dangling_meters() {
        let mut graph = Graph::default();
        graph
            .nodes
            .retain(|n| n.id != "master" && n.id != "a-fader");
        graph.wires.retain(|w| {
            graph.nodes.iter().any(|n| n.id == w.from) && graph.nodes.iter().any(|n| n.id == w.to)
        });
        let mut plan = graph.compile().unwrap();
        assert!(!plan.conventional);
        let (outputs, meters) = plan.render(
            [[1.; 2]; 2],
            [Settings::default(); 2],
            [1.; 2],
            [1.; 2],
            [1.; 2],
        );
        assert_eq!(outputs[0], [0.; 2]);
        assert_eq!(meters[0], [0.; 2]);
        let mut empty = Graph {
            nodes: vec![],
            wires: vec![],
        }
        .compile()
        .unwrap();
        assert_eq!(
            empty
                .render(
                    [[1.; 2]; 2],
                    [Settings::default(); 2],
                    [1.; 2],
                    [1.; 2],
                    [1.; 2]
                )
                .0,
            [[0.; 2]; 2]
        );
    }
    #[test]
    fn disconnected_outputs_are_silent() {
        let mut g = Graph::default();
        g.wires.clear();
        let (out, _) = g.compile().unwrap().render(
            [[1.; 2]; 2],
            [Settings::default(); 2],
            [1.; 2],
            [1.; 2],
            [1.; 2],
        );
        assert_eq!(out, [[0.; 2]; 2]);
    }
}
