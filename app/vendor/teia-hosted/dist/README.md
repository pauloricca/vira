# Hosted Teia: shared scalar runtime

Standalone WASM and owned native instances now share Rust program validation,
installation/cache/resource preparation, scalar graph scheduling, smoothing,
monitor capture and DSP implementations. The version-1 profile name is retained
for wire compatibility; it no longer denotes an opcode whitelist.

See `docs/shared-runtime-plan.md` in the repository for the concrete extraction
plan, evidence and remaining migration work. This is an incremental migration,
not a claim of complete platform or arbitrary-patch real-time verification.
No Vira checkout/process or package publication is changed by these builds.

## Current migration boundary

- Shared: instruction and whole-program validation; `addDspOp` preparation;
  `render_shared_frame`/`render_dsp_ops`; state fields/defaults; node DSP; value
  smoothing; MIDI note-state and Tempo-position helpers; reset behavior.
- Native resources: samples, images, custom waves, sequencers and Buffer
  snapshots through `Resources`/`Instance::new_with_resources`, using existing
  Rust resource setters. The host must decode/map the supplied bindings.
- Shared bounded repeats: optional preallocated hierarchical Spawn/Spread pools (depth 4, 1024 total potential item slots),
  recycled instances, explicit exhaustion counts and preparation memory budget.
  Legacy standalone dynamic capacity remains unchanged unless explicitly opted in.
- Still pending: FFT analysis runs in the JavaScript worklet today and is
  explicitly diagnosed for native execution. Complete cross-host live state
  migration/crossfades and optional native parallel/block optimization integration
  are not claimed. External MIDI delivery retains adapter-specific timing policy.
- Verified in Linux ARM64: native regressions, graph equivalence, bounded repeat
  allocation guards and JS contract tests. Exact counts/results are in the plan.
  macOS-native compilation, audio-device deadlines, browser editor isolation and
  actual Vira integration remain unverified.

## Artifacts and entrypoints

```sh
npm run build:hosted
```

This cleans/rebuilds `hosted/dist`, emits declarations, bundles ESM, copies CSS and
the complete native Rust source crate, typechecks/compiles conformance harnesses,
and generates `compatibility.json`. It does not start a server or execute tests.
`npm run build:hosted:conformance` recompiles just the harnesses; run the full build
after source changes to refresh checksums. The private package remains UNLICENSED.

The root `@pauloricca/teia-hosted` entrypoint exports document/compiler APIs,
`prepareAssets`, `nativeProgram`, native capability/event/timeline types,
`HostedSession`, `ParameterOverrides`, bridge contracts and `MockHostBridge`.
`./editor` exports `HostedNodeEditor`; `./flow.css`, `./themes.css` and `./styles.css`
are separate assets. React and React DOM 19.1+, React Flow 12.8+ and
`@xyflow/system` 0.0.77 are peers. Import those CSS files in that order and give
the mounting element a width and height. CSS is global; a dedicated editor window
or host CSS isolation is recommended. For Vira, pass `theme="vira"` to
`HostedNodeEditor`: blue-black panels, slate borders, pale monospace text, cyan
selection/active accents and orange additive links/sample ends. Unselected node
titles use white text; selected titles retain dark text on cyan. Theme tokens are
scoped to a full-size editor wrapper; the host document's `data-theme` is untouched.
The optional `theme` prop also accepts `console`, `amber`, `ocean` and `default`.
Omit it to inherit the document theme with the original unwrapped mounting behavior.
This scopes palette/font tokens, not the global component styles; host CSS
isolation is still recommended. Rebuild the hosted package and reload/rebuild the
host's editor bundle after changing the theme assets. Icons are embedded; hosted mode needs no
Teia development-server URLs or standalone worklet/kernel assets.

The manifest records source HEAD and dirty status, all package versions,
document/program/runtime/bridge versions, source/artifact SHA-256 checksums and
native verification provenance. Consume the local `hosted` package or
copy the entire artifact directory. No npm publishing or licensing-policy change
is included.

```tsx
import { HostedSession, NATIVE_PROFILE } from '@pauloricca/teia-hosted';
import { HostedNodeEditor } from '@pauloricca/teia-hosted/editor';
import '@pauloricca/teia-hosted/flow.css';
import '@pauloricca/teia-hosted/themes.css';
import '@pauloricca/teia-hosted/styles.css';

// bridge addresses the existing host instance; its adapter is host-owned IPC.
const session = new HostedSession(editorSessionId, initialPatch, {
  save: true, saveAs: true, profile: NATIVE_PROFILE,
  transport: false, feedback: ['parameters'],
}, bridge, currentRuntimeGeneration);
root.render(<HostedNodeEditor session={session} theme="vira" />);
// Host keeps session/drafts across React remounts and coordinates close:
// if (await session.close()) { root.unmount(); session.dispose(); }
```

