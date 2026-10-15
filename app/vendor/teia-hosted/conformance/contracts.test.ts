// Functional conformance harness. Build is permitted; execution requires authorization.
import { test } from 'node:test';
import { readPackageZip } from '../../runtime/src/zip';
import assert from 'node:assert/strict';
import { readDocument, writeDocument, withParameterIds, cloneParameterIds, preparePatch, classifyEdit, HostedSession, MockHostBridge, ParameterOverrides, nativeProgram, NATIVE_PROFILE, bufferReferences, createHostedPatchPackage, type Patch } from '../../editor/src/hosted/index';
function fixture(): Patch {
  return { name: 'hosted fixture', nodes: [
    { id: 'p', type: 'Params', params: { gain: 1 }, outputs: [{ name: 'gain', min: 0, max: 2 }] },
    { id: 'input', type: 'AudioInput', params: { gain: 1, level: 1 } },
    { id: 'out', type: 'AudioOut', params: { level: 1 } },
  ], links: [
    { from: { node: 'input', port: 'left' }, to: { node: 'out', port: 'left' } },
    { from: { node: 'input', port: 'right' }, to: { node: 'out', port: 'right' } },
    { from: { node: 'p', port: 'gain' }, to: { node: 'input', port: 'gain' } },
  ] };
}
function prepared(document: Patch) { const value = preparePatch(document); assert.ok('program' in value); assert.equal(value.diagnostics.some(d => d.severity === 'error'), false); return value; }
const last = (bridge: MockHostBridge) => bridge.commands.at(-1)!;
function unexecutable(): Patch {
  const patch = fixture();
  // Valid document, invalid executable parameter range (not silent Audio Out).
  patch.nodes[0].outputs![0].min = 2;
  patch.nodes[0].outputs![0].max = 1;
  return patch;
}

