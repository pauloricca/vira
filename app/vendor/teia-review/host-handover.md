# Implementing a Teia host

Teia supplies the editor, document/compiler APIs and a bounded native DSP runtime.
Teia does not supply a production host adapter. Vira integration is maintained
in its own repository. `MockHostBridge` is a contract test double; it does not connect an editor to audio processing. The host must
provide that connection, audio ownership and persistence.

See [the full contracts and current limitations](hosted.md) for API details.

## How to consume the shared code

Use two dependencies from the same Teia source revision:

| Dependency | Purpose | Initial distribution |
| --- | --- | --- |
| `@pauloricca/teia-hosted` | TypeScript compiler/session/bridge contracts, React editor and CSS | Local npm tarball |
| `teia-kernel` | Native Rust DSP instances | Cargo path dependency on `rust/teia-kernel`, or the complete source crate copied into `hosted/dist/native/teia-kernel` |

From the Teia checkout:

```sh
npm run build:hosted
npm pack ./hosted --pack-destination /tmp
```

This produces `/tmp/pauloricca-teia-hosted-0.1.0.tgz`. In the host's frontend
project, install that file with `npm install /tmp/pauloricca-teia-hosted-0.1.0.tgz`.
Install the peer dependencies declared in `hosted/package.json` as needed. For
the native host, use a Cargo dependency pointing to the matching crate directory:

```toml
[dependencies]
teia-kernel = { path = "../teia/rust/teia-kernel" }
```

Adjust the path for the host checkout. For reproducible handoffs, retain the
tarball, `compatibility.json`, and the matching Rust source snapshot together;
record the source commit and keep any dirty-source snapshot too. A commit alone
does not identify uncommitted changes. The manifest records source state,
protocol versions and artifact checksums.

For Vira's Docker build, vendor the matching crate snapshot inside the Docker
build context (for example `vendor/teia-kernel`) and point Cargo at that directory.
Do not depend on an unmounted sibling checkout on the developer's machine. Use
the crate shipped in the same hosted artifact set and verify its manifest hashes
before copying; keep the source snapshot pinned alongside the frontend tarball.

**npm is appropriate for the frontend SDK, but publication is optional.** Today
the package is `private: true`, `UNLICENSED`, and unpublished. `npm pack` creates
a local archive without publishing. After the first host integration, a private
registry could replace tarball handoffs; that requires an explicit access,
licensing and release-policy decision and changing the publication configuration.
The Rust dependency still goes through Cargo/source distribution. No crates.io
release is required. The separate `@pauloricca/teia-runtime` browser player is
not the native host backend.

## What the host needs to implement

1. **Own the runtime.** Create one native `Instance` per hosted patch. Prepare
   and allocate off the audio thread, process host-provided stereo buffers through
   `process_host`, and retire replaced instances off the audio thread. Adapt the
   host's MIDI and timeline into the ordered, sample-offset event/segment types.
   Respect the bounded `native-scalar-v1` profile (including bend links); unsupported graphs must produce
   diagnostics and leave the last valid graph installed.

2. **Mount the editor.** Import `HostedNodeEditor`, the three exported CSS files
   and `HostedSession`; supply an initial document, unique session ID, current
   runtime generation, capabilities and a real `HostBridge`. Give the editor a
   sized container. The editor owns no audio device or clock. Closing its window
   must not implicitly destroy a host-owned runtime. The full guide contains a
   mounting example.

3. **Implement the IPC adapter.** Implement `request` and `subscribe`, routing
   each session to its runtime. Negotiate bridge version 2 for the optional new messages (or version 1 for legacy commands) before connecting;
   Teia exports the version but does not implement a transport handshake. Echo
   request/session/revision/generation context in replies and correlated events.
   Settle pending requests on disconnect, emit connection state, and support
   `resync` with the current installed generation.

4. **Make installation transactional.** Handle `revision` immediately, before
   expensive work. For `apply`, validate/prepare the native program off-render
   and atomically recheck the latest revision at the actual installation boundary.
   Keep the old instance on failure or supersession. `queued` only acknowledges
   receipt; send `installed` after installation. Use generation checks for controls
   so stale messages cannot mutate a replacement instance. Values and specialized
   updates must respect layout compatibility; advertise specialized controls only
   when implemented.

   Invalid Apply commands omit `prepared`: return a diagnostic without attempting
   to decode a missing/null native program, and keep the installed instance.