Opening the hosted editor subscribes to the existing instance; it does not Apply
an automatically generated initial canvas layout. A session identity change
remounts editor state. Host close policies can save, preserve a draft, discard or
cancel; return `closed` only after the chosen policy succeeds and rechecking that no newer revision
would be discarded. On cancellation,
retain the session. On reconnect, call `resync()` to reannounce the working draft.
Teia does not choose host file paths, shared-file conflicts or session persistence.

## Documents, identities and preparation

`graph/parse.ts` extracts the existing parser/compatibility rules from NodeEditor.
`readDocument` returns original input, normalized editable patch, source version
and diagnostics for migrations/discarded content, malformed input, duplicate
IDs/ports and non-finite numbers. Sequencer row labels/column width and nested
subpatch/media/Buffer references are preserved. Retain `source` until lossy import
is reviewed: the normalized Patch cannot itself represent unknown node types or
unknown fields. `preparePatch` blocks lossy execution pending review, and a
`HostedSession` rejects lossy initial documents. The host may deliberately provide
a reviewed normalized document after presenting the import diagnostics.

Unversioned JSON is schema 0. Schema 1 (`schemaVersion: 1`) is opt-in; reading or
writing legacy documents does not stamp a version. Future versions fail
explicitly. Hosted migration adds `parameterId` to Params output ports, initially
using scoped node/original-port identity; subsequent renames/reorders retain the
stored ID. Duplicating/pasting Params creates new identities; undo/snapshots
retain the original IDs. Unexpected duplicate IDs are errors. Persist the migrated identity on explicit
Save. Older editor builds may strip unknown parameter metadata; keep compatible
source/artifact versions together. Persistent ID, editable display name and transient compiled
`binding.valueIndex`/`binding.layout` are distinct.

Preparation runs off-render without an editor, AudioContext, devices or storage.
It returns source separately from executable program, numeric defaults/bounds/
step/integer metadata, limits, diagnostics, and media/MIDI/timeline requirements.
It allocates/clones, expands groups/containers, optimizes and schedules; costs
scale with graph size and need host measurement. `prepareAssets` takes a supplied
resolver for decoded mono samples/Buffers or RGBA images, including scoped
subpatch Buffer snapshots. It never fetches URLs or reads browser Buffer storage.
The resolver owns decoding, locations and integrity. Shared DSP numeric
sanitization (including the 12000 register limit) remains in force for MIDI
frequency and pitch-bend paths as well. Asset limits are explicit;
current media DSP is mono, independently of stereo live audio I/O.

Editor and XP export share preparation. XP manifest 2/program 1 remain. Legacy mono packages retain engine API 1;
new stereo Input packages require engine API 2 so older players reject them
instead of silently averaging channels. Runtime 0.3.0 accepts both engine APIs.
Raw kernel consumers opt into `setDspStereoInputEnabled(1)` for engine API 2;
legacy exports default to mono even if unused Input fields contain zero. The
packaged worklet sets this per installed program, and native hosted instances
opt in at construction. Legacy `id` lookup stays unchanged and runtime 0.3.0 also accepts persistent IDs; additive
`parameterIdentityVersion: 1`/`persistentId` expose stable identity. Hosted package
export requires explicit media/Buffer adapters. Nested Buffer snapshots are
included and resolved by the package player in compiled group scope.

`dspEdit.ts` centralizes standalone/hosted layout, custom-wave and sequencer keys.
Classification returns editor-only, value updates, specialized updates or
preparation. Hosts must opt into specialized controls; otherwise preparation is
requested. Indexed updates require identical executable layout and expected
runtime generation. Never reinterpret stale indices in a replacement program.
`ParameterOverrides` rebinds by persistent ID and filters default deltas for
existing overrides; it never mutates document defaults. The real host owns the
authoritative override state and initializes/rebinds it before the first sample
of any replacement instance.

## Native API and render profile

Native Rust is the execution direction. `Instance::process[_host]` calls the same
scalar graph scheduler `render_dsp_ops` and per-frame `render_shared_frame` as WASM. Shared MIDI note-state and Tempo-position helpers
serve both paths, with native orchestration supplying exact host events/timing.
`kernel_global!` keeps browser globals compatible and selects owned native state
through a scoped thread-local pointer, without a shared-state mutex. Legacy native
C exports use a separate per-thread default. Native hosted API is unavailable
with the optional parallel feature; existing parallel WASM remains compatible.

