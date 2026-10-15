> **Superseded — 15 October 2026:** Teia implemented the facilities requested
> below. Vira has imported bridge-v2/execution-revision-3 artifacts and connected
> observations, gestures, staged Buffer operations and ordered MIDI pulses.
> This document is retained as implementation history, not a new work request.
> See `TEIA-HANDOVER.md` for current behavior. Remaining Teia work is native FFT
> as planned in its handover; resource-heavy repeat deadline acceptance and any
> future repeated-Buffer restore policy require explicit follow-up scope.

# Teia follow-up: complete the hosted native editor/runtime facilities

Work only in Teia. Do not inspect or modify Vira. Implement the remaining Teia
facilities below, preserve the standalone editor and FM-1 mode, and follow your
repository instructions. This request explicitly authorizes headless native/WASM
functional regression harnesses in Docker; do not launch, refresh or interact
with a running GUI or audio device. Rebuild the hosted/WASM artifacts and provide
a source-matched handover. Do not publish a package or deploy a service.

## Existing Vira host (context; no Vira checkout needed)

Vira is a native macOS ARM64 Tauri application. It owns patch JSON files,
content-addressed media, explicit Save/Save As, source-hash conflicts, recovery
sessions and instance overrides. One Teia stereo insert processes master audio
after Vira's routing/mix; cue is untouched. The native producer runs 128-frame
blocks at 48 kHz. No webview carries audio or owns an AudioContext/WASM engine.
A separate Tauri window mounts your existing HostedNodeEditor with theme="vira".
It supplies HostBridge.request/subscribe and EditorAssetAdapter.

Vira imports the complete hosted/dist package and its matching native source,
checks compatibility.json hashes, and fingerprints session caches with the
manifest hash. The current package is 0.1.0, bridge/program v1,
profile native-scalar-v1, execution revision 2. Source provenance is 9cdf8ac plus
dirty=true. The latest imported manifest SHA-256 is
f7b8aaae6d3ab57348319b0c98761a5e945b99d5cce21382b31e0be99f9c37bc.
Preserve truthful source provenance; unchanged package version is not a content
identity. Vira uses an rlib-only Cargo adapter for your unmodified source because
it does not need the cdylib target.

Vira now prepares Resources and calls Instance::new_with_resources. CustomWave,
Sequencer/Roll, samples, images, Buffer processing and explicit bounded repeats
are connected. Resource edits prepare and replace the runtime off-render;
compatible values use timed Control events without a structural debounce.
Resource definitions/snapshot changes participate in replacement identity.
Repeats have 16 active items per template and a 64 MiB preparation budget.
Vira reports repeat exhaustion and rejects over-budget preparation while keeping
the old installation. It does not advertise specialized in-place wave/sequence
updates yet. Sample/image acquisition, decoding and previews belong to Vira;
assets are durable independently of explicit patch Save. Existing Buffer
snapshots can be restored, but live Buffer capture/export/clear/copy and Buffer
visualization are not advertised. Save currently writes the editable graph and
existing durable references; it does not claim to capture live recordings.

Vira also supplies deck-derived host timelines and an optional idle-deck patch
clock. Basic CoreMIDI input/output is host-owned: note on/off, CC, pitch bend
(fixed two-semitone input range), timestamp mapping to the audio output cursor,
bounded input/output queues, generation fencing and cleanup on lifecycle events.
Late input is counted and clamped to the next available render boundary. MIDI
Note and MIDI CC and send nodes are offered. MIDI Note On/Off pulse nodes remain
rejected pending the collision contract below. Device selection stays in Vira;
Teia must not introduce browser MIDI ownership in hosted mode. Per-control MIDI
learning/visual feedback is not yet advertised.

Graph Apply installs only after native validation and a render-boundary ack.
New revisions supersede older preparation; stale generations cannot update a
replacement. Explicit Save is independent of installation, may preserve an
invalid editable draft, and succeeds only on host acknowledgement. Old instances
and allocated command payloads retire on ordinary threads. Vira uses bounded
queues; it never concurrently reads/mutates a live Instance from an IPC thread.

## Required Teia changes

### 1. Public instance-scoped native observation

