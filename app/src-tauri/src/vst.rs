//! VST3 discovery, instances and block adapter. Discovery runs in bounded child
//! processes; plugin creation and editors run on the macOS main thread.
use crate::decks::{Frame, PRODUCER_FRAMES};
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use truce_rack_core::buffer::BusRange;
use truce_rack_core::{
    AudioBuffer, BusLayout, EventList, Plugin, PluginCore, PluginInfo, PluginScanner,
    ProcessContext, ProcessStatus,
};
use truce_rack_vst3::{Vst3Plugin, Vst3Scanner};
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bus {
    pub id: String,
    pub label: String,
    pub channels: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Descriptor {
    pub path: PathBuf,
    pub uid: String,
    pub name: String,
    pub inputs: Vec<Bus>,
    pub outputs: Vec<Bus>,
    pub midi_input: bool,
    pub effect: bool,
    pub instrument: bool,
}
impl Descriptor {
    fn info(&self) -> PluginInfo {
        PluginInfo {
            name: self.name.clone(),
            vendor: String::new(),
            version: 0,
            category: truce_rack_core::PluginCategory::Tool,
            path: self.path.clone(),
            unique_id: self.uid.clone(),
            format: "vst3",
            has_editor: false,
            accepts_midi: self.midi_input,
        }
    }
    fn from_plugin(p: &Vst3Plugin) -> Result<Self> {
        let layout = p
            .supported_layouts()
            .first()
            .context("Plugin has no audio layout")?;
        let buses = |b: &[truce_rack_core::bus::Bus], prefix: &str| {
            b.iter()
                .enumerate()
                .map(|(i, b)| Bus {
                    id: format!("{prefix}-{i}"),
                    label: b.name.clone(),
                    channels: b.channels.count(),
                })
                .collect::<Vec<_>>()
        };
        let inputs = buses(&layout.inputs, "in");
        let outputs = buses(&layout.outputs, "out");
        let midi_input = p.info().accepts_midi;
        ensure!(!outputs.is_empty(), "Plugin has no audio outputs");
        Ok(Self {
            path: p.info().path.clone(),
            uid: p.info().unique_id.clone(),
            name: p.info().name.clone(),
            effect: !inputs.is_empty(),
            instrument: midi_input || inputs.is_empty(),
            inputs,
            outputs,
            midi_input,
        })
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            self.path.is_absolute()
                && self.path.extension().is_some_and(|e| e == "vst3")
                && self.uid.len() == 32
                && self.uid.bytes().all(|b| b.is_ascii_hexdigit()),
            "Invalid VST3 identity"
        );
        ensure!(
            self.inputs.len() <= 32
                && !self.outputs.is_empty()
                && self.outputs.len() <= 32
                && self
                    .inputs
                    .iter()
                    .chain(&self.outputs)
                    .all(|b| (1..=32).contains(&b.channels)),
            "Invalid VST3 buses"
        );
        for (prefix, buses) in [("in", &self.inputs), ("out", &self.outputs)] {
            for (i, b) in buses.iter().enumerate() {
                ensure!(b.id == format!("{prefix}-{i}"), "Invalid VST3 port");
            }
        }
        Ok(())
    }
}
#[derive(Clone, Default, Serialize)]
pub struct Catalog {
    pub scanning: bool,
    pub plugins: Vec<Descriptor>,
    pub errors: Vec<String>,
}
static CATALOG: Mutex<Catalog> = Mutex::new(Catalog {
    scanning: false,
    plugins: Vec::new(),
    errors: Vec::new(),
});
static SCAN: Mutex<()> = Mutex::new(());
static INSTANCE_ERRORS: Mutex<Vec<String>> = Mutex::new(Vec::new());
pub fn report_error(error: String) {
    INSTANCE_ERRORS.lock().unwrap().push(error);
}
pub fn catalog() -> Catalog {
    let mut catalog = CATALOG.lock().unwrap().clone();
    catalog
        .errors
        .extend(INSTANCE_ERRORS.lock().unwrap().iter().cloned());
    for (id, instance) in instances().lock().unwrap().iter() {
        if let Ok(instance) = instance.try_lock() {
            if instance.failed {
                catalog.errors.push(format!(
                    "{} ({id}): processing failed; remove and add this instance again",
                    instance.descriptor.name
                ));
            }
        }
    }
    catalog
}
pub fn paths() -> Vec<PathBuf> {
    std::fs::read(crate::paths::support().join("vst-paths.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(truce_rack_vst3::default_vst3_paths)
}
pub fn save_paths(paths: Vec<PathBuf>) -> Result<()> {
    ensure!(
        paths.len() <= 64 && paths.iter().all(|p| p.is_absolute()),
        "Use up to 64 absolute scan folders"
    );
    let mut seen = HashSet::new();
    let paths: Vec<_> = paths
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .collect();
    std::fs::create_dir_all(crate::paths::support())?;
    let path = crate::paths::support().join("vst-paths.json");
    std::fs::write(
        path.with_extension("tmp"),
        serde_json::to_vec_pretty(&paths)?,
    )?;
    std::fs::rename(path.with_extension("tmp"), path)?;
    Ok(())
}
fn bundles(
    root: &Path,
    found: &mut HashSet<PathBuf>,
    seen: &mut HashSet<PathBuf>,
    errors: &mut Vec<String>,
) {
    let path = match root.canonicalize() {
        Ok(p) => p,
        Err(e) => {
            errors.push(format!("{}: {e}", root.display()));
            return;
        }
    };
    if !seen.insert(path.clone()) {
        return;
    }
    if path.extension().is_some_and(|x| x == "vst3") {
        found.insert(path);
        return;
    }
    match std::fs::read_dir(&path) {
        Ok(entries) => {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    bundles(&e.path(), found, seen, errors)
                }
            }
        }
        Err(e) => errors.push(format!("{}: {e}", path.display())),
    }
}
/// Called by the CLI probe, before creating VIRA's engine or service.
pub fn probe(path: &Path) -> Result<Vec<Descriptor>> {
    let entries = Vst3Scanner.scan_path(path)?;
    ensure!(
        !entries.is_empty(),
        "No loadable VST3 classes (check Apple Silicon compatibility)"
    );
    entries
        .iter()
        .map(|info| {
            let plugin = Vst3Scanner.load(info)?;
            Descriptor::from_plugin(&plugin)
        })
        .collect()
}
pub fn scan() {
    let Ok(_scan) = SCAN.try_lock() else { return };
    CATALOG.lock().unwrap().scanning = true;
    let mut result = Catalog::default();
    let mut found = HashSet::new();
    let mut seen = HashSet::new();
    for root in paths() {
        bundles(&root, &mut found, &mut seen, &mut result.errors)
    }
    let mut found: Vec<_> = found.into_iter().collect();
    found.sort();
    for bundle in found {
        let outcome = (|| -> Result<Vec<Descriptor>> {
            let mut child = std::process::Command::new(std::env::current_exe()?)
                .arg("--vst-probe")
                .arg(&bundle)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::null())
                .spawn()?;
            // Drain stdout concurrently so large multi-class bundles cannot fill a pipe.
            use std::io::Read;
            let mut pipe = child.stdout.take().unwrap();
            let reader = std::thread::spawn(move || {
                let mut bytes = Vec::new();
                pipe.by_ref()
                    .take(4 * 1024 * 1024)
                    .read_to_end(&mut bytes)
                    .map(|_| bytes)
            });
            let started = std::time::Instant::now();
            let status = loop {
                if let Some(status) = child.try_wait()? {
                    break status;
                }
                if started.elapsed().as_secs() >= 20 {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    anyhow::bail!("Scan timed out")
                }
                std::thread::sleep(std::time::Duration::from_millis(30));
            };
            let bytes = reader
                .join()
                .map_err(|_| anyhow::anyhow!("Probe reader failed"))??;
            ensure!(
                status.success(),
                "Plugin probe failed or crashed ({status})"
            );
            // A plugin may print to stdout; use the explicit final marker.
            let output = String::from_utf8(bytes)?;
            let line = output
                .lines()
                .rev()
                .find_map(|s| s.strip_prefix("VIRA_VST_PROBE:"))
                .context("Missing probe result")?;
            Ok(serde_json::from_str(line)?)
        })();
        match outcome {
            Ok(mut entries) => result.plugins.append(&mut entries),
            Err(e) => result.errors.push(format!("{}: {e:#}", bundle.display())),
        }
    }
    result
        .plugins
        .sort_by(|a, b| a.name.cmp(&b.name).then(a.uid.cmp(&b.uid)));
    *CATALOG.lock().unwrap() = result;
}