Use the original `rust/teia-kernel` crate or the copied
`hosted/dist/native/teia-kernel` as a Rust path dependency:

```toml
[dependencies]
teia-kernel = { path = "path/to/teia-kernel" }
```

1. Off-render, call `preparePatch(patch, { profile: NATIVE_PROFILE })`, then
   `nativeProgram(prepared, numericGeneration)`. Decode its fields into native
   Operation structs: missing register/state fields are -1, missing floats 0.
2. `PreparedProgram::prepare` calls the shared Rust program validator. WASM also
   calls it through `validateDspProgram` after upload. Prepared data is immutable.
3. `Instance::new` retains the version-1 no-resource constructor. Use
   `Instance::new_with_resources` for decoded media/configurations/snapshots and
   explicit repeat budgets. Installation uses the existing Rust setters and
   `addDspOp`; it does not copy instructions past resource/cache preparation.
   Both constructors allocate independent mutable state and bounded held-note/
   MIDI-output resources off-render. `memory_bytes()` reports the requested fixed
   state/MIDI footprint before allocator overhead. Media, effect/Buffer memory,
   repeat pools, preparation/source and caller audio/event buffers are additional. An immutable empty-resource template
   is copied directly to the heap, avoiding a whole-instance stack temporary.
4. Transfer exclusive ownership to one execution thread. Instance is Send,
   not Sync, and processing requires `&mut self`. No implicit concurrent mutation.
   `process` is a numeric-control convenience; `process_host` accepts one ordered
   Event list, TimelineSegment list and caller-owned MIDI-output array. Rendering
   makes no plans/queues/resource allocations in admitted paths by source review;
   allocation/deallocation guards pass for the tested numeric/MIDI/repeat
   fixtures. Arbitrary graphs and host deadlines are not thereby verified.
5. `feedback` returns generation, audio peak, frame count/host position/BPM/beat/
   running state/has-timeline flag, held-note count, rejected-block/input-overflow/output-overflow
   and repeat-exhaustion counters. Reset uses the standalone Rust reset machinery,
   including Buffer reset policy, while keeping current
   numeric controls. Dispose/drop on an ordinary thread after render ownership
   has ended; preparation, asset decoding and retirement never run in the callback.

Sample rates 8–384 kHz; configured block size 1–2048 frames (48 kHz/128 is a
fixture, not a hard-coded configuration). Four planar stereo slices must match.
Input selector -1 averages channels for legacy signal, 0 selects left, 1 right.
Entire block/event/timeline validation occurs before DSP or output mutation.
Maximum 4096 operations/registers/states, 2048 values, 256 input events and 256
segments per block, 2048 distinct held MIDI keys and 4096 caller MIDI-output
slots. Held notes and a per-sample 4096-event output queue are preallocated.
An input FIFO of 4096 notes is also preallocated. Notes are enqueued at their
supplied offsets, retaining caller order; the shared native/WASM dispatcher
consumes one note every two samples, with an intervening blank sample for edge
consumers such as Spawn. Mono held state changes when each note is delivered.
Equal-offset notes therefore have explicit bounded spreading latency rather than
simultaneous scalar fidelity. A full 4096-note queue takes at most 8191 additional
rendered frames to deliver its last accepted event. CC, pitch bend, numeric
Control events and host timeline segments keep their supplied sample offsets.

Notes and CC
accept channels 1–16, notes/controllers 0–127, velocities/CC values 0–1. Note On
velocity zero releases. Monophonic Midi Note uses last-note priority while
retaining all simultaneous held keys; releasing the latest restores the previous
held note. Pitch bend accepts 14-bit 0–16383 (center 8192) plus explicit 0–48
semitone sensitivity, updating the selected channel's frequency at that offset.
SysEx, aftertouch, program changes and MIDI clock bytes are explicitly rejected;
timing comes from host segments. Pulse-event Midi Note On/Off and polyphonic Spawn use the existing evaluator;
see the ordered serialization policy above. MIDI output supports note on/off and CC,
with exact graph-produced frame offsets and operation ordering. Output pitch bend
is not advertised. Version-1 native numeric controls default to immediate mode; callers can select standalone value
smoothing. This is explicit profile behavior.

Input overflow rejects the block and increments a counter; stale generations
reject before mutation. MIDI output overflow preserves earlier events, drops
newer ones after the caller buffer fills, and counts every dropped event. Duplicate
held keys replace their existing entry without growing beyond the 16×128 pool.
There is no native opcode whitelist. Filters, envelopes, oscillator modes,
modulation, effects, media, sequencers, event MIDI and repeated graphs use the
existing evaluator after shared validation and required resource preparation.
FFT is currently an explicit missing Rust facility, rather than silent zero
outputs; the shared capability contract records this temporary gap.