test('legacy and versioned import retain media/subpatchs, report discarded data and reject future schema', () => {
  const patch = fixture(); patch.nodes.push({ id: 'group', type: 'Group', params: {}, subpatch: { nodes: [], links: [], buffers: { b: { hash: 'a'.repeat(64), sampleCount: 2, sampleRate: 48000 } } } });
  patch.nodes.push({ id: 'seq', type: 'Sequencer', params: {}, sequencerRowLabels: ['kick'], sequencerRowLabelColumnWidth: 80 });
  patch.nodes.push({ id: 'sample', type: 'SamplePlayer', params: {}, sample: { name: 'sample', url: 'host:asset' } });
  const read = readDocument(writeDocument(patch)); assert.ok(read.patch); assert.equal(read.sourceVersion, 0); assert.equal(read.patch.nodes.find(n => n.id === 'sample')?.sample?.url, 'host:asset');
  assert.ok(read.patch.nodes.find(n => n.id === 'group')?.subpatch?.buffers?.b);
  assert.ok(bufferReferences(read.patch).group__b);
  assert.equal(read.patch.nodes.find(n => n.id === 'seq')?.sequencerRowLabels?.[0], 'kick');
  assert.equal(readDocument({ ...patch, schemaVersion: 999 }).patch, undefined);
  const legacy = readDocument({ nodes: [{ id: 'legacy', type: 'SamplePlayer', params: { originalPitch: 69 }, enabled: true }], links: [], midiInput: { selectedDeviceIds: [], sendClock: false } });
  assert.ok(legacy.patch); assert.equal(legacy.patch.nodes[0].params.originalFrequency, 440); assert.equal(legacy.diagnostics.some(d => d.code === 'discarded-content'), false);
  const discarded = readDocument({ ...patch, nodes: [...patch.nodes, { id: 'unknown', type: 'Unknown', params: {} }] });
  assert.ok(discarded.diagnostics.some(d => d.code === 'discarded-content')); assert.ok(discarded.source);
  assert.ok(preparePatch({ ...patch, nodes: [...patch.nodes, { id: 'unknown', type: 'Unknown', params: {} }] } as Patch).diagnostics.some(d => d.severity === 'error'));
});
test('parameter identity survives rename, reorder and serialization; binding locations are transient', () => {
  const patch = withParameterIds(fixture()); const id = patch.nodes[0].outputs![0].parameterId;
  patch.nodes[0].outputs![0].name = 'volume'; patch.nodes[0].params = { volume: 1 }; patch.links[2].from.port = 'volume'; patch.nodes.reverse();
  const read = readDocument(writeDocument(patch)); assert.ok(read.patch); assert.equal(read.patch.nodes.find(n => n.id === 'p')?.outputs?.[0].parameterId, id);
  const duplicate = cloneParameterIds(read.patch.nodes.find(n => n.id === 'p')!, 'new parameter node'); assert.equal(duplicate.outputs![0].parameterId === id, false);
  assert.equal(prepared(read.patch).parameters[0].id, id);
});
test('value updates, editor-only changes, native wire and override rebinds', () => {
  const patch = withParameterIds(fixture()); const first = prepared(patch); patch.nodes[0].params.gain = 0.5; const next = prepared(patch);
  assert.equal(classifyEdit(first, next).kind, 'values'); patch.nodes[0].position = { x: 1, y: 2 }; assert.equal(classifyEdit(next, prepared(patch)).kind, 'editor-only');
  const overrides = new ParameterOverrides(); overrides.set(first, first.parameters[0].id, 1.5); assert.equal(overrides.bind(next)[0].value, 1.5); assert.equal(next.document.nodes[0].params.gain, 0.5);
  const native = preparePatch(patch, { profile: NATIVE_PROFILE }); assert.ok('program' in native); assert.equal(native.diagnostics.some(d => d.severity === 'error'), false); assert.ok(nativeProgram(native, 1).operations.some(op => op.opcode === 11 && op.b === 0));
});
test('native profile accepts bend links using the shared Bend instruction', () => {
  const patch = fixture(); patch.links[2].mode = 'bend';
  const compiled = preparePatch(patch, { profile: NATIVE_PROFILE });
  assert.ok('program' in compiled);
  assert.equal(compiled.diagnostics.some(d => d.severity === 'error'), false);
  assert.ok(nativeProgram(compiled, 1).operations.some(op => op.opcode === 55));
});
test('failed Apply retains compiler diagnostics alongside host errors', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('diagnostics', fixture(), { save: true }, bridge);
  const apply = session.edit(unexecutable());
  bridge.reply(last(bridge).requestId, 'failed', [{ severity: 'error', code: 'host-apply', message: 'No prepared program.' }]);
  await apply;
  assert.ok(session.getSnapshot().diagnostics.some(d => d.code === 'invalid-parameter-range'));
  assert.ok(session.getSnapshot().diagnostics.some(d => d.code === 'host-apply'));
  session.dispose(); bridge.dispose();
});
test('superseded installation and failed application keep the last installed graph', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('session', fixture(), { save: true }, bridge);
  const patch = session.getDocument(); patch.name = 'one'; const one = session.edit(patch); const oneId = last(bridge).requestId;
  patch.name = 'two'; const two = session.edit(patch); const twoId = last(bridge).requestId;
  bridge.reply(twoId, 'installed'); await two; const generation = session.getSnapshot().generation;
  bridge.reply(oneId, 'installed'); await one; assert.equal(session.getSnapshot().generation, generation);
  patch.name = 'three'; const three = session.edit(patch); bridge.reply(last(bridge).requestId, 'failed'); await three;
  assert.equal(session.getSnapshot().generation, generation); assert.equal(session.getDocument().name, 'three'); session.dispose(); bridge.dispose();
});
test('queued receipt is not installation and mismatched feedback is ignored', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('session', fixture(), { save: true, feedback: ['meters'] }, bridge);
  const patch = session.getDocument(); patch.name = 'changed'; const apply = session.edit(patch); const command = last(bridge); const context = { requestId: command.requestId, sessionId: command.sessionId, revision: command.revision, generation: command.generation };
  bridge.reply(context.requestId, 'queued'); await apply; assert.equal(session.getSnapshot().generation, null);
  bridge.emit({ ...context, type: 'installed', generation: 'actual-instance' }); assert.equal(session.getSnapshot().generation, 'actual-instance');
  bridge.emit({ ...context, type: 'feedback', generation: 'stale-instance', peak: 0.5 }); assert.equal(session.getSnapshot().feedback, undefined);
  bridge.emit({ ...context, type: 'feedback', generation: 'actual-instance', peak: 0.5 }); assert.equal(session.getSnapshot().feedback?.peak, 0.5); session.dispose(); bridge.dispose();
});
test('delayed installed reply survives a newer invalid draft and retains actual controls/feedback', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('delayed', fixture(), { save: true, feedback: ['parameters'] }, bridge);
  const patch = session.getDocument(); patch.name = 'installed A';
  const a = session.edit(patch); const installed = last(bridge);
  // Installation happens now; promise delivery runs after the next edit.
  bridge.reply(installed.requestId, 'installed');
  const b = session.edit(unexecutable()); const invalid = last(bridge);
  bridge.reply(invalid.requestId, 'failed'); await Promise.all([a, b]);
  assert.equal(session.getSnapshot().revision, 2); assert.equal(session.getSnapshot().installedRevision, 1);
  assert.equal(session.getSnapshot().generation, 'mock:1'); assert.equal(session.getSnapshot().applying, false);
  assert.ok(session.getSnapshot().diagnostics.some(d => d.severity === 'error'));
  bridge.emit({ requestId: installed.requestId, sessionId: installed.sessionId, revision: installed.revision, type: 'feedback', generation: 'mock:1', peak: 0.25 });
  assert.equal(session.getSnapshot().feedback?.peak, 0.25);
  const control = session.setParameter(prepared(patch).parameters[0].id, 1.5);
  assert.equal(last(bridge).generation, 'mock:1'); bridge.reply(last(bridge).requestId, 'updated'); assert.equal(await control, true);
  session.dispose(); bridge.dispose();
});
test('queued install event tracks earlier runtime while newer Apply remains pending, without rollback', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('events', fixture(), { save: true }, bridge);
  const patch = session.getDocument(); patch.name = 'A'; const a = session.edit(patch); const ca = last(bridge);
  bridge.reply(ca.requestId, 'queued'); await a;
  patch.name = 'B'; const b = session.edit(patch); const cb = last(bridge);
  bridge.emit({ ...ca, type: 'installed', generation: 'already-installed-A' });
  assert.equal(session.getSnapshot().installedRevision, 1); assert.equal(session.getSnapshot().applying, true);
  bridge.reply(cb.requestId, 'installed'); await b;
  bridge.emit({ ...ca, type: 'installed', generation: 'already-installed-A' });
  assert.equal(session.getSnapshot().installedRevision, 2); assert.equal(session.getSnapshot().generation, 'mock:2');
  session.dispose(); bridge.dispose();
});
test('Save is acknowledged independently of Apply, retains newer edits, and close cancellation', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('session', fixture(), { save: true }, bridge);
  const patch = session.getDocument(); patch.name = 'save revision'; const apply = session.edit(patch); const applyId = last(bridge).requestId;
  const save = session.save(); const saveId = last(bridge).requestId;
  patch.name = 'newer edit'; const newer = session.edit(patch); const newerId = last(bridge).requestId;
  bridge.reply(saveId, 'saved'); assert.equal(await save, true); assert.equal(session.getSnapshot().dirty, true); assert.equal(session.getSnapshot().savedRevision, 1);
  const failedSave = session.save(); bridge.reply(last(bridge).requestId, 'failed', [{ severity: 'error', code: 'save-conflict', message: 'The patch was changed on disk.' }]);
  assert.equal(await failedSave, false); assert.equal(session.getSnapshot().dirty, true); assert.equal(session.getSnapshot().savedRevision, 1);
  assert.equal(session.getSnapshot().diagnostics[0].code, 'save-conflict'); assert.equal(session.getSnapshot().saveDiagnostics?.[0].message, 'The patch was changed on disk.');
  const close = session.close(); bridge.reply(last(bridge).requestId, 'cancelled'); assert.equal(await close, false);
  bridge.reply(applyId, 'cancelled'); bridge.reply(newerId, 'failed'); await Promise.all([apply, newer]); session.dispose(); bridge.dispose();
});
test('disconnection invalidates in-flight replies and preserves draft', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('session', fixture(), { save: true }, bridge);
  const patch = session.getDocument(); patch.name = 'draft'; const edit = session.edit(patch); const context = last(bridge);
  bridge.emit({ type: 'connection', sessionId: 'session', connected: false }); bridge.reply(context.requestId, 'installed'); await edit;
  assert.equal(session.getSnapshot().generation, null); assert.equal(session.getDocument().name, 'draft'); assert.equal(await session.save(), false); session.dispose(); bridge.dispose();
});
// Not claimed as implemented by the limited native profile.
// Timestamped MIDI and host timeline behavior are covered by the native Rust harness.