pub struct Instance {
    pub plugin: Vst3Plugin,
    layout: BusLayout,
    midi: crate::teia_midi::Render,
    inputs: Vec<[f32; PRODUCER_FRAMES]>,
    outputs: Vec<[f32; PRODUCER_FRAMES]>,
    in_ranges: Vec<BusRange>,
    out_ranges: Vec<BusRange>,
    pub descriptor: Descriptor,
    failed: bool,
    events: EventList,
}
type Shared = Arc<Mutex<Instance>>;
static INSTANCES: OnceLock<Mutex<HashMap<String, Shared>>> = OnceLock::new();
fn instances() -> &'static Mutex<HashMap<String, Shared>> {
    INSTANCES.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn instance(id: &str) -> Option<Shared> {
    instances().lock().unwrap().get(id).cloned()
}
pub fn save_all() {
    for (id, instance) in instances().lock().unwrap().iter() {
        if let Ok(instance) = instance.lock() {
            if let Err(e) = instance.save(id) {
                eprintln!("VST save {id}: {e:#}");
            }
        }
    }
}
pub fn sync_routing(graph: &crate::routing::Graph) {
    use std::sync::atomic::Ordering::SeqCst;
    for (id, instance) in instances().lock().unwrap().iter() {
        let instance = instance.lock().unwrap();
        let host = &instance.midi.host;
        let active = graph
            .nodes
            .iter()
            .any(|n| n.kind == crate::routing::Kind::Vst && &n.id == id);
        if active && !instance.failed {
            host.muted.store(false, SeqCst);
            host.generation.store(1, SeqCst);
        } else if !host.muted.load(SeqCst) {
            host.mute();
        }
    }
}
pub fn midi_host(id: &str) -> Option<Arc<crate::teia_midi::Host>> {
    instance(id).map(|i| i.lock().unwrap().midi.host.clone())
}
/// Must be called on the UI thread. Instances survive plan replacement and undo.
pub fn prepare(id: &str, descriptor: &Descriptor) -> Result<()> {
    ensure!(
        id.starts_with("vst-")
            && id.len() == 40
            && id[4..].bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'),
        "Invalid VST instance ID"
    );
    descriptor.validate()?;
    if let Some(existing) = instance(id) {
        ensure!(
            existing.lock().unwrap().descriptor == *descriptor,
            "VST instance identity changed"
        );
        return Ok(());
    }
    ensure!(
        instances().lock().unwrap().len() < 128,
        "VST instance limit reached; reopen VIRA"
    );
    let mut plugin = Vst3Scanner.load(&descriptor.info())?;
    let actual = Descriptor::from_plugin(&plugin)?;
    ensure!(
        actual == *descriptor,
        "VST buses changed; remove and add the plugin again"
    );
    let layout = plugin.supported_layouts()[0].clone();
    let state = crate::paths::support()
        .join("vst-state")
        .join(format!("{id}.bin"));
    if let Ok(bytes) = std::fs::read(state) {
        plugin.load_state(&bytes)?
    }
    plugin.activate(
        layout.clone(),
        crate::sample_rate::get() as f64,
        PRODUCER_FRAMES,
    )?;
    let ranges = |buses: &[truce_rack_core::bus::Bus]| {
        let mut offset = 0;
        buses
            .iter()
            .map(|b| {
                let n = b.channels.count() as usize;
                let r = BusRange::new(offset, n);
                offset += n;
                r
            })
            .collect()
    };
    let midi = crate::teia_midi::channel();
    use std::sync::atomic::Ordering::SeqCst;
    midi.host.generation.store(1, SeqCst);
    let instance = Instance {
        inputs: vec![[0.; PRODUCER_FRAMES]; layout.total_input_channels() as usize],
        outputs: vec![[0.; PRODUCER_FRAMES]; layout.total_output_channels() as usize],
        in_ranges: ranges(&layout.inputs),
        out_ranges: ranges(&layout.outputs),
        layout,
        plugin,
        midi,
        descriptor: actual,
        failed: false,
        events: {
            let event = truce_rack_core::Event {
                sample_offset: 0,
                body: truce_rack_core::EventBody::Midi(truce_rack_core::MidiData::NoteOff {
                    channel: 0,
                    note: 0,
                    velocity: 0,
                }),
            };
            let mut events = EventList::from_slice(&[event; 4096]);
            events.clear();
            events
        },
    };
    instances()
        .lock()
        .unwrap()
        .insert(id.into(), Arc::new(Mutex::new(instance)));
    Ok(())
}
impl Instance {
    pub fn save(&self, id: &str) -> Result<()> {
        let dir = crate::paths::support().join("vst-state");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{id}.bin"));
        std::fs::write(path.with_extension("tmp"), self.plugin.save_state()?)?;
        std::fs::rename(path.with_extension("tmp"), path)?;
        Ok(())
    }
    pub fn render(
        &mut self,
        routed: &[[[f32; PRODUCER_FRAMES]; 2]],
        block: &[Frame; PRODUCER_FRAMES],
        output: &mut [[[f32; 2]; 32]; PRODUCER_FRAMES],
    ) {
        if self.failed {
            return;
        }
        let mut offset = 0;
        for (bus, b) in self.layout.inputs.iter().enumerate() {
            for channel in 0..b.channels.count() as usize {
                for i in 0..PRODUCER_FRAMES {
                    self.inputs[offset + channel][i] = if b.channels.count() == 1 {
                        (routed[bus][0][i] + routed[bus][1][i]) * 0.5
                    } else if channel < 2 {
                        routed[bus][channel][i]
                    } else {
                        0.
                    };
                }
            }
            offset += b.channels.count() as usize;
        }
        self.outputs.fill([0.; PRODUCER_FRAMES]);
        use std::sync::atomic::Ordering::SeqCst;
        use truce_rack_core::{Event, EventBody, MidiData};
        let start = block[0].output_frame;
        #[cfg(target_os = "macos")]
        self.midi
            .host
            .anchor(start, unsafe { crate::teia_midi::now_ns() });
        self.midi.prepare_input(self.midi.host.epoch.load(SeqCst));
        self.events.clear();
        if self.midi.host.panic.swap(false, SeqCst) {
            for channel in 0..16 {
                for note in 0..128 {
                    self.events.push(Event {
                        sample_offset: 0,
                        body: EventBody::Midi(MidiData::NoteOff {
                            channel,
                            note,
                            velocity: 0,
                        }),
                    });
                }
            }
        }
        while let Some(e) = self.midi.input_before(start + PRODUCER_FRAMES as u64) {
            use teia_kernel::hosted::EventKind;
            let data = match e.kind {
                EventKind::NoteOn {
                    channel,
                    note,
                    velocity,
                } => MidiData::NoteOn {
                    channel: channel.saturating_sub(1),
                    note,
                    velocity: (velocity.clamp(0., 1.) * 127.).round() as u8,
                },
                EventKind::NoteOff { channel, note } => MidiData::NoteOff {
                    channel: channel.saturating_sub(1),
                    note,
                    velocity: 0,
                },
                _ => continue,
            };
            self.events.push(Event {
                sample_offset: e
                    .frame
                    .saturating_sub(start)
                    .min((PRODUCER_FRAMES - 1) as u64) as u32,
                body: EventBody::Midi(data),
            });
        }
        let input_count = self.inputs.len();
        let output_count = self.outputs.len();
        let mut input_iter = self.inputs.iter();
        let inputs: [&[f32]; 1024] =
            std::array::from_fn(|_| input_iter.next().map_or(&[] as &[f32], |c| c.as_slice()));
        let mut output_iter = self.outputs.iter_mut();
        let mut outputs: [&mut [f32]; 1024] = std::array::from_fn(|_| {
            output_iter
                .next()
                .map_or(&mut [] as &mut [f32], |c| c.as_mut_slice())
        });
        let mut buffer = AudioBuffer::new(
            &inputs[..input_count],
            &mut outputs[..output_count],
            PRODUCER_FRAMES,
            &self.in_ranges,
            &self.out_ranges,
        );
        let mut outbound = EventList::new();
        let frame = &block[0];
        let mut context = ProcessContext {
            sample_rate: crate::sample_rate::get() as f64,
            max_block_size: PRODUCER_FRAMES,
            transport: Some(truce_rack_core::TransportInfo {
                tempo_bpm: frame.master_bpm_set.then_some(frame.master_bpm),
                time_signature: Some((4, 4)),
                song_position_samples: Some(start as i64),
                song_position_beats: Some(frame.global_beat),
                bar_start_beats: Some((frame.global_beat / 4.).floor() * 4.),
                playing: frame.master_running,
                ..Default::default()
            }),
            output_events: &mut outbound,
        };
        if !matches!(
            self.plugin.process(&mut buffer, &self.events, &mut context),
            Ok(ProcessStatus::Continue | ProcessStatus::Sleep | ProcessStatus::Tail { .. })
        ) {
            self.failed = true;
            self.midi.host.mute();
            return;
        }
        let mut offset = 0;
        for (bus, b) in self.layout.outputs.iter().enumerate() {
            for i in 0..PRODUCER_FRAMES {
                for c in 0..2 {
                    let value = self.outputs[offset + c.min(b.channels.count() as usize - 1)][i];
                    output[i][bus][c] = if value.is_finite() { value } else { 0. };
                }
            }
            offset += b.channels.count() as usize;
        }
    }
}

