//! Host-owned patch files, working drafts, native preparation and editor sessions.
use crate::teia_audio::{self, Ack, Action, Command, Live, Status, Telemetry};
use anyhow::{bail, ensure, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering::SeqCst},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use teia_kernel::hosted::{ControlEvent, Instance, Operation, PreparedProgram};
const MAX_JSON: usize = 4 * 1024 * 1024;
const SNAPSHOT_MANIFEST: &str = include_str!("../../vendor/teia-hosted/dist/compatibility.json");
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parameter {
    pub id: String,
    pub name: String,
    pub default_value: f64,
    pub min: f64,
    pub max: f64,
    pub step: Option<f64>,
    pub integer: Option<bool>,
    pub binding: Binding,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    pub value_index: usize,
    pub layout: String,
}
impl Parameter {
    fn normalize(&self, value: f64) -> Result<f64> {
        ensure!(
            value.is_finite()
                && self.min.is_finite()
                && self.max.is_finite()
                && self.min <= self.max,
            "Invalid parameter bounds/value"
        );
        let mut value = value.clamp(self.min, self.max);
        if self.integer == Some(true) {
            value = value.round();
        } else if let Some(step) = self.step {
            ensure!(step.is_finite() && step > 0., "Invalid parameter step");
            value = self.min + ((value - self.min) / step).round() * step;
        }
        Ok(value.clamp(self.min, self.max))
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Prepared {
    pub profile: String,
    pub layout: String,
    pub parameters: Vec<Parameter>,
    pub program: Program,
    pub diagnostics: Vec<Value>,
    #[serde(default)]
    pub requirements: Value,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Program {
    pub version: u32,
    pub ops: Vec<WireOp>,
    pub values: Vec<f64>,
    #[serde(flatten)]
    pub metadata: BTreeMap<String, Value>,
}
fn absent() -> i32 {
    -1
}
#[derive(Clone, Deserialize, Serialize)]
pub struct WireOp {
    pub opcode: i32,
    #[serde(default = "absent")]
    pub out: i32,
    #[serde(default = "absent")]
    pub a: i32,
    #[serde(default = "absent")]
    pub b: i32,
    #[serde(default = "absent")]
    pub c: i32,
    #[serde(default = "absent")]
    pub d: i32,
    #[serde(default = "absent")]
    pub e: i32,
    #[serde(default = "absent")]
    pub state: i32,
    #[serde(default)]
    pub value: f64,
    #[serde(default)]
    pub value2: f64,
    #[serde(default)]
    pub value3: f64,
    #[serde(default)]
    pub value4: f64,
}
impl WireOp {
    fn operation(&self) -> Operation {
        Operation {
            opcode: self.opcode,
            out: self.out,
            a: self.a,
            b: self.b,
            c: self.c,
            d: self.d,
            e: self.e,
            state: self.state,
            value: self.value,
            value2: self.value2,
            value3: self.value3,
            value4: self.value4,
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Record {
    pub name: String,
    pub saved_hash: String,
    pub saved_document: Value,
    pub document: Value,
    pub installed_document: Value,
    pub prepared: Prepared,
    pub overrides: BTreeMap<String, f64>,
    pub bypass: bool,
    #[serde(default)]
    pub passthrough: bool,
    #[serde(default)]
    pub clock_running: bool,
    #[serde(default)]
    pub runtime_snapshots: Value,
}
#[derive(Default)]
struct State {
    record: Option<Record>,
    generation: u64,
    installed_revision: u64,
    working_revision: u64,
}
pub struct Host {
    pub(crate) bridge: crate::teia_bridge::Bridge,
    pub facilities: Arc<crate::teia_facilities::Host>,
    pub midi: Arc<crate::teia_midi::Host>,
    root: PathBuf,
    session_file: String,
    slot: usize,
    midi_started: AtomicBool,
    state: Mutex<State>,
    ports: Mutex<teia_audio::Ports>,
    transaction: Mutex<()>,
    pub telemetry: Arc<Telemetry>,
    automatic_resets: AtomicU64,
    sequence: AtomicU64,
    epoch: AtomicU64,
    session: Mutex<Option<String>>,
    restore_error: Mutex<Option<String>>,
}
impl Host {
    pub fn new(root: PathBuf) -> (Arc<Self>, teia_audio::Driver) {
        Self::new_slot(root, 0)
    }
    pub fn new_slot(root: PathBuf, slot: usize) -> (Arc<Self>, teia_audio::Driver) {
        let (ports, driver) = teia_audio::channel();
        let host = Arc::new(Self {
            bridge: Default::default(),
            facilities: driver.facilities.host.clone(),
            midi: driver.midi.host.clone(),
            root,
            session_file: if slot == 0 {
                ".vira-session.json".into()
            } else {
                format!(".vira-session-{slot}.json")
            },
            slot,
            midi_started: AtomicBool::new(false),
            state: Mutex::new(State::default()),
            ports: Mutex::new(ports),
            transaction: Mutex::new(()),
            telemetry: driver.telemetry.clone(),
            automatic_resets: 0.into(),
            sequence: 0.into(),
            epoch: 0.into(),
            session: Mutex::new(None),
            restore_error: Mutex::new(None),
        });
        if let Err(error) = host.restore() {
            *host.restore_error.lock().unwrap() = Some(format!("Teia restore: {error:#}"));
        }
        if host.state.lock().unwrap().record.is_some() {
            host.start_midi();
        }
        let weak = Arc::downgrade(&host);
        std::thread::spawn(move || {
            let mut retry_at = Instant::now();
            let mut delay = Duration::from_millis(100);
            let mut last_attempt = Instant::now() - Duration::from_secs(10);
            while let Some(host) = weak.upgrade() {
                let generation = host.telemetry.reset_generation.load(SeqCst);
                if generation == 0 && last_attempt.elapsed() >= Duration::from_secs(10) {
                    delay = Duration::from_millis(100);
                }
                // Muting marks a fault, not a request for manual intervention.
                // Rebuild off-render, with bounded retry frequency for bad patches.
                if generation != 0
                    && host.telemetry.alive.load(SeqCst)
                    && Instant::now() >= retry_at
                {
                    last_attempt = Instant::now();
                    match host.control("reset", None, None, Some(generation)) {
                        Ok(_) => {
                            host.automatic_resets.fetch_add(1, SeqCst);
                        }
                        Err(error) => {
                            if host.telemetry.reset_generation.load(SeqCst) != 0
                                && host.telemetry.generation.load(SeqCst) == generation
                            {
                                *host.restore_error.lock().unwrap() = Some(format!("Patch audio recovery failed: {error:#}. Retrying automatically."));
                            }
                        }
                    }
                    retry_at = Instant::now() + delay;
                    delay = (delay * 2).min(Duration::from_secs(5));
                }
                drop(host);
                std::thread::sleep(Duration::from_millis(10));
            }
        });
        (host, driver)
    }
    fn start_midi(&self) {
        if !self.midi_started.swap(true, SeqCst) {
            let file = if self.slot == 0 {
                ".vira-midi.json".into()
            } else {
                format!(".vira-midi-{}.json", self.slot)
            };
            crate::teia_midi::start(self.midi.clone(), self.root.join(file));
        }
    }
    pub fn instrument_info(&self) -> Value {
        let state = self.state.lock().unwrap();
        json!({"name":state.record.as_ref().map(|r|&r.name),"loaded":state.record.is_some(),"running":self.telemetry.alive.load(SeqCst)})
    }
    pub fn default_root() -> PathBuf {
        crate::paths::active().patches.clone()
    }
    pub(crate) fn installed(&self) -> Result<(u64, Record)> {
        let state = self.state.lock().unwrap();
        Ok((
            state.generation,
            state.record.clone().context("No installed patch")?,
        ))
    }
    pub(crate) fn installed_revision(&self) -> u64 {
        self.state.lock().unwrap().installed_revision
    }
    pub(crate) fn store_buffer(&self, samples: &[f32], rate: f64) -> Result<Value> {
        crate::teia_resources::store_buffer(&self.root, samples, rate)
    }
    pub fn import_media(
        &self,
        kind: &str,
        name: &str,
        bytes: &[u8],
        width: u32,
        height: u32,
    ) -> Result<Value> {
        crate::teia_resources::import(&self.root, kind, name, bytes, width, height)
    }
    pub fn media_preview(&self, reference: &str) -> Result<Value> {
        crate::teia_resources::preview(&self.root, reference)
    }
    fn next(&self) -> u64 {
        self.sequence.fetch_add(1, SeqCst) + 1
    }
    fn persist(&self) -> Result<()> {
        let state = self.state.lock().unwrap();
        atomic_json(
            &self.root.join(&self.session_file),
            &json!({ "version": 1, "teiaProfile": "native-scalar-v1", "teiaSnapshot": hash(SNAPSHOT_MANIFEST.as_bytes()), "record": state.record }),
        )
    }
    fn restore(&self) -> Result<()> {
        fs::create_dir_all(&self.root)?;
        let path = self.root.join(&self.session_file);
        if !path.exists() {
            return Ok(());
        }
        let saved = read_json(&path)?;
        ensure!(
            saved["version"] == 1 && saved["teiaProfile"] == "native-scalar-v1",
            "Unsupported Teia session version"
        );
        if saved["record"].is_null() {
            return Ok(());
        }
        ensure!(
            saved["teiaSnapshot"] == hash(SNAPSHOT_MANIFEST.as_bytes()),
            "Teia runtime snapshot changed; reload the patch explicitly"
        );
        let record: Record = serde_json::from_value(saved["record"].clone())?;
        let path = self.path(&record.name)?;
        ensure!(path.exists(), "Patch file is missing: {}", record.name);
        ensure!(
            hash(&fs::read(path)?) == record.saved_hash,
            "Patch file changed since the session was saved; load it explicitly: {}",
            record.name
        );
        let generation = self.next();
        let ticket = self.new_epoch();
        let live = prepare_live(
            &self.root,
            &runtime_prepared(&record),
            generation,
            &record.overrides,
            &record.installed_document,
        )?;
        self.ports
            .lock()
            .unwrap()
            .commands
            .push(Command {
                id: generation,
                action: Action::Install { ticket, live },
            })
            .map_err(|_| anyhow::anyhow!("Teia queue full"))?;
        if record.clock_running {
            self.ports
                .lock()
                .unwrap()
                .commands
                .push(Command {
                    id: self.next(),
                    action: Action::Clock(true),
                })
                .map_err(|_| anyhow::anyhow!("Teia queue full"))?;
        }
        self.ports
            .lock()
            .unwrap()
            .commands
            .push(Command {
                id: self.next(),
                action: Action::Passthrough(record.passthrough),
            })
            .map_err(|_| anyhow::anyhow!("Teia queue full"))?;
        if record.bypass {
            self.ports
                .lock()
                .unwrap()
                .commands
                .push(Command {
                    id: self.next(),
                    action: Action::Bypass(true),
                })
                .map_err(|_| anyhow::anyhow!("Teia queue full"))?;
        }
        *self.state.lock().unwrap() = State {
            record: Some(record),
            generation,
            installed_revision: 0,
            working_revision: ticket,
        };
        Ok(())
    }
    fn path(&self, name: &str) -> Result<PathBuf> {
        ensure!(
            !name.starts_with('.')
                && name.ends_with(".json")
                && !name.contains(['/', '\\'])
                && name.len() <= 180,
            "Choose a plain .json patch filename"
        );
        let path = self.root.join(name);
        if path.exists() {
            ensure!(
                fs::symlink_metadata(&path)?.is_file(),
                "Patch must be a regular file, not a symlink"
            );
        }
        Ok(path)
    }
    pub fn library(&self) -> Result<Value> {
        fs::create_dir_all(&self.root)?;
        let mut files = Vec::new();
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !name.starts_with('.') && name.ends_with(".json") && entry.file_type()?.is_file() {
                files.push(name);
            }
        }
        files.sort();
        Ok(json!({ "directory": self.root, "files": files, "state": self.snapshot() }))
    }
    pub fn read(&self, name: &str) -> Result<Value> {
        let bytes = fs::read(self.path(name)?)?;
        ensure!(bytes.len() <= MAX_JSON, "Patch is too large");
        let document: Value = serde_json::from_slice(&bytes)?;
        Ok(json!({ "name": name, "document": document, "hash": hash(&bytes) }))
    }
    pub fn import(&self, name: &str, document: &Value) -> Result<()> {
        validate_document(document)?;
        let path = self.path(name)?;
        ensure!(!path.exists(), "A patch with that filename already exists");
        atomic_json(&path, document)
    }
    fn new_epoch(&self) -> u64 {
        let ticket = (self.epoch.fetch_add(1, SeqCst) + 1) << 32;
        self.telemetry.latest.store(ticket, SeqCst);
        ticket
    }
    fn ticket(&self, session: &str, revision: u64) -> Result<u64> {
        ensure!(
            self.session.lock().unwrap().as_deref() == Some(session),
            "This editor session has ended"
        );
        ensure!(revision < u32::MAX as u64, "Editor revision limit reached");
        Ok((self.epoch.load(SeqCst) << 32) | revision)
    }
    fn send(&self, action: Action, id: u64) -> Result<Ack> {
        ensure!(
            self.telemetry.alive.load(SeqCst),
            "Native audio producer is unavailable"
        );
        {
            let mut ports = self.ports.lock().unwrap();
            while let Ok(old) = ports.retired.pop() {
                match old {
                    teia_audio::Retired::Live(live) => drop(live),
                    teia_audio::Retired::Values(values) => drop(values),
                }
            }
            ports
                .commands
                .push(Command { id, action })
                .map_err(|_| anyhow::anyhow!("Teia command queue is full; retry"))?;
        }
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(5) {
            {
                let mut ports = self.ports.lock().unwrap();
                while let Ok(old) = ports.retired.pop() {
                    match old {
                        teia_audio::Retired::Live(live) => drop(live),
                        teia_audio::Retired::Values(values) => drop(values),
                    }
                }
                while let Ok(ack) = ports.acks.pop() {
                    if ack.id == id {
                        return Ok(ack);
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        self.telemetry.latest.fetch_add(1, SeqCst);
        bail!("Timed out waiting for the audio producer; last confirmed patch is retained")
    }
    pub fn load(
        &self,
        name: &str,
        saved_hash: &str,
        document: Value,
        prepared: Prepared,
    ) -> Result<Value> {
        self.load_mode(name, saved_hash, document, prepared, false)
    }
    pub fn load_draft(
        &self,
        name: &str,
        saved_hash: &str,
        fallback: Value,
        prepared: Prepared,
    ) -> Result<Value> {
        self.load_mode(name, saved_hash, fallback, prepared, true)
    }
    fn load_mode(
        &self,
        name: &str,
        saved_hash: &str,
        document: Value,
        prepared: Prepared,
        draft: bool,
    ) -> Result<Value> {
        self.start_midi();
        let _transaction = self.transaction.lock().unwrap();
        ensure!(
            self.session.lock().unwrap().is_none(),
            "Close the Teia editor before loading another patch"
        );
        let source = self.read(name)?;
        ensure!(
            source["hash"] == saved_hash,
            "Patch changed while loading; refresh and retry"
        );
        validate_document(&document)?;
        if draft {
            validate_document(&source["document"])?;
        }
        let id = self.next();
        let ticket = self.new_epoch();
        let live = prepare_live(&self.root, &prepared, id, &BTreeMap::new(), &document)?;
        self.send(Action::Clock(false), self.next())?;
        let ack = self.send(Action::Install { ticket, live }, id)?;
        ensure!(
            ack.status == Status::Installed,
            "Patch installation was superseded"
        );
        *self.state.lock().unwrap() = State {
            record: Some(Record {
                name: name.into(),
                saved_hash: saved_hash.into(),
                saved_document: source["document"].clone(),
                document: if draft {
                    source["document"].clone()
                } else {
                    document.clone()
                },
                installed_document: document,
                prepared,
                overrides: BTreeMap::new(),
                bypass: false,
                passthrough: false,
                clock_running: false,
                runtime_snapshots: json!({}),
            }),
            generation: ack.generation,
            installed_revision: 0,
            working_revision: ticket,
        };
        self.send(Action::Bypass(false), self.next())?;
        self.send(Action::Passthrough(false), self.next())?;
        *self.restore_error.lock().unwrap() = None;
        self.persist()?;
        Ok(self.snapshot())
    }
    pub fn snapshot(&self) -> Value {
        let state = self.state.lock().unwrap();
        let parameters: BTreeMap<String, f64> = state
            .record
            .as_ref()
            .map(|r| {
                r.prepared
                    .parameters
                    .iter()
                    .map(|p| {
                        (
                            p.id.clone(),
                            f64::from_bits(
                                self.telemetry.values[p.binding.value_index].load(SeqCst),
                            ),
                        )
                    })
                    .collect()
            })
            .unwrap_or_default();
        json!({ "midi": self.midi.snapshot(), "instanceId": format!("patch-{}", self.slot), "generation": state.generation.to_string(), "runtimeGeneration": self.telemetry.generation.load(SeqCst).to_string(), "record": state.record, "parameters": parameters, "editorOpen": self.session.lock().unwrap().is_some(), "peak": f64::from_bits(self.telemetry.peak.load(SeqCst)), "renderFailures": self.telemetry.failures.load(SeqCst), "automaticResets": self.automatic_resets.load(SeqCst), "suspended":self.telemetry.reset_generation.load(SeqCst)!=0, "repeatExhaustions": self.telemetry.repeat_exhaustions.load(SeqCst), "restoreError": *self.restore_error.lock().unwrap(), "running": self.telemetry.alive.load(SeqCst), "installedRevision": state.installed_revision })
    }
    pub fn open_session(&self) -> Result<String> {
        ensure!(
            self.state.lock().unwrap().record.is_some(),
            "Load a Teia patch first"
        );
        let mut session = self.session.lock().unwrap();
        if let Some(session) = &*session {
            return Ok(session.clone());
        }
        let ticket = self.new_epoch();
        let id = format!("master-editor-{}", ticket >> 32);
        *session = Some(id.clone());
        drop(session);
        // Feedback revisions are scoped to this fresh editor session.
        self.state.lock().unwrap().installed_revision = 0;
        Ok(id)
    }
    pub fn editor_init(&self) -> Result<Value> {
        let session = self
            .session
            .lock()
            .unwrap()
            .clone()
            .context("No active editor session")?;
        let state = self.state.lock().unwrap();
        let record = state.record.as_ref().context("No loaded patch")?;
        // The editor's initial saved baseline is the file. Reapply a recovered/live
        // draft through its normal revision gate before presenting the canvas.
        Ok(
            json!({ "bridgeVersion": 2, "sessionId": session, "document": record.saved_document, "draft": record.document, "generation": state.generation.to_string(), "needsApply": record.document != record.installed_document, "filename": record.name }),
        )
    }
    pub fn end_session(&self) {
        self.end_gestures();
        self.facilities
            .disable(self.telemetry.generation.load(SeqCst));
        *self.session.lock().unwrap() = None;
    }
    pub fn control(
        &self,
        action: &str,
        parameter: Option<&str>,
        value: Option<f64>,
        expected: Option<u64>,
    ) -> Result<Value> {
        let _transaction = self.transaction.lock().unwrap();
        let (generation, record) = {
            let state = self.state.lock().unwrap();
            (
                state.generation,
                state.record.clone().context("No loaded patch")?,
            )
        };
        ensure!(
            expected.is_none_or(|expected| expected == generation),
            "Stale runtime generation; refresh controls"
        );
        let mut updated = record;
        match action {
            "parameter" => {
                ensure!(
                    self.telemetry.reset_generation.load(SeqCst) == 0,
                    "Patch audio is recovering automatically; try again shortly"
                );
                let p = updated
                    .prepared
                    .parameters
                    .iter()
                    .find(|p| Some(p.id.as_str()) == parameter)
                    .context("Unknown parameter")?;
                let value = p.normalize(value.context("Parameter value required")?)?;
                let values = vec![ControlEvent {
                    offset: 0,
                    value_index: p.binding.value_index,
                    value,
                    generation,
                }]
                .into_boxed_slice();
                let ack = self.send(
                    Action::Values {
                        generation,
                        ticket: self.telemetry.latest.load(SeqCst),
                        values,
                    },
                    self.next(),
                )?;
                ensure!(ack.status == Status::Updated, "Stale parameter update");
                updated.overrides.insert(p.id.clone(), value);
            }
            "clock" => {
                updated.clock_running = !updated.clock_running;
                self.send(Action::Clock(updated.clock_running), self.next())?;
            }
            "bypass" => {
                updated.bypass = value == Some(1.);
                self.send(Action::Bypass(updated.bypass), self.next())?;
            }
            "passthrough" => {
                ensure!(
                    value == Some(0.) || value == Some(1.),
                    "Bypass must be 0 or 1"
                );
                updated.passthrough = value == Some(1.);
                self.send(Action::Passthrough(updated.passthrough), self.next())?;
            }
            "reset" => {
                // Reconstruct from durable resources off-render. Whole-engine reset
                // can bulk-clear repeat storage and is not a bounded RT operation.
                self.release_gestures();
                self.facilities.cancel();
                let id = self.next();
                let ticket = self.telemetry.latest.load(SeqCst);
                updated.runtime_snapshots = self.snapshots_for_reset(generation, &updated)?;
                let live = prepare_live(
                    &self.root,
                    &runtime_prepared(&updated),
                    id,
                    &updated.overrides,
                    &updated.installed_document,
                )?;
                let ack = self.send(Action::Install { ticket, live }, id)?;
                ensure!(
                    ack.status == Status::Installed,
                    "Reset superseded by a newer edit"
                );
                self.state.lock().unwrap().generation = ack.generation;
            }
            "remove" => {
                ensure!(
                    self.session.lock().unwrap().is_none(),
                    "Close the editor before removing the patch"
                );
                self.new_epoch();
                self.send(Action::Remove, self.next())?;
                let mut state = self.state.lock().unwrap();
                state.record = None;
                state.generation = 0;
                drop(state);
                *self.restore_error.lock().unwrap() = None;
                self.persist()?;
                return Ok(self.snapshot());
            }
            _ => bail!("Unsupported Teia action"),
        }
        self.state.lock().unwrap().record = Some(updated);
        self.persist()?;
        if action == "reset" {
            *self.restore_error.lock().unwrap() = None;
        }
        Ok(self.snapshot())
    }
    pub fn request(&self, command: Value, save_name: Option<String>) -> Result<Value> {
        ensure!(
            serde_json::to_vec(&command)?.len()
                <= if command["type"] == "restore buffer" {
                    32 * 1024 * 1024
                } else {
                    MAX_JSON
                },
            "Editor message is too large"
        );
        let session = command["sessionId"].as_str().context("Missing session")?;
        let revision = command["revision"].as_u64().context("Missing revision")?;
        let ticket = self.ticket(session, revision)?;
        let kind = command["type"].as_str().context("Missing editor command")?;
        let reply = |status: &str, generation: u64| json!({ "requestId": command["requestId"], "sessionId": session, "revision": revision, "generation": generation.to_string(), "status": status });
        if matches!(
            kind,
            "gesture"
                | "release gestures"
                | "capture buffer"
                | "restore buffer"
                | "capture save"
                | "buffer"
                | "feedback"
        ) {
            let result = self.hosted_request(&command);
            if kind == "gesture"
                && result.is_err()
                && command["generation"]
                    .as_str()
                    .and_then(|v| v.parse::<u64>().ok())
                    == Some(self.telemetry.generation.load(SeqCst))
            {
                self.release_gestures();
            }
            return result;
        }
        if kind == "revision" {
            self.telemetry.latest.fetch_max(ticket, SeqCst);
            return Ok(reply("updated", self.state.lock().unwrap().generation));
        }
        if kind == "transport" {
            self.control(
                "clock",
                None,
                None,
                command["generation"].as_str().and_then(|s| s.parse().ok()),
            )?;
            return Ok(reply("updated", self.state.lock().unwrap().generation));
        }
        if kind == "parameter" {
            let generation = command["generation"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .context("Missing generation")?;
            self.control(
                "parameter",
                command["parameterId"].as_str(),
                command["value"].as_f64(),
                Some(generation),
            )?;
            return Ok(reply("updated", generation));
        }
        if kind == "resync" {
            return Ok(reply(
                if kind == "resync" {
                    "connected"
                } else {
                    "updated"
                },
                self.state.lock().unwrap().generation,
            ));
        }
        let _transaction = self.transaction.lock().unwrap();
        let generation = self.state.lock().unwrap().generation;
        match kind {
            "apply" => {
                self.telemetry.latest.fetch_max(ticket, SeqCst);
                if self.telemetry.latest.load(SeqCst) != ticket {
                    return Ok(reply("cancelled", generation));
                }
                validate_document(&command["document"])?;
                {
                    let mut state = self.state.lock().unwrap();
                    state.record.as_mut().context("No patch")?.document =
                        command["document"].clone();
                    state.working_revision = ticket;
                }
                self.persist()?; // Recovery draft only; never writes the patch file.

                ensure!(
                    command["prepared"].is_object(),
                    "Patch cannot execute; last valid graph retained"
                );
                let prepared: Prepared = serde_json::from_value(command["prepared"].clone())
                    .context("Patch cannot execute; last valid graph retained")?;
                let record = self.state.lock().unwrap().record.clone().unwrap();
                let same_layout = self.telemetry.reset_generation.load(SeqCst) == 0
                    && prepared.layout == record.prepared.layout
                    && same_structure(&prepared.program, &record.prepared.program)?
                    && prepared.requirements["buffers"] == record.prepared.requirements["buffers"];
                let id = self.next();
                let (action, installed_generation) = if same_layout {
                    validate_prepared(&prepared, generation)?;
                    let mut values = Vec::new();
                    for (index, value) in prepared.program.values.iter().enumerate() {
                        let parameter = prepared
                            .parameters
                            .iter()
                            .find(|p| p.binding.value_index == index);
                        if self.held_value(generation, index) {
                            continue;
                        }
                        let target = if let Some(p) = parameter {
                            p.normalize(record.overrides.get(&p.id).copied().unwrap_or(*value))?
                        } else {
                            *value
                        };
                        if f64::from_bits(self.telemetry.values[index].load(SeqCst)) != target {
                            values.push(ControlEvent {
                                offset: 0,
                                value_index: index,
                                value: target,
                                generation,
                            });
                        }
                    }
                    if values.len() > 256 {
                        (
                            Action::Install {
                                ticket,
                                live: prepare_live(
                                    &self.root,
                                    &prepared,
                                    id,
                                    &record.overrides,
                                    &command["document"],
                                )?,
                            },
                            id,
                        )
                    } else {
                        (
                            Action::Values {
                                ticket,
                                generation,
                                values: values.into_boxed_slice(),
                            },
                            generation,
                        )
                    }
                } else {
                    (
                        Action::Install {
                            ticket,
                            live: prepare_live(
                                &self.root,
                                &prepared,
                                id,
                                &record.overrides,
                                &command["document"],
                            )?,
                        },
                        id,
                    )
                };
                let ack = self.send(action, id)?;
                if matches!(ack.status, Status::Superseded | Status::Stale) {
                    return Ok(reply("cancelled", generation));
                }
                let mut state = self.state.lock().unwrap();
                state.generation = installed_generation;
                state.installed_revision = revision;
                let current = state.record.as_mut().unwrap();
                current.installed_document = command["document"].clone();
                current.prepared = prepared;
                if installed_generation != generation {
                    current.runtime_snapshots = json!({});
                }
                for p in &current.prepared.parameters {
                    if let Some(value) = current.overrides.get_mut(&p.id) {
                        *value = p.normalize(*value)?;
                    }
                }
                drop(state);
                self.persist()?;
                Ok(reply("installed", installed_generation))
            }
            "save" => {
                validate_document(&command["document"])?;
                crate::teia_resources::validate_references(&self.root, &command["document"])?;
                let mut record = self
                    .state
                    .lock()
                    .unwrap()
                    .record
                    .clone()
                    .context("No patch")?;
                let name = if command["saveAs"] == true {
                    save_name.context("Choose a filename for Save As")?
                } else {
                    match command["document"]["name"].as_str() {
                        Some(name) => {
                            let name = name.trim();
                            ensure!(!name.is_empty(), "Give the patch a name before saving");
                            format!("{name}.json")
                        }
                        None => record.name.clone(),
                    }
                };
                let path = self.path(&name)?;
                let previous_path = self.path(&record.name)?;
                let save_as = command["saveAs"] == true;
                if !save_as || name == record.name {
                    ensure!(hash(&fs::read(&previous_path)?) == record.saved_hash, "Save conflict: the patch was changed on disk. Use Save As to preserve your draft");
                }
                if name != record.name {
                    ensure!(
                        !path.exists(),
                        "Save conflict: that patch name already exists; choose another name"
                    );
                }
                atomic_json(&path, &command["document"])?;
                if !save_as && name != record.name {
                    fs::remove_file(previous_path)?;
                }
                record.name = name;
                record.saved_hash = hash(&fs::read(path)?);
                record.saved_document = command["document"].clone();
                if crate::teia_bridge::without_buffers(&record.saved_document)
                    == crate::teia_bridge::without_buffers(&record.installed_document)
                {
                    let mut refs = serde_json::Map::new();
                    collect_buffer_refs(&record.saved_document, "", &mut refs);
                    if !record.prepared.requirements.is_object() {
                        record.prepared.requirements = json!({});
                    }
                    record.prepared.requirements["buffers"] = Value::Object(refs);
                    record.runtime_snapshots = record.prepared.requirements["buffers"].clone();
                }
                let mut state = self.state.lock().unwrap();
                if ticket >= state.working_revision {
                    record.document = command["document"].clone();
                    state.working_revision = ticket;
                }
                state.record = Some(record);
                drop(state);
                self.persist()?;
                Ok(reply("saved", generation))
            }
            "close" => {
                validate_document(&command["document"])?;
                if ticket >= self.state.lock().unwrap().working_revision {
                    let mut state = self.state.lock().unwrap();
                    state.record.as_mut().context("No patch")?.document =
                        command["document"].clone();
                    state.working_revision = ticket;
                }
                self.persist()?;
                Ok(reply("closed", generation))
            }
            _ => bail!("Host capability is unavailable"),
        }
    }
    pub fn feedback(&self) -> Result<Value> {
        let observations = self.observation_feedback()?;
        let session = self
            .session
            .lock()
            .unwrap()
            .clone()
            .context("No editor session")?;
        let state = self.state.lock().unwrap();
        if state.generation != self.telemetry.generation.load(SeqCst) {
            return Ok(Value::Null);
        }
        let record = state.record.as_ref().context("No patch")?;
        let parameters: BTreeMap<_, _> = record
            .prepared
            .parameters
            .iter()
            .map(|p| {
                (
                    p.id.clone(),
                    f64::from_bits(self.telemetry.values[p.binding.value_index].load(SeqCst)),
                )
            })
            .collect();
        let mut payload = json!({ "type": "feedback", "requestId": "runtime-feedback", "sessionId": session, "revision": state.installed_revision, "generation": state.generation.to_string(), "parameters": parameters, "peak": f64::from_bits(self.telemetry.peak.load(SeqCst)), "tempo": {"bpm":f64::from_bits(self.telemetry.bpm.load(SeqCst)),"beat":f64::from_bits(self.telemetry.beat.load(SeqCst)),"running":self.telemetry.timeline_running.load(SeqCst),"renderFrame":self.telemetry.render_frame.load(SeqCst)} });
        if let Some(fields) = observations.as_object() {
            for (key, value) in fields {
                payload[key] = value.clone();
            }
        }
        Ok(payload)
    }
}
pub(crate) fn validate_prepared(prepared: &Prepared, generation: u64) -> Result<PreparedProgram> {
    ensure!(
        prepared
            .program
            .metadata
            .get("fftBindings")
            .is_none_or(|v| v.as_array().is_some_and(Vec::is_empty)),
        "Teia native FFT is unavailable"
    );
    ensure!(
        serde_json::to_vec(prepared)?.len() <= MAX_JSON,
        "Prepared patch is too large"
    );
    ensure!(
        prepared.profile == "native-scalar-v1"
            && !prepared
                .diagnostics
                .iter()
                .any(|d| d["severity"] == "error"),
        "Patch is outside Teia's native profile"
    );
    ensure!(
        prepared.parameters.len() <= 128,
        "At most 128 exposed parameters"
    );
    let mut ids = std::collections::HashSet::new();
    // Teia revision 3 admits nested bounded pools. Resource-heavy repeated
    // buffers/effects can clear storage in bulk on voice reuse; defer until a
    // macOS producer-deadline workload has been accepted.
    for (index, op) in prepared.program.ops.iter().enumerate() {
        if (matches!(op.opcode, 34 | 12 | 13 | 14 | 39)
            || (op.opcode == 4 && matches!(op.a, 5 | 6)))
            && prepared
                .program
                .ops
                .iter()
                .enumerate()
                .any(|(start, begin)| {
                    matches!(begin.opcode, 42 | 46) && start < index && begin.b as usize > index
                })
        {
            bail!("Buffered effects/Buffer inside repeats await Vira's native deadline validation");
        }
    }
    for p in &prepared.parameters {
        ensure!(
            ids.insert(&p.id)
                && p.binding.value_index < prepared.program.values.len()
                && p.binding.layout == prepared.layout,
            "Invalid parameter binding"
        );
        p.normalize(p.default_value)?;
    }
    let operations: Vec<_> = prepared.program.ops.iter().map(WireOp::operation).collect();
    PreparedProgram::prepare(
        prepared.program.version,
        generation,
        &operations,
        &prepared.program.values,
    )
    .map_err(|e| anyhow::anyhow!("Native program rejected: {e:?}"))
}
fn prepare_live(
    root: &Path,
    prepared: &Prepared,
    generation: u64,
    overrides: &BTreeMap<String, f64>,
    document: &Value,
) -> Result<Box<Live>> {
    validate_prepared(prepared, generation)?;
    let mut prepared = prepared.clone();
    for p in &prepared.parameters {
        prepared.program.values[p.binding.value_index] =
            p.normalize(overrides.get(&p.id).copied().unwrap_or(p.default_value))?;
    }
    let ports = crate::routing::patch_audio_inputs(document);
    ensure!(
        ports.len() <= 32,
        "A patch supports at most 32 routed Audio Input nodes"
    );
    let bindings = prepared
        .program
        .metadata
        .get("inputBindings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut input_routes = Vec::new();
    for op in &prepared.program.ops {
        if op.opcode != 11 {
            continue;
        }
        let node = bindings
            .iter()
            .find(|b| b["register"].as_i64() == Some(op.out as i64))
            .and_then(|b| b["nodeId"].as_str());
        let slot = node.and_then(|id| ports.iter().position(|p| p.id == id));
        ensure!(
            slot.is_some() || ports.len() <= 1,
            "Reload the patch to bind its independent Audio Input nodes"
        );
        input_routes.push((op.out as usize, slot.unwrap_or(0)));
    }
    let program = validate_prepared(&prepared, generation)?;
    let resources = crate::teia_resources::prepare(root, &prepared)?;
    let mut instance = Instance::new_with_resources(
        &program,
        crate::sample_rate::get() as f64,
        crate::decks::PRODUCER_FRAMES,
        &resources,
    )
    .map_err(|e| anyhow::anyhow!("Native instance rejected: {e:?}"))?;
    instance
        .set_audio_input_routes(&input_routes)
        .map_err(|e| anyhow::anyhow!("Invalid audio input routes: {e:?}"))?;
    Ok(Box::new(Live {
        instance,
        generation,
        values: prepared.program.values,
    }))
}
fn same_structure(a: &Program, b: &Program) -> Result<bool> {
    Ok(a.version == b.version
        && a.values.len() == b.values.len()
        && serde_json::to_value(&a.ops)? == serde_json::to_value(&b.ops)?
        && [
            "customWaveBindings",
            "sequencerBindings",
            "sampleBindings",
            "imageBindings",
            "repeatBindings",
            "inputBindings",
        ]
        .iter()
        .all(|key| a.metadata.get(*key) == b.metadata.get(*key)))
}
fn runtime_prepared(record: &Record) -> Prepared {
    let mut prepared = record.prepared.clone();
    if let Some(snapshots) = record
        .runtime_snapshots
        .as_object()
        .filter(|m| !m.is_empty())
    {
        if !prepared.requirements.is_object() {
            prepared.requirements = json!({});
        }
        if !prepared.requirements["buffers"].is_object() {
            prepared.requirements["buffers"] = json!({});
        }
        for (id, snapshot) in snapshots {
            prepared.requirements["buffers"][id] = snapshot.clone();
        }
    }
    prepared
}
fn collect_buffer_refs(document: &Value, prefix: &str, out: &mut serde_json::Map<String, Value>) {
    if let Some(refs) = document["buffers"].as_object() {
        for (id, value) in refs {
            out.insert(format!("{prefix}{id}"), value.clone());
        }
    }
    if let Some(nodes) = document["nodes"].as_array() {
        for node in nodes {
            if node["type"] == "Group" {
                collect_buffer_refs(
                    &node["subpatch"],
                    &format!("{prefix}{}__", node["id"].as_str().unwrap_or("")),
                    out,
                );
            }
        }
    }
}

fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read_json(path: &Path) -> Result<Value> {
    let metadata = fs::metadata(path)?;
    ensure!(
        metadata.len() <= (8 * MAX_JSON) as u64,
        "Patch/session file is too large"
    );
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}
fn validate_document(document: &Value) -> Result<()> {
    ensure!(
        document.is_object()
            && document["nodes"].is_array()
            && document["links"].is_array()
            && serde_json::to_vec(document)?.len() <= MAX_JSON,
        "Invalid editable patch document"
    );
    Ok(())
}
fn atomic_json(path: &Path, document: &Value) -> Result<()> {
    fs::create_dir_all(path.parent().unwrap())?;
    let temporary = path.with_extension("json.vira-tmp");
    let bytes = serde_json::to_vec_pretty(document)?;
    {
        use std::io::Write;
        let mut file = fs::File::create(&temporary)?;
        file.write_all(&bytes)?;
        file.write_all(b"\n")?;
        file.sync_all()?;
    }
    fs::rename(temporary, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::decks::{Frame, PRODUCER_FRAMES};
    use std::sync::atomic::AtomicBool;
    struct Fixture {
        host: Arc<Host>,
        root: PathBuf,
        stop: Arc<AtomicBool>,
        worker: Option<std::thread::JoinHandle<()>>,
        prepared: Prepared,
        document: Value,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "vira-teia-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            let (host, mut driver) = Host::new(root.clone());
            let stop = Arc::new(AtomicBool::new(false));
            let stopping = stop.clone();
            driver.telemetry.alive.store(true, SeqCst);
            let worker = std::thread::spawn(move || {
                while !stopping.load(SeqCst) {
                    driver.commands();
                    driver.process(
                        &mut [Frame {
                            samples: [0.4, -0.2],
                            master_bpm: 120.,
                            ..Frame::default()
                        }; PRODUCER_FRAMES],
                    );
                    std::thread::sleep(Duration::from_millis(1));
                }
                driver.telemetry.alive.store(false, SeqCst);
            });
            let prepared: Prepared = serde_json::from_value(json!({ "profile":"native-scalar-v1", "layout":"stereo-fixture", "diagnostics":[], "parameters":[{ "id":"gain", "name":"gain", "defaultValue":1., "min":0., "max":2., "binding":{"valueIndex":0,"layout":"stereo-fixture"} }], "program":{"version":1,"values":[1.],"ops":[{"opcode":0,"out":0,"a":0},{"opcode":11,"out":1,"a":0,"b":0},{"opcode":11,"out":2,"a":0,"b":1},{"opcode":5,"a":1,"b":0},{"opcode":5,"a":2,"b":1}]}})).unwrap();
            let document = json!({"name":"Gain", "nodes":[], "links":[]});
            host.import("Gain.json", &document).unwrap();
            let source = host.read("Gain.json").unwrap();
            host.load(
                "Gain.json",
                source["hash"].as_str().unwrap(),
                document.clone(),
                prepared.clone(),
            )
            .unwrap();
            Self {
                host,
                root,
                stop,
                worker: Some(worker),
                prepared,
                document,
            }
        }
        fn command(&self, session: &str, revision: u64, kind: &str) -> Value {
            json!({"sessionId":session,"requestId":format!("request-{revision}-{kind}"),"revision":revision,"generation":self.host.snapshot()["generation"],"type":kind,"document":self.document})
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.stop.store(true, SeqCst);
            self.worker.take().unwrap().join().unwrap();
            let _ = fs::remove_dir_all(&self.root);
        }
    }
    #[test]
    fn patches_waiting_for_routing_receive_valid_silent_timeline_blocks() {
        let fixture = Fixture::new();
        let live = prepare_live(
            &fixture.root,
            &fixture.prepared,
            100,
            &BTreeMap::new(),
            &fixture.document,
        )
        .unwrap();
        let (mut ports, mut driver) = teia_audio::channel();
        ports
            .commands
            .push(Command {
                id: 1,
                action: Action::Install { ticket: 0, live },
            })
            .ok()
            .unwrap();
        driver.commands();
        let telemetry = driver.telemetry.clone();
        let midi = driver.midi.host.clone();
        let mut drivers = vec![driver];
        let mut decks = crate::decks::Decks::new();
        let mut block = [Frame::default(); PRODUCER_FRAMES];
        for _ in 0..3 {
            decks.next_block(&mut block, &mut drivers).unwrap();
        }
        assert_eq!(
            telemetry.failures.load(SeqCst),
            0,
            "Unrouted patch installation must not create a runtime fault"
        );
        assert_eq!(telemetry.reset_generation.load(SeqCst), 0);
        assert!(!midi.muted.load(SeqCst));
        assert!(block.iter().all(|frame| frame.samples == [0.; 2]));
    }
    #[test]
    fn muted_faults_recover_automatically_without_losing_parameters_or_saving_the_patch() {
        let fixture = Fixture::new();
        fixture
            .host
            .control("parameter", Some("gain"), Some(0.25), None)
            .unwrap();
        fixture
            .host
            .control("bypass", None, Some(1.), None)
            .unwrap();
        let original = fs::read(fixture.root.join("Gain.json")).unwrap();
        let old_generation = fixture.host.snapshot()["generation"].clone();
        fixture.host.midi.mute();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let state = fixture.host.snapshot();
            if state["automaticResets"].as_u64().unwrap() > 0 && state["suspended"] == false {
                assert_ne!(state["generation"], old_generation);
                assert_eq!(state["record"]["overrides"]["gain"], 0.25);
                assert_eq!(state["record"]["bypass"], true);
                assert_eq!(state["parameters"]["gain"], 0.25);
                assert_eq!(state["midi"]["muted"], false);
                assert!(state["restoreError"].is_null());
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Muted patch did not recover automatically: {state}"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(fs::read(fixture.root.join("Gain.json")).unwrap(), original);
    }
    #[test]
    fn distinct_patch_input_pins_deliver_independent_stereo_signals() {
        let fixture = Fixture::new();
        let document = json!({"nodes":[{"id":"a-unused","type":"AudioInput"},{"id":"b-left","type":"AudioInput"},{"id":"c-right","type":"AudioInput"}],"links":[]});
        let mut prepared = fixture.prepared.clone();
        prepared.program.metadata.insert(
            "inputBindings".into(),
            json!([{"nodeId":"b-left","register":1},{"nodeId":"c-right","register":2}]),
        );
        let live =
            prepare_live(&fixture.root, &prepared, 100, &BTreeMap::new(), &document).unwrap();
        let (mut ports, mut driver) = teia_audio::channel();
        driver.silent_bypass = true;
        ports
            .commands
            .push(Command {
                id: 1,
                action: Action::Install { ticket: 0, live },
            })
            .ok()
            .unwrap();
        driver.commands();
        let mut graph = crate::routing::Graph::default();
        graph.add_patch(
            0,
            "Independent inputs".into(),
            crate::routing::patch_audio_inputs(&document),
        );
        graph.wires.clear();
        for (from, to, input) in [
            ("a-player", "patch-0", "b-left"),
            ("b-player", "patch-0", "c-right"),
            ("patch-0", "master", "audio"),
        ] {
            graph.wires.push(crate::routing::Wire {
                from: from.into(),
                to: to.into(),
                input: input.into(),
                output: "audio".into(),
                gain: 1.,
            });
        }
        let mut plan = graph.compile().unwrap();
        let mut drivers = vec![driver];
        let mut block = [Frame {
            routing_players: [[0.2, 0.3], [-0.4, -0.5]],
            master_bpm: 120.,
            ..Frame::default()
        }; PRODUCER_FRAMES];
        for _ in 0..crate::sample_rate::fine_frames().div_ceil(PRODUCER_FRAMES) + 1 {
            plan.render_block(&mut block, &mut drivers);
        }
        assert!((block[127].samples[0] - 0.2).abs() < 1e-6);
        assert!((block[127].samples[1] + 0.5).abs() < 1e-6);
        graph.wires.retain(|w| w.input != "c-right");
        let mut plan = graph.compile().unwrap();
        plan.render_block(&mut block, &mut drivers);
        assert!((block[127].samples[0] - 0.2).abs() < 1e-6);
        assert_eq!(block[127].samples[1], 0.);

        // Bypass sums every exposed input, including inputs unused by the DSP,
        // and follows the same fan-out and wire gains as the processed signal.
        graph.wires.push(crate::routing::Wire {
            from: "b-player".into(),
            to: "patch-0".into(),
            input: "a-unused".into(),
            output: "audio".into(),
            gain: 0.5,
        });
        graph.wires.push(crate::routing::Wire {
            from: "patch-0".into(),
            to: "headphones".into(),
            input: "audio".into(),
            output: "audio".into(),
            gain: 0.5,
        });
        let mut plan = graph.compile().unwrap();
        ports
            .commands
            .push(Command {
                id: 2,
                action: Action::Passthrough(true),
            })
            .ok()
            .unwrap();
        drivers[0].commands();
        for _ in 0..crate::sample_rate::fine_frames().div_ceil(PRODUCER_FRAMES) + 1 {
            plan.render_block(&mut block, &mut drivers);
        }
        assert!(block[127].samples[0].abs() < 1e-6);
        assert!((block[127].samples[1] - 0.05).abs() < 1e-6);
        assert!((block[127].cue_samples[1] - 0.025).abs() < 1e-6);
        ports
            .commands
            .push(Command {
                id: 3,
                action: Action::Bypass(true),
            })
            .ok()
            .unwrap();
        drivers[0].commands();
        for _ in 0..crate::sample_rate::fine_frames().div_ceil(PRODUCER_FRAMES) + 1 {
            plan.render_block(&mut block, &mut drivers);
        }
        assert_eq!(block[127].samples, [0.; 2]);
        ports
            .commands
            .push(Command {
                id: 4,
                action: Action::Bypass(false),
            })
            .ok()
            .unwrap();
        ports
            .commands
            .push(Command {
                id: 5,
                action: Action::Passthrough(false),
            })
            .ok()
            .unwrap();
        drivers[0].commands();
        drivers[0].commands();
        for _ in 0..crate::sample_rate::fine_frames().div_ceil(PRODUCER_FRAMES) + 1 {
            plan.render_block(&mut block, &mut drivers);
        }
        assert!((block[127].samples[0] - 0.2).abs() < 1e-6);
        assert_eq!(block[127].samples[1], 0.);
    }
    #[test]
    fn routed_patch_instances_sum_and_toggle_independently_and_restore_separately() {
        let fixture = Fixture::new();
        let (first, mut first_driver) = Host::new_slot(fixture.root.clone(), 1);
        let (second, mut second_driver) = Host::new_slot(fixture.root.clone(), 2);
        first_driver.silent_bypass = true;
        second_driver.silent_bypass = true;
        let mut graph = crate::routing::Graph::default();
        // Slots 0/1 here refer to driver positions, independent from persistence files.
        graph.add_patch(
            0,
            "First".into(),
            vec![crate::routing::PatchInput {
                id: "in".into(),
                label: "in".into(),
            }],
        );
        graph.add_patch(
            1,
            "Second".into(),
            vec![crate::routing::PatchInput {
                id: "in".into(),
                label: "in".into(),
            }],
        );
        let mut plan = graph.compile().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let output = Arc::new(AtomicU64::new(0));
        let result = output.clone();
        first_driver.telemetry.alive.store(true, SeqCst);
        second_driver.telemetry.alive.store(true, SeqCst);
        let mut drivers = vec![first_driver, second_driver];
        let worker = std::thread::spawn(move || {
            while !stopping.load(SeqCst) {
                for driver in &mut drivers {
                    driver.commands();
                }
                let mut block = [Frame {
                    routing_players: [[0.2; 2], [0.; 2]],
                    routing_cross: [1.; 2],
                    gains: [1.; 2],
                    master_bpm: 120.,
                    ..Frame::default()
                }; PRODUCER_FRAMES];
                plan.render_block(&mut block, &mut drivers);
                result.store(
                    (block[PRODUCER_FRAMES - 1].samples[0] as f64).to_bits(),
                    SeqCst,
                );
                std::thread::sleep(Duration::from_millis(1));
            }
        });
        first.import("Other.json", &fixture.document).unwrap();
        for (host, name) in [(&first, "Gain.json"), (&second, "Other.json")] {
            let source = host.read(name).unwrap();
            host.load(
                name,
                source["hash"].as_str().unwrap(),
                fixture.document.clone(),
                fixture.prepared.clone(),
            )
            .unwrap();
        }
        let wait_for = |expected: f64| {
            let deadline = Instant::now() + Duration::from_secs(2);
            while (f64::from_bits(output.load(SeqCst)) - expected).abs() > 0.00001 {
                assert!(
                    Instant::now() < deadline,
                    "expected {expected}, got {}",
                    f64::from_bits(output.load(SeqCst))
                );
                std::thread::sleep(Duration::from_millis(2));
            }
        };
        wait_for(0.27); // Existing dry mix .09 + two independent .09 patch returns.
        first
            .control("parameter", Some("gain"), Some(0.5), None)
            .unwrap();
        wait_for(0.225);
        first.control("bypass", None, Some(1.), None).unwrap();
        wait_for(0.18);
        second.control("bypass", None, Some(1.), None).unwrap();
        wait_for(0.09);
        stop.store(true, SeqCst);
        worker.join().unwrap();
        let (restored_first, _) = Host::new_slot(fixture.root.clone(), 1);
        let (restored_second, _) = Host::new_slot(fixture.root.clone(), 2);
        assert_eq!(restored_first.snapshot()["record"]["name"], "Gain.json");
        assert_eq!(restored_second.snapshot()["record"]["name"], "Other.json");
        assert_eq!(
            restored_first.snapshot()["record"]["overrides"]["gain"],
            0.5
        );
        assert!(restored_second.snapshot()["record"]["overrides"]["gain"].is_null());
    }
    #[test]
    fn a_dry_draft_can_open_missing_media_without_saving_or_claiming_installation() {
        let fixture = Fixture::new();
        let source = json!({"nodes":[{"id":"sample","type":"SamplePlayer","params":{},"sample":{"name":"missing","url":"blob:old-editor"}}],"links":[]});
        fixture.host.import("Broken.json", &source).unwrap();
        let bytes = fs::read(fixture.root.join("Broken.json")).unwrap();
        let hash = fixture.host.read("Broken.json").unwrap()["hash"]
            .as_str()
            .unwrap()
            .to_owned();
        fixture
            .host
            .load_draft(
                "Broken.json",
                &hash,
                fixture.document.clone(),
                fixture.prepared.clone(),
            )
            .unwrap();
        fixture.host.open_session().unwrap();
        let initial = fixture.host.editor_init().unwrap();
        assert_eq!(initial["document"], source);
        assert_eq!(initial["draft"], source);
        assert_eq!(initial["needsApply"], true);
        assert_eq!(fs::read(fixture.root.join("Broken.json")).unwrap(), bytes);
        assert_eq!(
            fixture.host.snapshot()["record"]["installed_document"],
            fixture.document
        );
    }
    #[test]
    fn resource_changes_replace_the_runtime_and_assets_save_only_on_request() {
        let fixture = Fixture::new();
        let session = fixture.host.open_session().unwrap();
        let saved = fs::read(fixture.root.join("Gain.json")).unwrap();
        let mut generation = fixture.host.snapshot()["generation"].clone();
        for (revision, color) in [(1, vec![255, 0, 0, 255]), (2, vec![0, 255, 0, 255])] {
            let image = fixture
                .host
                .import_media("image", "pixel.png", &color, 1, 1)
                .unwrap();
            let mut prepared = fixture.prepared.clone();
            prepared.program.metadata.insert(
                "imageBindings".into(),
                json!([{"nodeId":"image","image":image}]),
            );
            let mut apply = fixture.command(&session, revision, "apply");
            apply["document"]["nodes"] =
                json!([{"id":"image","type":"Image","params":{},"image":image}]);
            apply["prepared"] = serde_json::to_value(prepared).unwrap();
            let reply = fixture.host.request(apply, None).unwrap();
            assert_eq!(reply["status"], "installed");
            assert_ne!(reply["generation"], generation);
            generation = reply["generation"].clone();
            assert_eq!(fs::read(fixture.root.join("Gain.json")).unwrap(), saved);
        }
        let mut save = fixture.command(&session, 2, "save");
        save["document"] = fixture.host.snapshot()["record"]["document"].clone();
        assert_eq!(fixture.host.request(save, None).unwrap()["status"], "saved");
        assert_ne!(fs::read(fixture.root.join("Gain.json")).unwrap(), saved);
        let mut invalid = fixture.command(&session, 3, "apply");
        let mut prepared = fixture.prepared.clone();
        prepared.program.metadata.insert("imageBindings".into(),json!([{"image":{"url":"vira-asset:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}}]));
        invalid["prepared"] = serde_json::to_value(prepared).unwrap();
        assert!(fixture.host.request(invalid, None).is_err());
        assert_eq!(fixture.host.snapshot()["generation"], generation);
    }
    fn buffer_patch() -> (Value, Prepared) {
        let document = json!({"nodes":[{"id":"buffer","type":"Buffer","params":{"length":0.1,"on reset":1}}],"links":[]});
        let prepared=serde_json::from_value(json!({"profile":"native-scalar-v1","layout":"root-buffer","parameters":[],"diagnostics":[],"program":{"version":1,"values":[1.,0.1,0.,1.],"ops":[{"opcode":0,"out":0,"a":0},{"opcode":11,"out":1,"a":0,"b":0},{"opcode":0,"out":2,"a":1},{"opcode":0,"out":3,"a":2},{"opcode":0,"out":4,"a":3},{"opcode":34,"out":5,"a":1,"b":3,"c":3,"d":2,"e":6,"state":0,"value":1.,"value2":4.,"value3":4.},{"opcode":5,"a":5,"b":0}],"stateBindings":[{"id":"buffer:buffer","nodeId":"buffer","state":0,"count":7}],"valueBindings":[{"kind":"node-param","nodeId":"buffer","port":"length","valueIndex":1}],"monitorIds":{"buffer":5}}})).unwrap();
        (document, prepared)
    }
    #[test]
    fn capture_save_persists_consistent_buffer_content_and_reset_replaces_off_render() {
        let fixture = Fixture::new();
        let (document, prepared) = buffer_patch();
        fixture.host.import("Buffer.json", &document).unwrap();
        let source = fixture.host.read("Buffer.json").unwrap();
        fixture
            .host
            .load(
                "Buffer.json",
                source["hash"].as_str().unwrap(),
                document.clone(),
                prepared,
            )
            .unwrap();
        let session = fixture.host.open_session().unwrap();
        std::thread::sleep(Duration::from_millis(20));
        // Reset preserves live content in private recovery without saving JSON.
        let generation = fixture.host.snapshot()["generation"].clone();
        fixture.host.control("reset", None, None, None).unwrap();
        let recovered = fixture.host.snapshot();
        assert_ne!(recovered["generation"], generation);
        assert_eq!(
            recovered["record"]["runtime_snapshots"]["buffer"]["sampleCount"],
            crate::sample_rate::get() / 10
        );
        assert!(fixture.host.read("Buffer.json").unwrap()["document"]["buffers"].is_null());
        let mut command = fixture.command(&session, 0, "capture save");
        command["version"] = json!(1);
        command["document"] = document;
        command["installedRevision"] = json!(0);
        let captured = fixture.host.request(command, None).unwrap();
        assert_eq!(captured["status"], "captured");
        let snapshot = &captured["capturedDocument"]["buffers"]["buffer"];
        assert_eq!(snapshot["sampleCount"], crate::sample_rate::get() / 10);
        assert_eq!(snapshot["sampleRate"], crate::sample_rate::get() as f64);
        assert!(fixture.host.read("Buffer.json").unwrap()["document"]["buffers"].is_null());
        let mut save = fixture.command(&session, 0, "save");
        save["document"] = captured["capturedDocument"].clone();
        assert_eq!(fixture.host.request(save, None).unwrap()["status"], "saved");
        let before = fixture.host.snapshot()["generation"].clone();
        fixture.host.control("reset", None, None, None).unwrap();
        assert_ne!(fixture.host.snapshot()["generation"], before);
        assert_eq!(
            fixture.host.read("Buffer.json").unwrap()["document"]["buffers"]["buffer"],
            *snapshot
        );
    }
    #[test]
    fn gestures_are_ordered_live_events_and_never_patch_edits() {
        let fixture = Fixture::new();
        let document = json!({"nodes":[{"id":"button","type":"Button","params":{"pressed":0,"clicks":0}}],"links":[]});
        let mut prepared = fixture.prepared.clone();
        prepared.parameters.clear();
        prepared.program.metadata.insert(
            "valueBindings".into(),
            json!([{"kind":"node-param","nodeId":"button","port":"pressed","valueIndex":0}]),
        );
        prepared.program.values[0] = 0.;
        fixture.host.import("Button.json", &document).unwrap();
        let source = fixture.host.read("Button.json").unwrap();
        fixture
            .host
            .load(
                "Button.json",
                source["hash"].as_str().unwrap(),
                document.clone(),
                prepared.clone(),
            )
            .unwrap();
        let session = fixture.host.open_session().unwrap();
        for (sequence, value) in [(1, 1.), (2, 0.)] {
            let mut command = fixture.command(&session, 0, "gesture");
            command["version"] = json!(1);
            command["sequence"] = json!(sequence);
            command["timestamp"] = json!(100. + sequence as f64 * 0.01);
            command["nodeId"] = json!("button");
            command["layout"] = json!(prepared.layout);
            command["values"] = json!({"pressed":value});
            assert_eq!(
                fixture.host.request(command, None).unwrap()["status"],
                "updated"
            );
        }
        assert_eq!(fixture.host.snapshot()["record"]["document"], document);
        assert_eq!(
            fixture.host.read("Button.json").unwrap()["document"],
            document
        );
        fixture.host.end_session();
        let next = fixture.host.open_session().unwrap();
        let mut command = fixture.command(&next, 0, "gesture");
        command["version"] = json!(1);
        command["sequence"] = json!(1);
        command["timestamp"] = json!(200.);
        command["nodeId"] = json!("button");
        command["layout"] = json!(prepared.layout);
        command["values"] = json!({"pressed":1.});
        assert_eq!(
            fixture.host.request(command, None).unwrap()["status"],
            "updated"
        );
    }
    #[test]
    fn buffered_repeats_require_native_deadline_acceptance() {
        let fixture = Fixture::new();
        let mut prepared = fixture.prepared.clone();
        prepared.program.ops[0].opcode = 42;
        prepared.program.ops[0].b = 4;
        prepared.program.ops[1].opcode = 34;
        let error = validate_prepared(&prepared, 1).err().unwrap().to_string();
        assert!(error.contains("deadline validation"));
    }
    #[test]
    fn native_fft_stays_rejected() {
        let fixture = Fixture::new();
        let mut prepared = fixture.prepared.clone();
        prepared
            .program
            .metadata
            .insert("fftBindings".into(), json!([{"nodeId":"fft"}]));
        assert!(validate_prepared(&prepared, 1).is_err());
    }
    #[test]
    fn live_apply_and_invalid_drafts_never_save_the_patch_file() {
        let fixture = Fixture::new();
        let session = fixture.host.open_session().unwrap();
        let before = fs::read(fixture.root.join("Gain.json")).unwrap();
        let mut prepared = fixture.prepared.clone();
        prepared.program.values[0] = 0.5;
        prepared.parameters[0].default_value = 0.5;
        let mut apply = fixture.command(&session, 1, "apply");
        apply["prepared"] = serde_json::to_value(prepared).unwrap();
        apply["document"]["name"] = json!("Draft");
        let reply = fixture.host.request(apply, None).unwrap();
        assert_eq!(reply["status"], "installed");
        assert_eq!(fs::read(fixture.root.join("Gain.json")).unwrap(), before);
        assert_eq!(
            f64::from_bits(fixture.host.telemetry.values[0].load(SeqCst)),
            0.5
        );
        let generation = fixture.host.snapshot()["generation"].clone();
        let mut invalid = fixture.command(&session, 2, "apply");
        invalid["document"]["name"] = json!("Invalid draft");
        assert!(fixture.host.request(invalid, None).is_err());
        assert_eq!(fixture.host.snapshot()["generation"], generation);
        assert_eq!(
            fixture.host.snapshot()["record"]["document"]["name"],
            "Invalid draft"
        );
        assert_eq!(fs::read(fixture.root.join("Gain.json")).unwrap(), before);
    }
    #[test]
    fn overrides_survive_edits_but_new_parameter_identity_gets_its_own_default() {
        let fixture = Fixture::new();
        fixture
            .host
            .control("parameter", Some("gain"), Some(1.5), None)
            .unwrap();
        let session = fixture.host.open_session().unwrap();
        let mut apply = fixture.command(&session, 1, "apply");
        apply["prepared"] = serde_json::to_value(&fixture.prepared).unwrap();
        fixture.host.request(apply.clone(), None).unwrap();
        assert_eq!(
            f64::from_bits(fixture.host.telemetry.values[0].load(SeqCst)),
            1.5
        );
        apply["revision"] = json!(2);
        apply["prepared"]["parameters"][0]["id"] = json!("new-gain");
        fixture.host.request(apply, None).unwrap();
        assert_eq!(
            f64::from_bits(fixture.host.telemetry.values[0].load(SeqCst)),
            1.
        );
    }
    #[test]
    fn saving_renames_the_file_from_the_patch_name_and_restores_that_name() {
        let fixture = Fixture::new();
        let session = fixture.host.open_session().unwrap();
        let mut save = fixture.command(&session, 1, "save");
        save["document"]["name"] = json!("My stereo effect");
        assert_eq!(
            fixture.host.request(save.clone(), None).unwrap()["status"],
            "saved"
        );
        assert!(!fixture.root.join("Gain.json").exists());
        assert_eq!(
            read_json(&fixture.root.join("My stereo effect.json")).unwrap(),
            save["document"]
        );
        assert_eq!(
            fixture.host.snapshot()["record"]["name"],
            "My stereo effect.json"
        );
        assert_eq!(
            fixture.host.editor_init().unwrap()["filename"],
            "My stereo effect.json"
        );
        fixture.host.restore().unwrap();
        assert_eq!(
            fixture.host.snapshot()["record"]["document"]["name"],
            "My stereo effect"
        );
        assert_eq!(fixture.host.request(save, None).unwrap()["status"], "saved");
    }
    #[test]
    fn patch_renames_reject_collisions_and_invalid_names_without_changing_files() {
        let fixture = Fixture::new();
        let session = fixture.host.open_session().unwrap();
        fixture
            .host
            .import("Other.json", &fixture.document)
            .unwrap();
        let original = fs::read(fixture.root.join("Gain.json")).unwrap();
        for name in [
            "Other",
            "",
            "  ",
            "../Escape",
            "nested/name",
            "nested\\name",
        ] {
            let mut save = fixture.command(&session, 1, "save");
            save["document"]["name"] = json!(name);
            assert!(fixture.host.request(save, None).is_err(), "{name}");
            assert_eq!(fs::read(fixture.root.join("Gain.json")).unwrap(), original);
            assert_eq!(fixture.host.snapshot()["record"]["name"], "Gain.json");
        }
    }
    #[test]
    fn save_conflicts_and_save_as_acknowledge_only_the_requested_snapshot() {
        let fixture = Fixture::new();
        let session = fixture.host.open_session().unwrap();
        let mut save = fixture.command(&session, 1, "save");
        save["document"]["name"] = json!("Saved snapshot");
        save["saveAs"] = json!(false);
        atomic_json(
            &fixture.root.join("Gain.json"),
            &json!({"nodes":[],"links":[],"name":"External change"}),
        )
        .unwrap();
        assert!(fixture
            .host
            .request(save.clone(), None)
            .unwrap_err()
            .to_string()
            .contains("Save conflict"));
        save["saveAs"] = json!(true);
        assert_eq!(
            fixture
                .host
                .request(save.clone(), Some("Copy.json".into()))
                .unwrap()["status"],
            "saved"
        );
        assert_eq!(
            read_json(&fixture.root.join("Copy.json")).unwrap(),
            save["document"]
        );
        assert!(fixture
            .host
            .request(save, Some("Gain.json".into()))
            .is_err());
        assert!(fixture
            .host
            .import("../Escape.json", &fixture.document)
            .is_err());
    }
    #[test]
    fn restore_keeps_draft_overrides_and_bypass_without_overwriting_the_file() {
        let fixture = Fixture::new();
        fixture
            .host
            .control("passthrough", None, Some(1.), None)
            .unwrap();
        fixture
            .host
            .control("parameter", Some("gain"), Some(0.25), None)
            .unwrap();
        fixture
            .host
            .control("bypass", None, Some(1.), None)
            .unwrap();
        let session = fixture.host.open_session().unwrap();
        let mut close = fixture.command(&session, 1, "close");
        close["document"]["name"] = json!("Recovered draft");
        fixture.host.request(close, None).unwrap();
        let (restored, mut driver) = Host::new(fixture.root.clone());
        driver.commands();
        driver.process(
            &mut [Frame {
                master_bpm: 120.,
                ..Frame::default()
            }; PRODUCER_FRAMES],
        );
        assert_eq!(
            restored.snapshot()["record"]["document"]["name"],
            "Recovered draft"
        );
        assert_eq!(restored.snapshot()["record"]["overrides"]["gain"], 0.25);
        assert_eq!(restored.snapshot()["record"]["bypass"], true);
        assert_eq!(restored.snapshot()["record"]["passthrough"], true);
        assert_eq!(
            read_json(&fixture.root.join("Gain.json")).unwrap()["name"],
            "Gain"
        );
    }
}