5. **Preserve live controls.** Key host automation/overrides by persistent
   parameter ID, rebind them to each new program's value indices, and retain
   overrides across graph replacement without rewriting document defaults.
   `ParameterOverrides` supplies frontend utilities; the host must carry the
   policy through its native control queue and actual installation.

6. **Implement Save and close policy.** Persist the exact requested document
   snapshot and required assets before replying `saved`. Saving an editable
   document whose graph cannot execute is allowed by default. Decide file names,
   conflicts, drafts and Save As behavior. For `close`, save/preserve/discard or
   return `cancelled`; recheck for newer edits before replying `closed`.

7. **Publish actual feedback and capabilities.** Send bounded, throttled
   feedback from the installed runtime, honor scope subscriptions, and report
   actual parameter values and host transport position. Enable transport, Buffer
   mutations, media adapters and node eligibility only as supported. Media
   selection, decoded waveform bins and preview Blobs are host-supplied; there
   is no standalone storage/device fallback in the hosted editor.

## First integration milestone

Start with one native stereo effect, one numeric parameter, a hosted editor
window, transactional Apply and acknowledged Save. Then add MIDI/host transport
and optional capabilities. Rust now uses shared graph validation/preparation/scheduling. Enable additional
nodes by wiring resources and explicit repeat budgets, rather than adding opcode
allowlists. FFT analysis remains a named pending facility. Use the full contract
when choosing fixtures.

Before claiming host support, verify stale-Apply rejection, failed-Apply rollback,
parameter identity across rename/reorder, Save during later edits, disconnect/
resync and cancelled close. Tested native allocation guards now pass; audio-deadline measurements and editor
isolation checks remain outstanding. Existing conformance harnesses are
listed in the full guide; compilation alone is not functional verification.

For the shared-runtime migration, rebuild the host frontend and native binary
against matching artifacts. Existing version-1 stereo integration stays valid.
Resource graphs additionally require `Instance::new_with_resources`; select
standalone smoothing with `set_control_smoothing(true)` when desired. Do not
advertise those host facilities before wiring them. Recreate the editor session
and exercise the integration checks above.

## Hosted facilities: execution revision 4, bridge 2

Package/program/API/profile names remain 0.1.0 / 1 / 1 /
`native-scalar-v1`. They are compatibility identifiers, not content hashes.
`NATIVE_CAPABILITIES.executionRevision` is 4; consume its limits from the package.
Use the complete `hosted/dist/compatibility.json` manifest and its per-file hashes,
including the two new native modules. The final handover receipt is
`docs/hosted-artifact-hashes.json`. Rust 1.90 compiles the intentional owned-state
array borrows explicitly, with its default-deny lint intact. The existing WASM
image remains Rust 1.87; optional atomics/proc_macro toolchain warnings are not
macOS evidence and are not silenced.

### Instance ownership and observations

`Instance` remains `Send`, `!Sync`, with exclusive `&mut` access. The render owner
is the only thread that touches a live instance. IPC/background threads prepare
owned commands and transfer them through host-owned bounded queues. Collect on
the render owner into caller-owned storage; send the resulting values to the IPC
thread after that storage changes ownership. Never borrow the instance or its
Buffer data concurrently, and never call thread-local C exports on its behalf.

Public APIs in `teia_kernel::hosted`:

- `PreparedProgram::identity()` and `Instance::identity()` return
  `Identity { generation, layout }`. The layout is a deterministic executable
  checksum, not a security/content hash. Generation must be unique per install.
- `ObservationPlan::prepare(&program, &[Observation])` allocates off-render.
  Requests use compiled `monitorIds` registers, sample binding indices and Buffer
  `stateBindings`. Preserve compiler IDs such as `group__node`, link monitor IDs,
  and repeat binding IDs; operation positions are not node identities.
- `Instance::apply_observation(&mut Option<ObservationPlan>)` validates identity
  and swaps the old owner back into the caller's option. Disable using `None`.
  Applying, replacing and disabling allocate/deallocate nothing. Retire the
  returned plan on an ordinary thread, including failed incoming plans.