Inspect rust/teia-kernel/src/hosted.rs, native_state.rs, state_fields.rs and lib.rs.
Instance::feedback currently exposes summary peak/tempo/counters, but no meter,
scope, sample playhead or Buffer visualization access. The standalone exports
(setDspMeter, dspMeterLevel, setDspScope, dspScopePtr, sample playhead functions,
dspBufferPtr, etc.) address thread-local default state outside native_state::enter.
Vira must not call them hoping to affect its live Instance.

Expose safe, documented instance methods or prepared observation plans for:
- Requested register/node/link meters, including signed readings.
- Bounded scope subscriptions (length, point count, reset policy).
- Sample/Buffer playheads and bounded Buffer visualization.
- Generation/layout identity and overflow/drop indicators.

Reuse the existing HostEvent.feedback shapes in editor/src/hosted/bridge.ts and
the compiler's monitorIds/stateBindings/resource bindings. Preserve stable node
identity across groups and compilation. Do not expose mutable pointers or require
concurrent instance access. Preparation/subscription allocation must happen
off-render; applying a prepared observation plan and collecting into caller-owned
bounded storage must have explicit real-time-safe behavior. Old plans must be
retirable off-render. Vira will throttle/publish feedback over its own IPC.

### 2. Buffer capture, restore and individual mutation

Resources::buffers already restores externally supplied snapshots. Add hosted
native operations to clear/copy a specific Buffer and capture recorded samples,
with state/layout/generation validation. Define sample rate, sample count, reset
preserve/clear policy and nested/repeated Buffer semantics explicitly.

A complete Buffer can contain 960,000 floats. Do not allocate or copy an entire
large Buffer on a 128-frame render deadline. Provide a bounded staged protocol
for consistent capture (or a justified equivalent), documenting how recording
continues or is explicitly frozen and resumed. Do not permit a data race between
rendering and a background snapshot reader. Define cancellation, graph replacement,
reset and overflow behavior. Vira owns hashing, disk writes, asset references,
patch library and persistence.

The hosted presentation adapter currently has captureBuffer returning null and
restoreBuffers as a no-op. Extend the generic bridge/session/editor workflow as
needed so explicit Save can request any required captures, obtain durable
host-owned references, save the exact resulting document, and acknowledge the
correct saved baseline without marking newer edits saved. Live Apply must never
implicitly save. Keep Buffer mutations/feedback gated by advertised capabilities.

### 3. Ordered transient Button/Keys gestures

Hosted Button/Keys interaction currently changes the editable patch and goes
through HostedSession.edit/prepare/revision/Apply. That path may supersede rapid
press/release transitions and can persist transient pressed state. Add a generic
capability-gated gesture/event bridge, reusing the existing editor and controls.

Separate persistent control configuration/defaults from transient key/gate/note
state. Address controls by stable node/control identity plus the installed
layout/generation; the host resolves validated compiled bindings. Define ordered
press/release, note/gate/velocity and value changes, host scheduling/timestamps,
ack/cancellation behavior, disconnect/focus-loss/close cleanup and graph swaps.
Release events must not be coalesced away by graph preparation, revision
supersession or a later neutral state. No host-specific filesystem or device
concepts. Hosted mode still creates no local audio engine.

Connect useHostedAudio/HostedSession/NodeEditor and existing Button/Keys UI to this
path. Make MIDI-learning/last-control-change presentation host-supplied if added;
do not request browser MIDI access. Version/negotiate changed messages; old hosts
must degrade clearly and retain existing behavior for supported capabilities.

### 4. MIDI pulse nodes: no silent same-offset event loss

Inspect Instance::process_inner/apply_event and the shared MIDI evaluator.
Currently all events at an offset are applied before one graph evaluation, while
DSP_MIDI_CURRENT_EVENT holds only one event. MidiNoteOn/MidiNoteOff scalar pulse
outputs (MidiNote opcode kinds 5..9) can therefore expose only the last event.
The comment saying these nodes are outside the profile is also inconsistent with
the shared evaluator now implementing them.