`nativeProgram` preserves the original version-1 wire shape by default. Passing
`{ includeResources: true }` as its third argument adds `executionRevision` and
`resourceBindings`. Old hosts can continue decoding operations/values for their
existing stereo patches. To enable resource-dependent graphs, map these binding
records and `prepareAssets` output to Rust `Resources`; calling the old
constructor without required resources returns `MissingResource`.

Version-1 native controls remain immediate by default to preserve working host
integrations. Call `instance.set_control_smoothing(true)` off-render to select
standalone's existing target smoothing. Immediate-mode Value instructions remain
categorical in both paths. There is no second smoothing implementation.

For repeats, set `Resources.repeat_capacity` (1–1024) and
`repeat_memory_budget` explicitly. `prepareDspRealtime(capacity, budgetBytes)`
exposes the same opt-in preparation to WASM. This prepares compiled graph context
zero; legacy per-voice graph contexts are not covered by that finite policy.
Excess Spread counts are capped at the requested capacity; excess Spawn triggers
are dropped. `repeat_exhaustions`/`dspRepeatExhaustions()` count these requests.
Within the budget, shrink/regrow resets discarded item state/resources as before,
and killed Spawn resources are recycled without callback destruction. Capacity
is a host/user choice, never silently assigned to an existing standalone patch.
The budget estimate excludes allocator overhead and ordinary per-instance/media
memory; it is not a process-wide memory or audio-deadline guarantee.

Bend retains the shared exponent ±32 and ratio 12000 bounds and saved link order.

## Host timeline

Every block using Tempo requires a segment at offset zero. Additional ordered
segments express tempo and running-state changes within a block. Supply absolute
render-frame position, musical quarter-note beat, BPM 1–999 and running state. Beats can be
negative for pre-roll and are bounded to ±1e6. Without an explicit discontinuity,
frame/beat continuity is validated within and across blocks (beat tolerance
1e-8). Seek, loop, start and stop have explicit discontinuity kinds. On a
running discontinuity, click phase is aligned to the supplied musical position:
an exact grid boundary can click; a seek to an off-grid beat does not invent a
pulse. Stopped Tempo emits no clicks/frequency, while feedback retains host BPM.
Document BPM/source defaults are not overwritten. Standalone internal/MIDI Tempo
modes and legacy browser MIDI pulse separators retain their prior behavior.
No editor or native independent clock approximates the host timeline.

## Bridge, feedback, assets and persistence

All commands/events carry opaque request ID, session ID, working revision and
runtime generation. There is no Tauri, application-routing/device or filesystem
concept. A revision command is sent before frontend compilation so older pending
preparation can be superseded. Apply carries source/preparation and classified
change; invalid revisions are still announced and keep the last valid graph.
Hosts must update latest revision immediately and atomically recheck at the real
installation boundary. UI response filtering alone cannot prevent a defective
host from installing stale DSP. MockHostBridge demonstrates the gate without
creating DSP. Queued is receipt, not installation; only matching installed
acknowledgements/events advance the installed graph.

An invalid Apply deliberately omits `prepared`. The host must handle that as a
non-installing validation failure before decoding a native program, rather than
deserialize null as `Prepared`. Teia retains compiler diagnostics alongside host
failure diagnostics so the graph's actual restriction remains visible.

Installed state advances independently of the newest working draft: a delayed
acknowledgement for an earlier revision that really installed remains valid while
a newer draft is pending or invalid. Once a newer installation is confirmed,
older acknowledgements cannot roll it back. Hosts still reject superseded work
at installation; accepting a delayed acknowledgement does not relax that gate.

Save captures a requested source revision independently of pending/failed Apply.
Only a matching saved acknowledgement advances that snapshot baseline; later
edits stay dirty. Saving an editable but unexecutable document is allowed unless
the host sets requireExecutableToSave. Host Save must capture/resolve required
Buffer/media resources before acknowledgement; it never reads standalone browser
storage. Names, draft persistence and conflict decisions are host-owned. Close
requests allow host save/draft/discard/cancel coordination.

Failed Save replies expose host diagnostics in the editor and retain the dirty
document. Parameter override rebinding applies the replacement parameter's bounds,
integer and step rules and retains that normalized value for later replacements.