- `collect_observation(&mut [ObservationValue]) -> ObservationReport` writes
  bounded flat values with `{request,index,value,auxiliary}`. `request` refers to
  the prepared request index, which the host maps back to its stable ID.
  `ObservationReport` carries identity, written count and dropped value count.
  Small output capacity truncates values with an explicit drop count.
- `Observation::Meter {register}` returns magnitude mean in `value`, signed mean
  in `auxiliary`, and resets accumulated meters after collection. A repeated
  register is the last evaluated register value at each sample, not a separate
  meter for every item. Hosts choose node/link monitor registers as appropriate.
- `Scope {register,seconds,points,reset}` allows 0.01–30 seconds, 32–1024 points,
  and `ScopeReset::{None,ZeroCrossing}`. Shared sample decimation is
  `max(1,round(seconds*sample_rate/points))`; the ring is chronological. A zero
  crossing policy trims presentation to the first nonpositive-to-positive edge;
  installing a new plan clears its history. It is a display alignment policy,
  not a change to DSP scheduling.
- `SamplePlayhead {binding,voice}` queries a direct voice; negative means idle.
  `SamplePlayheads {binding,limit}` enumerates active ordinary or prepared-repeat
  voices, normalized 0–1, up to 128 values, counting omitted voices as drops.
- `Buffer {state,points}` and `RepeatBuffer {address,points}` return heads at index
  0 (`value` playhead, `auxiliary` record head), then up to 1024 preview points.
  Each point is a bounded sample with identical min/max values. This is explicitly
  a point-sampled preview; it is not a full-buffer extrema scan.

At most 128 requests / 128 meters / 32 scopes are admitted. Scope/preview copying
has bounded work but can still be too expensive at maximum subscriptions for a
particular host deadline. Hosts must choose a subscription/publication budget;
container tests do not establish a 128-frame macOS deadline. Translate values to
existing `HostEvent.feedback` meters/scopes/playheads/buffers shapes. Include the
optional `observation {layout,dropped,eventOverflows,queuedNotes}` metadata and
throttle IPC separately. Unadvertised feedback kinds are not shown by the session.

```rust
use teia_kernel::hosted::*;
// Preparation thread, with the installed program's monitor mapping:
let mut pending = Some(ObservationPlan::prepare(&program,
    &[Observation::Meter { register: monitor_register }])?);
// Render owner at a boundary; no allocator activity:
instance.apply_observation(&mut pending)?;
let report = instance.collect_observation(&mut feedback_values);
// Transfer report + values to an ordinary thread. Retire pending there.
```

### Staged Buffer capture and mutation

`begin_buffer_capture(identity,state)` begins a root/group-expanded capture.
`begin_buffer_capture_at(identity,BufferAddress)` selects a concrete repeat item.
`BufferAddress {state,path:[RepeatItem;4],depth}` uses the compiled Buffer state
and each outer-to-inner `RepeatItem {template,item}`: template is the compiled
repeat slot (`repeatBindings`), item is its current active index. Depth zero is
root. Inactive/unknown paths fail; never aggregate independent repeated recordings
under one snapshot. A host saving repeated Buffers must choose and document which
concrete item(s) its durable document representation restores. Current
`Resources::buffers` restores root snapshots only; it does not serialize a live
repeat tree or imply that transient Spawn voices survive reconstruction.

A capture token records owner identity, generation/layout, reset epoch, serial,
sample rate, sample count and cursor. Native sample rate is the instance's rate.
Count is the current rendered Buffer duration times that rate, clamped to 2 through
960,000 samples (2 before a first render). Writes to that storage freeze at begin;
playback and play/record heads continue. Length-control changes do not change the
captured count. Readback is consistent because only the render owner copies it.
There is no background reader and no mutable pointer in the public API.

`read_buffer_capture(&mut token,&mut [f32])` copies at most 1024 samples per call,
returns the copied count, and advances `token.position()`. Schedule a bounded
number of chunks per render boundary; a 960,000-sample recording needs 938 chunks
at 1024 samples. Accumulate transferred chunks, hash and persist on an ordinary
thread. Do not copy or allocate a whole recording in a render callback.