Define and implement bounded, deterministic semantics that preserve all ordered
note events, including multiple note-ons and note-on/off pairs at the same sample
offset. Cover use with Spawn/polyphonic graphs, sustained mono state, channels,
velocity-zero note-ons, reset and overflow. If the scalar graph representation
requires bounded event spreading/latency or another mechanism, document that
explicitly and align native and standalone behavior. Do not silently discard
voices or claim simultaneous event fidelity unsupported by the representation.
Expose capability/limits so Vira can decide when to enable these nodes.

### 5. Nested bounded repeats

A further code audit found that prepareDspRealtime explicitly prepares context
zero only, and render_dsp_ops skips repeats when DSP_SPREAD_CONTEXT != 0 under
the bounded policy, incrementing exhaustion. Vira therefore rejects nested
Spread/Spawn during preparation rather than silently dropping the inner graph.
Top-level repeats are enabled. Extend the prepared pool/layout model to nested
contexts with explicit depth, total-active-item and memory budgets. Never fall
back to allocation/dynamic standalone behavior on the render path. Publish the
actual capability and limits. Cover nested Spread, nested Spawn, mixed nesting,
resource-bearing children, bounded exhaustion, reset and native/WASM parity.

### 6. Shared native FFT

nativeAnalysis is currently false and preparePatch emits
native-analysis-unavailable. Implement FFT configuration, execution and outputs
through the shared Rust path with explicit window/hop/range/latency/capacity
semantics. Reuse standalone behavior, or document any actual difference.
Keep preparation allocations off-render, bound analysis work per block and expose
analysis observation through the APIs above. Enable capabilities only after both
native/WASM functional coverage. If FFT is too large for the first milestone,
complete items 1–5 and provide a concrete separate FFT handover; never mark FFT
supported based on schema changes alone.

### 7. Compatibility and artifact correctness

Fix the intentional native owned-state array borrows explicitly so Rust 1.90's
default-deny dangerous_implicit_autorefs lint passes without Vira lowering it to a
warning. Keep warnings/test policy honest. Rebuild hosted artifacts, declarations,
CSS/themes, native source and conformance fixtures together. Ensure verification
metadata accurately identifies the fixtures actually packaged: Vira's latest
packaged native fixture function contains 58 entries while verification.json
still describes 53 source-matched native/Node-WASM fixtures. Distinguish evidence
for a subset from the complete packaged corpus or regenerate matching evidence.
Update docs/host-handover.md with exact public APIs, thread/ownership/allocation
rules, message negotiation, limits, examples, artifact hashes and remaining gaps.
Review FM-1 parity/support tracking for every DSP change; don't claim firmware
support merely because the hosted/native implementation works.

## Optional improvements (not prerequisites)

- Prepared, allocation-free in-place CustomWave/Sequencer resource updates that
  preserve voices and tails. Vira currently uses safe replacement instead.
- Better instance memory estimates including installed resources/repeat pools.
- Structured per-node admission diagnostics and negotiated capability metadata
  rather than additional independent opcode allowlists.
- Native platform benchmarks, if available with explicit user authorization;
  container timings must not become macOS audio-deadline evidence.

## Tests and milestones

1. Add native observation and Buffer APIs with ownership, capacity, cancellation,
   generation-isolation and allocation/deallocation guards; document usage.
2. Add negotiated hosted gestures and Buffer Save flow with headless mock-host
   regressions: short press/release, rapid chords, disconnect/focus loss, graph
   replacement, Save during newer edits, failed capture and failed persistence.
3. Cover nested bounded repeats, MIDI pulse collisions and bounded exhaustion; verify native versus
   standalone/WASM sample/event behavior under equal-offset event batches.
4. Complete native FFT, or deliver its explicit remaining implementation plan.
5. Rebuild artifacts and run typechecks, contract tests, native/shared-runtime
   equivalence, allocation guards, FM-1 audit and whitespace checks in Docker.
   Do not change a failing expectation merely to obtain green tests.

Handoff must list what is actually usable now, exact host-facing APIs/messages,
which checks ran and passed, remaining limitations and instructions to rebuild
and reopen the consuming host. Do not claim Vira integration or device/deadline
acceptance from standalone/container tests. Do not implement any Vira changes.