test('portable packages gate stereo engine API and preserve stable parameter metadata', async () => {
  const patch = withParameterIds(fixture());
  const adapters = { readMedia: async () => { throw new Error('Unexpected media read'); }, readBuffer: async () => { throw new Error('Unexpected Buffer read'); } };
  const stereo = readPackageZip(await (await createHostedPatchPackage(patch, adapters)).arrayBuffer());
  const manifestBytes = stereo.get('manifest.json'); assert.ok(manifestBytes);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  assert.equal(manifest.engineApiVersion, 2); assert.equal(manifest.parameters[0].persistentId, patch.nodes[0].outputs![0].parameterId);
  patch.links[0].from.port = 'signal'; patch.links[1].from.port = 'signal';
  const mono = readPackageZip(await (await createHostedPatchPackage(patch, adapters)).arrayBuffer());
  assert.equal(JSON.parse(new TextDecoder().decode(mono.get('manifest.json'))).engineApiVersion, 1);
});

test('host instance overrides survive default edits and parameter rename/rebind', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('overrides', fixture(), { save: true }, bridge);
  const patch = session.getDocument(); patch.name = 'active'; const first = session.edit(patch); bridge.reply(last(bridge).requestId, 'installed'); await first;
  const compiled = prepared(patch); const id = compiled.parameters[0].id;
  const control = session.setParameter(id, 1.5); bridge.reply(last(bridge).requestId, 'updated'); assert.equal(await control, true);
  patch.nodes[0].params.gain = 0.25; const edit = session.edit(patch); bridge.reply(last(bridge).requestId, 'installed'); await edit;
  assert.equal(bridge.liveValues[prepared(patch).parameters[0].binding.valueIndex], 1.5); assert.equal(session.getDocument().nodes[0].params.gain, 0.25);
  patch.nodes[0].outputs![0].name = 'volume'; patch.nodes[0].params = { volume: 0.25 }; patch.links[2].from.port = 'volume';
  const rename = session.edit(patch); bridge.reply(last(bridge).requestId, 'installed'); await rename;
  const renamed = prepared(patch); assert.equal(renamed.parameters[0].id, id); assert.equal(bridge.liveValues[renamed.parameters[0].binding.valueIndex], 1.5); session.dispose(); bridge.dispose();
});

