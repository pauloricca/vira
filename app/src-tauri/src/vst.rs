//! VST3 discovery, instances and block adapter. Discovery runs in bounded child
//! processes; plugin creation and editors run on the macOS main thread.
use crate::decks::{Frame, PRODUCER_FRAMES};
use crate::plugin_host::Control;
use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use truce_rack_core::buffer::BusRange;
use truce_rack_core::{
    AudioBuffer, BusLayout, EventList, PluginInfo, PluginScanner, ProcessContext, ProcessStatus,
};
use truce_rack_vst3::Vst3Scanner;
pub static PLAYBACK_CLOCK: crate::teia_midi::PlaybackClock = crate::teia_midi::PlaybackClock::new();
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Bus {
    pub id: String,
    pub label: String,
    pub channels: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Descriptor {
    #[serde(default = "default_format")]
    pub format: String,
    #[serde(default)]
    pub offline_bypass: bool,
    #[serde(default)]
    pub vendor: String,
    #[serde(default)]
    pub midi_output: bool,
    pub path: PathBuf,
    pub uid: String,
    pub name: String,
    pub inputs: Vec<Bus>,
    pub outputs: Vec<Bus>,
    pub midi_input: bool,
    pub effect: bool,
    pub instrument: bool,
}
fn default_format() -> String {
    "vst3".into()
}
impl Descriptor {
    fn info(&self) -> PluginInfo {
        PluginInfo {
            name: self.name.clone(),
            vendor: self.vendor.clone(),
            version: 0,
            category: truce_rack_core::PluginCategory::Tool,
            path: self.path.clone(),
            unique_id: self.uid.clone(),
            format: match self.format.as_str() {
                "clap" => "clap",
                "au" => "au",
                _ => "vst3",
            },
            has_editor: false,
            accepts_midi: self.midi_input,
        }
    }
    fn from_plugin(control: &Control) -> Result<Self> {
        let p = control.plugin();
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
        let midi_output = control.midi_output();
        ensure!(
            !outputs.is_empty() || midi_output,
            "Plugin has no audio or event outputs"
        );
        Ok(Self {
            offline_bypass: false,
            format: p.info().format.into(),
            vendor: p.info().vendor.clone(),
            midi_output,
            path: p.info().path.clone(),
            uid: p.info().unique_id.clone(),
            name: p.info().name.clone(),
            effect: !inputs.is_empty()
                || matches!(
                    p.info().category,
                    truce_rack_core::PluginCategory::Effect
                        | truce_rack_core::PluginCategory::NoteEffect
                        | truce_rack_core::PluginCategory::Analyzer
                ),
            instrument: matches!(
                p.info().category,
                truce_rack_core::PluginCategory::Instrument
            ) || (!outputs.is_empty() && (midi_input || inputs.is_empty())),
            inputs,
            outputs,
            midi_input,
        })
    }
    pub fn validate(&self) -> Result<()> {
        ensure!(
            match self.format.as_str() {
                "vst3" =>
                    self.path.is_absolute()
                        && self.path.extension().is_some_and(|e| e == "vst3")
                        && self.uid.len() == 32
                        && self.uid.bytes().all(|b| b.is_ascii_hexdigit()),
                "clap" =>
                    self.path.is_absolute()
                        && self.path.extension().is_some_and(|e| e == "clap")
                        && !self.uid.is_empty()
                        && self.uid.len() <= 512,
                "au" => self.uid.split(':').count() == 3 && self.uid.len() <= 64,
                _ => false,
            },
            "Invalid plugin identity"
        );
        ensure!(
            self.inputs.len() <= 32
                && (!self.outputs.is_empty() || self.midi_output)
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
#[derive(Clone, Default, Serialize, Deserialize)]
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
    let mut errors = INSTANCE_ERRORS.lock().unwrap();
    if !errors.contains(&error) {
        if errors.len() == 256 {
            errors.remove(0);
        }
        errors.push(error);
    }
}
pub fn catalog() -> Catalog {
    let mut catalog = CATALOG.lock().unwrap().clone();
    catalog
        .errors
        .extend(INSTANCE_ERRORS.lock().unwrap().iter().cloned());
    for (id, instance) in instances().lock().unwrap().iter() {
        if let Ok(instance) = instance.try_lock() {
            if instance.failure.load(std::sync::atomic::Ordering::Acquire) {
                catalog.errors.push(format!(
                    "{} ({id}): processing failed; select the node and use Recover / relink installed plugin",
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
        .unwrap_or_default()
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
    if path.extension().is_some_and(|x| x == "vst3" || x == "clap") {
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
    #[cfg(target_os = "macos")]
    if path.to_string_lossy() == "vira-au-registry" {
        return truce_rack_au::AuScanner
            .scan()?
            .iter()
            .map(|p| {
                Ok(Descriptor {
                    offline_bypass: false,
                    format: "au".into(),
                    vendor: p.vendor.clone(),
                    midi_output: false,
                    path: PathBuf::new(),
                    uid: p.unique_id.clone(),
                    name: p.name.clone(),
                    inputs: Vec::new(),
                    outputs: Vec::new(),
                    midi_input: p.accepts_midi,
                    effect: false,
                    instrument: false,
                })
            })
            .collect();
    }
    #[cfg(target_os = "macos")]
    if let Some(uid) = path.to_string_lossy().strip_prefix("au:") {
        let info = truce_rack_au::AuScanner
            .scan()?
            .into_iter()
            .find(|p| p.unique_id == uid)
            .context("AUv2 is no longer registered")?;
        return Ok(vec![Descriptor::from_plugin(&Control::load(&info)?)?]);
    }
    let entries = if path.extension().is_some_and(|e| e == "clap") {
        truce_rack_clap::ClapScanner.scan_path(path)?
    } else {
        Vst3Scanner.scan_path(path)?
    };
    ensure!(
        !entries.is_empty(),
        "No loadable plugin classes (check Apple Silicon compatibility)"
    );
    entries
        .iter()
        .map(|info| {
            let plugin = Control::load(info)?;
            Descriptor::from_plugin(&plugin)
        })
        .collect()
}
#[derive(Clone, Serialize, Deserialize)]
struct CacheEntry {
    fingerprint: String,
    plugins: Vec<Descriptor>,
    error: Option<String>,
}
#[derive(Default, Serialize, Deserialize)]
struct ScanCache {
    version: u32,
    entries: HashMap<PathBuf, CacheEntry>,
}
fn cache_path() -> PathBuf {
    crate::paths::support().join("plugin-cache-v2.json")
}
/// Content inventory catches changed bundle executables/resources without loading code.
fn fingerprint(path: &Path) -> String {
    use sha2::{Digest, Sha256};
    fn visit(path: &Path, hash: &mut Sha256, seen: &mut HashSet<PathBuf>) {
        let Ok(path) = path.canonicalize() else {
            return;
        };
        if !seen.insert(path.clone()) {
            return;
        }
        if let Ok(m) = std::fs::metadata(&path) {
            hash.update(path.to_string_lossy().as_bytes());
            hash.update(m.len().to_le_bytes());
            hash.update(
                m.modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos())
                    .unwrap_or(0)
                    .to_le_bytes(),
            );
            if m.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&path) {
                    let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                    paths.sort();
                    for p in paths {
                        visit(&p, hash, seen)
                    }
                }
            }
        }
    }
    let mut hash = Sha256::new();
    visit(path, &mut hash, &mut HashSet::new());
    format!("{:x}", hash.finalize())
}
fn isolated_probe(path: &Path) -> Result<Vec<Descriptor>> {
    use std::io::Read;
    let mut command = std::process::Command::new(std::env::current_exe()?);
    command
        .arg("--vst-probe")
        .arg(path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn()?;
    let mut pipe = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let r = pipe
            .by_ref()
            .take(4 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = tx.send(r);
    });
    let started = std::time::Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed().as_secs() >= 20 {
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            let _ = child.wait();
            anyhow::bail!("Scan timed out; quarantined until Retry failed scans");
        }
        std::thread::sleep(std::time::Duration::from_millis(30));
    };
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    ensure!(
        status.success(),
        "Plugin probe failed or crashed ({status}); quarantined until Retry failed scans"
    );
    let bytes = rx
        .recv_timeout(std::time::Duration::from_secs(1))
        .context("Probe output timed out")??;
    let output = String::from_utf8(bytes)?;
    let line = output
        .lines()
        .rev()
        .find_map(|s| s.strip_prefix("VIRA_VST_PROBE:"))
        .context("Missing probe result")?;
    Ok(serde_json::from_str(line)?)
}
pub fn scan() {
    scan_with_retry(false);
}
pub fn default_paths() -> Vec<PathBuf> {
    let mut paths = truce_rack_vst3::default_vst3_paths();
    paths.extend(truce_rack_clap::default_clap_paths());
    paths
}
pub fn scan_with_retry(retry: bool) {
    let Ok(_scan) = SCAN.try_lock() else { return };
    let mut cache: ScanCache = std::fs::read(cache_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .filter(|c: &ScanCache| c.version == 2)
        .unwrap_or_default();
    cache.version = 2;
    {
        let mut current = CATALOG.lock().unwrap();
        current.scanning = true;
        if current.plugins.is_empty() {
            current.plugins = cache
                .entries
                .values()
                .flat_map(|e| e.plugins.clone())
                .collect();
        }
    }
    let mut result = Catalog::default();
    let mut found = HashSet::new();
    let mut seen = HashSet::new();
    for root in default_paths() {
        if root.exists() {
            bundles(&root, &mut found, &mut seen, &mut result.errors)
        }
    }
    for root in paths() {
        bundles(&root, &mut found, &mut seen, &mut result.errors)
    }
    let mut work: Vec<_> = found
        .into_iter()
        .map(|p| {
            let f = fingerprint(&p);
            (p, f)
        })
        .collect();
    work.sort();
    #[cfg(target_os = "macos")]
    match isolated_probe(Path::new("vira-au-registry")) {
        Ok(entries) => {
            // AU registry IDs are stable; changes to installed component bundles invalidate their metadata.
            let mut roots = vec![
                PathBuf::from("/System/Library/Components"),
                PathBuf::from("/Library/Audio/Plug-Ins/Components"),
            ];
            if let Some(home) = std::env::var_os("HOME") {
                roots.push(PathBuf::from(home).join("Library/Audio/Plug-Ins/Components"));
            }
            roots.extend(paths());
            let stamp = roots
                .iter()
                .map(|p| fingerprint(p))
                .collect::<Vec<_>>()
                .join(":");
            work.extend(
                entries
                    .into_iter()
                    .map(|p| (PathBuf::from(format!("au:{}", p.uid)), stamp.clone())),
            );
        }
        Err(e) => result.errors.push(format!("AU registry: {e:#}")),
    }
    let mut next = HashMap::new();
    for (path, stamp) in work {
        let cached = cache
            .entries
            .remove(&path)
            .filter(|e| e.fingerprint == stamp && (!retry || e.error.is_none()));
        let entry = cached.unwrap_or_else(|| match isolated_probe(&path) {
            Ok(plugins) => CacheEntry {
                fingerprint: stamp,
                plugins,
                error: None,
            },
            Err(e) => CacheEntry {
                fingerprint: stamp,
                plugins: Vec::new(),
                error: Some(format!("{}: {e:#}", path.display())),
            },
        });
        result.plugins.extend(entry.plugins.clone());
        if let Some(e) = &entry.error {
            result.errors.push(e.clone());
        }
        next.insert(path, entry);
    }
    // Collapse duplicate installations within a format; retain explicit format variants.
    result.plugins.sort_by(|a, b| {
        a.name
            .cmp(&b.name)
            .then(a.format.cmp(&b.format))
            .then(a.path.cmp(&b.path))
    });
    let mut ids = HashSet::new();
    result
        .plugins
        .retain(|p| ids.insert((p.format.clone(), p.uid.clone())));
    cache.entries = next;
    if let Err(e) = (|| -> Result<()> {
        let path = cache_path();
        std::fs::create_dir_all(path.parent().unwrap())?;
        std::fs::write(path.with_extension("tmp"), serde_json::to_vec(&cache)?)?;
        std::fs::rename(path.with_extension("tmp"), path)?;
        Ok(())
    })() {
        result.errors.push(format!("Scan cache: {e:#}"));
    }
    *CATALOG.lock().unwrap() = result;
}

fn preallocated_events() -> EventList {
    let e = truce_rack_core::Event {
        sample_offset: 0,
        body: truce_rack_core::EventBody::Midi(truce_rack_core::MidiData::NoteOff {
            channel: 0,
            note: 0,
            velocity: 0,
        }),
    };
    let mut list = EventList::from_slice(&[e; 4096]);
    list.clear();
    list
}
#[derive(Clone, Copy)]
pub struct MidiPacket {
    pub frame: u64,
    pub epoch: u64,
    pub data: [u8; 8],
    pub len: usize,
}
fn midi_bytes(body: truce_rack_core::MidiData) -> Option<([u8; 8], usize)> {
    use truce_rack_core::MidiData::*;
    let (status, a, b, len) = match body {
        NoteOn {
            channel,
            note,
            velocity,
        } => (0x90 | (channel & 15), note, velocity, 3),
        NoteOff {
            channel,
            note,
            velocity,
        } => (0x80 | (channel & 15), note, velocity, 3),
        ControlChange {
            channel,
            controller,
            value,
        } => (0xb0 | (channel & 15), controller, value, 3),
        PitchBend { channel, value } => (
            0xe0 | (channel & 15),
            (value & 127) as u8,
            ((value >> 7) & 127) as u8,
            3,
        ),
        PolyAftertouch {
            channel,
            note,
            pressure,
        } => (0xa0 | (channel & 15), note, pressure, 3),
        ChannelAftertouch { channel, pressure } => (0xd0 | (channel & 15), pressure, 0, 2),
        ProgramChange { channel, program } => (0xc0 | (channel & 15), program, 0, 2),
        Raw { len, data } => return (len > 0 && len <= 8).then_some((data, len as usize)),
    };
    if a > 127 || b > 127 {
        return None;
    }
    Some(([status, a, b, 0, 0, 0, 0, 0], len))
}
pub struct Instance {
    plugin: crate::plugin_host::Audio,
    layout: BusLayout,
    midi: crate::teia_midi::Render,
    inputs: Vec<[f32; PRODUCER_FRAMES]>,
    outputs: Vec<[f32; PRODUCER_FRAMES]>,
    in_ranges: Vec<BusRange>,
    out_ranges: Vec<BusRange>,
    pub descriptor: Descriptor,
    pub failed: bool,
    failure: Arc<std::sync::atomic::AtomicBool>,
    events: EventList,
    outbound: EventList,
    output: rtrb::Producer<MidiPacket>,
    overflow: Arc<std::sync::atomic::AtomicBool>,
}
pub struct ControlInstance {
    pub audio: Arc<Mutex<Instance>>,
    pub plugin: Control,
    pub descriptor: Descriptor,
    pub host: Arc<crate::teia_midi::Host>,
    pub latency: u32,
    generation: u64,

    failure: Arc<std::sync::atomic::AtomicBool>,
}
#[derive(Clone)]
struct Endpoint {
    host: Arc<crate::teia_midi::Host>,
    output: Arc<Mutex<rtrb::Consumer<MidiPacket>>>,
    overflow: Arc<std::sync::atomic::AtomicBool>,
}
static ENDPOINTS: OnceLock<Mutex<HashMap<String, Endpoint>>> = OnceLock::new();
fn endpoints() -> &'static Mutex<HashMap<String, Endpoint>> {
    ENDPOINTS.get_or_init(|| Mutex::new(HashMap::new()))
}
pub static SESSION_SAVE: Mutex<()> = Mutex::new(());
type Shared = Arc<Mutex<ControlInstance>>;
static INSTANCES: OnceLock<Mutex<HashMap<String, Shared>>> = OnceLock::new();
static GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static RETIRED: Mutex<Vec<Shared>> = Mutex::new(Vec::new());
fn instances() -> &'static Mutex<HashMap<String, Shared>> {
    INSTANCES.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn instance(id: &str) -> Option<Shared> {
    instances().lock().unwrap().get(id).cloned()
}
pub fn audio_instance(id: &str) -> Option<Arc<Mutex<Instance>>> {
    instance(id).map(|i| i.lock().unwrap().audio.clone())
}
pub fn service() -> Vec<(String, (u32, u32))> {
    RETIRED
        .lock()
        .unwrap()
        .retain(|i| Arc::strong_count(i) > 1 || Arc::strong_count(&i.lock().unwrap().audio) > 1);
    let mut resized = Vec::new();
    for (id, shared) in instances().lock().unwrap().iter() {
        let mut i = shared.lock().unwrap();
        if let Some(size) = i.plugin.service() {
            resized.push((id.clone(), size));
        }
    }
    resized
}
pub fn refresh_latencies() -> bool {
    let mut changed = false;
    for shared in instances().lock().unwrap().values() {
        let mut i = shared.lock().unwrap();
        let n = i.plugin.latency_samples();
        if i.latency != n {
            i.latency = n;
            changed = true;
        }
    }
    changed
}
pub fn take_output(id: &str) -> Option<(Arc<crate::teia_midi::Host>, Result<Vec<MidiPacket>, ()>)> {
    let i = endpoints().lock().unwrap().get(id).cloned()?;
    let mut queue = i.output.lock().unwrap();
    let packets = (0..4096).map_while(|_| queue.pop().ok()).collect();
    Some((
        i.host.clone(),
        if i.overflow.swap(false, std::sync::atomic::Ordering::AcqRel) {
            Err(())
        } else {
            Ok(packets)
        },
    ))
}
pub fn latency(id: &str) -> u32 {
    instance(id).map(|i| i.lock().unwrap().latency).unwrap_or(0)
}
#[derive(Clone, Serialize, Deserialize)]
pub struct StateBlob {
    format: String,
    uid: String,
    bytes: Vec<u8>,
}
static STATES: OnceLock<Mutex<HashMap<String, StateBlob>>> = OnceLock::new();
fn states() -> &'static Mutex<HashMap<String, StateBlob>> {
    STATES.get_or_init(|| Mutex::new(HashMap::new()))
}
pub fn restore_states(bytes: &[u8]) {
    if let Ok(value) = serde_json::from_slice::<serde_json::Value>(bytes) {
        if let Ok(saved) =
            serde_json::from_value::<HashMap<String, StateBlob>>(value["plugin_states"].clone())
        {
            *states().lock().unwrap() = saved;
        }
    }
}
pub fn snapshot(graph: &crate::routing::Graph) -> Result<()> {
    for node in &graph.nodes {
        if let Some(instance) = instance(&node.id) {
            instance.lock().unwrap().save(&node.id)?;
        }
    }
    Ok(())
}
pub fn with_states(mut value: serde_json::Value) -> Result<serde_json::Value> {
    let saved = states().lock().unwrap();
    let mut blobs = HashMap::new();
    if let Some(nodes) = value["nodes"].as_array() {
        for node in nodes {
            if let Some(id) = node["id"].as_str() {
                if let Some(state) = saved.get(id) {
                    blobs.insert(id.to_owned(), state.clone());
                }
            }
        }
    }
    value["plugin_state_version"] = 1.into();
    value["plugin_states"] = serde_json::to_value(blobs)?;
    Ok(value)
}
fn checkpoint() -> Result<()> {
    let _write = SESSION_SAVE.lock().unwrap();
    let path = crate::teia::Host::default_root().join(".vira-routing.json");
    if let Ok(bytes) = std::fs::read(&path) {
        let value = with_states(serde_json::from_slice(&bytes)?)?;
        std::fs::write(path.with_extension("tmp"), serde_json::to_vec(&value)?)?;
        std::fs::rename(path.with_extension("tmp"), path)?;
    }
    Ok(())
}
pub fn save_all() {
    for (id, instance) in instances().lock().unwrap().iter() {
        if let Err(e) = instance.lock().unwrap().save(id) {
            report_error(format!("Plugin save {id}: {e:#}"));
        }
    }
    if let Err(e) = checkpoint() {
        report_error(format!("Session checkpoint: {e:#}"));
    }
}
/// Main-thread reclamation after plans and editor windows have released references.
/// State files survive eviction so undo can instantiate the same identity again.
pub fn retain(ids: &HashSet<String>) {
    instances().lock().unwrap().retain(|id, value| {
        if ids.contains(id) || Arc::strong_count(value) > 1 {
            return true;
        }
        let i = value.lock().unwrap();
        if Arc::strong_count(&i.audio) > 1 {
            return true;
        }
        if let Err(e) = i.save(id) {
            report_error(format!("Plugin save {id}: {e:#}"));
            return true;
        }
        endpoints().lock().unwrap().remove(id);
        states().lock().unwrap().remove(id);
        false
    });
}
pub fn sync_routing(graph: &crate::routing::Graph) {
    use std::sync::atomic::Ordering::SeqCst;
    for (id, instance) in instances().lock().unwrap().iter() {
        let instance = instance.lock().unwrap();
        let host = &instance.host;
        let active = graph
            .nodes
            .iter()
            .any(|n| n.kind == crate::routing::Kind::Vst && &n.id == id);
        if active && !instance.failure.load(SeqCst) {
            host.muted.store(false, SeqCst);
            host.generation.store(instance.generation, SeqCst);
        } else if !host.muted.load(SeqCst) {
            host.mute();
        }
    }
}
pub fn midi_host(id: &str) -> Option<Arc<crate::teia_midi::Host>> {
    endpoints().lock().unwrap().get(id).map(|i| i.host.clone())
}
impl ControlInstance {
    pub fn save(&self, id: &str) -> Result<()> {
        let dir = crate::paths::support().join("vst-state");
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{id}.bin"));
        let bytes = self.plugin.plugin().save_state()?;
        std::fs::write(path.with_extension("tmp"), &bytes)?;
        std::fs::rename(path.with_extension("tmp"), &path)?;
        states().lock().unwrap().insert(
            id.into(),
            StateBlob {
                format: self.descriptor.format.clone(),
                uid: self.descriptor.uid.clone(),
                bytes,
            },
        );
        Ok(())
    }
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
        let guard = existing.lock().unwrap();
        ensure!(
            guard.descriptor.format == descriptor.format
                && guard.descriptor.uid == descriptor.uid
                && guard.descriptor.inputs == descriptor.inputs
                && guard.descriptor.outputs == descriptor.outputs,
            "Plugin identity or buses changed"
        );
        if !guard.failure.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(());
        }
        let _ = guard.save(id);
        guard.host.mute();
        drop(guard);
        if let Some(old) = instances().lock().unwrap().remove(id) {
            RETIRED.lock().unwrap().push(old);
        }
    }
    ensure!(
        instances().lock().unwrap().len() < 128,
        "Active plugin instance limit reached (128)"
    );
    let mut resolved = descriptor.clone();
    if !descriptor.path.exists() || descriptor.format == "au" {
        if let Some(found) = catalog()
            .plugins
            .into_iter()
            .find(|p| p.format == descriptor.format && p.uid == descriptor.uid)
        {
            resolved.path = found.path;
        }
    }
    let mut plugin = Control::load(&resolved.info())?;
    let actual = Descriptor::from_plugin(&plugin)?;
    ensure!(
        actual.uid == descriptor.uid
            && actual.format == descriptor.format
            && actual.inputs == descriptor.inputs
            && actual.outputs == descriptor.outputs,
        "Plugin buses changed; relink to a compatible plugin"
    );
    let layout = plugin.plugin().supported_layouts()[0].clone();
    let state = crate::paths::support()
        .join("vst-state")
        .join(format!("{id}.bin"));
    let saved = states()
        .lock()
        .unwrap()
        .get(id)
        .filter(|s| s.format == descriptor.format && s.uid == descriptor.uid)
        .map(|s| s.bytes.clone());
    if let Some(bytes) = saved.or_else(|| std::fs::read(state).ok()) {
        plugin.plugin_mut().load_state(&bytes)?;
    }
    plugin.plugin_mut().activate(
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
    let midi = crate::teia_midi::channel_with_clock(Some(&PLAYBACK_CLOCK));
    use std::sync::atomic::Ordering::SeqCst;
    let generation = GENERATION.fetch_add(1, SeqCst);
    midi.host.generation.store(generation, SeqCst);
    let host = midi.host.clone();
    let latency = plugin.latency_samples();
    let processor = plugin.split_processor();
    let failure = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let (output, consumer) = rtrb::RingBuffer::new(4096);
    let overflow = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let instance = Instance {
        output,
        overflow: overflow.clone(),
        inputs: vec![[0.; PRODUCER_FRAMES]; layout.total_input_channels() as usize],
        outputs: vec![[0.; PRODUCER_FRAMES]; layout.total_output_channels() as usize],
        in_ranges: ranges(&layout.inputs),
        out_ranges: ranges(&layout.outputs),
        layout,
        plugin: processor,
        midi,
        descriptor: actual,
        failed: false,
        failure: failure.clone(),
        outbound: preallocated_events(),
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
    endpoints().lock().unwrap().insert(
        id.into(),
        Endpoint {
            host: host.clone(),
            output: Arc::new(Mutex::new(consumer)),
            overflow,
        },
    );
    instances().lock().unwrap().insert(
        id.into(),
        Arc::new(Mutex::new(ControlInstance {
            plugin,
            descriptor: descriptor.clone(),
            audio: Arc::new(Mutex::new(instance)),
            host,
            latency,
            generation,
            failure,
        })),
    );
    Ok(())
}
impl Instance {
    pub fn stop(&mut self) {
        self.plugin.stop();
        self.midi.host.mute();
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
                EventKind::ControlChange {
                    channel,
                    controller,
                    value,
                } => MidiData::ControlChange {
                    channel: channel.saturating_sub(1),
                    controller,
                    value: (value.clamp(0., 1.) * 127.).round() as u8,
                },
                EventKind::PitchBend { channel, value, .. } => MidiData::PitchBend {
                    channel: channel.saturating_sub(1),
                    value,
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
        self.outbound.clear();
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
            output_events: &mut self.outbound,
        };
        if !matches!(
            self.plugin.process(&mut buffer, &self.events, &mut context),
            Ok(ProcessStatus::Continue | ProcessStatus::Sleep | ProcessStatus::Tail { .. })
        ) {
            self.failed = true;
            self.failure.store(true, SeqCst);
            self.midi.host.mute();
            return;
        }
        for e in self.outbound.iter().take(4096) {
            let EventBody::Midi(body) = e.body else {
                continue;
            };
            let Some((data, len)) = midi_bytes(body) else {
                continue;
            };
            if e.sample_offset >= PRODUCER_FRAMES as u32 {
                continue;
            }
            if self
                .output
                .push(MidiPacket {
                    frame: start + e.sample_offset as u64,
                    epoch: self.midi.host.epoch.load(SeqCst),
                    data,
                    len,
                })
                .is_err()
            {
                self.overflow.store(true, SeqCst);
                self.midi.host.output_drops.fetch_add(1, SeqCst);
            }
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
    let shared = audio_instance(id).unwrap();
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
    drop(plugin);
    let control = instance(id).unwrap();
    let parameter = {
        let mut c = control.lock().unwrap();
        let p = c.plugin.plugin_mut();
        let index = (0..p.parameter_count()).find(|&n| {
            p.parameter_info(n)
                .map(|i| {
                    i.max > i.min
                        && !i
                            .flags
                            .contains(truce_rack_core::info::ParameterFlags::READ_ONLY)
                })
                .unwrap_or(false)
        });
        if let Some(index) = index {
            let info = p.parameter_info(index)?;
            let current = p.parameter_value(index)?;
            let value = if current < (info.min + info.max) * 0.5 {
                info.max
            } else {
                info.min
            };
            p.set_parameter(index, value)?;
            Some((index, info))
        } else {
            None
        }
    };
    if parameter.is_some() {
        let mut audio = shared.lock().unwrap();
        audio.render(&routed, &block, &mut output);
    }
    let expected = parameter
        .as_ref()
        .map(|(index, _)| {
            control
                .lock()
                .unwrap()
                .plugin
                .plugin()
                .parameter_value(*index)
        })
        .transpose()?;
    let state = control.lock().unwrap().plugin.plugin().save_state()?;
    let mut restored = Control::load(&d.info())?;
    restored.plugin_mut().load_state(&state)?;
    let restored_layout = restored.plugin().supported_layouts()[0].clone();
    restored.plugin_mut().activate(
        restored_layout,
        crate::sample_rate::get() as f64,
        PRODUCER_FRAMES,
    )?;
    if let (Some((index, info)), Some(expected)) = (&parameter, expected) {
        let actual = restored.plugin().parameter_value(*index)?;
        ensure!(
            (actual - expected).abs() <= (info.max - info.min).abs() * 0.00001 + 1e-6,
            "Native state did not restore parameter {}: {expected} -> {actual}",
            info.name
        );
    }

    // Hold the UI/control lock deliberately while the worker processes. The audio
    // handle must continue advancing without needing that lock.
    let progress = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let observed = progress.clone();
    let worker = std::thread::spawn(move || {
        let mut audio = shared.lock().unwrap();
        for i in 0..128 {
            audio.render(&routed, &block, &mut output);
            observed.store(i + 1, std::sync::atomic::Ordering::Release);
        }
        !audio.failed
    });
    let guard = control.lock().unwrap();
    for _ in 0..16 {
        let _ = guard.plugin.plugin().save_state()?;
    }
    let concurrent_blocks = progress.load(std::sync::atomic::Ordering::Acquire);
    drop(guard);
    ensure!(
        worker.join().unwrap_or(false),
        "Audio failed during concurrent state capture"
    );
    Ok(
        serde_json::json!({"plugin":d,"peak":peak,"frames":750*PRODUCER_FRAMES,"sample_rate":crate::sample_rate::get(),"passed":true,"state_roundtrip_bytes":state.len(),"concurrent_blocks_during_state_capture":concurrent_blocks}),
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn scan_fingerprint_tracks_nested_resources_and_cache_keeps_quarantine() {
        let root = std::env::temp_dir().join(format!("vira-plugin-cache-{}", std::process::id()));
        std::fs::create_dir_all(root.join("Synth.clap/Contents")).unwrap();
        let file = root.join("Synth.clap/Contents/data");
        std::fs::write(&file, b"v1").unwrap();
        let first = super::fingerprint(&root);
        assert_eq!(first, super::fingerprint(&root));
        std::fs::write(&file, b"v2-changed").unwrap();
        assert_ne!(first, super::fingerprint(&root));
        let entry = super::CacheEntry {
            fingerprint: first,
            plugins: Vec::new(),
            error: Some("Crash quarantined".into()),
        };
        let cache = super::ScanCache {
            version: 2,
            entries: [(root.clone(), entry)].into_iter().collect(),
        };
        let decoded: super::ScanCache =
            serde_json::from_slice(&serde_json::to_vec(&cache).unwrap()).unwrap();
        assert_eq!(
            decoded.entries[&root].error.as_deref(),
            Some("Crash quarantined")
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn plugin_output_preserves_channel_voice_messages() {
        use truce_rack_core::MidiData;
        assert_eq!(
            super::midi_bytes(MidiData::PitchBend {
                channel: 2,
                value: 8192
            }),
            Some(([0xe2, 0, 64, 0, 0, 0, 0, 0], 3))
        );
        assert_eq!(
            super::midi_bytes(MidiData::ProgramChange {
                channel: 0,
                program: 23
            }),
            Some(([0xc0, 23, 0, 0, 0, 0, 0, 0], 2))
        );
        assert!(super::midi_bytes(MidiData::Raw {
            len: 9,
            data: [0; 8]
        })
        .is_none());
    }

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
            offline_bypass: false,
            format: "vst3".into(),
            vendor: String::new(),
            midi_output: false,
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
