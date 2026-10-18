//! Audio-only DAG compiled on an ordinary thread. The producer executes a bounded
//! schedule; the device callback still only consumes the existing stereo queue.
use crate::mixer::{MixerDsp, Settings};
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};

const NODE_LIMIT: usize = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Player,
    Input,
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
    Patch,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PatchInput {
    pub id: String,
    pub label: String,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Node {
    pub id: String,
    pub kind: Kind,
    pub deck: Option<usize>,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_label: Option<String>,
    pub x: f32,
    pub y: f32,
    pub value: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_inputs: Option<Vec<PatchInput>>,
}
impl Node {
    pub fn display_label(&self) -> &str {
        self.custom_label.as_deref().unwrap_or(&self.label)
    }
    pub fn inputs(&self) -> Vec<&str> {
        if self.kind == Kind::Patch {
            if let Some(ports) = &self.patch_inputs {
                return ports.iter().map(|p| p.id.as_str()).collect();
            }
        }
        let ports: &[&str] = match self.kind {
            Kind::Player | Kind::Input | Kind::Oscillator => &[],
            Kind::Crossfader | Kind::Cue => &["A", "B"],
            Kind::Compressor => &["audio", "sidechain"],
            Kind::RingModulation => &["audio", "carrier"],
            _ => &["audio"],
        };
        ports.to_vec()
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
                    custom_label: None,
                    patch_inputs: None,
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
            ("headphones", Kind::Output, "Cue output", 1160., 350.),
        ] {
            nodes.push(Node {
                custom_label: None,
                patch_inputs: None,
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
    capture: Option<std::sync::Arc<crate::audio_inputs::Capture>>,
    send: Option<crate::instrument_output::Output>,
}
pub struct Plan {
    pub history: std::sync::Arc<crate::rolling::History>,
    waveform_peaks: [f32; NODE_LIMIT],
    pub conventional: bool,
    steps: Vec<Step>,
    master: usize,
    headphones: usize,
    faders: [usize; 2],
    block_outputs: Box<[[[[f32; 2]; 2]; crate::decks::PRODUCER_FRAMES]]>,
    routed_inputs: Box<[[[f32; crate::decks::PRODUCER_FRAMES]; 2]]>,
    patch_frames: Box<[crate::decks::Frame; crate::decks::PRODUCER_FRAMES]>,
}
impl Graph {
    // Only routes reaching an output justify opening a live source. An input
    // wired to an abandoned processor chain must stay closed as well.
    fn live_nodes(&self) -> Vec<bool> {
        let mut live: Vec<bool> = self.nodes.iter().map(|n| n.kind == Kind::Output).collect();
        loop {
            let mut changed = false;
            for wire in self.wires.iter().filter(|w| w.gain > 0.) {
                let source = self.nodes.iter().position(|n| n.id == wire.from);
                let target = self.nodes.iter().position(|n| n.id == wire.to);
                if let (Some(source), Some(target)) = (source, target) {
                    if live[target] && !live[source] {
                        live[source] = true;
                        changed = true;
                    }
                }
            }
            if !changed {
                return live;
            }
        }
    }

    pub fn from_saved(bytes: &[u8]) -> Result<Self> {
        let value: serde_json::Value = serde_json::from_slice(bytes)?;
        let mut graph: Self = serde_json::from_value(value.clone())?;
        // Older versions saved every detected device as a node. Preserve wired
        // inputs, but move unused automatically placed devices back to the palette.
        if value["input_palette"] != true {
            graph.nodes.retain(|n| {
                n.kind != Kind::Input || graph.wires.iter().any(|w| w.from == n.id || w.to == n.id)
            });
        }
        Ok(graph)
    }
    pub fn saved_value(&self) -> Result<serde_json::Value> {
        let mut value = serde_json::to_value(self)?;
        value["input_palette"] = true.into();
        Ok(value)
    }
    pub fn same_audio(&self, other: &Self) -> bool {
        self.nodes.len() == other.nodes.len()
            && self.wires.len() == other.wires.len()
            && self.nodes.iter().all(|n| {
                other.nodes.iter().any(|o| {
                    n.id == o.id
                        && n.kind == o.kind
                        && n.deck == o.deck
                        && n.value == o.value
                        && n.patch_inputs == o.patch_inputs
                })
            })
            && self.wires.iter().all(|w| other.wires.contains(w))
    }
    pub fn compile(&self) -> Result<Box<Plan>> {
        ensure!(
            self.nodes.len() <= NODE_LIMIT && self.wires.len() <= 512,
            "Routing limit: 128 nodes and 512 wires"
        );
        let default = Self::default();
        for (i, n) in self.nodes.iter().enumerate() {
            ensure!(
                !n.id.is_empty()
                    && n.id.len() <= 64
                    && n.label.len()
                        <= if n.kind == Kind::Input || n.id.starts_with("instrument-") {
                            512
                        } else {
                            80
                        }
                    && n.custom_label
                        .as_ref()
                        .map_or(true, |name| !name.trim().is_empty()
                            && name.chars().count() <= 80)
                    && n.x.is_finite()
                    && n.y.is_finite()
                    && n.value.is_finite(),
                "Invalid node"
            );
            ensure!(
                n.patch_inputs.as_ref().is_none_or(|p| p.len() <= 32
                    && p.iter().all(|port| !port.id.is_empty())
                    && p.iter()
                        .enumerate()
                        .all(|(i, port)| !p[..i].iter().any(|old| old.id == port.id))),
                "Invalid patch input ports (maximum 32)"
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
                            Kind::Input
                                | Kind::Output
                                | Kind::Gain
                                | Kind::Compressor
                                | Kind::Oscillator
                                | Kind::RingModulation
                                | Kind::Patch
                        )),
                "Unsupported processing node"
            );
            ensure!(
                match n.kind {
                    Kind::Output =>
                        n.id.starts_with("instrument-out-")
                            || default.nodes.iter().any(|b| b.id == n.id),
                    Kind::Patch => patch_slot(&n.id).is_some(),
                    Kind::Gain => n.value >= 0.,
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
        let conventional = self.nodes.iter().filter(|n| n.kind != Kind::Input).count()
            == default.nodes.len()
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
                capture: None,
                send: None,
            })
            .collect();
        Ok(Box::new(Plan {
            history: std::sync::Arc::new(crate::rolling::History::new(self)),
            waveform_peaks: [0.; NODE_LIMIT],
            conventional,
            steps,
            routed_inputs: vec![[[0.; crate::decks::PRODUCER_FRAMES]; 2]; 32].into_boxed_slice(),
            block_outputs: vec![[[[0.; 2]; 2]; crate::decks::PRODUCER_FRAMES]; NODE_LIMIT + 1]
                .into_boxed_slice(),
            patch_frames: vec![crate::decks::Frame::default(); crate::decks::PRODUCER_FRAMES]
                .into_boxed_slice()
                .try_into()
                .unwrap(),
            // The final slot is immutable silence when a built-in meter/output is removed.
            master: index("master").unwrap_or(NODE_LIMIT),
            headphones: index("headphones").unwrap_or(NODE_LIMIT),
            faders: [
                index("a-fader").unwrap_or(NODE_LIMIT),
                index("b-fader").unwrap_or(NODE_LIMIT),
            ],
        }))
    }
}
impl Plan {
    #[cfg(target_os = "macos")]
    pub fn bind_inputs(
        &mut self,
        graph: &Graph,
        sources: &crate::audio_inputs::Inputs,
    ) -> Result<()> {
        let mut error = None;
        let live = graph.live_nodes();
        for step in &mut self.steps {
            if step.node.kind == Kind::Output
                && step.node.id.starts_with("instrument-out-")
                && graph.wires.iter().any(|w| w.to == step.node.id)
            {
                match crate::instruments::audio(&step.node.id, false)
                    .and_then(crate::instrument_output::Output::open)
                {
                    Ok(send) => step.send = Some(send),
                    Err(e) => error = Some(e),
                }
            }
            if step.node.kind == Kind::Input && live[step.index] {
                match sources.open(&step.node.id) {
                    Ok(capture) => step.capture = Some(capture),
                    Err(e) => {
                        error = Some(e);
                    }
                }
            }
        }
        error.map_or(Ok(()), Err)
    }
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
        let mut outputs = [[[0.; 2]; 2]; NODE_LIMIT + 1];
        for step in &mut self.steps {
            let mut input = [[0.; 2]; 32];
            for link in &step.links {
                for c in 0..2 {
                    input[link.port][c] += outputs[link.source][link.output][c] * link.gain;
                }
            }
            let value = step.process(input, players, settings, gains, cross, cue);
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
    #[test]
    fn live_sources_require_a_nonzero_route_to_an_output() {
        let mut graph = super::Graph::default();
        let source = graph.nodes.iter().position(|n| n.id == "a-player").unwrap();
        assert!(graph.live_nodes()[source]);
        graph.wires.retain(|w| w.from != "a-filter");
        assert!(!graph.live_nodes()[source]);
        graph.wires.push(super::Wire {
            from: "a-filter".into(),
            output: "audio".into(),
            to: "master".into(),
            input: "audio".into(),
            gain: 0.,
        });
        assert!(!graph.live_nodes()[source]);
        graph.wires.last_mut().unwrap().gain = 1.;
        assert!(graph.live_nodes()[source]);
    }

    use super::*;
    #[test]
    fn live_input_routes_through_gain_to_cue_without_leaking_to_master() {
        let mut graph = Graph::default();
        graph.wires.clear();
        graph.nodes.push(Node {
            id: "input-test".into(),
            kind: Kind::Input,
            deck: None,
            label: "Interface".into(),
            x: 0.,
            y: 0.,
            value: 1.,
            custom_label: None,
            patch_inputs: None,
        });
        graph.nodes.push(Node {
            id: "input-gain".into(),
            kind: Kind::Gain,
            deck: None,
            label: "Gain".into(),
            x: 0.,
            y: 0.,
            value: 0.5,
            custom_label: None,
            patch_inputs: None,
        });
        for (from, to) in [("input-test", "input-gain"), ("input-gain", "headphones")] {
            graph.wires.push(Wire {
                from: from.into(),
                to: to.into(),
                output: "audio".into(),
                input: "audio".into(),
                gain: 1.,
            });
        }
        assert!(graph.nodes.last().unwrap().inputs().contains(&"audio"));
        assert!(graph
            .nodes
            .iter()
            .find(|n| n.kind == Kind::Input)
            .unwrap()
            .inputs()
            .is_empty());
        let mut plan = graph.compile().unwrap();
        plan.steps
            .iter_mut()
            .find(|s| s.node.kind == Kind::Input)
            .unwrap()
            .capture = Some(crate::audio_inputs::test_capture(2048, [0.4, -0.2], 44100));
        let mut block = [crate::decks::Frame::default(); crate::decks::PRODUCER_FRAMES];
        plan.render_block(&mut block, &mut []);
        assert!(block
            .iter()
            .all(|f| f.samples == [0.; 2] && f.cue_samples == [0.2, -0.1]));
        // A disconnected source must become silent, including on a reused plan.
        plan.steps
            .iter_mut()
            .find(|s| s.node.kind == Kind::Input)
            .unwrap()
            .capture = None;
        plan.render_block(&mut block, &mut []);
        assert!(block
            .iter()
            .all(|f| f.samples == [0.; 2] && f.cue_samples == [0.; 2]));
    }
    #[test]
    fn saved_input_palette_migrates_only_unused_automatic_devices() {
        let mut graph = Graph::default();
        for id in ["input-unused", "input-connected"] {
            graph.nodes.push(Node {
                id: id.into(),
                kind: Kind::Input,
                deck: None,
                label: id.into(),
                x: 40.,
                y: 650.,
                value: 1.,
                custom_label: None,
                patch_inputs: None,
            });
        }
        graph.wires.push(Wire {
            from: "input-connected".into(),
            to: "master".into(),
            input: "audio".into(),
            output: "audio".into(),
            gain: 1.,
        });
        let migrated = Graph::from_saved(&serde_json::to_vec(&graph).unwrap()).unwrap();
        assert!(!migrated.nodes.iter().any(|n| n.id == "input-unused"));
        assert!(migrated.nodes.iter().any(|n| n.id == "input-connected"));
        let restored =
            Graph::from_saved(&serde_json::to_vec(&graph.saved_value().unwrap()).unwrap()).unwrap();
        assert_eq!(restored, graph);
    }
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
            custom_label: None,
            patch_inputs: None,
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
    fn gain_nodes_accept_values_above_two_and_reject_invalid_values() {
        let mut graph = Graph::default();
        graph.nodes.push(Node {
            custom_label: None,
            patch_inputs: None,
            id: "test-gain".into(),
            kind: Kind::Gain,
            deck: None,
            label: "Gain".into(),
            x: 0.,
            y: 0.,
            value: 10.,
        });
        for value in [0., 10., 1000., f32::MAX] {
            graph.nodes.last_mut().unwrap().value = value;
            assert!(graph.compile().is_ok(), "gain {value} should be accepted");
        }
        for value in [-1., f32::NAN, f32::INFINITY] {
            graph.nodes.last_mut().unwrap().value = value;
            assert!(graph.compile().is_err(), "gain {value} should be rejected");
        }
    }

    #[test]
    fn compiled_stages_match_conventional_mixer_with_active_controls() {
        let mut graph = Graph::default();
        // An unused processor forces the general schedule without changing its signal chain.
        graph.nodes.push(Node {
            custom_label: None,
            patch_inputs: None,
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
            custom_label: None,
            patch_inputs: None,
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

pub const PATCH_LIMIT: usize = 16;
pub fn patch_slot(id: &str) -> Option<usize> {
    id.strip_prefix("patch-")?
        .parse::<usize>()
        .ok()
        .filter(|i| *i < PATCH_LIMIT && format!("patch-{i}") == id)
}
impl Step {
    fn process(
        &mut self,
        input: [[f32; 2]; 32],
        players: [[f32; 2]; 2],
        settings: [Settings; 2],
        gains: [f32; 2],
        cross: [f32; 2],
        cue: [f32; 2],
    ) -> [f32; 2] {
        let d = self.node.deck.unwrap_or(0);
        match self.node.kind {
            Kind::Player => players[d],
            Kind::Input => [0.; 2],
            Kind::Trim | Kind::Eq | Kind::Filter => {
                if self.dsp.settings != settings[d] {
                    self.dsp.set(settings[d]);
                }
                self.dsp.process_stage(
                    input[0],
                    match self.node.kind {
                        Kind::Trim => 0,
                        Kind::Eq => 1,
                        _ => 2,
                    },
                )
            }
            Kind::Fader => input[0].map(|v| v * gains[d]),
            Kind::Crossfader => {
                std::array::from_fn(|c| 0.45 * (input[0][c] * cross[0] + input[1][c] * cross[1]))
            }
            Kind::Cue => {
                std::array::from_fn(|c| 0.45 * (input[0][c] * cue[0] + input[1][c] * cue[1]))
            }
            Kind::Output | Kind::Patch => input[0],
            Kind::Gain => input[0].map(|v| v * self.node.value),
            Kind::Compressor => {
                let detector = if self.external_detector {
                    input[1]
                } else {
                    input[0]
                };
                let peak = detector[0].abs().max(detector[1].abs());
                self.envelope +=
                    (peak - self.envelope) * if peak > self.envelope { 0.02 } else { 0.0004 };
                let gain = if self.envelope > self.node.value {
                    (self.node.value / self.envelope).powf(0.75)
                } else {
                    1.
                };
                input[0].map(|v| v * gain)
            }
            Kind::RingModulation => std::array::from_fn(|c| input[0][c] * input[1][c]),
            Kind::Oscillator => {
                self.phase = (self.phase + self.node.value / 48000.).fract();
                let v = (self.phase * std::f32::consts::TAU).sin() * 0.1;
                [v, v]
            }
        }
    }
}
impl Graph {
    pub fn remove_patch(&mut self, slot: usize) {
        let id = format!("patch-{slot}");
        self.nodes.retain(|node| node.id != id);
        self.wires.retain(|wire| wire.from != id && wire.to != id);
    }
    pub fn add_patch(&mut self, slot: usize, label: String, ports: Vec<PatchInput>) {
        let id = format!("patch-{slot}");
        if self.nodes.iter().any(|n| n.id == id) {
            return;
        }
        self.nodes.push(Node {
            custom_label: None,
            patch_inputs: Some(Vec::new()),
            id: id.clone(),
            kind: Kind::Patch,
            deck: None,
            label,
            x: 800. + (slot % 4) as f32 * 180.,
            y: 500. + (slot / 4) as f32 * 95.,
            value: 1.,
        });
        self.sync_patch_inputs(slot, ports);
        if self.nodes.iter().any(|n| n.id == "master") {
            self.wires.push(Wire {
                from: id,
                to: "master".into(),
                output: "audio".into(),
                input: "audio".into(),
                gain: 1.,
            });
        }
    }
    pub fn sync_patch_inputs(&mut self, slot: usize, ports: Vec<PatchInput>) {
        let id = format!("patch-{slot}");
        let Some(node) = self
            .nodes
            .iter_mut()
            .find(|n| n.id == id && n.kind == Kind::Patch)
        else {
            return;
        };
        let old = node.patch_inputs.clone().unwrap_or_default();
        if node.patch_inputs.is_none() {
            if let Some(first) = ports.first() {
                for wire in &mut self.wires {
                    if wire.to == id && wire.input == "audio" {
                        wire.input = first.id.clone();
                    }
                }
            }
        }
        node.patch_inputs = Some(ports.clone());
        self.wires
            .retain(|w| w.to != id || ports.iter().any(|p| p.id == w.input));
        for port in &ports {
            if !old.iter().any(|p| p.id == port.id)
                && self.nodes.iter().any(|n| n.id == "mix")
                && !self
                    .wires
                    .iter()
                    .any(|w| w.from == "mix" && w.to == id && w.input == port.id)
            {
                self.wires.push(Wire {
                    from: "mix".into(),
                    to: id.clone(),
                    output: "audio".into(),
                    input: port.id.clone(),
                    gain: 1.,
                });
            }
        }
    }
}
impl Plan {
    pub fn capture_waveforms(
        &mut self,
        block: &[crate::decks::Frame; crate::decks::PRODUCER_FRAMES],
    ) {
        let interval = crate::rolling::PEAK_FRAMES;
        for index in self.history.indices() {
            let output = self.history.output(index);
            for (i, frame) in block.iter().enumerate() {
                let sample = if self.conventional {
                    std::array::from_fn(|c| {
                        (frame.deck_samples[0][c] * frame.routing_cross[0]
                            + frame.deck_samples[1][c] * frame.routing_cross[1])
                            * crate::decks::MIX_GAIN
                    })
                } else {
                    self.block_outputs[index][i][output]
                };
                self.waveform_peaks[index] = self.waveform_peaks[index]
                    .max(sample[0].abs())
                    .max(sample[1].abs());
                if (frame.output_frame + 1) % interval == 0 {
                    self.history.write(
                        index,
                        frame.output_frame + 1 - interval,
                        self.waveform_peaks[index],
                    );
                    self.waveform_peaks[index] = 0.;
                }
            }
        }
    }
    pub fn has_patch(&self, slot: usize) -> bool {
        self.steps
            .iter()
            .any(|s| s.node.kind == Kind::Patch && patch_slot(&s.node.id) == Some(slot))
    }
    pub fn render_block(
        &mut self,
        block: &mut [crate::decks::Frame; crate::decks::PRODUCER_FRAMES],
        drivers: &mut [crate::teia_audio::Driver],
    ) {
        use crate::decks::{Frame, PRODUCER_FRAMES};
        let outputs = &mut self.block_outputs;
        outputs.fill([[[0.; 2]; 2]; PRODUCER_FRAMES]);
        let patch = &mut self.patch_frames;
        let routed_inputs = &mut self.routed_inputs;
        for step in &mut self.steps {
            let mut captured = [0.; PRODUCER_FRAMES * 2];
            if let Some(source) = &step.capture {
                source.render(&mut captured);
            }
            if step.node.kind == Kind::Patch {
                routed_inputs.fill([[0.; PRODUCER_FRAMES]; 2]);
            }
            for (i, frame) in block.iter().enumerate() {
                let mut input = [[0.; 2]; 32];
                for link in &step.links {
                    for c in 0..2 {
                        input[link.port][c] += outputs[link.source][i][link.output][c] * link.gain;
                    }
                }
                let value = step.process(
                    input,
                    frame.routing_players,
                    frame.mixer,
                    frame.gains,
                    frame.routing_cross,
                    frame.routing_cue,
                );
                let value = if step.node.kind == Kind::Input {
                    [captured[i * 2], captured[i * 2 + 1]]
                } else {
                    value
                };
                let value = value.map(|v| if v.is_finite() { v } else { 0. });
                if let Some(send) = &mut step.send {
                    send.push(value);
                }
                outputs[step.index][i][0] = value;
                outputs[step.index][i][1] = if step.node.kind == Kind::Oscillator {
                    [(step.phase * std::f32::consts::TAU).cos() * 0.1; 2]
                } else {
                    input[0]
                };
                if step.node.kind == Kind::Patch {
                    for port in 0..step.node.patch_inputs.as_ref().map_or(1, Vec::len) {
                        for c in 0..2 {
                            routed_inputs[port][c][i] = input[port][c];
                        }
                    }
                    patch[i] = Frame {
                        samples: input[0],
                        ..*frame
                    };
                }
            }
            if step.node.kind == Kind::Patch {
                if let Some(driver) =
                    patch_slot(&step.node.id).and_then(|slot| drivers.get_mut(slot))
                {
                    driver.process_routed(
                        patch,
                        &routed_inputs[..step.node.patch_inputs.as_ref().map_or(1, Vec::len)],
                    );
                    for i in 0..PRODUCER_FRAMES {
                        outputs[step.index][i][0] = patch[i].samples;
                    }
                }
            }
        }
        for (i, frame) in block.iter_mut().enumerate() {
            frame.samples = outputs[self.master][i][0];
            frame.cue_samples = outputs[self.headphones][i][0];
            frame.deck_samples = [outputs[self.faders[0]][i][0], outputs[self.faders[1]][i][0]];
        }
    }
}

/// Stable node identities also cover AudioInput nodes nested in Groups.
pub fn patch_audio_inputs(document: &serde_json::Value) -> Vec<PatchInput> {
    let mut nodes = Vec::new();
    crate::teia_bridge::nodes(document, "", &mut nodes);
    let mut ports: Vec<_> = nodes
        .into_iter()
        .filter(|(_, node)| node["type"] == "AudioInput")
        .map(|(id, node)| PatchInput {
            label: node["customLabel"].as_str().unwrap_or(&id).to_string(),
            id,
        })
        .collect();
    ports.sort_by(|a, b| a.id.cmp(&b.id));
    ports
}
pub fn patch_has_audio_input(document: &serde_json::Value) -> bool {
    !patch_audio_inputs(document).is_empty()
}

#[cfg(test)]
mod patch_input_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn live_input_changes_preserve_existing_routes_and_only_default_new_ports() {
        let port = |id: &str| PatchInput {
            id: id.into(),
            label: id.into(),
        };
        let mut graph = Graph::default();
        graph.add_patch(0, "Patch".into(), vec![]);
        assert!(graph.nodes.last().unwrap().inputs().is_empty());
        graph.sync_patch_inputs(0, vec![port("one"), port("two")]);
        assert_eq!(graph.nodes.last().unwrap().inputs(), vec!["one", "two"]);
        assert_eq!(graph.wires.iter().filter(|w| w.to == "patch-0").count(), 2);
        graph
            .wires
            .retain(|w| !(w.to == "patch-0" && w.input == "one"));
        graph.sync_patch_inputs(0, vec![port("one"), port("two"), port("three")]);
        assert!(!graph
            .wires
            .iter()
            .any(|w| w.to == "patch-0" && w.input == "one"));
        assert!(graph
            .wires
            .iter()
            .any(|w| w.from == "mix" && w.to == "patch-0" && w.input == "three"));
        graph.sync_patch_inputs(0, vec![port("two")]);
        assert_eq!(graph.nodes.last().unwrap().inputs(), vec!["two"]);
        assert!(graph
            .wires
            .iter()
            .filter(|w| w.to == "patch-0")
            .all(|w| w.input == "two"));
        graph.sync_patch_inputs(0, vec![]);
        assert!(graph.nodes.last().unwrap().inputs().is_empty());
        assert!(!graph.wires.iter().any(|w| w.to == "patch-0"));
        assert!(graph.compile().is_ok());
    }
    #[test]
    fn removing_a_patch_removes_its_node_and_all_its_connections_only() {
        let mut graph = Graph::default();
        graph.add_patch(
            1,
            "Keep".into(),
            vec![PatchInput {
                id: "in".into(),
                label: "in".into(),
            }],
        );
        let kept = graph.clone();
        graph.add_patch(
            0,
            "Remove".into(),
            vec![PatchInput {
                id: "in".into(),
                label: "in".into(),
            }],
        );
        graph.wires.push(Wire {
            from: "patch-0".into(),
            to: "patch-1".into(),
            input: "audio".into(),
            output: "audio".into(),
            gain: 1.,
        });
        graph.remove_patch(0);
        assert_eq!(graph, kept);
        assert!(graph.compile().is_ok());
        graph.add_patch(0, "Add again".into(), vec![]);
        assert!(!graph.wires.iter().any(|w| w.to == "patch-0"));
        assert!(graph.compile().is_ok());
    }
    #[test]
    fn only_patches_with_an_audio_input_receive_the_default_mix_send() {
        for (document, expected_input) in [
            (
                json!({"nodes":[{"id":"in","type":"AudioInput"},{"type":"AudioOut"}]}),
                true,
            ),
            (
                json!({"nodes":[{"id":"group","type":"Group","subpatch":{"nodes":[{"id":"in","type":"AudioInput"}]}}]}),
                true,
            ),
            (
                json!({"nodes":[{"type":"SineOsc"},{"type":"AudioOut"}]}),
                false,
            ),
        ] {
            let input = patch_has_audio_input(&document);
            assert_eq!(input, expected_input);
            let mut graph = Graph::default();
            let original_wires = graph.wires.clone();
            graph.add_patch(0, "Patch".into(), patch_audio_inputs(&document));
            assert_eq!(
                graph
                    .wires
                    .iter()
                    .any(|w| w.from == "mix" && w.to == "patch-0"),
                input
            );
            assert!(graph
                .wires
                .iter()
                .any(|w| w.from == "patch-0" && w.to == "master"));
            assert!(original_wires.iter().all(|w| graph.wires.contains(w)));
            assert!(graph.compile().is_ok());
        }
        assert!(!patch_has_audio_input(&json!({"nodes":[]})));
    }
}

#[cfg(test)]
mod rolling_tests {
    use super::*;
    #[test]
    fn conventional_rolling_mix_uses_the_same_level_as_the_master_chain() {
        let mut plan = Graph::default().compile().unwrap();
        let mut block = [crate::decks::Frame::default(); crate::decks::PRODUCER_FRAMES];
        for offset in [0, 128] {
            for (i, frame) in block.iter_mut().enumerate() {
                frame.output_frame = offset + i as u64;
                frame.deck_samples = [[0.8, 0.2], [0.4, 0.1]];
                frame.routing_cross = [1., 0.5];
            }
            plan.capture_waveforms(&block);
        }
        let snapshot = plan.history.snapshot(&["mix".into()], 0, 256);
        let peak = snapshot["sources"][0]["peaks"][0][1].as_f64().unwrap();
        assert!((peak - 0.45).abs() < 1e-6);
    }
    #[test]
    fn rolling_capture_accumulates_across_producer_blocks_on_output_clock() {
        let mut graph = Graph::default();
        graph.nodes.push(Node {
            id: "synth".into(),
            kind: Kind::Oscillator,
            deck: None,
            label: "Synth".into(),
            x: 0.,
            y: 0.,
            value: 440.,
            custom_label: None,
            patch_inputs: None,
        });
        graph.wires.push(Wire {
            from: "synth".into(),
            output: "audio".into(),
            to: "master".into(),
            input: "audio".into(),
            gain: 1.,
        });
        let mut plan = graph.compile().unwrap();
        let mut block = [crate::decks::Frame::default(); crate::decks::PRODUCER_FRAMES];
        for offset in [0, 128] {
            for (i, frame) in block.iter_mut().enumerate() {
                frame.output_frame = offset + i as u64;
            }
            plan.render_block(&mut block, &mut []);
            plan.capture_waveforms(&block);
        }
        let snapshot = plan.history.snapshot(&["synth".into()], 0, 256);
        let synth = snapshot["sources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == "synth")
            .unwrap();
        assert_eq!(synth["peaks"].as_array().unwrap().len(), 1);
        assert_eq!(synth["peaks"][0][0], 0);
        assert!(synth["peaks"][0][1].as_f64().unwrap() > 0.09);
    }
}
