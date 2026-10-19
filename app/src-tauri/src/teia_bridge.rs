//! Bridge-v2 policy and JSON adapters; only prepared jobs/flat samples cross RT.
use crate::{
    teia::{validate_prepared, Host, Prepared, Record},
    teia_facilities::{Capture, Task},
};
use anyhow::{bail, ensure, Context, Result};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    sync::{atomic::Ordering::SeqCst, Mutex},
};
use teia_kernel::hosted::*;
#[derive(Default)]
pub struct Bridge {
    observation: Mutex<Observed>,
    gestures: Mutex<Gestures>,
}
#[derive(Default)]
struct Observed {
    generation: u64,
    serial: u64,
    scopes: Value,
    mapping: Vec<(String, Kind)>,
    latest: Value,
    deferred: usize,
}
#[derive(Clone, Copy)]
enum Kind {
    Meter(bool),
    Scope,
    Playheads,
    Buffer,
}
#[derive(Default)]
struct Gestures {
    generation: u64,
    sequence: u64,
    last_frame: u64,
    origin: Option<(f64, u64)>,
    held: BTreeMap<usize, f64>,
}
pub fn nodes(document: &Value, prefix: &str, out: &mut Vec<(String, Value)>) {
    if let Some(list) = document["nodes"].as_array() {
        for node in list {
            if let Some(id) = node["id"].as_str() {
                let id = format!("{prefix}{id}");
                if node["type"] == "Group" {
                    nodes(&node["subpatch"], &format!("{id}__"), out);
                } else {
                    out.push((id, node.clone()));
                }
            }
        }
    }
}
pub(crate) fn without_buffers(document: &Value) -> Value {
    let mut copy = document.clone();
    if let Some(obj) = copy.as_object_mut() {
        obj.remove("buffers");
    }
    if let Some(list) = copy["nodes"].as_array_mut() {
        for n in list {
            if n["subpatch"].is_object() {
                n["subpatch"] = without_buffers(&n["subpatch"]);
            }
        }
    }
    copy
}
fn set_snapshot(document: &mut Value, target: &str, prefix: &str, snapshot: Value) -> bool {
    if let Some(list) = document["nodes"].as_array() {
        for node in list {
            if node["type"] == "Buffer"
                && node["id"]
                    .as_str()
                    .is_some_and(|id| format!("{prefix}{id}") == target)
            {
                let id = node["id"].as_str().unwrap().to_owned();
                if !document["buffers"].is_object() {
                    document["buffers"] = json!({});
                }
                document["buffers"][id] = snapshot;
                return true;
            }
        }
    }
    if let Some(list) = document["nodes"].as_array_mut() {
        for n in list {
            if n["type"] == "Group" {
                let next = format!("{prefix}{}__", n["id"].as_str().unwrap_or(""));
                if set_snapshot(&mut n["subpatch"], target, &next, snapshot.clone()) {
                    return true;
                }
            }
        }
    }
    false
}
pub fn repeated(prepared: &Prepared, state: u32) -> bool {
    prepared
        .program
        .ops
        .iter()
        .enumerate()
        .filter(|(_, op)| op.opcode == 34 && op.state == state as i32)
        .any(|(index, _)| {
            prepared.program.ops.iter().enumerate().any(|(start, op)| {
                matches!(op.opcode, 42 | 46) && start < index && (op.b as usize) > index
            })
        })
}
fn preserved(prepared: &Prepared, id: &str) -> bool {
    let state = prepared
        .program
        .metadata
        .get("stateBindings")
        .and_then(Value::as_array)
        .and_then(|items| items.iter().find(|b| b["id"] == format!("{id}:buffer")))
        .and_then(|b| b["state"].as_i64());
    state.is_some_and(|state| {
        prepared
            .program
            .ops
            .iter()
            .any(|op| op.opcode == 34 && op.state as i64 == state && op.value >= 0.5)
    })
}
fn buffer_state(prepared: &Prepared, node: &str) -> Result<u32> {
    let bindings = prepared
        .program
        .metadata
        .get("stateBindings")
        .and_then(Value::as_array)
        .context("No Buffer bindings")?;
    let b = bindings
        .iter()
        .find(|b| b["id"] == format!("{node}:buffer"))
        .context("Unknown installed Buffer")?;
    let state = b["state"].as_u64().context("Invalid Buffer state")? as u32;
    ensure!(
        !repeated(prepared, state),
        "Repeated Buffer capture needs a concrete-item persistence policy; root/group Buffers only"
    );
    Ok(state)
}
fn context(host: &Host, command: &Value) -> Result<(u64, Record)> {
    let (gen, record) = host.installed()?;
    ensure!(
        command["generation"]
            .as_str()
            .and_then(|s| s.parse::<u64>().ok())
            == Some(gen),
        "Stale Teia runtime generation"
    );
    Ok((gen, record))
}
fn capture(host: &Host, generation: u64, prepared: &Prepared, state: u32) -> Result<Capture> {
    ensure!(
        host.telemetry.alive.load(SeqCst),
        "Native producer is unavailable"
    );
    let program = validate_prepared(prepared, generation)?;
    let job = host.facilities.request(
        generation,
        Task::Capture {
            identity: program.identity(),
            state,
            data: Capture {
                samples: vec![0.; 960000], // Native Buffer capacity is bounded in samples.
                count: 0,
                rate: (crate::sample_rate::get() as f64),
            },
        },
    )?;
    match job.task {
        Task::Capture { mut data, .. } => {
            data.samples.truncate(data.count);
            Ok(data)
        }
        _ => unreachable!(),
    }
}
impl Host {
    pub(crate) fn snapshots_for_reset(&self, generation: u64, record: &Record) -> Result<Value> {
        let mut expanded = Vec::new();
        nodes(&record.installed_document, "", &mut expanded);
        let mut refs = serde_json::Map::new();
        for (id, node) in expanded {
            if node["type"] == "Buffer" && preserved(&record.prepared, &id) {
                let state = buffer_state(&record.prepared, &id)?;
                let data = capture(self, generation, &record.prepared, state)?;
                refs.insert(id, self.store_buffer(&data.samples, data.rate)?);
            }
        }
        Ok(Value::Object(refs))
    }
    pub(crate) fn release_gestures(&self) {
        let mut state = self.bridge.gestures.lock().unwrap();
        let gen = state.generation;
        if gen != 0 && self.telemetry.generation.load(SeqCst) == gen {
            let frame = self
                .telemetry
                .render_frame
                .load(SeqCst)
                .saturating_add(1)
                .max(state.last_frame.saturating_add(1));
            state.last_frame = frame;
            for index in state.held.keys() {
                if !self.midi.enqueue_control(frame, gen, *index, 0.) {
                    break;
                }
            }
        }
        state.held.clear();
        state.origin = None;
    }
    pub(crate) fn end_gestures(&self) {
        self.release_gestures();
        self.bridge.gestures.lock().unwrap().sequence = 0;
    }
    pub(crate) fn held_value(&self, generation: u64, index: usize) -> bool {
        let state = self.bridge.gestures.lock().unwrap();
        state.generation == generation && state.held.contains_key(&index)
    }
    pub(crate) fn hosted_request(&self, command: &Value) -> Result<Value> {
        let kind = command["type"].as_str().unwrap_or("");
        let reply = |status: &str, generation: u64| json!({"requestId":command["requestId"],"sessionId":command["sessionId"],"revision":command["revision"],"generation":generation.to_string(),"status":status});
        if matches!(kind, "gesture" | "release gestures") {
            ensure!(command["version"] == 1, "Unsupported gesture version");
            ensure!(
                self.telemetry.reset_generation.load(SeqCst) == 0,
                "Patch audio is recovering automatically; try again shortly"
            );
            let (generation, record) = context(self, command)?;
            let sequence = command["sequence"]
                .as_u64()
                .context("Missing gesture sequence")?;
            let mut state = self.bridge.gestures.lock().unwrap();
            if state.generation != generation {
                *state = Gestures {
                    generation,
                    ..Default::default()
                };
            }
            ensure!(sequence > state.sequence, "Out-of-order gesture");
            state.sequence = sequence;
            if kind == "release gestures" {
                drop(state);
                self.release_gestures();
                return Ok(reply("updated", generation));
            }
            ensure!(
                command["layout"] == record.prepared.layout,
                "Gesture layout is stale"
            );
            let id = command["nodeId"].as_str().context("Missing gesture node")?;
            let mut expanded = Vec::new();
            nodes(&record.installed_document, "", &mut expanded);
            let node = expanded
                .iter()
                .find(|(n, _)| n == id)
                .map(|(_, n)| n)
                .context("Unknown installed gesture node")?;
            let ports: &[&str] = match node["type"].as_str() {
                Some("Button") => &["pressed", "clicks"],
                Some("Keys") => &["note", "frequency", "gate", "velocity"],
                _ => bail!("Node has no gesture controls"),
            };
            let values = command["values"]
                .as_object()
                .context("Missing gesture values")?;
            ensure!(
                !values.is_empty() && values.len() <= 4,
                "Invalid gesture values"
            );
            let timestamp = command["timestamp"]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 0.)
                .context("Invalid gesture timestamp")?;
            let render = self.telemetry.render_frame.load(SeqCst).saturating_add(1);
            let origin = state.origin.get_or_insert((timestamp, render));
            let elapsed = ((timestamp - origin.0).max(0.) * crate::sample_rate::get() as f64
                / 1000.)
                .min(crate::sample_rate::get() as f64) as u64;
            let frame = (origin.1 + elapsed)
                .max(render)
                .max(state.last_frame.saturating_add(1));
            state.last_frame = frame;
            let bindings = record
                .prepared
                .program
                .metadata
                .get("valueBindings")
                .and_then(Value::as_array)
                .context("No control bindings")?;
            let mut updates = Vec::new();
            for (port, value) in values {
                let value = value
                    .as_f64()
                    .filter(|v| v.is_finite() && *v >= 0.)
                    .context("Invalid gesture value")?;
                ensure!(
                    ports.contains(&port.as_str())
                        && match port.as_str() {
                            "pressed" | "gate" | "velocity" => value <= 1.,
                            "note" => value <= 127.,
                            "frequency" => value <= 24000.,
                            "clicks" => value.fract() == 0. && value <= 9007199254740991.,
                            _ => false,
                        },
                    "Invalid gesture port/range"
                );
                if let Some(binding) = bindings
                    .iter()
                    .find(|b| b["nodeId"] == id && b["port"] == *port && b["kind"] == "node-param")
                {
                    let index = binding["valueIndex"]
                        .as_u64()
                        .context("Invalid gesture binding")?
                        as usize;
                    ensure!(
                        index < record.prepared.program.values.len(),
                        "Invalid gesture index"
                    );
                    updates.push((index, value));
                    if port != "clicks" {
                        if value == 0. {
                            state.held.remove(&index);
                        } else {
                            state.held.insert(index, value);
                        }
                    }
                }
            }
            for (index, value) in updates {
                if !self.midi.enqueue_control(frame, generation, index, value) {
                    state.held.clear();
                    bail!("Gesture queue overflow; generation cancelled and reset requested");
                }
            }
            return Ok(reply("updated", generation));
        }
        if kind == "feedback" {
            let scopes = command["scopes"]
                .as_array()
                .context("Invalid scope subscription")?;
            ensure!(
                scopes.len() <= 4,
                "Vira supports at most four scope subscriptions"
            );
            self.bridge.observation.lock().unwrap().scopes = Value::Array(scopes.clone());
            return Ok(reply("updated", self.installed()?.0));
        }
        if kind == "capture save" {
            let mut required = Vec::new();
            nodes(&command["document"], "", &mut required);
            let native = self.installed()?.1;
            required.retain(|(id, n)| {
                n["type"] == "Buffer"
                    && (n["params"]["on reset"].as_f64().unwrap_or(0.) >= 0.5
                        || preserved(&native.prepared, id))
            });
            let generation = command["generation"]
                .as_str()
                .and_then(|s| s.parse().ok())
                .context("Missing capture generation")?;
            if required.is_empty() {
                let mut result = reply("captured", generation);
                result["capturedDocument"] = command["document"].clone();
                return Ok(result);
            }
            let (_, record) = context(self, command)?;
            ensure!(
                without_buffers(&record.installed_document)
                    == without_buffers(&command["document"]),
                "Apply this exact document before saving live Buffer recordings"
            );
            ensure!(
                command["installedRevision"].as_u64() == Some(self.installed_revision()),
                "Buffer capture revision is not installed"
            );
            let epoch = self.facilities.epoch.load(SeqCst);
            let mut document = command["document"].clone();
            for (id, _) in required {
                if !preserved(&record.prepared, &id) {
                    continue;
                }
                ensure!(
                    self.facilities.epoch.load(SeqCst) == epoch,
                    "Buffer Save capture was cancelled"
                );
                let state = buffer_state(&record.prepared, &id)?;
                let data = capture(self, generation, &record.prepared, state)?;
                let snapshot = self.store_buffer(&data.samples, data.rate)?;
                ensure!(
                    set_snapshot(&mut document, &id, "", snapshot),
                    "Buffer document identity changed"
                );
            }
            ensure!(
                self.installed()?.0 == generation
                    && self.facilities.epoch.load(SeqCst) == epoch
                    && command["installedRevision"].as_u64() == Some(self.installed_revision()),
                "Runtime or installed revision changed during Buffer capture"
            );
            let mut result = reply("captured", generation);
            result["capturedDocument"] = document;
            return Ok(result);
        }
        let (generation, record) = context(self, command)?;
        let node = command["nodeId"].as_str().context("Missing Buffer node")?;
        let state = buffer_state(&record.prepared, node)?;
        if kind == "capture buffer" {
            let data = capture(self, generation, &record.prepared, state)?;
            let mut result = reply("captured", generation);
            result["bufferSnapshot"] = json!({"samples":data.samples,"sampleRate":data.rate});
            return Ok(result);
        }
        let program = validate_prepared(&record.prepared, generation)?;
        let replacement = if kind == "restore buffer" {
            let samples: Vec<f32> = serde_json::from_value(command["snapshot"]["samples"].clone())?;
            let source_rate = command["snapshot"]["sampleRate"]
                .as_f64()
                .context("Missing sample rate")?;
            crate::teia_resources::validate_buffer_rate(samples.len(), source_rate)?;
            BufferReplacement::prepare_resampled(
                &program,
                BufferAddress::root(state),
                &samples,
                source_rate,
                crate::sample_rate::get() as f64,
            )
        } else if kind == "buffer" && command["action"] == "clear" {
            BufferReplacement::clear(&program, state, 2)
        } else if kind == "buffer" && command["action"] == "copy" {
            let target = buffer_state(
                &record.prepared,
                command["targetNodeId"]
                    .as_str()
                    .context("Missing copy target")?,
            )?;
            let data = capture(self, generation, &record.prepared, state)?;
            BufferReplacement::prepare(&program, target, &data.samples)
        } else {
            bail!("Unavailable hosted command")
        };
        self.facilities.request(
            generation,
            Task::Replace(
                replacement.map_err(|e| anyhow::anyhow!("Buffer preparation failed: {e:?}"))?,
            ),
        )?;
        Ok(reply("updated", generation))
    }
    pub(crate) fn observation_feedback(&self) -> Result<Value> {
        let (generation, record) = self.installed()?;
        let mut observed = self.bridge.observation.lock().unwrap();
        let scopes = observed.scopes.as_array().cloned().unwrap_or_default();
        let signature = serde_json::to_string(
            &json!({"scopes":scopes,"monitors":record.prepared.program.metadata.get("monitorIds"),"states":record.prepared.program.metadata.get("stateBindings"),"samples":record.prepared.program.metadata.get("sampleBindings"),"signed":record.prepared.program.metadata.get("signedMeterIds")}),
        )?;
        let current_signature = observed.latest["_scopes"].as_str().unwrap_or("");
        if observed.generation != generation
            || current_signature != signature
            || !self.facilities.enabled.load(SeqCst)
        {
            let program = validate_prepared(&record.prepared, generation)?;
            let meta = &record.prepared.program.metadata;
            let monitors = meta.get("monitorIds").and_then(Value::as_object);
            let mut requests = Vec::new();
            let mut mapping = Vec::new();
            let mut deferred = 0;
            if let Some(monitors) = monitors {
                for (id, register) in monitors {
                    if mapping.len() >= 16 {
                        deferred += 1;
                        continue;
                    }
                    let signed = meta
                        .get("signedMeterIds")
                        .and_then(Value::as_array)
                        .is_some_and(|ids| ids.iter().any(|v| v == id));
                    requests.push(Observation::Meter {
                        register: register.as_u64().context("Invalid monitor register")? as u32,
                    });
                    mapping.push((id.clone(), Kind::Meter(signed)));
                }
            }
            for scope in scopes.iter().take(4) {
                let id = scope["id"].as_str().context("Invalid scope ID")?;
                let Some(register) = monitors.and_then(|m| m.get(id)).and_then(Value::as_u64)
                else {
                    deferred += 1;
                    continue;
                };
                requests.push(Observation::Scope {
                    register: register as u32,
                    seconds: scope["length"].as_f64().unwrap_or(0.08).clamp(0.01, 30.),
                    points: scope["points"].as_u64().unwrap_or(128).clamp(32, 256) as u32,
                    reset: if scope["reset"] == "zero-crossing" {
                        ScopeReset::ZeroCrossing
                    } else {
                        ScopeReset::None
                    },
                });
                mapping.push((id.to_owned(), Kind::Scope));
            }
            if let Some(samples) = meta.get("sampleBindings").and_then(Value::as_array) {
                for (index, binding) in samples.iter().take(4).enumerate() {
                    requests.push(Observation::SamplePlayheads {
                        binding: index as u32,
                        limit: 16,
                    });
                    mapping.push((
                        binding["nodeId"].as_str().unwrap_or("").to_owned(),
                        Kind::Playheads,
                    ));
                }
                deferred += samples.len().saturating_sub(4);
            }
            if let Some(bindings) = meta.get("stateBindings").and_then(Value::as_array) {
                let mut count = 0;
                for b in bindings {
                    if b["id"].as_str().is_some_and(|id| id.ends_with(":buffer")) {
                        let state = b["state"].as_u64().unwrap_or(0) as u32;
                        if count == 4 || repeated(&record.prepared, state) {
                            deferred += 1;
                            continue;
                        }
                        requests.push(Observation::Buffer { state, points: 64 });
                        mapping.push((b["nodeId"].as_str().unwrap_or("").to_owned(), Kind::Buffer));
                        count += 1;
                    }
                }
            }
            let plan = ObservationPlan::prepare(&program, &requests)
                .map_err(|e| anyhow::anyhow!("Observation preparation: {e:?}"))?;
            let job = self
                .facilities
                .request(generation, Task::Observe(Some(plan)))?;
            observed.serial = job.id;
            observed.mapping = mapping;
            observed.generation = generation;
            observed.deferred = deferred;
            observed.latest = json!({"_scopes":signature});
            self.facilities.enabled.store(true, SeqCst);
        }
        if let Some(frame) = self
            .facilities
            .latest()
            .filter(|frame| frame.serial == observed.serial && frame.generation == generation)
        {
            let mut payload = json!({"meters":{},"scopes":{},"playheads":{},"buffers":{},"observation":{"layout":frame.layout.to_string(),"dropped":frame.dropped+observed.deferred,"eventOverflows":frame.event_overflows,"queuedNotes":frame.queued_notes},"_scopes":signature});
            for reading in &frame.values[..frame.count] {
                if let Some((id, kind)) = observed.mapping.get(reading.request) {
                    match kind {
                        Kind::Meter(signed) => {
                            let value = if *signed {
                                reading.auxiliary
                            } else {
                                reading.value
                            };
                            payload["meters"][id] =
                                json!({"input":value,"output":value,"envelope":reading.value});
                        }
                        Kind::Scope => {
                            if payload["scopes"][id].is_null() {
                                payload["scopes"][id] = json!({"mode":"set","samples":[]});
                            }
                            payload["scopes"][id]["samples"]
                                .as_array_mut()
                                .unwrap()
                                .push(json!(reading.value));
                        }
                        Kind::Playheads => {
                            if payload["playheads"][id].is_null() {
                                payload["playheads"][id] = json!([]);
                            }
                            payload["playheads"][id]
                                .as_array_mut()
                                .unwrap()
                                .push(json!(reading.value));
                        }
                        Kind::Buffer => {
                            if payload["buffers"][id].is_null() {
                                payload["buffers"][id] =
                                    json!({"playhead":0.,"recordHead":0.,"bins":[]});
                            }
                            if reading.index == 0 {
                                payload["buffers"][id]["playhead"] = json!(reading.value);
                                payload["buffers"][id]["recordHead"] = json!(reading.auxiliary);
                            } else {
                                payload["buffers"][id]["bins"]
                                    .as_array_mut()
                                    .unwrap()
                                    .push(json!({"min":reading.value,"max":reading.auxiliary}));
                            }
                        }
                    }
                }
            }
            observed.latest = payload;
        }
        let mut payload = observed.latest.clone();
        payload.as_object_mut().unwrap().remove("_scopes");
        Ok(payload)
    }
}