test('syntactically editable but unexecutable documents can Save unless host policy is strict', async () => {
  const patch = unexecutable();
  assert.ok(readDocument(patch).patch);
  assert.ok(preparePatch(patch).diagnostics.some(d => d.severity === 'error' && d.code === 'invalid-parameter-range'));
  const bridge = new MockHostBridge(); const session = new HostedSession('invalid-save', patch, { save: true }, bridge);
  const save = session.save(); bridge.reply(last(bridge).requestId, 'saved'); assert.equal(await save, true);
  const strictBridge = new MockHostBridge(); const strict = new HostedSession('strict-save', patch, { save: true, requireExecutableToSave: true }, strictBridge);
  assert.equal(await strict.save(), false); assert.equal(strictBridge.commands.length, 0);
  session.dispose(); bridge.dispose(); strict.dispose(); strictBridge.dispose();
});

test('override rebind normalizes integer, step and narrowed bounds and retains the installed value', () => {
  const first = prepared(withParameterIds(fixture())); const id = first.parameters[0].id;
  const overrides = new ParameterOverrides(); overrides.set(first, id, 1.5);
  const integer = structuredClone(first); integer.parameters[0].integer = true;
  assert.equal(overrides.bind(integer)[0].value, 2);
  assert.equal(overrides.bind(first)[0].value, 2);
  overrides.set(first, id, 1.3);
  const stepped = structuredClone(first); stepped.parameters[0].step = 0.5;
  assert.equal(overrides.bind(stepped)[0].value, 1.5);
  const narrowed = structuredClone(stepped); narrowed.parameters[0].max = 1;
  assert.equal(overrides.bind(narrowed)[0].value, 1);
});

