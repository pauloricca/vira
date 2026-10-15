import {
  COMPILER_VERSION,
  DOCUMENT_VERSION,
  NATIVE_PROFILE,
  bufferReferences,
  classifyEdit,
  cloneParameterIds,
  createPatchPackage,
  engineCapabilities_default,
  gestureUpdates,
  parameterMetadata,
  patchToJson,
  preparePatch,
  readDocument,
  retainNestedBufferReferences,
  withParameterIds
} from "./chunk-2YJPUQUH.js";

// editor/src/hosted/assets.ts
async function prepareAssets(prepared, resolve, signal) {
  const requests = [
    ...prepared.requirements.samples.map((b) => ({ kind: "sample", nodeId: b.nodeId, reference: b.sample.url })),
    ...prepared.requirements.images.map((b) => ({ kind: "image", nodeId: b.nodeId, reference: b.image.url })),
    ...Object.entries(prepared.requirements.buffers ?? {}).map(([nodeId, b]) => ({ kind: "buffer", nodeId, reference: b.hash }))
  ];
  const assets = /* @__PURE__ */ new Map();
  let bytes = 0;
  for (const request of requests) {
    signal?.throwIfAborted();
    const asset = await resolve(request, signal);
    signal?.throwIfAborted();
    if (asset.kind !== request.kind) throw new Error(`Asset kind mismatch for ${request.nodeId}.`);
    if (asset.kind === "image") {
      if (!Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width < 1 || asset.height < 1 || asset.width > 1024 || asset.height > 1024 || asset.rgba.byteLength !== asset.width * asset.height * 4) throw new Error("Invalid prepared image.");
      bytes += asset.rgba.byteLength;
    } else {
      if (!Number.isFinite(asset.sampleRate) || asset.sampleRate <= 0 || asset.channels.length !== 1 || asset.channels[0].length < 1 || asset.channels[0].length > (asset.kind === "buffer" ? 96e4 : 32 * 1024 * 1024) || asset.channels[0].some((v) => !Number.isFinite(v))) throw new Error("Invalid prepared mono media.");
      bytes += asset.channels[0].byteLength;
    }
    if (bytes > 512 * 1024 * 1024) throw new Error("Prepared assets exceed the 512 MiB preparation budget.");
    assets.set(`${request.kind}:${request.nodeId}`, asset);
  }
  return assets;
}

// editor/src/hosted/bridge.ts
var BRIDGE_VERSION = 2;

// editor/src/hosted/parameters.ts
function normalizeParameterValue(parameter, value) {
  let bounded = Math.max(parameter.min, Math.min(parameter.max, value));
  if (parameter.integer) bounded = Math.round(bounded);
  else if (parameter.step && parameter.step > 0) bounded = parameter.min + Math.round((bounded - parameter.min) / parameter.step) * parameter.step;
  return Math.max(parameter.min, Math.min(parameter.max, bounded));
}
var ParameterOverrides = class {
  values = /* @__PURE__ */ new Map();
  set(prepared, id, value) {
    const parameter = prepared.parameters.find((p) => p.id === id);
    if (!parameter || !Number.isFinite(value)) throw new Error("Unknown parameter or invalid value.");
    this.values.set(id, normalizeParameterValue(parameter, value));
  }
  clear(id) {
    this.values.delete(id);
  }
  /** Rebind only by persistent ID when a new program is installed. */
  bind(prepared) {
    return prepared.parameters.flatMap((p) => {
      if (!this.values.has(p.id)) return [];
      const value = normalizeParameterValue(p, this.values.get(p.id));
      this.values.set(p.id, value);
      return [{ valueIndex: p.binding.valueIndex, value }];
    });
  }
  filterDefaults(prepared, updates) {
    const overridden = new Set(this.bind(prepared).map((b) => b.valueIndex));
    return updates.filter((u) => !overridden.has(u.valueIndex));
  }
};