/// Native DSP smoke check; uses installed plugins without changing the session.
pub fn check(path: &Path) -> Result<serde_json::Value> {
    let descriptors = probe(path)?;
    let d = descriptors.first().context("No plugin")?;
    let id = "vst-00000000-0000-0000-0000-000000000000";
    prepare(id, d)?;
    let shared = instance(id).unwrap();
    let mut plugin = shared.lock().unwrap();
    use teia_kernel::hosted::EventKind;
    plugin.midi.host.enqueue(
        0,
        EventKind::NoteOn {
            channel: 1,
            note: 60,
            velocity: 0.8,
        },
    );
    let mut block = [Frame::default(); PRODUCER_FRAMES];
    let mut output = [[[0.; 2]; 32]; PRODUCER_FRAMES];
    let mut routed = vec![[[0.; PRODUCER_FRAMES]; 2]; 32];
    let mut peak = 0f32;
    for index in 0..750 {
        for (i, f) in block.iter_mut().enumerate() {
            f.output_frame = (index * PRODUCER_FRAMES + i) as u64;
            f.global_beat = f.output_frame as f64 / 24000.;
            f.master_bpm = 120.;
            f.master_bpm_set = true;
            f.master_running = true;
            for bus in &mut routed {
                for channel in bus {
                    channel[i] =
                        (f.output_frame as f32 * 440. * std::f32::consts::TAU / 48000.).sin() * 0.1;
                }
            }
        }
        if index == 500 {
            plugin.midi.host.enqueue(
                block[0].output_frame,
                EventKind::NoteOff {
                    channel: 1,
                    note: 60,
                },
            );
        }
        plugin.render(&routed, &block, &mut output);
        for x in output.iter().flatten().flatten() {
            ensure!(x.is_finite(), "Non-finite VST output");
            peak = peak.max(x.abs());
        }
    }
    ensure!(!plugin.failed, "VST processing failed");
    ensure!(peak > 0.00001, "Plugin produced no audible output");
    Ok(
        serde_json::json!({"plugin":d,"peak":peak,"frames":750*PRODUCER_FRAMES,"sample_rate":crate::sample_rate::get(),"passed":true}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn overlapping_scan_roots_find_bundles_once_without_descending_into_them() {
        let root = std::env::temp_dir().join(format!("vira-vst-walk-{}", std::process::id()));
        std::fs::create_dir_all(root.join("nested/Test.vst3/Contents/Hidden.vst3")).unwrap();
        let mut found = HashSet::new();
        let mut seen = HashSet::new();
        let mut errors = Vec::new();
        bundles(&root, &mut found, &mut seen, &mut errors);
        bundles(&root.join("nested"), &mut found, &mut seen, &mut errors);
        assert_eq!(found.len(), 1);
        assert!(errors.is_empty());
        bundles(&root.join("missing"), &mut found, &mut seen, &mut errors);
        assert_eq!(errors.len(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn plugin_bus_ports_roundtrip_and_reject_invalid_topology() {
        let descriptor = Descriptor {
            path: "/Plugins/Hybrid.vst3".into(),
            uid: "a".repeat(32),
            name: "Hybrid".into(),
            inputs: vec![
                Bus {
                    id: "in-0".into(),
                    label: "Main".into(),
                    channels: 2,
                },
                Bus {
                    id: "in-1".into(),
                    label: "Sidechain".into(),
                    channels: 1,
                },
            ],
            outputs: vec![
                Bus {
                    id: "out-0".into(),
                    label: "Main".into(),
                    channels: 2,
                },
                Bus {
                    id: "out-1".into(),
                    label: "Aux".into(),
                    channels: 2,
                },
            ],
            midi_input: true,
            effect: true,
            instrument: true,
        };
        let mut graph = crate::routing::Graph::default();
        let mut node = graph.nodes[0].clone();
        node.id = "vst-00000000-0000-0000-0000-000000000001".into();
        node.kind = crate::routing::Kind::Vst;
        node.deck = None;
        node.vst = Some(descriptor);
        graph.nodes.push(node);
        let id = graph.nodes.last().unwrap().id.clone();
        graph.wires.push(crate::routing::Wire {
            from: "a-player".into(),
            output: "audio".into(),
            to: id.clone(),
            input: "in-1".into(),
            gain: 1.,
        });
        graph.wires.push(crate::routing::Wire {
            from: id,
            output: "out-1".into(),
            to: "master".into(),
            input: "audio".into(),
            gain: 1.,
        });
        assert!(graph.compile().is_ok());
        let restored = crate::routing::Graph::from_saved(
            &serde_json::to_vec(&graph.saved_value().unwrap()).unwrap(),
        )
        .unwrap();
        assert_eq!(graph, restored);
        graph
            .nodes
            .last_mut()
            .unwrap()
            .vst
            .as_mut()
            .unwrap()
            .outputs[1]
            .channels = 33;
        assert!(graph.compile().is_err());
    }
}