test('v2 ordered gestures bypass revisions, retain releases and clean up lifecycle', async () => {
  const bridge = new MockHostBridge();
  const patch = fixture(); patch.nodes.push({ id: 'keys', type: 'Keys', params: { note: 0, frequency: 0 } });
  const session = new HostedSession('gestures', patch, { save: true, bridgeVersion: 2, gestures: 1 }, bridge, 'live');
  const before = writeDocument(session.getDocument());
  session.gesture('keys', { note: 60, frequency: 261.625565 });
  session.gesture('keys', { note: 64, frequency: 329.627557 });
  session.gesture('keys', { note: 0, frequency: 0 });
  const gestures = bridge.commands.filter(c => c.type === 'gesture');
  assert.equal(gestures.length, 3); assert.deepEqual(gestures.map(c => c.sequence), [1, 2, 3]);
  assert.equal(gestures[2].values.frequency, 0);
  assert.equal(session.getSnapshot().revision, 0); assert.equal(session.getSnapshot().dirty, false);
  assert.equal(writeDocument(session.getDocument()), before);
  session.releaseGestures('focus loss'); assert.equal(last(bridge).type, 'release gestures');
  session.gesture('keys', { frequency: 440 });
  bridge.emit({ type: 'connection', sessionId: 'gestures', connected: false });
  const count = bridge.commands.length; session.gesture('keys', { frequency: 0 }); assert.equal(bridge.commands.length, count);
  session.dispose(); bridge.dispose();
});

test('v2 short press/release survive graph preparation supersession and failed gesture cancels controls', async () => {
  const bridge = new MockHostBridge(); const patch = fixture();
  const session = new HostedSession('press', patch, { save: true, bridgeVersion: 2, gestures: 1 }, bridge, 'live');
  session.gesture('button', { pressed: 1 }); const press = last(bridge);
  patch.name = 'new graph'; const applying = session.edit(patch); const apply = last(bridge);
  session.gesture('button', { pressed: 0 }); const release = last(bridge);
  assert.equal(press.type, 'gesture'); assert.equal(release.type, 'gesture');
  assert.equal(release.generation, press.generation);
  bridge.reply(apply.requestId, 'installed'); await applying;
  assert.equal(last(bridge).type, 'release gestures');
  // Acknowledgement from the retired generation cannot affect the replacement.
  bridge.reply(press.requestId, 'failed'); bridge.reply(release.requestId, 'updated');
  await Promise.resolve(); assert.equal(session.getSnapshot().generation, `mock:${apply.revision}`);
  session.gesture('button', { pressed: 1 }); bridge.reply(last(bridge).requestId, 'failed');
  await Promise.resolve(); assert.equal(last(bridge).type, 'release gestures');
  session.dispose(); bridge.dispose();
});