// editor/src/hosted/session.ts
var HostedSession = class {
  constructor(sessionId, initial, capabilities, bridge, generation = null) {
    this.sessionId = sessionId;
    this.capabilities = capabilities;
    this.bridge = bridge;
    const read = readDocument(initial);
    if (!read.patch || read.diagnostics.some((d) => d.severity === "error" || d.code === "discarded-content")) throw new Error("Initial hosted document is invalid.");
    this.document = withParameterIds(read.patch);
    this.saved = patchToJson(this.document);
    this.state = { revision: 0, savedRevision: 0, installedRevision: generation === null ? null : 0, generation, dirty: false, connected: true, applying: false, diagnostics: read.diagnostics, parameters: [], parameterValues: {} };
    if (generation !== null) {
      const prepared = preparePatch(this.document, { profile: capabilities.profile });
      if ("program" in prepared && !prepared.diagnostics.some((d) => d.severity === "error")) this.installed = prepared;
    }
    this.state.parameters = this.installed?.parameters ?? [];
    this.unsubscribe = bridge.subscribe((event) => this.receive(event));
  }
  sessionId;
  capabilities;
  bridge;
  document;
  saved;
  sequence = 0;
  gestureSequence = 0;
  gestureValues = /* @__PURE__ */ new Map();
  epoch = 0;
  disposed = false;
  installed;
  pending = /* @__PURE__ */ new Map();
  listeners = /* @__PURE__ */ new Set();
  unsubscribe;
  lastFeedback = -Infinity;
  parameterWrites = /* @__PURE__ */ new Map();
  state;
  getSnapshot = () => this.state;
  getDocument = () => structuredClone(this.document);
  getParameterLabel(id) {
    const find = (patch) => {
      for (const node of patch.nodes) {
        const port = node.outputs?.find((p) => p.parameterId === id);
        if (node.type === "Params" && port) return port.name;
        if (node.subpatch) {
          const label = find(node.subpatch);
          if (label) return label;
        }
      }
      return void 0;
    };
    return find(this.document) ?? id;
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  publish(update) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  context() {
    return { requestId: `${this.sessionId}:${++this.sequence}`, sessionId: this.sessionId, revision: this.state.revision, generation: this.state.generation };
  }
  matching(command, reply) {
    return reply.requestId === command.requestId && reply.sessionId === command.sessionId && reply.revision === command.revision;
  }
  async edit(document, force = false) {
    if (this.disposed) return;
    const editable = withParameterIds(document);
    if (!force && patchToJson(editable) === patchToJson(this.document)) return;
    this.document = structuredClone(editable);
    const revision = this.state.revision + 1;
    this.publish({ revision, dirty: patchToJson(editable) !== this.saved, applying: this.state.connected });
    if (this.state.connected) {
      try {
        void this.bridge.request({ ...this.context(), type: "revision" }).catch(() => void 0);
      } catch {
      }
    }
    const result = preparePatch(editable, { profile: this.capabilities.profile });
    const prepared = "program" in result ? result : void 0;
    const valid = prepared && !prepared.diagnostics.some((d) => d.severity === "error");
    this.publish({ revision, dirty: patchToJson(editable) !== this.saved, diagnostics: result.diagnostics, applying: this.state.connected });
    if (!this.state.connected) return;
    let change = valid && this.installed ? classifyEdit(this.installed, prepared) : { kind: "prepare", reason: valid ? "Initial apply." : "Invalid working revision; preserve installed graph." };
    if (change.kind === "specialized" && (change.customWaves && !this.capabilities.specializedControls?.includes("custom wave") || change.sequencers && !this.capabilities.specializedControls?.includes("sequencer"))) change = { kind: "prepare", reason: "Host does not advertise the specialized control update." };
    const command = {
      ...this.context(),
      type: "apply",
      document: this.getDocument(),
      ...valid ? { prepared } : {},
      change
    };
    this.pending.set(command.requestId, { revision, ...valid ? { prepared } : {} });
    const epoch = this.epoch;
    try {
      const reply = await this.bridge.request(command);
      if (epoch !== this.epoch || !this.matching(command, reply)) return;
      if (reply.status === "installed") this.acceptInstall(reply);
      else if (reply.status !== "queued") {
        this.pending.delete(command.requestId);
        if (revision === this.state.revision) this.publish({ applying: false, ...reply.status === "failed" ? { diagnostics: [...result.diagnostics, ...reply.diagnostics ?? []] } : {} });
      }
    } catch (error) {
      this.pending.delete(command.requestId);
      if (epoch === this.epoch && revision === this.state.revision) this.publish({ applying: false, diagnostics: [{ severity: "error", code: "bridge-apply", message: String(error) }] });
    }
  }
  acceptInstall(context) {
    const pending = this.pending.get(context.requestId);
    if (!pending?.prepared || context.revision !== pending.revision || context.generation === null || context.revision <= (this.state.installedRevision ?? -1)) return;
    this.releaseGestures("graph swap");
    this.lastFeedback = -Infinity;
    this.installed = pending.prepared;
    this.parameterWrites.clear();
    const parameterValues = {};
    for (const parameter of this.installed.parameters) {
      const value = this.state.parameterValues[parameter.id];
      if (value !== void 0) parameterValues[parameter.id] = normalizeParameterValue(parameter, value);
    }
    for (const [id, application] of this.pending) if (application.revision <= context.revision) this.pending.delete(id);
    this.publish({ parameters: this.installed.parameters, parameterValues, generation: context.generation, installedRevision: context.revision, applying: context.revision === this.state.revision ? false : this.state.applying, feedback: void 0 });
  }
  receive(event) {
    if (this.disposed || event.sessionId !== this.sessionId) return;
    if (event.type === "connection") {
      this.epoch++;
      this.pending.clear();
      this.gestureValues.clear();
      this.parameterWrites.clear();
      this.publish({ connected: event.connected, applying: false, feedback: void 0 });
      return;
    }
    if (!this.state.connected) return;
    if (event.type === "installed") {
      this.acceptInstall(event);
      return;
    }
    if (event.type === "diagnostics") {
      if (event.revision === this.state.revision) this.publish({ diagnostics: event.diagnostics.slice(0, 128), applying: false });
      return;
    }
    if (event.generation !== this.state.generation || event.revision !== this.state.installedRevision) return;
    const now = performance.now();
    const hz = Math.max(1, Math.min(60, Number.isFinite(this.capabilities.maxFeedbackHz) ? this.capabilities.maxFeedbackHz : 30));
    if (now - this.lastFeedback < 1e3 / hz || !boundedFeedback(event)) return;
    this.lastFeedback = now;
    const allowed = this.capabilities.feedback ?? [];
    const parameterValues = { ...this.state.parameterValues };
    if (allowed.includes("parameters") && event.parameters) {
      for (const parameter of this.state.parameters) {
        const value = event.parameters[parameter.id];
        if (Number.isFinite(value) && !this.parameterWrites.has(parameter.id)) parameterValues[parameter.id] = normalizeParameterValue(parameter, value);
      }
    }
    this.publish({ parameterValues, feedback: structuredClone({
      ...event,
      meters: allowed.includes("meters") ? event.meters : void 0,
      scopes: allowed.includes("scopes") ? event.scopes : void 0,
      playheads: allowed.includes("playheads") ? event.playheads : void 0,
      buffers: allowed.includes("buffers") ? event.buffers : void 0,
      parameters: allowed.includes("parameters") ? event.parameters : void 0
    }) });
  }
  async save(saveAs = false) {
    if (!this.capabilities.save || saveAs && !this.capabilities.saveAs || !this.state.connected || this.disposed) return false;
    let document = this.getDocument();
    const validation = readDocument(document);
    const errors = [...validation.diagnostics, ...this.capabilities.requireExecutableToSave ? preparePatch(document, { profile: this.capabilities.profile }).diagnostics : []].filter((d) => d.severity === "error");
    this.publish({ saveDiagnostics: errors });
    if (errors.length) {
      this.publish({ diagnostics: errors });
      return false;
    }
    const context = this.context();
    const epoch = this.epoch;
    try {
      if (this.capabilities.bridgeVersion === 2 && this.capabilities.bufferCapture === 1) {
        const capture = { ...context, type: "capture save", version: 1, document, installedRevision: this.state.installedRevision };
        const reply2 = await this.bridge.request(capture);
        if (epoch !== this.epoch || this.disposed || !this.matching(capture, reply2) || reply2.generation !== context.generation || this.state.generation !== context.generation || reply2.status !== "captured" || !reply2.capturedDocument) throw new Error("Host Buffer capture did not complete.");
        const captured = readDocument(reply2.capturedDocument);
        if (!captured.patch || captured.diagnostics.some((d) => d.severity === "error" || d.code === "discarded-content") || withoutBuffers(captured.patch) !== withoutBuffers(document)) throw new Error(`Capture must return the exact document with only durable Buffer references changed. ${JSON.stringify(captured.diagnostics)}`);
        document = mergeCapturedBuffers(document, captured.patch);
      }
      const command = { ...context, requestId: `${context.requestId}:persist`, type: "save", saveAs, document };
      const snapshot = patchToJson(document);
      const reply = await this.bridge.request(command);
      if (epoch !== this.epoch || this.disposed || !this.matching(command, reply)) return false;
      if (reply.status === "failed") {
        const diagnostics = reply.diagnostics?.slice(0, 128) ?? [];
        this.publish({ diagnostics, saveDiagnostics: diagnostics });
        return false;
      }
      if (reply.status !== "saved" || command.revision < this.state.savedRevision) return false;
      this.saved = snapshot;
      if (this.state.revision === command.revision) this.document = structuredClone(document);
      this.publish({ savedRevision: command.revision, dirty: patchToJson(this.document) !== snapshot });
      return true;
    } catch (error) {
      if (epoch === this.epoch) {
        const diagnostics = [{ severity: "error", code: "bridge-save", message: String(error) }];
        this.publish({ diagnostics, saveDiagnostics: diagnostics });
      }
      return false;
    }
  }
  async close() {
    this.releaseGestures("close");
    const command = { ...this.context(), type: "close", dirty: this.state.dirty, document: this.getDocument() };
    const epoch = this.epoch;
    const reply = await this.bridge.request(command);
    return epoch === this.epoch && this.matching(command, reply) && reply.status === "closed" && command.revision === this.state.revision;
  }
  async resync() {
    const command = { ...this.context(), type: "resync" };
    const epoch = this.epoch;
    const reply = await this.bridge.request(command);
    if (epoch !== this.epoch || this.disposed || !this.matching(command, reply) || reply.status !== "connected") return false;
    this.installed = void 0;
    this.parameterWrites.clear();
    this.publish({ connected: true, generation: reply.generation, installedRevision: null, feedback: void 0, parameters: [], parameterValues: {} });
    const document = this.getDocument();
    await this.edit(document, true);
    return true;
  }
  /** An instance override; never changes working document defaults. */
  async setParameter(parameterId, value) {
    const parameter = this.state.parameters.find((p) => p.id === parameterId);
    if (!parameter || !Number.isFinite(value) || !this.state.connected || this.state.generation === null || this.disposed) return false;
    const normalized = normalizeParameterValue(parameter, value);
    const command = { ...this.context(), type: "parameter", parameterId, value: normalized };
    const epoch = this.epoch;
    this.parameterWrites.set(parameterId, command.requestId);
    let accepted = false;
    try {
      const reply = await this.bridge.request(command);
      accepted = epoch === this.epoch && !this.disposed && this.matching(command, reply) && reply.status === "updated" && reply.generation === command.generation && this.state.generation === command.generation;
      if (accepted && this.parameterWrites.get(parameterId) === command.requestId) {
        this.publish({ parameterValues: { ...this.state.parameterValues, [parameterId]: normalized } });
      }
      return accepted;
    } catch {
      return false;
    } finally {
      if (this.parameterWrites.get(parameterId) === command.requestId) this.parameterWrites.delete(parameterId);
    }
  }
  async selectMedia(request) {
    const select = this.bridge.assets?.selectMedia;
    if (!select || !this.state.connected || this.disposed) {
      this.reportUnavailable("Media selection requires a supplied host asset adapter.");
      return null;
    }
    const context = this.context();
    const epoch = this.epoch;
    const asset = await select({ ...context, ...request });
    if (this.disposed || epoch !== this.epoch || context.revision !== this.state.revision) return null;
    return asset;
  }
  async captureBuffer(nodeId) {
    if (this.capabilities.bridgeVersion !== 2 || !this.capabilities.bufferCapture || !this.state.connected || !this.state.generation || this.disposed) {
      this.reportUnavailable("Buffer capture requires bridge v2 and a host capture adapter.");
      return null;
    }
    const command = { ...this.context(), type: "capture buffer", version: 1, nodeId };
    const epoch = this.epoch;
    try {
      const reply = await this.bridge.request(command);
      const snapshot = reply.bufferSnapshot;
      if (epoch !== this.epoch || this.disposed || !this.matching(command, reply) || reply.generation !== command.generation || this.state.generation !== command.generation || reply.status !== "captured" || !snapshot || !(snapshot.samples instanceof Float32Array) || snapshot.samples.length < 2 || snapshot.samples.length > 96e4 || !Number.isFinite(snapshot.sampleRate) || snapshot.sampleRate <= 0 || !snapshot.samples.every(Number.isFinite)) return null;
      return snapshot;
    } catch {
      return null;
    }
  }
  async restoreBuffer(nodeId, snapshot) {
    if (this.capabilities.bridgeVersion !== 2 || !this.capabilities.bufferCapture || !this.capabilities.bufferMutation || !this.state.connected || !this.state.generation || this.disposed || snapshot.samples.length < 2 || snapshot.samples.length > 96e4 || !snapshot.samples.every(Number.isFinite) || !Number.isFinite(snapshot.sampleRate) || snapshot.sampleRate <= 0) return false;
    const command = { ...this.context(), type: "restore buffer", version: 1, nodeId, snapshot };
    const epoch = this.epoch;
    try {
      const reply = await this.bridge.request(command);
      return epoch === this.epoch && !this.disposed && this.matching(command, reply) && reply.status === "updated" && reply.generation === command.generation && this.state.generation === command.generation;
    } catch {
      return false;
    }
  }
  async mutateBuffer(action, nodeId, targetNodeId) {
    if (!this.capabilities.bufferMutation || !this.state.connected || !this.state.generation || this.disposed) {
      this.reportUnavailable("Buffer mutation requires a supplied host capability.");
      return false;
    }
    const command = { ...this.context(), type: "buffer", action, nodeId, ...targetNodeId ? { targetNodeId } : {} };
    const epoch = this.epoch;
    try {
      const reply = await this.bridge.request(command);
      return epoch === this.epoch && !this.disposed && this.matching(command, reply) && reply.status === "updated" && reply.generation === command.generation && this.state.generation === command.generation;
    } catch {
      return false;
    }
  }
  /** Ordered transient controls bypass document edits and graph supersession.
   * Host validates bindings against layout, schedules in sequence order, and
   * acknowledges updated only after acceptance in its bounded render queue.
   * Queue overflow must cancel/release the generation, never discard a release.
   */
  gesture(nodeId, values) {
    if (!this.capabilities.gestures || this.capabilities.bridgeVersion !== 2) return;
    if (!this.state.connected || !this.state.generation || !this.installed || this.disposed) {
      this.reportUnavailable("Gestures require an installed, connected host graph.");
      return;
    }
    if (!Object.values(values).every(Number.isFinite)) return;
    const previous = this.gestureValues.get(nodeId) ?? {};
    if ("clicks" in values) values = { ...values, clicks: (previous.clicks ?? 0) + 1 };
    this.gestureValues.set(nodeId, { ...previous, ...values });
    const command = { ...this.context(), type: "gesture", version: 1, sequence: ++this.gestureSequence, layout: this.installed.layout, nodeId, values, timestamp: performance.now() };
    const epoch = this.epoch;
    void this.bridge.request(command).then((reply) => {
      if (epoch !== this.epoch || this.disposed || this.state.generation !== command.generation) return;
      if (!this.matching(command, reply) || reply.generation !== command.generation || reply.status !== "updated") {
        this.releaseGestures("focus loss");
        this.reportUnavailable("Host rejected a transient gesture; held controls were cancelled.");
      }
    }).catch(() => {
      if (epoch === this.epoch && !this.disposed) {
        this.releaseGestures("focus loss");
        this.reportUnavailable("Gesture transport failed; host must release controls on disconnect.");
      }
    });
  }
  releaseGestures(reason) {
    this.gestureValues.clear();
    if (this.capabilities.bridgeVersion !== 2 || !this.capabilities.gestures || !this.state.connected || !this.state.generation || this.disposed) return;
    try {
      void this.bridge.request({ ...this.context(), type: "release gestures", version: 1, sequence: ++this.gestureSequence, reason }).catch(() => void 0);
    } catch {
    }
  }
  reportUnavailable(message) {
    this.publish({ diagnostics: [{ severity: "warning", code: "host-adapter-required", message }] });
  }
  async toggleTransport() {
    if (this.capabilities.transport && this.state.connected) await this.bridge.request({ ...this.context(), type: "transport", action: "toggle" });
  }
  requestFeedback(scopes) {
    if (this.capabilities.feedback?.length && this.state.connected) void this.bridge.request({ ...this.context(), type: "feedback", scopes: scopes.slice(0, 32).map((s) => ({ ...s, length: Number.isFinite(s.length) ? Math.max(1e-4, Math.min(30, s.length)) : 0.08, points: Number.isFinite(s.points) ? Math.max(1, Math.min(1024, Math.floor(s.points))) : 256 })) }).catch(() => void 0);
  }
  dispose() {
    this.releaseGestures("dispose");
    this.disposed = true;
    this.epoch++;
    this.unsubscribe();
    this.listeners.clear();
    this.pending.clear();
    this.parameterWrites.clear();
  }
};
function boundedFeedback(event) {
  for (const map of [event.meters, event.scopes, event.playheads, event.buffers, event.parameters]) if (map && Object.keys(map).length > 128) return false;
  if (event.tempo && (![event.tempo.bpm, event.tempo.beat, event.tempo.renderFrame].every(Number.isFinite) || event.tempo.bpm <= 0 || typeof event.tempo.running !== "boolean")) return false;
  if (Object.values(event.parameters ?? {}).some((value) => !Number.isFinite(value))) return false;
  if (Object.values(event.scopes ?? {}).some((s) => s.samples.length > 1024)) return false;
  if (Object.values(event.playheads ?? {}).some((s) => s.length > 128)) return false;
  if (Object.values(event.buffers ?? {}).some((s) => s.bins.length > 1024)) return false;
  return true;
}
function withoutBuffers(patch) {
  const copy = structuredClone(patch);
  const strip = (p) => {
    delete p.buffers;
    for (const node of p.nodes) if (node.subpatch) strip(node.subpatch);
  };
  strip(copy);
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  return JSON.stringify(canonical(JSON.parse(patchToJson(copy))));
}
function mergeCapturedBuffers(source, captured) {
  const copy = structuredClone(source);
  if (captured.buffers) copy.buffers = structuredClone(captured.buffers);
  else delete copy.buffers;
  for (const node of copy.nodes) if (node.subpatch) {
    const matched = captured.nodes.find((n) => n.id === node.id)?.subpatch;
    if (matched) node.subpatch = mergeCapturedBuffers(node.subpatch, matched);
  }
  return copy;
}

// editor/src/hosted/mockBridge.ts
var MockHostBridge = class {
  commands = [];
  installed = null;
  parameters = new ParameterOverrides();
  liveValues = [];
  generation = null;
  listeners = /* @__PURE__ */ new Set();
  pending = /* @__PURE__ */ new Map();
  latest = /* @__PURE__ */ new Map();
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  request(command) {
    this.commands.push(structuredClone(command));
    if (command.type === "apply" || command.type === "revision") this.latest.set(command.sessionId, Math.max(command.revision, this.latest.get(command.sessionId) ?? -1));
    return new Promise((resolve) => {
      this.pending.set(command.requestId, { command: structuredClone(command), resolve });
    });
  }
  reply(requestId, status, diagnostics, payload) {
    const pending = this.pending.get(requestId);
    if (!pending) throw new Error(`Unknown request ${requestId}.`);
    const command = pending.command;
    if (status === "installed") {
      if (command.type !== "apply" || !command.prepared || command.prepared.diagnostics.some((d) => d.severity === "error") || this.latest.get(command.sessionId) !== command.revision) status = "cancelled";
      else {
        this.installed = command;
        this.generation = `mock:${command.revision}`;
        this.liveValues = [...command.prepared.program.values];
        for (const update of this.parameters.bind(command.prepared)) this.liveValues[update.valueIndex] = update.value;
      }
    }
    if (status === "updated" && command.type === "parameter") {
      if (command.generation !== this.generation || this.installed?.type !== "apply" || !this.installed.prepared) status = "failed";
      else {
        try {
          this.parameters.set(this.installed.prepared, command.parameterId, command.value);
          for (const update of this.parameters.bind(this.installed.prepared)) this.liveValues[update.valueIndex] = update.value;
        } catch {
          status = "failed";
        }
      }
    }
    const reply = { ...payload, requestId, sessionId: command.sessionId, revision: command.revision, generation: status === "installed" ? `mock:${command.revision}` : command.generation, status, ...diagnostics ? { diagnostics } : {} };
    pending.resolve(reply);
    this.pending.delete(requestId);
  }
  emit(event) {
    for (const listener of this.listeners) listener(structuredClone(event));
  }
  dispose() {
    for (const [id] of this.pending) this.reply(id, "cancelled");
    this.listeners.clear();
  }
};

// editor/src/hosted/package.ts
function createHostedPatchPackage(patch, assets) {
  if (!assets?.readMedia || !assets?.readBuffer) throw new Error("Hosted packaging requires media and Buffer adapters.");
  return createPatchPackage(patch, void 0, assets);
}

// editor/src/hosted/native.ts
var NATIVE_CAPABILITIES = Object.freeze({ ...engineCapabilities_default, profile: NATIVE_PROFILE });
function nativeProgram(prepared, generation, options = {}) {
  if (prepared.profile !== NATIVE_PROFILE || prepared.diagnostics.some((d) => d.severity === "error")) throw new Error("A valid native-scalar-v1 preparation is required.");
  if (!Number.isSafeInteger(generation) || generation < 1) throw new Error("Native generation must be a positive safe integer.");
  return {
    version: 1,
    generation,
    operations: prepared.program.ops.map((op) => ({ opcode: op.opcode, out: op.out ?? -1, a: op.a ?? -1, b: op.b ?? -1, c: op.c ?? -1, d: op.d ?? -1, e: op.e ?? -1, state: op.state ?? -1, value: op.value ?? 0, value2: op.value2 ?? 0, value3: op.value3 ?? 0, value4: op.value4 ?? 0 })),
    values: [...prepared.program.values],
    ...options.includeResources ? {
      resourceBindings: {
        samples: prepared.program.sampleBindings,
        images: prepared.program.imageBindings,
        customWaves: prepared.program.customWaveBindings,
        sequencers: prepared.program.sequencerBindings,
        buffers: prepared.program.stateBindings.filter((b) => b.id.endsWith(":buffer")),
        snapshots: prepared.requirements.buffers,
        repeats: prepared.program.repeatBindings,
        fft: prepared.program.fftBindings
      },
      executionRevision: NATIVE_CAPABILITIES.executionRevision
    } : {}
  };
}
export {
  BRIDGE_VERSION,
  COMPILER_VERSION,
  DOCUMENT_VERSION,
  HostedSession,
  MockHostBridge,
  NATIVE_CAPABILITIES,
  NATIVE_PROFILE,
  ParameterOverrides,
  bufferReferences,
  classifyEdit,
  cloneParameterIds,
  createHostedPatchPackage,
  gestureUpdates,
  nativeProgram,
  normalizeParameterValue,
  parameterMetadata,
  prepareAssets,
  preparePatch,
  readDocument,
  retainNestedBufferReferences,
  withParameterIds,
  patchToJson as writeDocument
};