`end_buffer_capture(&token)` resumes writes for completion or cancellation.
Dropping a token alone does not resume writes: the host must enqueue cancellation
on disconnect/timeout/Save cancellation. Repeated tokens follow the storage serial
when Spawn compacts active indices. Killing/reusing their item, reset, mutation or
instance replacement makes them stale. Reset also cancels/unfreezes all captures;
reset's existing preserve-on-reset Buffer control governs content. Reset performs
bulk engine clearing and is not advertised as a bounded 128-frame command.
Discard/retire a replaced instance off-render; no token can read its successor,
even if the same PreparedProgram/generation is reused accidentally.

`BufferReplacement::{prepare,prepare_at,clear,clear_at,prepare_resampled}` allocate
full storage off-render. `prepare_resampled` uses endpoint-aligned linear
interpolation, matching `Resources::buffers`; otherwise supplied samples must
already be at the destination instance rate. `replace_buffer(&mut replacement)`
swaps full storage in constant time and returns retired storage in the same owner.
Retire it off-render. It sets the sample-count metadata; subsequent render duration
still follows the Buffer's compiled length control. Coordinate that control with
the intended snapshot duration. Head controls are preserved. A clear is an
explicit zero-filled replacement, independent of preserve-on-reset. To copy,
capture a source in chunks, prepare a destination replacement off-render, then
swap it at a boundary. Repeated lookup is bounded by the prepared 1024-item tree.
Errors never consume the replacement owner. No host disk/library logic is added.

### Bridge negotiation, gestures and explicit Save

Hosts choose capabilities during session creation; there is no hidden transport
handshake. Advertise `bridgeVersion:2` and separately opt in to `gestures:1`,
`bufferCapture:1`, `bufferMutation:true`, and supported feedback kinds. Old hosts
that omit them receive the existing commands and retain existing Button/Keys edit
behavior. They must not infer new facilities from package version 0.1.0.

New commands retain request/session/revision/generation context:

| Message | Payload and reply |
| --- | --- |
| `gesture` | `version:1,sequence,layout,nodeId,values,timestamp`; `updated` only after bounded queue admission; `failed/cancelled` otherwise |
| `release gestures` | `version:1,sequence,reason` (focus loss, graph swap, close, dispose); release every held control for that session/generation |
| `capture buffer` | `version:1,nodeId`; `captured` plus `bufferSnapshot {samples:Float32Array,sampleRate}` after consistent staged capture |
| `restore buffer` | `version:1,nodeId,snapshot`; off-render preparation then boundary swap; `updated` after acceptance/application |
| `capture save` | `version:1,document,installedRevision`; `captured` plus `capturedDocument` containing host-owned durable Buffer references |

Existing `buffer` clear/copy commands require `bufferMutation`; legacy transport,
parameter, Apply and Save commands are unchanged. Raw snapshot payloads are bounded
to 960,000 samples; transport adapters must encode typed arrays explicitly if IPC
is JSON-only. `capture save` should use durable references rather than large PCM
messages. `useHostedAudio` now calls the session capture/restore adapters. Buffer
to Sample media conversion remains unavailable without a host media conversion
adapter; it never invokes the standalone upload path.

`HostedSession.gesture(nodeId,values)` and `releaseGestures(reason)` feed the
existing Button/Keys UI. Transient pressed/click/note/frequency changes affect
presentation without editing source, history, revision or Apply. Persistent mode,
range, layout and saved defaults stay editable. Button values are `pressed` and
monotonic `clicks`; Keys sends `note,frequency,gate,velocity` (UI velocity 1 on
press, 0 on release). Keys remains the existing mono keyboard; it does not add a
polyphonic device implementation. Hosts can use gate/velocity metadata but the
existing Keys scalar bindings are note/frequency. `gestureUpdates(installed,
nodeId,values)` validates expanded stable node/port identities and returns compiled
value-index updates/layout. Unused output bindings need no write. Use installed
bindings, never bindings from a pending draft. No browser MIDI access is requested.

`timestamp` is the editor's monotonic `performance.now()` time. The host maps it
to its audio cursor, clamps late input, assigns sequence order, and schedules
successive transitions at distinct samples (at least one sample apart). Equal-offset
numeric Control writes retain final-value semantics; putting a press and release
at the same offset would lose the gesture and violates this bridge contract.
A gesture's revision is context, not a structural supersession key. Newer Apply
preparation must not coalesce, cancel or supersede an accepted release. Per-session
sequence numbers order admission, including cleanup barriers. Reserve cleanup
capacity or release/cancel the whole generation on overflow; never silently lose
release messages. A queued/received reply is not `updated`. On rejection the editor
requests cleanup and reports the failure.

