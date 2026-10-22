//! Typed musical connections, separate from the audio signal graph.
use super::patterns::Bank;
use anyhow::{ensure, Result};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Destination {
    Midi { output: i32 },
    Teia { slot: usize },
    Deck { deck: usize },
    DeckCue { deck: usize },
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Harmony {
    pub key: u8,
    pub scale: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Transformation {
    Selector {
        selected: String,
        ports: Vec<String>,
    },
    OctaveShift {
        octaves: i8,
    },
    Filter {
        direction: String,
        note: u8,
    },
}
impl Transformation {
    pub fn apply(&self, note: u8) -> Option<u8> {
        match self {
            Self::Selector { .. } => Some(note),
            Self::OctaveShift { octaves } => {
                let pitch = note as i16 + *octaves as i16 * 12;
                (0..=127).contains(&pitch).then_some(pitch as u8)
            }
            Self::Filter {
                direction,
                note: threshold,
            } => ((direction == "above" && note > *threshold)
                || (direction == "below" && note < *threshold))
                .then_some(note),
        }
    }
}
pub fn transform(note: u8, steps: &[Transformation]) -> Option<u8> {
    steps.iter().try_fold(note, |note, step| step.apply(note))
}
/// Expand every source-to-destination path through transformations.
/// Path IDs keep sources independent; each expanded path owns a distinct route.
pub fn signal_paths(graph: &Graph) -> Vec<(Wire, Vec<Transformation>)> {
    fn expand(
        graph: &Graph,
        wire: Wire,
        steps: Vec<Transformation>,
        seen: &mut HashSet<String>,
        productive: &HashSet<&str>,
        result: &mut Vec<(Wire, Vec<Transformation>)>,
    ) {
        // Validation rejects oversized expansions. Bound work even on invalid graphs.
        if result.len() > 256 || !productive.contains(wire.from.as_str()) {
            return;
        }
        let Some(node) = graph
            .nodes
            .iter()
            .find(|n| n.id == wire.from && n.kind == "transformation")
        else {
            let mut steps = steps;
            steps.reverse();
            result.push((wire, steps));
            return;
        };
        if !seen.insert(node.id.clone()) {
            return;
        }
        let mut steps = steps;
        if let Some(step) = &node.transformation {
            if !matches!(step, Transformation::Selector { .. }) {
                steps.push(step.clone());
            }
        }
        for input in graph.wires.iter().filter(|w| {
            w.to == node.id
                && match &node.transformation {
                    Some(Transformation::Selector { selected, .. }) => {
                        w.input.as_ref() == Some(selected)
                            && (w.kind == wire.kind
                                || wire.kind != "scale"
                                    && ["notes", "midi"].contains(&w.kind.as_str()))
                    }
                    _ => ["midi", "notes"].contains(&w.kind.as_str()),
                }
        }) {
            let mut upstream = wire.clone();
            upstream.id = format!("{}>{}", input.id, wire.id);
            upstream.from = input.from.clone();
            if input.kind == "notes" {
                upstream.kind = "notes".into();
            }
            expand(graph, upstream, steps.clone(), seen, productive, result);
            if result.len() > 256 {
                break;
            }
        }
        seen.remove(&node.id);
    }
    // Skip disconnected upstream branches before enumerating paths through a DAG.
    let mut productive: HashSet<&str> = graph
        .nodes
        .iter()
        .filter(|n| n.kind != "transformation")
        .map(|n| n.id.as_str())
        .collect();
    loop {
        let before = productive.len();
        for wire in &graph.wires {
            if ["midi", "notes", "scale", "cue"].contains(&wire.kind.as_str())
                && productive.contains(wire.from.as_str())
            {
                productive.insert(wire.to.as_str());
            }
        }
        if productive.len() == before {
            break;
        }
    }
    let mut result = Vec::new();
    let terminals: Vec<_> = graph
        .wires
        .iter()
        .enumerate()
        .filter(|(_, w)| {
            ["midi", "notes", "scale", "cue"].contains(&w.kind.as_str())
                && productive.contains(w.from.as_str())
                && !graph
                    .nodes
                    .iter()
                    .any(|n| n.id == w.to && n.kind == "transformation")
        })
        .collect();
    // Reserve terminal cable owners so existing single-source routes keep their slots.
    let mut used: HashSet<_> = terminals
        .iter()
        .filter(|(_, w)| w.kind != "scale")
        .map(|(i, w)| w.route.unwrap_or(*i as u16))
        .collect();
    for (index, end) in terminals {
        let start = result.len();
        expand(
            graph,
            end.clone(),
            Vec::new(),
            &mut HashSet::new(),
            &productive,
            &mut result,
        );
        for (offset, (wire, _)) in result[start..].iter_mut().enumerate() {
            let owner = if offset == 0 && end.kind != "scale" {
                end.route.unwrap_or(index as u16)
            } else {
                (0..256).find(|slot| !used.contains(slot)).unwrap_or(256)
            };
            used.insert(owner);
            wire.route = Some(owner);
        }
        if result.len() > 256 {
            break;
        }
    }
    result
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_label: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub pattern: Option<String>,
    #[serde(default)]
    pub deck: Option<usize>,
    #[serde(default)]
    pub destination: Option<Destination>,
    #[serde(default)]
    pub harmony: Option<Harmony>,
    #[serde(default)]
    pub input: Option<i32>,
    #[serde(default)]
    pub channel: Option<u8>,
    #[serde(default)]
    pub transformation: Option<Transformation>,
    #[serde(default)]
    pub advance_ms: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Wire {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(default)]
    pub route: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
}
#[derive(Clone, Default, Debug, Serialize, Deserialize, PartialEq)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub wires: Vec<Wire>,
}
impl Graph {
    pub fn validate(&self, bank: &Bank) -> Result<()> {
        ensure!(
            self.nodes.len() <= 258 && self.wires.len() <= 256,
            "Musical routing limit exceeded"
        );
        let mut ids = HashSet::new();
        let mut patterns = HashSet::new();
        for n in &self.nodes {
            ensure!(
                !n.id.is_empty()
                    && n.id.len() <= 100
                    && ids.insert(&n.id)
                    && n.label.len() <= 200
                    && n.x.is_finite()
                    && n.y.is_finite()
                    && (0. ..=1500.).contains(&n.x)
                    && (0. ..=900.).contains(&n.y),
                "Invalid musical node"
            );
            ensure!(
                n.harmony
                    .is_none_or(|h| h.key < 12 && h.scale < super::patterns::SCALES.len()),
                "Invalid instrument key/scale"
            );
            ensure!(
                n.channel.is_none_or(|ch| (1..=16).contains(&ch)),
                "MIDI channel must be 1–16 or All"
            );
            match n.kind.as_str() {
                "pattern" => {
                    ensure!(
                        n.pattern.as_ref().is_some_and(|id| bank
                            .patterns
                            .iter()
                            .any(|p| p.id == *id)
                            && patterns.insert(id)),
                        "Unknown or duplicate pattern node"
                    );
                    ensure!(
                        n.destination.is_none() && n.deck.is_none(),
                        "Invalid pattern ports"
                    );
                }
                "deck" => ensure!(
                    n.deck.is_some_and(|d| d <= 2)
                        && n.destination.is_none()
                        && n.pattern.is_none(),
                    "Invalid deck node"
                ),
                "instrument" => ensure!(
                    n.destination.as_ref().is_some_and(|d| match d {
                        Destination::Midi { .. } => true,
                        Destination::Teia { slot } => *slot < crate::routing::PATCH_LIMIT,
                        Destination::Deck { .. } | Destination::DeckCue { .. } => false,
                    }) && n.pattern.is_none()
                        && n.deck.is_none(),
                    "Invalid instrument destination"
                ),
                "transformation" => {
                    ensure!(
                        n.pattern.is_none() && n.deck.is_none() && n.destination.is_none(),
                        "Invalid transformation ports"
                    );
                    ensure!(
                        match &n.transformation {
                            Some(Transformation::Selector { selected, ports }) =>
                                !ports.is_empty()
                                    && ports.contains(selected)
                                    && ports.len() <= 257
                                    && ports.iter().all(|p| !p.is_empty())
                                    && ports
                                        .iter()
                                        .enumerate()
                                        .all(|(i, p)| !ports[..i].contains(p)),
                            Some(Transformation::OctaveShift { octaves }) =>
                                (-10..=10).contains(octaves),
                            Some(Transformation::Filter { direction, note }) =>
                                ["above", "below"].contains(&direction.as_str()) && *note <= 127,
                            None => false,
                        },
                        "Invalid transformation settings"
                    );
                    let mut seen = HashSet::new();
                    let mut pending: Vec<_> = self
                        .wires
                        .iter()
                        .filter(|w| w.to == n.id)
                        .map(|w| &w.from)
                        .collect();
                    while let Some(id) = pending.pop() {
                        ensure!(id != &n.id, "Transformation feedback is not supported");
                        if seen.insert(id)
                            && self
                                .nodes
                                .iter()
                                .any(|node| &node.id == id && node.kind == "transformation")
                        {
                            pending
                                .extend(self.wires.iter().filter(|w| &w.to == id).map(|w| &w.from));
                        }
                    }
                }
                _ => anyhow::bail!("Unsupported musical node"),
            }
        }
        let mut wires = HashSet::new();
        let mut pairs = HashSet::new();
        let mut roots = HashSet::new();
        let mut routes = HashSet::new();
        for (index, w) in self.wires.iter().enumerate() {
            if ["midi", "notes", "cue"].contains(&w.kind.as_str())
                && !self
                    .nodes
                    .iter()
                    .any(|n| n.id == w.to && n.kind == "pattern")
            {
                let route = w.route.unwrap_or(index as u16);
                ensure!(
                    route < 256 && routes.insert(route),
                    "Duplicate MIDI route owner"
                );
            }
            ensure!(
                !w.id.is_empty()
                    && w.id.len() <= 100
                    && wires.insert(&w.id)
                    && pairs.insert((&w.from, &w.to, &w.kind, &w.input)),
                "Duplicate musical cable"
            );
            let from = self
                .nodes
                .iter()
                .find(|n| n.id == w.from)
                .ok_or_else(|| anyhow::anyhow!("Missing cable source"))?;
            let to = self
                .nodes
                .iter()
                .find(|n| n.id == w.to)
                .ok_or_else(|| anyhow::anyhow!("Missing cable target"))?;
            if let Some(Transformation::Selector { ports, .. }) = &to.transformation {
                ensure!(
                    w.input.as_ref().is_some_and(|p| ports.contains(p))
                        && self
                            .wires
                            .iter()
                            .filter(|other| other.to == w.to && other.input == w.input)
                            .count()
                            == 1,
                    "Selector input accepts one cable"
                );
            }
            ensure!(
                w.kind == "cue"
                    || !bank.patterns.iter().any(|p| p.kind == "cue"
                        && (Some(&p.id) == from.pattern.as_ref()
                            || Some(&p.id) == to.pattern.as_ref())),
                "Cue point patterns connect only to deck cue inputs"
            );
            ensure!(
                from.id != to.id && match w.kind.as_str() {
                    "cue" => from.kind == "pattern" && to.kind == "deck" && bank.patterns.iter().any(|p| Some(&p.id) == from.pattern.as_ref() && p.kind == "cue"),
                    "notes" if to.kind == "pattern" =>
                        ["deck", "instrument", "pattern", "transformation"].contains(&from.kind.as_str()) && from.id != to.id && roots.insert((&to.id, "root")),
                    "key" | "root" | "scale" =>
                        (from.kind == "deck" || matches!(from.transformation, Some(Transformation::Selector { .. })) || from.kind == "instrument" && w.kind != "scale")
                            && (to.kind == "pattern" || matches!(to.transformation, Some(Transformation::Selector { .. })))
                            && (to.kind != "pattern" || roots.insert((&to.id, if w.kind == "key" { "root" } else { w.kind.as_str() }))),
                    "midi" | "notes" => (["pattern", "instrument", "transformation"].contains(&from.kind.as_str()) || from.kind == "deck" && w.kind == "notes") && ["instrument", "deck", "transformation"].contains(&to.kind.as_str()),
                    _ => false,
                },
                "Connect Note or MIDI through transformations, or scale → scale; each mapping input accepts one cable"
            );
        }
        let paths = signal_paths(self);
        let mut owners = HashSet::new();
        ensure!(
            paths.len() <= 256
                && paths
                    .iter()
                    .all(|(w, _)| w.route.is_some_and(|r| r < 256 && owners.insert(r))),
            "Maximum expanded MIDI route count reached"
        );
        let flattened = paths
            .iter()
            .map(|(w, _)| w.clone())
            .chain(
                self.wires
                    .iter()
                    .filter(|w| ["key", "root"].contains(&w.kind.as_str()))
                    .cloned(),
            )
            .collect::<Vec<_>>();
        ensure!(
            !flattened
                .iter()
                .any(|w| ["root", "key", "notes"].contains(&w.kind.as_str())
                    && self
                        .nodes
                        .iter()
                        .any(|n| n.id == w.from && n.kind == "deck")
                    && flattened
                        .iter()
                        .any(|out| ["midi", "notes"].contains(&out.kind.as_str())
                            && out.from == w.to
                            && self.nodes.iter().any(|target| target.id == out.to
                                && target.kind == "deck"
                                && self.nodes.iter().any(|source| source.id == w.from
                                    && (source.deck == target.deck
                                        || source.deck == Some(2)
                                        || target.deck == Some(2)))))),
            "A deck cannot drive a pattern root while that pattern controls its pitch"
        );
        Ok(())
    }
}
/// Produces one independently owned playback route per MIDI cable. Its old
/// destination remains in the previous plan until every owned note is released.
pub fn deck_index(deck: Option<usize>, active: usize) -> Option<usize> {
    deck.map(|d| if d == 2 { active.min(1) } else { d })
}
pub fn resolve(bank: &Bank, decks: [Option<Harmony>; 2]) -> Bank {
    resolve_active(bank, decks, crate::patterns::active_deck())
}
pub fn resolve_active(bank: &Bank, decks: [Option<Harmony>; 2], active: usize) -> Bank {
    let Some(graph) = &bank.graph else {
        return bank.clone();
    };
    let mut result = bank.clone();
    result.patterns.clear();
    // Each pattern has one independent note-value voice, even without a MIDI destination.
    let mut playback_wires: Vec<_> = signal_paths(graph)
        .into_iter()
        .filter(|(w, _)| ["midi", "cue"].contains(&w.kind.as_str()))
        .collect();
    playback_wires.extend(
        graph
            .nodes
            .iter()
            .filter(|n| {
                n.kind == "pattern"
                    && !bank
                        .patterns
                        .iter()
                        .any(|p| Some(&p.id) == n.pattern.as_ref() && p.kind == "cue")
            })
            .map(|n| {
                (
                    Wire {
                        id: format!("note-source-{}", n.pattern.as_deref().unwrap_or(&n.id)),
                        from: n.id.clone(),
                        to: n.id.clone(),
                        kind: "notes".into(),
                        route: None,
                        input: None,
                    },
                    Vec::new(),
                )
            }),
    );
    let mut selected_paths = signal_paths(graph);
    selected_paths.extend(
        graph
            .wires
            .iter()
            .filter(|w| ["key", "root"].contains(&w.kind.as_str()))
            .map(|w| (w.clone(), Vec::new())),
    );
    for (route, (w, steps)) in playback_wires.iter().enumerate() {
        let Some(source) = graph.nodes.iter().find(|n| n.id == w.from) else {
            continue;
        };
        let Some(target) = graph.nodes.iter().find(|n| n.id == w.to) else {
            continue;
        };
        let Some(p) = bank
            .patterns
            .iter()
            .find(|p| Some(&p.id) == source.pattern.as_ref())
        else {
            continue;
        };
        let mut p = p.clone();
        p.compensation = Some(target.advance_ms);
        p.transformations = steps.clone();
        p.note_source = w.kind == "notes";
        p.owner = Some(p.id.clone());
        p.id = w.id.clone();
        p.route = w.route.unwrap_or(route as u16);
        p.destination = if p.note_source {
            p.output = 0;
            Some(Destination::Midi { output: 0 })
        } else if target.kind == "deck" {
            deck_index(target.deck, active).map(|deck| {
                if w.kind == "cue" {
                    Destination::DeckCue { deck }
                } else {
                    Destination::Deck { deck }
                }
            })
        } else {
            target.destination.clone()
        };
        if !p.note_source && matches!(target.destination, Some(Destination::Midi { .. })) {
            p.channel = target.channel.unwrap_or(p.channel);
        }
        for component in ["root", "scale"] {
            if p.kind != "melodic" {
                continue;
            }
            if let Some(h) = selected_paths
                .iter()
                .map(|(w, _)| w)
                .find(|w| {
                    (w.kind == component
                        || w.kind == "key"
                        || component == "root" && w.kind == "notes")
                        && w.to == source.id
                })
                .and_then(|w| graph.nodes.iter().find(|n| n.id == w.from))
                .and_then(|n| {
                    if n.kind == "deck" {
                        deck_index(n.deck, active).and_then(|d| decks[d])
                    } else {
                        n.harmony
                    }
                })
            {
                if component == "root" {
                    p.key = h.key;
                } else {
                    p.scale = h.scale;
                }
            }
        }
        if let Some(Destination::Midi { output }) = p.destination {
            p.output = output;
        }
        // MIDI's bounded pitch range is a playback constraint; never wrap it.
        p.notes.retain(|n| {
            if p.kind == "percussion" {
                return true;
            }
            let pitch = 12 * (p.octave as i16 + 1 + n.octave as i16)
                + p.key as i16
                + super::patterns::SCALES[p.scale][n.degree as usize - 1];
            (0..=127).contains(&pitch)
        });
        result.patterns.push(p);
    }
    result
}
pub fn migrate(bank: &mut Bank) {
    if let Some(graph) = &mut bank.graph {
        let mut scales = Vec::new();
        for w in &mut graph.wires {
            if w.kind == "key" {
                w.kind = "notes".into();
                let mut scale = w.clone();
                scale.id = format!("{}-scale", w.id);
                scale.kind = "scale".into();
                scales.push(scale);
            }
            if w.kind == "root" {
                w.kind = "notes".into();
            }
        }
        graph.wires.extend(scales);
        for w in &graph.wires {
            if w.kind == "scale" {
                if let Some(source) = graph
                    .nodes
                    .iter()
                    .find(|n| n.id == w.from && n.kind == "instrument")
                {
                    if let (Some(h), Some(target)) =
                        (source.harmony, graph.nodes.iter().find(|n| n.id == w.to))
                    {
                        if let Some(p) = bank
                            .patterns
                            .iter_mut()
                            .find(|p| Some(&p.id) == target.pattern.as_ref())
                        {
                            p.scale = h.scale;
                        }
                    }
                }
            }
        }
        let instruments: HashSet<_> = graph
            .nodes
            .iter()
            .filter(|n| n.kind == "instrument")
            .map(|n| &n.id)
            .collect();
        graph
            .wires
            .retain(|w| !(w.kind == "scale" && instruments.contains(&w.from)));
        return;
    }
    let mut graph = Graph::default();
    for deck in 0..2 {
        graph.nodes.push(Node {
            id: format!("deck-{deck}"),
            kind: "deck".into(),
            label: format!("Deck {}", if deck == 0 { "A" } else { "B" }),
            custom_label: None,
            x: 60.,
            y: 70. + deck as f64 * 200.,
            pattern: None,
            deck: Some(deck),
            destination: None,
            harmony: None,
            input: None,
            channel: None,
            transformation: None,
            advance_ms: 0.0,
        });
    }
    let mut outputs = HashMap::new();
    for (i, p) in bank.patterns.iter_mut().enumerate() {
        let id = format!("pattern-{}", p.id);
        graph.nodes.push(Node {
            id: id.clone(),
            kind: "pattern".into(),
            label: p.name.clone(),
            custom_label: None,
            x: 430. + ((i / 4) % 4) as f64 * 230.,
            y: 70. + (i % 4) as f64 * 200.,
            pattern: Some(p.id.clone()),
            deck: None,
            destination: None,
            harmony: None,
            input: None,
            channel: None,
            transformation: None,
            advance_ms: 0.0,
        });
        if p.output != 0 {
            let index = outputs.len();
            let target = outputs
                .entry(p.output)
                .or_insert_with(|| format!("midi-{}", p.output))
                .clone();
            if !graph.nodes.iter().any(|n| n.id == target) {
                graph.nodes.push(Node {
                    id: target.clone(),
                    kind: "instrument".into(),
                    label: format!("MIDI {}", p.output),
                    custom_label: None,
                    x: 1050.,
                    y: 70. + (index % 5) as f64 * 180.,
                    pattern: None,
                    deck: None,
                    destination: Some(Destination::Midi { output: p.output }),
                    harmony: Some(Harmony { key: 0, scale: 0 }),
                    input: None,
                    channel: None,
                    transformation: None,
                    advance_ms: 0.0,
                });
            }
            graph.wires.push(Wire {
                id: format!("route-{}", p.id),
                from: id,
                to: target,
                kind: "midi".into(),
                route: Some(graph.wires.len() as u16),
                input: None,
            });
        }
        p.output = 0;
    }
    bank.graph = Some(graph);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn bank() -> Bank {
        serde_json::from_value(json!({"patterns":[{"id":"p","name":"Arp","kind":"melodic","mode":"relative","output":42,"channel":2,"bars":2,"grid":4,"key":0,"scale":0,"octave":4,"quantum":4,"compensation":null,"notes":[{"id":"n","beat":0,"duration":4,"degree":3,"octave":0,"velocity":100}]}],"outputCompensation":{}})).unwrap()
    }
    #[test]
    fn cue_patterns_route_only_to_cue_inputs_and_resolve_active_deck() {
        let mut b = bank();
        b.patterns[0].kind = "cue".into();
        b.patterns[0].output = 0;
        migrate(&mut b);
        let graph = b.graph.as_mut().unwrap();
        let deck = graph.nodes.iter_mut().find(|n| n.deck == Some(0)).unwrap();
        deck.deck = Some(2);
        let target = deck.id.clone();
        let from = graph
            .nodes
            .iter()
            .find(|n| n.kind == "pattern")
            .unwrap()
            .id
            .clone();
        graph.wires.push(Wire {
            id: "cue-wire".into(),
            from,
            to: target,
            kind: "cue".into(),
            route: Some(9),
            input: None,
        });
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        for active in 0..2 {
            let resolved = resolve_active(&b, [None; 2], active);
            assert_eq!(resolved.patterns.len(), 1);
            assert_eq!(
                resolved.patterns[0].destination,
                Some(Destination::DeckCue { deck: active })
            );
            assert_eq!(resolved.patterns[0].route, 9);
            assert!(!resolved.patterns[0].note_source);
        }
        b.graph.as_mut().unwrap().wires[0].kind = "midi".into();
        assert!(b.graph.as_ref().unwrap().validate(&b).is_err());
    }
    #[test]
    fn several_patterns_share_one_device_with_independent_routes() {
        let mut b = bank();
        for id in ["q", "r"] {
            let mut p = b.patterns[0].clone();
            p.id = id.into();
            b.patterns.push(p);
        }
        migrate(&mut b);
        let graph = b.graph.as_ref().unwrap();
        graph.validate(&b).unwrap();
        assert_eq!(
            graph
                .nodes
                .iter()
                .filter(|n| n.kind == "instrument")
                .count(),
            1
        );
        let plan = resolve(&b, [None, None]);
        let routes: Vec<_> = plan.patterns.iter().filter(|p| !p.note_source).collect();
        assert_eq!(routes.len(), 3);
        assert_eq!(
            routes.iter().map(|p| p.route).collect::<HashSet<_>>().len(),
            3
        );
        for (p, owner) in routes.iter().zip(["p", "q", "r"]) {
            assert_eq!(p.owner.as_deref(), Some(owner));
            assert_eq!(p.destination, Some(Destination::Midi { output: 42 }));
        }
        b.graph
            .as_mut()
            .unwrap()
            .wires
            .retain(|w| w.from != "pattern-q");
        let after = resolve(&b, [None, None]);
        for p in routes.iter().filter(|p| p.owner.as_deref() != Some("q")) {
            let retained = after.patterns.iter().find(|new| new.id == p.id).unwrap();
            assert_eq!(retained.route, p.route);
            assert_eq!(retained.destination, p.destination);
        }
        assert!(!after
            .patterns
            .iter()
            .any(|p| !p.note_source && p.owner.as_deref() == Some("q")));
    }
    #[test]
    fn octave_and_filter_boundaries_never_wrap_or_include_the_threshold() {
        assert_eq!(
            Transformation::OctaveShift { octaves: -2 }.apply(60),
            Some(36)
        );
        assert_eq!(
            Transformation::OctaveShift { octaves: 0 }.apply(127),
            Some(127)
        );
        assert_eq!(Transformation::OctaveShift { octaves: -1 }.apply(0), None);
        assert_eq!(Transformation::OctaveShift { octaves: 1 }.apply(127), None);
        for (direction, passed, rejected) in [("above", 61, 59), ("below", 59, 61)] {
            let step = Transformation::Filter {
                direction: direction.into(),
                note: 60,
            };
            assert_eq!(step.apply(passed), Some(passed));
            assert_eq!(step.apply(rejected), None);
            assert_eq!(step.apply(60), None);
        }
    }
    fn add_transform(b: &mut Bank, id: &str, step: Transformation) {
        let g = b.graph.as_mut().unwrap();
        let mut node = g.nodes[0].clone();
        node.id = id.into();
        node.kind = "transformation".into();
        node.deck = None;
        node.transformation = Some(step);
        g.nodes.push(node);
    }
    #[test]
    fn selector_routes_only_selected_notes_or_scale_and_empty_input_is_silent() {
        let mut b = bank();
        migrate(&mut b);
        add_transform(
            &mut b,
            "selector",
            Transformation::Selector {
                selected: "A".into(),
                ports: vec!["A".into(), "B".into(), "C".into()],
            },
        );
        let g = b.graph.as_mut().unwrap();
        g.wires.clear();
        for (id, from, to, kind, input, route) in [
            ("a", "deck-0", "selector", "scale", Some("A"), 0),
            ("b", "pattern-p", "selector", "midi", Some("B"), 1),
            ("out", "selector", "midi-42", "midi", None, 2),
            ("scale", "selector", "pattern-p", "scale", None, 3),
        ] {
            g.wires.push(Wire {
                id: id.into(),
                from: from.into(),
                to: to.into(),
                kind: kind.into(),
                input: input.map(str::to_owned),
                route: Some(route),
            });
        }
        // Use the migrated pattern identity, which is independent of its label.
        let pattern = g
            .nodes
            .iter()
            .find(|n| n.kind == "pattern")
            .unwrap()
            .id
            .clone();
        for w in &mut g.wires {
            if w.from == "pattern-p" {
                w.from = pattern.clone();
            }
            if w.to == "pattern-p" {
                w.to = pattern.clone();
            }
        }
        let validation_bank = Bank {
            graph: None,
            ..b.clone()
        };
        let g = b.graph.as_mut().unwrap();
        g.validate(&validation_bank).unwrap();
        let paths = signal_paths(g);
        assert!(paths
            .iter()
            .all(|(w, _)| w.kind == "scale" && w.from == "deck-0"));
        g.nodes
            .iter_mut()
            .find(|n| n.id == "selector")
            .unwrap()
            .transformation = Some(Transformation::Selector {
            selected: "B".into(),
            ports: vec!["A".into(), "B".into(), "C".into()],
        });
        let paths = signal_paths(g);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].0.from, pattern);
        assert_eq!(paths[0].0.kind, "midi");
        g.nodes
            .iter_mut()
            .find(|n| n.id == "selector")
            .unwrap()
            .transformation = Some(Transformation::Selector {
            selected: "C".into(),
            ports: vec!["A".into(), "B".into(), "C".into()],
        });
        assert!(signal_paths(g).is_empty());
    }
    #[test]
    fn transformation_chains_keep_order_owner_timing_and_release_pitch() {
        let mut b = bank();
        migrate(&mut b);
        add_transform(&mut b, "shift", Transformation::OctaveShift { octaves: 1 });
        add_transform(
            &mut b,
            "filter",
            Transformation::Filter {
                direction: "above".into(),
                note: 72,
            },
        );
        let g = b.graph.as_mut().unwrap();
        g.wires[0].to = "shift".into();
        g.wires.push(Wire {
            id: "middle".into(),
            from: "shift".into(),
            to: "filter".into(),
            kind: "midi".into(),
            route: Some(1),
            input: None,
        });
        g.wires.push(Wire {
            id: "end".into(),
            from: "filter".into(),
            to: "midi-42".into(),
            kind: "midi".into(),
            route: Some(2),
            input: None,
        });
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        let paths = signal_paths(b.graph.as_ref().unwrap());
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].0.route, Some(2));
        assert_eq!(transform(64, &paths[0].1), Some(76));
        assert_eq!(transform(60, &paths[0].1), None);
        assert_eq!(transform(120, &paths[0].1), None);
        let plan = resolve(&b, [None, None]);
        let p = plan.patterns.iter().find(|p| !p.note_source).unwrap();
        assert_eq!(p.notes[0].duration, 4.);
        assert_eq!(p.transformations, paths[0].1);
        b.graph.as_mut().unwrap().wires[0].from = "filter".into();
        assert!(b.graph.as_ref().unwrap().validate(&b).is_err());
    }
    #[test]
    fn transformations_merge_sources_with_independent_owners_and_ordered_steps() {
        let mut b = bank();
        migrate(&mut b);
        add_transform(&mut b, "shift", Transformation::OctaveShift { octaves: 1 });
        add_transform(
            &mut b,
            "filter",
            Transformation::Filter {
                direction: "above".into(),
                note: 72,
            },
        );
        let mut second = b.patterns[0].clone();
        second.id = "q".into();
        b.patterns.push(second);
        let g = b.graph.as_mut().unwrap();
        let mut source = g
            .nodes
            .iter()
            .find(|n| n.id == "pattern-p")
            .unwrap()
            .clone();
        source.id = "pattern-q".into();
        source.pattern = Some("q".into());
        g.nodes.push(source);
        g.wires[0].to = "shift".into();
        for (id, from, to, route) in [
            ("second", "pattern-q", "shift", 1),
            ("middle", "shift", "filter", 2),
            ("end", "filter", "midi-42", 3),
        ] {
            g.wires.push(Wire {
                id: id.into(),
                from: from.into(),
                to: to.into(),
                kind: "midi".into(),
                route: Some(route),
                input: None,
            });
        }
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        let paths = signal_paths(b.graph.as_ref().unwrap());
        assert_eq!(paths.len(), 2);
        assert_ne!(paths[0].0.id, paths[1].0.id);
        assert_ne!(paths[0].0.route, paths[1].0.route);
        assert_eq!(paths[0].1, paths[1].1);
        for (_, steps) in &paths {
            assert_eq!(transform(64, steps), Some(76));
            assert_eq!(transform(60, steps), None);
        }
        let plan = resolve(&b, [None, None]);
        assert_eq!(plan.patterns.iter().filter(|p| !p.note_source).count(), 2);
        b.graph.as_mut().unwrap().wires.retain(|w| w.id != "second");
        assert_eq!(signal_paths(b.graph.as_ref().unwrap()).len(), 1);
        // A cycle on the second incoming edge must also be rejected.
        b.graph.as_mut().unwrap().wires.push(Wire {
            id: "cycle".into(),
            from: "filter".into(),
            to: "shift".into(),
            kind: "midi".into(),
            route: Some(4),
            input: None,
        });
        assert!(b
            .graph
            .as_ref()
            .unwrap()
            .validate(&b)
            .unwrap_err()
            .to_string()
            .contains("feedback"));
    }
    #[test]
    fn merged_note_and_midi_paths_fan_out_without_sharing_owners() {
        let mut b = bank();
        migrate(&mut b);
        add_transform(&mut b, "shift", Transformation::OctaveShift { octaves: -1 });
        let g = b.graph.as_mut().unwrap();
        g.wires[0].to = "shift".into();
        for (id, from, to, kind, route) in [
            ("note-in", "deck-0", "shift", "notes", 1),
            ("out", "shift", "midi-42", "midi", 2),
            ("deck-out", "shift", "deck-1", "midi", 3),
        ] {
            g.wires.push(Wire {
                id: id.into(),
                from: from.into(),
                to: to.into(),
                kind: kind.into(),
                route: Some(route),
                input: None,
            });
        }
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        let paths = signal_paths(b.graph.as_ref().unwrap());
        assert_eq!(paths.len(), 4);
        assert_eq!(paths.iter().filter(|(w, _)| w.kind == "notes").count(), 2);
        assert_eq!(
            paths
                .iter()
                .map(|(w, _)| w.route)
                .collect::<HashSet<_>>()
                .len(),
            4
        );
        assert!(paths
            .iter()
            .all(|(_, steps)| transform(60, steps) == Some(48)));
    }
    #[test]
    fn rejects_expanded_paths_over_the_owner_limit() {
        let mut b = bank();
        migrate(&mut b);
        let mut previous = "pattern-p".to_string();
        b.graph.as_mut().unwrap().wires.clear();
        for i in 0..9 {
            let a = format!("a{i}");
            let c = format!("c{i}");
            let join = format!("join{i}");
            for id in [&a, &c, &join] {
                add_transform(&mut b, id, Transformation::OctaveShift { octaves: 0 });
            }
            let g = b.graph.as_mut().unwrap();
            for (from, to) in [(&previous, &a), (&previous, &c), (&a, &join), (&c, &join)] {
                let route = g.wires.len() as u16;
                g.wires.push(Wire {
                    id: format!("wire{route}"),
                    from: from.clone(),
                    to: to.clone(),
                    kind: "midi".into(),
                    route: Some(route),
                    input: None,
                });
            }
            previous = join;
        }
        let g = b.graph.as_mut().unwrap();
        g.wires.push(Wire {
            id: "end".into(),
            from: previous,
            to: "midi-42".into(),
            kind: "midi".into(),
            route: Some(100),
            input: None,
        });
        assert_eq!(signal_paths(g).len(), 257);
        assert!(b
            .graph
            .as_ref()
            .unwrap()
            .validate(&b)
            .unwrap_err()
            .to_string()
            .contains("expanded MIDI route"));
    }
    #[test]
    fn active_deck_maps_harmony_and_destination_without_changing_cable_owner() {
        let mut b = bank();
        migrate(&mut b);
        let graph = b.graph.as_mut().unwrap();
        let node = graph.nodes.iter_mut().find(|n| n.id == "deck-0").unwrap();
        node.deck = Some(2);
        graph.wires.push(Wire {
            id: "root".into(),
            from: "deck-0".into(),
            to: "pattern-p".into(),
            kind: "notes".into(),
            route: None,
            input: None,
        });
        graph.wires.push(Wire {
            id: "scale".into(),
            from: "deck-0".into(),
            to: "pattern-p".into(),
            kind: "scale".into(),
            route: None,
            input: None,
        });
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        let keys = [
            Some(Harmony { key: 0, scale: 0 }),
            Some(Harmony { key: 7, scale: 1 }),
        ];
        let a = resolve_active(&b, keys, 0);
        let c = resolve_active(&b, keys, 1);
        assert_eq!((a.patterns[0].key, a.patterns[0].scale), (0, 0));
        assert_eq!((c.patterns[0].key, c.patterns[0].scale), (7, 1));
        let graph = b.graph.as_mut().unwrap();
        graph.wires.retain(|w| w.kind == "midi");
        graph.wires[0].to = "deck-0".into();
        let a = resolve_active(&b, keys, 0);
        let c = resolve_active(&b, keys, 1);
        assert_eq!(
            a.patterns[0].destination,
            Some(Destination::Deck { deck: 0 })
        );
        assert_eq!(
            c.patterns[0].destination,
            Some(Destination::Deck { deck: 1 })
        );
        assert_eq!(a.patterns[0].route, c.patterns[0].route);
        assert_eq!(a.patterns[0].id, c.patterns[0].id);
        b.graph.as_mut().unwrap().wires.push(Wire {
            id: "feedback".into(),
            from: "deck-1".into(),
            to: "pattern-p".into(),
            kind: "notes".into(),
            route: None,
            input: None,
        });
        assert!(b.graph.as_ref().unwrap().validate(&b).is_err());
    }
    #[test]
    fn removing_canvas_pattern_keeps_definition_and_releases_its_routes() {
        let mut b = bank();
        migrate(&mut b);
        let before = resolve(&b, [None, None]);
        let graph = b.graph.as_mut().unwrap();
        graph.nodes.retain(|n| n.pattern.as_deref() != Some("p"));
        graph
            .wires
            .retain(|w| w.from != "pattern-p" && w.to != "pattern-p");
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        assert_eq!(b.patterns.len(), 1);
        assert_eq!(before.patterns.len(), 2);
        assert!(resolve(&b, [None, None]).patterns.is_empty());
        assert_eq!(
            before.patterns[0].destination,
            Some(Destination::Midi { output: 42 })
        );
    }
    #[test]
    fn root_and_scale_are_independent_and_decks_accept_notes() {
        let mut b = bank();
        migrate(&mut b);
        let g = b.graph.as_mut().unwrap();
        g.wires.push(Wire {
            id: "root".into(),
            from: "deck-0".into(),
            to: "pattern-p".into(),
            kind: "notes".into(),
            route: None,
            input: None,
        });
        g.wires.push(Wire {
            id: "scale".into(),
            from: "deck-1".into(),
            to: "pattern-p".into(),
            kind: "scale".into(),
            route: None,
            input: None,
        });
        g.wires[0].to = "deck-1".into();
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        let p = resolve(
            &b,
            [
                Some(Harmony { key: 7, scale: 1 }),
                Some(Harmony { key: 2, scale: 2 }),
            ],
        )
        .patterns
        .remove(0);
        assert_eq!((p.key, p.scale), (7, 2));
        assert_eq!(p.destination, Some(Destination::Deck { deck: 1 }));
        b.graph
            .as_mut()
            .unwrap()
            .wires
            .retain(|w| w.kind != "notes");
        let p = resolve(&b, [None, Some(Harmony { key: 2, scale: 2 })])
            .patterns
            .remove(0);
        assert_eq!((p.key, p.scale), (0, 2));
    }
    #[test]
    fn note_source_runs_without_midi_and_device_channel_overrides_only_midi() {
        let mut b = bank();
        migrate(&mut b);
        b.graph
            .as_mut()
            .unwrap()
            .nodes
            .iter_mut()
            .find(|n| n.id == "midi-42")
            .unwrap()
            .channel = Some(9);
        let plan = resolve(&b, [None, None]);
        let midi = plan.patterns.iter().find(|p| !p.note_source).unwrap();
        let source = plan.patterns.iter().find(|p| p.note_source).unwrap();
        assert_eq!(midi.channel, 9);
        assert_eq!(source.channel, 2);
        assert_eq!(source.owner.as_deref(), Some("p"));
        b.graph.as_mut().unwrap().wires.clear();
        let plan = resolve(&b, [None, None]);
        assert_eq!(plan.patterns.len(), 1);
        assert!(plan.patterns[0].note_source);
        b.graph
            .as_mut()
            .unwrap()
            .nodes
            .iter_mut()
            .find(|n| n.id == "midi-42")
            .unwrap()
            .channel = Some(17);
        assert!(b.graph.as_ref().unwrap().validate(&b).is_err());
    }
    #[test]
    fn migrates_legacy_root_to_note_cable() {
        let mut b = bank();
        migrate(&mut b);
        b.graph.as_mut().unwrap().wires.push(Wire {
            id: "old-root".into(),
            from: "deck-0".into(),
            to: "pattern-p".into(),
            kind: "root".into(),
            route: None,
            input: None,
        });
        migrate(&mut b);
        let g = b.graph.as_ref().unwrap();
        assert_eq!(
            g.wires.iter().find(|w| w.id == "old-root").unwrap().kind,
            "notes"
        );
        g.validate(&b).unwrap();
        assert_eq!(
            resolve(&b, [Some(Harmony { key: 7, scale: 1 }), None]).patterns[0].key,
            7
        );
    }
    #[test]
    fn splits_legacy_key_wires_without_losing_routes() {
        let mut b = bank();
        migrate(&mut b);
        b.graph.as_mut().unwrap().wires.push(Wire {
            id: "old".into(),
            from: "deck-0".into(),
            to: "pattern-p".into(),
            kind: "key".into(),
            route: None,
            input: None,
        });
        migrate(&mut b);
        migrate(&mut b);
        assert_eq!(b.graph.as_ref().unwrap().wires.len(), 3);
        b.graph.as_ref().unwrap().validate(&b).unwrap();
    }
    #[test]
    fn migration_preserves_output_and_resolves_deck_harmony_without_rewriting_notes() {
        let mut b = bank();
        migrate(&mut b);
        b.graph.as_ref().unwrap().validate(&b).unwrap();
        let graph = b.graph.as_mut().unwrap();
        graph.wires.push(Wire {
            id: "key".into(),
            from: "deck-0".into(),
            to: "pattern-p".into(),
            kind: "key".into(),
            route: None,
            input: None,
        });
        let resolved = resolve(&b, [Some(Harmony { key: 7, scale: 1 }), None]);
        assert_eq!(resolved.patterns.len(), 2);
        let p = &resolved.patterns[0];
        assert_eq!((p.key, p.scale), (7, 1));
        assert_eq!(p.notes[0].degree, 3);
        assert_eq!(p.owner.as_deref(), Some("p"));
        assert_eq!(p.destination, Some(Destination::Midi { output: 42 }));
        assert_eq!(b.patterns[0].key, 0);
    }
    #[test]
    fn disconnected_plan_keeps_old_destination_available_for_release_and_owner_slots_stay_stable() {
        let mut b = bank();
        migrate(&mut b);
        let graph = b.graph.as_mut().unwrap();
        let mut node = graph.nodes.last().unwrap().clone();
        node.id = "second".into();
        node.destination = Some(Destination::Teia { slot: 0 });
        graph.nodes.push(node);
        graph.wires.push(Wire {
            id: "second-route".into(),
            from: "pattern-p".into(),
            to: "second".into(),
            kind: "midi".into(),
            route: Some(15),
            input: None,
        });
        let old = resolve(&b, [None, None]);
        assert_eq!(old.patterns.len(), 3);
        b.graph.as_mut().unwrap().wires.remove(0);
        let new = resolve(&b, [None, None]);
        assert_eq!(new.patterns.len(), 2);
        assert_eq!(new.patterns[0].route, 15);
        assert_eq!(
            old.patterns[0].destination,
            Some(Destination::Midi { output: 42 })
        );
    }
    #[test]
    fn rejects_wrong_ports_multiple_roots_and_duplicate_route_owners() {
        let mut b = bank();
        migrate(&mut b);
        b.graph.as_mut().unwrap().wires.push(Wire {
            id: "bad".into(),
            from: "deck-0".into(),
            to: "midi-42".into(),
            kind: "midi".into(),
            route: Some(9),
            input: None,
        });
        assert!(b.graph.as_ref().unwrap().validate(&b).is_err());
        let g = b.graph.as_mut().unwrap();
        g.wires.pop();
        for deck in 0..2 {
            g.wires.push(Wire {
                id: format!("key-{deck}"),
                from: format!("deck-{deck}"),
                to: "pattern-p".into(),
                kind: "key".into(),
                route: None,
                input: None,
            });
        }
        assert!(b.graph.as_ref().unwrap().validate(&b).is_err());
    }
}