test('v2 Buffer Save persists exact captured snapshot and never marks newer edits saved', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('capture', fixture(), { save: true, bridgeVersion: 2, bufferCapture: 1 }, bridge, 'live');
  const saving = session.save(); const capture = last(bridge); assert.equal(capture.type, 'capture save');
  const captured = session.getDocument(); captured.buffers = { recorded: { hash: 'a'.repeat(64), sampleRate: 48000, sampleCount: 960 } };
  const newer = session.getDocument(); newer.name = 'newer'; const editing = session.edit(newer); const apply = last(bridge);
  bridge.reply(capture.requestId, 'captured', undefined, { capturedDocument: captured }); await Promise.resolve();
  const persist = last(bridge); assert.equal(persist.type, 'save', JSON.stringify(session.getSnapshot().saveDiagnostics)); if (persist.type !== 'save') throw new Error('Missing persistence');
  assert.deepEqual(persist.document.buffers, captured.buffers); assert.notEqual(persist.document.name, 'newer');
  bridge.reply(persist.requestId, 'saved'); assert.equal(await saving, true);
  assert.equal(session.getSnapshot().dirty, true); assert.equal(session.getDocument().name, 'newer');
  bridge.reply(apply.requestId, 'failed'); await editing;
  session.dispose(); bridge.dispose();
});

test('v2 failed capture and failed persistence preserve saved baseline; old hosts receive no v2 messages', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('failed capture', fixture(), { save: true, bridgeVersion: 2, bufferCapture: 1 }, bridge, 'live');
  let saving = session.save(); bridge.reply(last(bridge).requestId, 'failed'); assert.equal(await saving, false);
  assert.equal(bridge.commands.some(c => c.type === 'save'), false);
  saving = session.save(); bridge.reply(last(bridge).requestId, 'captured', undefined, { capturedDocument: session.getDocument() }); await Promise.resolve();
  assert.equal(last(bridge).type, 'save', JSON.stringify(session.getSnapshot().saveDiagnostics)); bridge.reply(last(bridge).requestId, 'failed'); assert.equal(await saving, false);
  assert.equal(session.getSnapshot().savedRevision, 0);
  session.dispose(); bridge.dispose();
  const legacyBridge = new MockHostBridge(); const legacy = new HostedSession('legacy', fixture(), { save: true }, legacyBridge, 'live');
  legacy.gesture('button', { pressed: 1 }); assert.equal(legacyBridge.commands.length, 0);
  saving = legacy.save(); assert.equal(last(legacyBridge).type, 'save'); legacyBridge.reply(last(legacyBridge).requestId, 'saved'); assert.equal(await saving, true);
  legacy.dispose(); legacyBridge.dispose();
});

test('capture Save rejects host graph changes and replacement during capture, and accepts same-revision durable baseline', async () => {
  const bridge = new MockHostBridge(); const session = new HostedSession('save isolation', fixture(), { save: true, bridgeVersion: 2, bufferCapture: 1 }, bridge, 'live');
  let saving = session.save(); let capture = last(bridge);
  const changed = session.getDocument(); changed.name = 'host changed graph';
  bridge.reply(capture.requestId, 'captured', undefined, { capturedDocument: changed }); assert.equal(await saving, false);
  saving = session.save(); capture = last(bridge);
  const document = session.getDocument(); document.buffers = { recorded: { hash: 'b'.repeat(64), sampleRate: 48000, sampleCount: 960 } };
  bridge.reply(capture.requestId, 'captured', undefined, { capturedDocument: document }); await Promise.resolve();
  assert.equal(last(bridge).type, 'save'); bridge.reply(last(bridge).requestId, 'saved'); assert.equal(await saving, true);
  assert.equal(session.getSnapshot().dirty, false); assert.deepEqual(session.getDocument().buffers, document.buffers);
  saving = session.save(); capture = last(bridge);
  const newer = session.getDocument(); newer.name = 'replacement'; const editing = session.edit(newer); const apply = last(bridge);
  bridge.reply(apply.requestId, 'installed'); await editing;
  const count = bridge.commands.length;
  bridge.reply(capture.requestId, 'captured', undefined, { capturedDocument: document }); assert.equal(await saving, false);
  assert.equal(bridge.commands.length, count);
  session.dispose(); bridge.dispose();
});