The editor sends cleanup on blur, hidden document, unmount, close and graph swap.
The host must independently release/cancel on disconnect/window destruction,
queue failure and atomically on generation retirement; IPC cleanup alone cannot
guarantee this. Delayed old-generation acknowledgements have no effect on a new
graph. New instances start from persistent defaults. Hosts own MIDI learning and
last-control-change presentation; no local MIDI learning/device backend is added.

With `bufferCapture:1`, `save()` snapshots its source revision/generation and asks
`capture save` first. The host validates that live Buffer bindings correspond to
that exact document/installed revision, stages required captures, persists their
assets, and returns the same document with only durable Buffer references changed
(including nested subpatch references). If bindings cannot be matched—for example
an invalid newer draft—fail explicitly or return the unchanged document only when
there are no required captures. Do not attach an old runtime recording to a new
unrelated node. Repeated recordings require the concrete-item policy above.

The session verifies the captured document and sends a separate `save` containing
the exact resulting snapshot. It updates the saved baseline only on the matching
`saved` acknowledgement. If newer edits arrived during capture or persistence,
they remain dirty. Capture or persistence failure preserves the previous baseline.
The editor retains nested host-owned references when rebuilding presentations.
Live Apply never captures or saves. Host acquisition/durable assets remain
independent of explicit patch Save. Capture alone is not Save. Hosts must settle
pending requests on cancellation/disconnect and retire payloads off-render.

### MIDI collisions and repeat admission

All accepted ordered note events, including velocity-zero note-ons as note-offs,
enter a 4096-event FIFO and are delivered one every two rendered samples with a
blank sample after each event. Equal-offset batches retain caller order, including
across block boundaries. This changes native revision-2 timing. Sustained mono
last-note priority/held state updates on delivery; channels 1–16 remain independent.
Reset clears notes, backlog and the pending blank. Native overflow rejects the
entire incoming block before output/state mutation and increments
`feedback().event_overflows`; `feedback().queued_notes` exposes backlog. Standalone
`queueDspMidiNoteEvent` rejects newest on overflow and exposes the cumulative
`dspMidiInputOverflows()` counter. Accepted events are never evicted to admit new
ones. Hosts must handle rejection by retry or explicit lifecycle cancellation.

At worst a full queue's last event incurs 8191 additional rendered frames, about
171 ms at 48 kHz; this is bounded event spreading, not simultaneous event fidelity.
CC, pitch bend, Control events and timeline retain immediate offset semantics and
can therefore affect a note waiting in the FIFO. MIDI outputs retain actual graph
render offsets. Pulse note zero is indistinguishable from idle on the scalar
`note` output; use positive frequency or note-on velocity for Spawn triggering of
MIDI note zero. Frequency tags also permit matching releases. Spawn still requires
an appropriate lifetime/kill graph; preserving input events does not imply an
unlimited voice count. Excess triggers are reported as repeat exhaustion.

`prepareDspRealtime(capacity,budget_bytes)` now prepares a hierarchical pool tree
shared by native and WASM; native `Resources.repeat_capacity` selects it. Maximum
nesting depth is 4, maximum per-template capacity 1024, maximum total potential
item slots 1024 across every parent context. The total includes inactive reserved
capacity: with capacity 16, two nested templates reserve 16+256=272 items; three
would exceed the total and fail preparation. Memory admission checks allocated
heap payload capacities (not allocator metadata), including child pools and DSP
resources. Each parent item owns its children; no context-zero alias or dynamic
fallback remains in this selected path. Spread caps counts; Spawn rejects excess
new triggers; both increment repeat exhaustion. Shrink/kill/reuse/reset retain
allocated pools. Reuse/reset can clear resource storage in bulk: allocation-free
does not establish deadline acceptance for a resource-heavy Spawn graph.

Legacy standalone dynamic policy remains selected unless explicitly prepared.
The optional WASM bounded path uses the same scalar traversal even in the
shared-memory build; parallel repeat acceleration is not claimed for that path.
Resource-free nested wire fixtures compare actual native versus Node WASM output;
native nested Buffer regressions cover concrete item capture, copy and clear.

### Separate FFT implementation handover

