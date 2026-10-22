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
    CueSwitch,
    Output,
    Gain,
    Compressor,
    Oscillator,
    RingModulation,
    Selector,
    Patch,
    Vst,
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
    pub vst: Option<crate::vst::Descriptor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patch_inputs: Option<Vec<PatchInput>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eq: Option<[f32; 3]>,
}
impl Node {
    pub fn display_label(&self) -> &str {
        self.custom_label.as_deref().unwrap_or(&self.label)
    }
    pub fn inputs(&self) -> Vec<&str> {
        if self.kind == Kind::Vst {
            return self.vst.as_ref().map_or_else(Vec::new, |v| {
                v.inputs.iter().map(|b| b.id.as_str()).collect()
            });
        }
        if self.kind == Kind::Patch || self.kind == Kind::Selector {
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
    pub fn outputs(&self) -> Vec<&str> {
        if self.kind == Kind::Vst {
            return self.vst.as_ref().map_or_else(Vec::new, |v| {
                v.outputs.iter().map(|b| b.id.as_str()).collect()
            });
        }
        let ports: &[&str] = match self.kind {
            Kind::Output => &[],
            Kind::Compressor | Kind::RingModulation => &["audio", "dry"],
            Kind::Oscillator => &["audio", "cosine"],
            _ => &["audio"],
        };
        ports.to_vec()
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
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeValue {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eq: Option<[f32; 3]>,
    pub id: String,
    pub value: f32,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Parameters {
    pub nodes: Vec<NodeValue>,
    pub wires: Vec<Wire>,
}
impl Graph {
    /// Patch values by stable identity without importing any draft topology.
    pub fn with_parameters(mut self, parameters: Parameters) -> Result<Self> {
        ensure!(
            parameters.nodes.len() <= self.nodes.len()
                && parameters.wires.len() <= self.wires.len(),
            "Too many routing parameters"
        );
        for parameter in parameters.nodes {
            let node = self
                .nodes
                .iter_mut()
                .find(|n| n.id == parameter.id)
                .ok_or_else(|| anyhow::anyhow!("Routing node is not applied"))?;
            ensure!(
                matches!(
                    node.kind,
                    Kind::Gain
                        | Kind::Selector
                        | Kind::Compressor
                        | Kind::Oscillator
                        | Kind::Trim
                        | Kind::Eq
                        | Kind::Filter
                        | Kind::Fader
                        | Kind::CueSwitch
                ),
                "Node has no editable parameter"
            );
            node.value = parameter.value;
            if parameter.eq.is_some() {
                node.eq = parameter.eq;
            }
        }
        for parameter in parameters.wires {
            let wire = self
                .wires
                .iter_mut()
                .find(|w| {
                    w.from == parameter.from
                        && w.output == parameter.output
                        && w.to == parameter.to
                        && w.input == parameter.input
                })
                .ok_or_else(|| anyhow::anyhow!("Routing cable is not applied"))?;
            wire.gain = parameter.gain;
        }
        Ok(self)
    }
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
                ("cue-switch", Kind::CueSwitch),
            ];
            for (i, (name, kind)) in stages.iter().enumerate() {
                nodes.push(Node {
                    custom_label: None,
                    vst: None,
                    patch_inputs: None,
                    eq: None,
                    id: format!("{prefix}-{name}"),
                    kind: *kind,
                    deck: Some(d),
                    label: name.to_uppercase(),
                    x: if i == 0 {
                        if d == 0 {
                            55.
                        } else {
                            715.
                        }
                    } else {
                        300. + d as f32 * 185.
                    },
                    y: if i == 0 {
                        100.
                    } else {
                        110. + (i - 1) as f32 * 64.
                    },
                    value: 1.,
                });
                if i > 0 && *kind != Kind::CueSwitch {
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
                &format!("{prefix}-cue-switch"),
                "audio",
            );
            wire(&format!("{prefix}-cue-switch"), "headphones", "audio");
        }
        for (id, kind, label, x, y) in [
            ("mix", Kind::Crossfader, "Crossfader / mix", 300., 510.),
            ("master", Kind::Output, "Master output", 300., 700.),
            ("headphones", Kind::Output, "Cue output", 485., 700.),
        ] {
            nodes.push(Node {
                custom_label: None,
                vst: None,
                patch_inputs: None,
                eq: None,
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
        for send in &mut wires {
            if send.to == "headphones" {
                send.gain = 0.45;
            }
        }
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
    vst: Option<std::sync::Arc<std::sync::Mutex<crate::vst::Instance>>>,
}
pub struct Plan {
    pub history: std::sync::Arc<crate::rolling::History>,
    waveform_peaks: [f32; NODE_LIMIT],
    pub conventional: bool,
    steps: Vec<Step>,
    master: usize,
    headphones: usize,
    faders: [usize; 2],
    block_outputs: Box<[[[[f32; 2]; 32]; crate::decks::PRODUCER_FRAMES]]>,
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
        for prefix in ["a", "b"] {
            let id = format!("{prefix}-cue-switch");
            if graph
                .nodes
                .iter()
                .any(|n| n.id == format!("{prefix}-filter"))
                && !graph.nodes.iter().any(|n| n.id == id)
            {
                let default = Graph::default();
                graph
                    .nodes
                    .push(default.nodes.into_iter().find(|n| n.id == id).unwrap());
                for w in &mut graph.wires {
                    if w.from == format!("{prefix}-filter") && w.to == "cue" {
                        w.from = id.clone();
                    }
                }
                graph.wires.push(Wire {
                    from: format!("{prefix}-filter"),
                    output: "audio".into(),
                    to: id,
                    input: "audio".into(),
                    gain: 1.,
                });
            }
        }
        graph.remove_legacy_cue_mix();
        Ok(graph)
    }
    /// Outputs sum their incoming cables, so flatten the former cue bus while
    /// retaining its level and any user-edited sends or additional destinations.
    fn remove_legacy_cue_mix(&mut self) {
        let Some(bus) = self
            .nodes
            .iter()
            .find(|n| n.id == "cue" && n.kind == Kind::Cue)
            .cloned()
        else {
            return;
        };
        let incoming: Vec<_> = self
            .wires
            .iter()
            .filter(|w| w.to == bus.id)
            .cloned()
            .collect();
        let outgoing: Vec<_> = self
            .wires
            .iter()
            .filter(|w| w.from == bus.id)
            .cloned()
            .collect();
        self.nodes.retain(|n| n.id != bus.id);
        self.wires.retain(|w| w.from != bus.id && w.to != bus.id);
        for source in incoming {
            for destination in &outgoing {
                let gain = source.gain * 0.45 * destination.gain;
                if let Some(existing) = self.wires.iter_mut().find(|w| {
                    w.from == source.from
                        && w.output == source.output
                        && w.to == destination.to
                        && w.input == destination.input
                }) {
                    existing.gain += gain;
                } else {
                    self.wires.push(Wire {
                        from: source.from.clone(),
                        output: source.output.clone(),
                        to: destination.to.clone(),
                        input: destination.input.clone(),
                        gain,
                    });
                }
            }
        }
        // Parallel legacy sends can sum above the cable's supported gain range.
        // Preserve those uncommon levels using a gain processor rather than clipping.
        let combined = std::mem::take(&mut self.wires);
        for wire in combined {
            if wire.gain <= 2. {
                self.wires.push(wire);
                continue;
            }
            let mut index = 0;
            let id = loop {
                let candidate = format!("cue-send-{index}");
                if !self.nodes.iter().any(|n| n.id == candidate) {
                    break candidate;
                }
                index += 1;
            };
            self.nodes.push(Node {
                id: id.clone(),
                kind: Kind::Gain,
                label: "Cue send level".into(),
                value: wire.gain,
                ..bus.clone()
            });
            self.wires.push(Wire {
                to: id.clone(),
                input: "audio".into(),
                gain: 1.,
                ..wire.clone()
            });
            self.wires.push(Wire {
                from: id,
                output: "audio".into(),
                gain: 1.,
                ..wire
            });
        }
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
                        && n.vst == o.vst
                        && n.patch_inputs == o.patch_inputs
                        && n.eq == o.eq
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
                    && n.value.is_finite()
                    && n.eq.is_none_or(|bands| bands
                        .iter()
                        .all(|v| v.is_finite() && (0. ..=1.).contains(v))),
                "Invalid node"
            );
            ensure!(
                n.deck.is_none_or(|deck| deck < 2),
                "Only A and B can own players and automatic transition controls"
            );
            ensure!(
                n.patch_inputs
                    .as_ref()
                    .is_none_or(|p| (n.kind == Kind::Selector || p.len() <= 32)
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
                                | Kind::Selector
                                | Kind::Vst
                                | Kind::Patch
                                | Kind::Trim
                                | Kind::Eq
                                | Kind::Filter
                                | Kind::Fader
                                | Kind::CueSwitch
                        )),
                "Unsupported processing node"
            );
            ensure!(
                match n.kind {
                    Kind::Output =>
                        n.id.starts_with("instrument-out-")
                            || default.nodes.iter().any(|b| b.id == n.id),
                    Kind::Vst =>
                        n.vst.as_ref().is_some_and(|v| v.validate().is_ok())
                            && n.id.starts_with("vst-")
                            && n.id.len() == 40
                            && n.id[4..]
                                .bytes()
                                .all(|b| b.is_ascii_hexdigit() || b == b'-'),
                    Kind::Patch => patch_slot(&n.id).is_some(),
                    Kind::Trim if n.deck.is_none() => (-12. ..=12.).contains(&n.value),
                    Kind::Filter if n.deck.is_none() => (-1. ..=1.).contains(&n.value),
                    Kind::Fader | Kind::CueSwitch if n.deck.is_none() =>
                        (0. ..=1.).contains(&n.value),
                    Kind::Selector =>
                        n.patch_inputs
                            .as_ref()
                            .is_some_and(|p| !p.is_empty() && p.len() <= 513)
                            && n.value >= 0.
                            && n.value.fract() == 0.
                            && (n.value as usize) < n.inputs().len(),
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
            if self.nodes[target].kind == Kind::Selector {
                ensure!(
                    !self.wires[..i]
                        .iter()
                        .any(|old| old.to == w.to && old.input == w.input),
                    "Selector inputs accept one cable each"
                );
            }
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
                port: if self.nodes[target].kind == Kind::Selector {
                    0
                } else {
                    port
                },
                gain: if self.nodes[target].kind == Kind::Selector
                    && port != self.nodes[target].value as usize
                {
                    0.
                } else {
                    w.gain
                },
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
                vst: None,
            })
            .collect();
        Ok(Box::new(Plan {
            history: std::sync::Arc::new(crate::rolling::History::new(self)),
            waveform_peaks: [0.; NODE_LIMIT],
            conventional,
            steps,
            routed_inputs: vec![[[0.; crate::decks::PRODUCER_FRAMES]; 2]; 32].into_boxed_slice(),
            block_outputs: vec![[[[0.; 2]; 32]; crate::decks::PRODUCER_FRAMES]; NODE_LIMIT + 1]
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
    pub fn bind_inputs(&mut self, graph: &Graph, sources: &crate::audio_inputs::Inputs) {
        self.bind_endpoints(
            graph,
            |id| sources.open(id),
            |id| {
                crate::instruments::audio(id, false)
                    .and_then(crate::instrument_output::Output::open)
            },
        );
    }
    #[cfg(any(target_os = "macos", test))]
    fn bind_endpoints(
        &mut self,
        graph: &Graph,
        mut input: impl FnMut(&str) -> Result<std::sync::Arc<crate::audio_inputs::Capture>>,
        mut output: impl FnMut(&str) -> Result<crate::instrument_output::Output>,
    ) {
        // Hardware is optional when planning a session. Keep unavailable endpoints
        // in the saved graph; unbound inputs render silence and outputs discard audio.
        let live = graph.live_nodes();
        for step in &mut self.steps {
            if step.node.kind == Kind::Output
                && step.node.id.starts_with("instrument-out-")
                && graph.wires.iter().any(|w| w.to == step.node.id)
            {
                step.send = output(&step.node.id)
                    .map_err(|e| {
                        eprintln!("Routing output {} unavailable: {e:#}", step.node.id);
                        e
                    })
                    .ok();
            }
            if step.node.kind == Kind::Input && live[step.index] {
                step.capture = input(&step.node.id)
                    .map_err(|e| {
                        eprintln!("Routing input {} unavailable: {e:#}", step.node.id);
                        e
                    })
                    .ok();
            }
        }
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
    fn offline_instrument_routes_save_and_leave_connected_inputs_audible() {
        let mut graph = Graph::default();
        graph.wires.clear();
        for (id, kind) in [
            ("instrument-in-offline", Kind::Input),
            ("input-connected", Kind::Input),
            ("instrument-out-offline", Kind::Output),
        ] {
            graph.nodes.push(Node {
                id: id.into(),
                kind,
                deck: None,
                label: id.into(),
                x: 0.,
                y: 0.,
                value: 1.,
                custom_label: None,
                vst: None,
                patch_inputs: None,
                eq: None,
            });
        }
        for (from, to) in [
            ("instrument-in-offline", "headphones"),
            ("input-connected", "master"),
            ("input-connected", "instrument-out-offline"),
        ] {
            graph.wires.push(Wire {
                from: from.into(),
                to: to.into(),
                output: "audio".into(),
                input: "audio".into(),
                gain: 1.,
            });
        }
        let saved = graph.saved_value().unwrap();
        let restored = Graph::from_saved(&serde_json::to_vec(&saved).unwrap()).unwrap();
        let mut plan = restored.compile().unwrap();
        let mut inputs = Vec::new();
        let mut outputs = Vec::new();
        plan.bind_endpoints(
            &restored,
            |id| {
                inputs.push(id.to_owned());
                if id == "input-connected" {
                    Ok(crate::audio_inputs::test_capture(2048, [0.4, -0.2], 44100))
                } else {
                    anyhow::bail!("Input device disconnected")
                }
            },
            |id| {
                outputs.push(id.to_owned());
                anyhow::bail!("Output device disconnected")
            },
        );
        assert_eq!(inputs.len(), 2);
        assert_eq!(outputs, ["instrument-out-offline"]);
        let mut block = [crate::decks::Frame::default(); crate::decks::PRODUCER_FRAMES];
        plan.render_block(&mut block, &mut []);
        assert!(block
            .iter()
            .all(|f| f.samples == [0.4, -0.2] && f.cue_samples == [0.; 2]));
        assert_eq!(restored.saved_value().unwrap(), saved);
        // Reapplying after connecting the instrument opens its existing route.
        plan.bind_endpoints(
            &restored,
            |_| Ok(crate::audio_inputs::test_capture(2048, [0.1, 0.1], 44100)),
            |_| anyhow::bail!("Output still disconnected"),
        );
        plan.render_block(&mut block, &mut []);
        assert!(block.iter().all(|f| f.cue_samples == [0.1, 0.1]));
    }
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
            vst: None,
            patch_inputs: None,
            eq: None,
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
            vst: None,
            patch_inputs: None,
            eq: None,
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
                vst: None,
                patch_inputs: None,
                eq: None,
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
            vst: None,
            patch_inputs: None,
            eq: None,
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
            vst: None,
            patch_inputs: None,
            eq: None,
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
            vst: None,
            patch_inputs: None,
            eq: None,
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
            vst: None,
            patch_inputs: None,
            eq: None,
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
                let settings = if self.node.deck.is_some() {
                    settings[d]
                } else {
                    Settings {
                        trim: if self.node.kind == Kind::Trim {
                            self.node.value
                        } else {
                            0.
                        },
                        eq: self.node.eq.unwrap_or([0.5; 3]),
                        filter: if self.node.kind == Kind::Filter {
                            self.node.value
                        } else {
                            0.
                        },
                    }
                };
                if self.dsp.settings != settings {
                    self.dsp.set(settings);
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
            Kind::Fader => input[0].map(|v| {
                v * if self.node.deck.is_some() {
                    gains[d]
                } else {
                    self.node.value
                }
            }),
            Kind::CueSwitch => input[0].map(|v| {
                v * if self.node.deck.is_some() {
                    cue[d]
                } else {
                    self.node.value
                }
            }),
            Kind::Crossfader => {
                std::array::from_fn(|c| 0.45 * (input[0][c] * cross[0] + input[1][c] * cross[1]))
            }
            Kind::Cue => std::array::from_fn(|c| 0.45 * (input[0][c] + input[1][c])),
            Kind::Output | Kind::Patch | Kind::Vst | Kind::Selector => input[0],
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
                self.phase =
                    (self.phase + self.node.value / crate::sample_rate::get() as f32).fract();
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
            eq: None,
            custom_label: None,
            vst: None,
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
        let interval = crate::rolling::peak_frames();
        for index in self.history.indices() {
            let output = self.history.output(index);
            for (i, frame) in block.iter().enumerate() {
                let sample = if self.conventional && self.faders.contains(&index) {
                    frame.deck_samples[if index == self.faders[0] { 0 } else { 1 }]
                } else if self.conventional {
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
    pub fn bind_vsts(&mut self) {
        for step in &mut self.steps {
            if step.node.kind == Kind::Vst {
                step.vst = crate::vst::instance(&step.node.id);
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
        let patch = &mut self.patch_frames;
        let routed_inputs = &mut self.routed_inputs;
        for step in &mut self.steps {
            let mut captured = [0.; PRODUCER_FRAMES * 2];
            if let Some(source) = &step.capture {
                source.render(&mut captured);
            }
            if matches!(step.node.kind, Kind::Patch | Kind::Vst) {
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
                if matches!(step.node.kind, Kind::Patch | Kind::Vst) {
                    for port in 0..if step.node.kind == Kind::Vst {
                        step.node.vst.as_ref().map_or(0, |v| v.inputs.len())
                    } else {
                        step.node.patch_inputs.as_ref().map_or(1, Vec::len)
                    } {
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
            if step.node.kind == Kind::Vst {
                outputs[step.index].fill([[0.; 2]; 32]);
                if let Some(instance) = &step.vst {
                    // The audio producer never waits on a plugin editor/state operation.
                    if let Ok(mut instance) = instance.try_lock() {
                        instance.render(routed_inputs, block, &mut outputs[step.index]);
                    }
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
        let mix = snapshot["sources"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == "mix")
            .unwrap();
        let peak = mix["peaks"][0][1].as_f64().unwrap();
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
            vst: None,
            patch_inputs: None,
            eq: None,
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

#[cfg(test)]
mod parameter_tests {
    use super::*;
    #[test]
    fn values_patch_existing_identity_without_changing_topology_or_layout() {
        let mut graph = Graph::default();
        graph.nodes.push(Node {
            id: "test-gain".into(),
            kind: Kind::Gain,
            deck: None,
            label: "Gain".into(),
            custom_label: None,
            vst: None,
            patch_inputs: None,
            eq: None,
            x: 10.,
            y: 20.,
            value: 1.,
        });
        let original = graph.clone();
        let mut wire = graph.wires[0].clone();
        wire.gain = 0.4;
        let updated = graph
            .with_parameters(Parameters {
                nodes: vec![NodeValue {
                    eq: None,
                    id: "test-gain".into(),
                    value: 3.,
                }],
                wires: vec![wire],
            })
            .unwrap();
        assert_eq!(updated.nodes.len(), original.nodes.len());
        assert_eq!(updated.nodes.last().unwrap().x, 10.);
        assert_eq!(updated.nodes.last().unwrap().value, 3.);
        assert_eq!(updated.wires.len(), original.wires.len());
        assert_eq!(updated.wires[0].from, original.wires[0].from);
        assert_eq!(updated.wires[0].gain, 0.4);
        assert!(updated.compile().is_ok());
        assert!(original
            .clone()
            .with_parameters(Parameters {
                nodes: vec![NodeValue {
                    eq: None,
                    id: "draft-node".into(),
                    value: 2.
                }],
                wires: vec![]
            })
            .is_err());
        let invalid = original
            .with_parameters(Parameters {
                nodes: vec![NodeValue {
                    eq: None,
                    id: "test-gain".into(),
                    value: -1.,
                }],
                wires: vec![],
            })
            .unwrap();
        assert!(invalid.compile().is_err());
    }
}

#[cfg(test)]
mod mixer_line_tests {
    use super::*;
    fn extra_line() -> Graph {
        let mut graph = Graph::default();
        let template = graph
            .nodes
            .iter()
            .find(|n| n.id == "a-trim")
            .unwrap()
            .clone();
        for (stage, kind, value) in [
            ("trim", Kind::Trim, 0.),
            ("eq", Kind::Eq, 0.),
            ("filter", Kind::Filter, 0.),
            ("fader", Kind::Fader, 0.),
            ("cue-switch", Kind::CueSwitch, 1.),
        ] {
            graph.nodes.push(Node {
                id: format!("line-2-{stage}"),
                kind,
                deck: None,
                value,
                eq: Some([0.5; 3]),
                ..template.clone()
            });
        }
        graph.wires.clear();
        for (from, to, gain) in [
            ("a-player", "line-2-trim", 1.),
            ("line-2-trim", "line-2-eq", 1.),
            ("line-2-eq", "line-2-filter", 1.),
            ("line-2-filter", "line-2-fader", 1.),
            ("line-2-filter", "line-2-cue-switch", 1.),
            ("line-2-fader", "master", 0.45),
            ("line-2-cue-switch", "headphones", 0.45),
        ] {
            graph.wires.push(Wire {
                from: from.into(),
                to: to.into(),
                input: "audio".into(),
                output: "audio".into(),
                gain,
            });
        }
        graph
    }
    #[test]
    fn independent_cue_is_pre_fader_and_unaffected_by_ab_crossfader() {
        let graph = extra_line();
        let restored =
            Graph::from_saved(&serde_json::to_vec(&graph.saved_value().unwrap()).unwrap()).unwrap();
        assert_eq!(graph, restored);
        let mut plan = graph.compile().unwrap();
        assert!(!plan.conventional);
        let (out, _) = plan.render(
            [[0.2; 2], [0.; 2]],
            [Settings::default(); 2],
            [0.; 2],
            [0.; 2],
            [0.; 2],
        );
        assert_eq!(out[0], [0.; 2]);
        assert!((out[1][0] - 0.09).abs() < 1e-6);
        let changed = graph
            .clone()
            .with_parameters(Parameters {
                nodes: vec![
                    NodeValue {
                        id: "line-2-fader".into(),
                        value: 1.,
                        eq: None,
                    },
                    NodeValue {
                        id: "line-2-cue-switch".into(),
                        value: 0.,
                        eq: None,
                    },
                ],
                wires: vec![],
            })
            .unwrap();
        let (out, _) = changed.compile().unwrap().render(
            [[0.2; 2], [0.; 2]],
            [Settings::default(); 2],
            [0.; 2],
            [0.; 2],
            [0.; 2],
        );
        assert!((out[0][0] - 0.09).abs() < 1e-6);
        assert_eq!(out[1], [0.; 2]);
        assert_eq!(
            graph.nodes.iter().find(|n| n.id == "a-fader").unwrap(),
            changed.nodes.iter().find(|n| n.id == "a-fader").unwrap()
        );
    }
    #[test]
    fn all_lines_are_waveform_options_even_with_no_master_connection() {
        let graph = extra_line();
        let snapshot = graph.compile().unwrap().history.snapshot(&[], 0, 0);
        let sources = snapshot["sources"].as_array().unwrap();
        for id in ["a-fader", "b-fader", "line-2-fader"] {
            assert!(sources.iter().any(|s| s["id"] == id));
        }
        assert!(sources.iter().any(|s| s["label"] == "Mixer line C"));
        assert!(!sources.iter().any(|s| s["id"] == "line-2-trim"));
    }
    #[test]
    fn channel_eq_parameters_validate_each_band_and_preserve_topology() {
        let graph = extra_line();
        let changed = graph
            .clone()
            .with_parameters(Parameters {
                nodes: vec![NodeValue {
                    id: "line-2-eq".into(),
                    value: 0.,
                    eq: Some([0., 0.6, 0.8]),
                }],
                wires: vec![],
            })
            .unwrap();
        assert!(changed.compile().is_ok());
        assert_eq!(changed.wires, graph.wires);
        let bad = graph
            .with_parameters(Parameters {
                nodes: vec![NodeValue {
                    id: "line-2-eq".into(),
                    value: 0.,
                    eq: Some([0.5, f32::NAN, 0.5]),
                }],
                wires: vec![],
            })
            .unwrap();
        assert!(bad.compile().is_err());
    }
}

#[cfg(test)]
mod direct_cue_tests {
    use super::*;
    fn legacy() -> Graph {
        let mut graph = Graph::default();
        graph.wires.retain(|w| w.to != "headphones");
        let template = graph
            .nodes
            .iter()
            .find(|n| n.id == "master")
            .unwrap()
            .clone();
        graph.nodes.push(Node {
            id: "cue".into(),
            kind: Kind::Cue,
            label: "Cue mix".into(),
            ..template
        });
        for (from, to, input, gain) in [
            ("a-cue-switch", "cue", "A", 1.4),
            ("b-cue-switch", "cue", "B", 0.6),
            ("cue", "headphones", "audio", 0.7),
            ("cue", "master", "audio", 0.3),
        ] {
            graph.wires.push(Wire {
                from: from.into(),
                to: to.into(),
                input: input.into(),
                output: "audio".into(),
                gain,
            });
        }
        graph
    }
    #[test]
    fn defaults_send_cue_switches_directly_to_output_at_existing_level() {
        let graph = Graph::default();
        assert!(!graph.nodes.iter().any(|n| n.kind == Kind::Cue));
        for prefix in ["a", "b"] {
            assert!(graph
                .wires
                .iter()
                .any(|w| w.from == format!("{prefix}-cue-switch")
                    && w.to == "headphones"
                    && w.gain == 0.45));
        }
        let mut plan = graph.compile().unwrap();
        assert!(plan.conventional);
        let (out, _) = plan.render(
            [[0.2; 2], [0.4; 2]],
            [Settings::default(); 2],
            [0.; 2],
            [0.; 2],
            [1., 0.5],
        );
        assert!((out[1][0] - 0.18).abs() < 1e-6);
    }
    #[test]
    fn saved_cue_mix_migration_keeps_custom_levels_and_destinations() {
        let mut old = legacy();
        // Also cover sessions saved before per-line cue-switch nodes existed.
        old.nodes.retain(|n| n.id != "a-cue-switch");
        old.wires.retain(|w| w.to != "a-cue-switch");
        for wire in &mut old.wires {
            if wire.from == "a-cue-switch" {
                wire.from = "a-filter".into();
            }
        }
        let graph = Graph::from_saved(&serde_json::to_vec(&old).unwrap()).unwrap();
        assert!(!graph.nodes.iter().any(|n| n.id == "cue"));
        assert!(!graph.wires.iter().any(|w| w.from == "cue" || w.to == "cue"));
        let (out, _) = graph.compile().unwrap().render(
            [[0.2; 2], [0.4; 2]],
            [Settings::default(); 2],
            [0.; 2],
            [0.; 2],
            [1., 0.5],
        );
        assert!((out[1][0] - 0.126).abs() < 1e-6);
        assert!((out[0][0] - 0.054).abs() < 1e-6);
        let restored =
            Graph::from_saved(&serde_json::to_vec(&graph.saved_value().unwrap()).unwrap()).unwrap();
        assert_eq!(graph, restored);
    }
    #[test]
    fn parallel_direct_and_legacy_sends_preserve_levels_above_cable_limit() {
        let mut graph = legacy();
        graph.wires.push(Wire {
            from: "a-cue-switch".into(),
            to: "headphones".into(),
            output: "audio".into(),
            input: "audio".into(),
            gain: 2.,
        });
        let migrated = Graph::from_saved(&serde_json::to_vec(&graph).unwrap()).unwrap();
        let (out, _) = migrated.compile().unwrap().render(
            [[0.2; 2], [0.; 2]],
            [Settings::default(); 2],
            [0.; 2],
            [0.; 2],
            [1., 0.],
        );
        assert!((out[1][0] - 0.4882).abs() < 1e-6);
    }
}

#[cfg(test)]
mod selector_tests {
    use super::*;
    #[test]
    fn selector_switches_audio_and_supports_more_than_32_ports() {
        let mut g = Graph::default();
        g.nodes.push(Node {
            id: "selector".into(),
            kind: Kind::Selector,
            deck: None,
            label: "Selector".into(),
            custom_label: None,
            x: 0.,
            y: 0.,
            value: 0.,
            eq: None,
            vst: None,
            patch_inputs: Some(
                (0..40)
                    .map(|i| PatchInput {
                        id: format!("p{i}"),
                        label: format!("p{i}"),
                    })
                    .collect(),
            ),
        });
        g.wires.retain(|w| w.to != "master");
        for (from, to, input) in [
            ("a-player", "selector", "p0"),
            ("b-player", "selector", "p38"),
            ("selector", "master", "audio"),
        ] {
            g.wires.push(Wire {
                from: from.into(),
                to: to.into(),
                input: input.into(),
                output: "audio".into(),
                gain: 1.,
            });
        }
        let render = |g: &Graph| {
            g.compile()
                .unwrap()
                .render(
                    [[0.2; 2], [0.8; 2]],
                    [Settings::default(); 2],
                    [1.; 2],
                    [1.; 2],
                    [1.; 2],
                )
                .0[0]
        };
        assert_eq!(render(&g), [0.2; 2]);
        g.nodes.last_mut().unwrap().value = 38.;
        assert_eq!(render(&g), [0.8; 2]);
        g.nodes.last_mut().unwrap().value = 39.;
        assert_eq!(render(&g), [0.; 2]);
        let loaded: Graph = serde_json::from_value(serde_json::to_value(&g).unwrap()).unwrap();
        assert_eq!(loaded, g);
    }
}