`session.setParameter` requests a stable-ID, generation-checked instance override
with an updated acknowledgement, without editing defaults. Internal controls
edit the working document and use classified deltas when compatible. Optional
Buffer mutation capability supplies acknowledged clear/copy commands. Media
selection carries correlated context and ignores superseded responses; it is redirected through optional `bridge.assets.selectMedia`. Waveform
previews require supplied bounded bins; image previews require prepared Blobs.
Neither hosted preview creates an AudioContext/OfflineAudioContext or fetches the
source URL. Direct video preview/recording/upload/library/device operations are
omitted or show clear reasons when no host adapter exists. Preferences currently
remain in memory; there is no global document/viewport/localStorage restoration.

Feedback is normalized public data, not raw worklet messages. Subscriptions
unsubscribe explicitly; matching installed revision/generation is required.
Payloads are cloned/bounded to 128 node keys, 1024 scope/Buffer bins and 128
playheads per node, at 1–60 Hz (default 30). Scope interest is bounded to 32
scopes/1024 points. Meters/scopes/playheads/Buffer views and the host parameter
sliders use actual instance feedback. The sliders stay visible across graph updates, follow host
parameter changes, and send instance overrides through the existing `parameter`
command. They respect each installed parameter's bounds, step and integer setting;
changing a slider never edits saved patch defaults. The panel requires the host's
`parameters` feedback capability and is disabled while disconnected. Routine
revision/generation and host tempo overlays are hidden; connection failures and
compiler warnings/errors remain visible. No second DSP preview is
instantiated and feedback never overwrites patch defaults. Host CPU is not
fabricated from the standalone backend.

## Checks, harnesses and making changes visible

Permitted static validation includes TypeScript editor/hosted/conformance checks,
hosted/editor/runtime builds, Linux ARM64 Docker Rust 1.87 cargo check --all-targets,
required ordinary/SIMD/parallel WASM builds, FM-1 source review/regeneration/check
and diff whitespace checks. Authorized native, contract and equivalence tests
have now run; macOS-native compilation and hardware deadlines remain unverified. FM-1 contracts record stereo Audio Input, nested Buffer assets
and hosted MIDI/transport drift; the firmware version was preserved.

Harnesses (compile only unless explicitly authorized):

- `hosted/conformance/contracts.test.ts`: legacy/versioned import, subpatch/assets,
  stable IDs, classification/overrides, native wire, failed/superseded Apply,
  queued versus installed, feedback correlation, Save race/failure, cancelled
  close and disconnect.
- `hosted/conformance/editor.tsx`: real hosted editor with sample/image documents
  and traps for audio/offline contexts, devices, network and both global storage
  APIs, using only a supplied bridge. It exposes violations and commands for
  inspection after mounting/exercising graph/subpatch/undo/Save controls.
- `rust/teia-kernel/tests/hosted.rs`: independent instances, stereo/legacy mono,
  reset/disposal, exact/equal controls, generation/malformed/overflow rejection,
  ordered notes/pitch bend/CC/MIDI-output offsets, timeline phase/stop/start/seek/
  loop/within-block tempo, full held-note pool and allocation/deallocation guards.

Functional execution requires authorization. With it, Node tests run with
`node --test hosted/dist/conformance/contracts.test.mjs`; native tests with
`cargo test --manifest-path rust/teia-kernel/Cargo.toml --all-targets`.
Generate compiled fixtures with `node scripts/shared-runtime-fixtures.mjs`, build
the `shared_fixture` Rust example, then run `node scripts/check-shared-runtime.mjs`
to compare actual WASM and native output. The browser
harness requires serving/opening `hosted/dist/conformance/editor.html`; do not
start that server, open a tab or execute tests without authorization. Actual
standalone/FM1 and external-host behavior also need functional verification.

For the existing Docker-served editor, **ordinary refresh required** after the
static bundle build, preserving its read-only-inspected explicit default theme
and local storage mode. The user refreshes and inspects Audio Input left/right
and legacy signal, then standalone/FM1 controls when functional testing is
wanted. Consuming hosts must rebuild against the new local artifacts and recreate
their editor session/window; this task does not install or restart a host app.


## Execution revision 3 and bridge version 2

The complete instance observation, staged Buffer, hierarchical repeat and
negotiated gesture/Save contracts, with ownership examples and exact remaining
FFT work, are specified in [the host handover](../../docs/host-handover.md) in the
source checkout (`docs/host-handover.md`). Read that contract before advertising
these optional facilities. `BRIDGE_VERSION` is now 2; legacy commands remain
available, and absent v2 capability flags retain existing host behavior.
Verification metadata lists the complete fixture corpus separately from the
resource-free subset compared against Node WASM. Compiling fixtures alone is not
verification. Import the whole matching `hosted/dist` tree and native source.