`nativeAnalysis` stays false and `preparePatch` retains
`native-analysis-unavailable`. No schema change enables native FFT.
The existing worklet `dominantSpectrumPeak` analyzes a decimated scope history,
using the largest power of two at most 512 points (minimum 32), a Hann window,
20–20000 Hz sorted/clamped search range, parabolic peak interpolation and
`4*magnitude/N` amplitude normalization. Its bin frequency is `1/seconds`, and
player outputs are refreshed around 30 Hz; it allocates scratch arrays in JS.
That behavior must be captured in golden fixtures before migration.

The next implementation should:

1. Add prepared Rust `AnalysisPlan` bindings from `DspFftBinding`: input register,
   min/max value indices, frequency/amplitude output indices, window length,
   decimation and hop. Preallocate ring, real/imaginary scratch, twiddles and output
   metadata off-render; bound analyzer count and memory explicitly.
2. Preserve the worklet's effective sampling/normalization first, or version a
   deliberate full-rate change. Define warmup, zero padding, range edits, reset,
   exact hop and output-update latency in rendered frames. Use an integer hop
   independent of IPC publication and meter collection.
3. Compute at most a negotiated number of transforms per block and expose skipped
   hops/overflow. Write analyzer outputs through the shared Rust value machinery,
   with a documented immediate/smoothing policy, and expose spectra through the
   observation plan. Avoid a second native-only scheduling algorithm.
4. Replace the worklet's JS calculation with that same Rust API. Add native/Node
   WASM goldens for silence, DC, bin-centered/off-bin sine, amplitude, noise,
   min/max inversion, empty range, decimation, hop crossings, multiple analyzers,
   reset/replacement and allocator guards. Rebuild all three WASM variants and
   update the FM-1 FFT drift before enabling `nativeAnalysis`.

Optional in-place wave/sequencer edits, complete installed-memory estimates,
macOS-native benchmarks, device/deadline acceptance and actual host integration
remain separate. No Vira source or process was inspected or modified, and no
package or service was published by this task.


### Artifact and check receipt for this handover

The compatibility manifest SHA-256 is
`51646e3f647cfa296a7a1e1dc18b16d6c76bf5e4be7a2ca9338332f7119b5853`.
It records source commit `3e5ba9f2bf17673225e7eeff45efac7c14080aa2` with
`sourceDirty: true`. The complete per-artifact hashes, WASM hashes, source
fingerprint and check scope are in [the receipt](hosted-artifact-hashes.json).
`node scripts/check-hosted-artifacts.mjs` statically verifies the manifest files,
source checksums and the packaged fixture identities without launching Teia.

Passed: 31 native unit tests plus 20 native integration tests (including allocation
guards), 20 mock-host contract tests, 57 actual native/Node-WASM fixtures over six
blocks with zero sample difference, scalar/SIMD WASM pulse/reset/overflow checks,
Rust 1.90 checks of the packaged crate, editor/conformance typechecks, the FM-1
support audit, manifest integrity (77 artifacts) and whitespace checks. The native
fixture corpus contains 58 compiler-generated graph fixtures plus 4 labelled nested
wire fixtures. Five resource fixtures are excluded from the Node-WASM comparison;
`verification.json` names them rather than implying complete-corpus equivalence.
The Rust corpus exercises those resource fixtures separately.

All three WASM variants and hosted declarations, ESM, CSS/themes and native source
were rebuilt. The static standalone editor build preserved the inspected active
empty/default theme and `VITE_TEIA_PATCH_STORAGE=local`. The optional atomics
Rust/toolchain notices and Vite chunk-size warning remain visible; tests did not
lower Rust's borrow lint or alter expectations to conceal a failure.

**Rebuild and restart required for the consuming host:** import the complete
manifest-matched `hosted/dist`, use its matching native source, implement and opt
in to the new capabilities, rebuild both host frontend and native binary, and
reopen the host editor. Check short Button/Keys transitions, cleanup, Buffer Save
while editing, rejected captures, repeated resources and feedback publication.
No host rebuild, restart or integration test was performed here.

**Ordinary refresh required for the standalone editor:** the configured static
bundle and WASM assets are already rebuilt. Refresh the existing tab normally,
then inspect Button/Keys, MIDI pulse/Spawn behavior and Buffer preservation in your
own functional testing. No tab was opened or refreshed by this task.
