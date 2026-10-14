# Audio routing verification — 14 October 2026

The audio graph and Routing page are implemented. The default graph retains the
original fused mixer path, including cue, timing clicks, faders and crossfader.
The device callback's audio path is unchanged. Custom graphs execute a bounded,
precompiled stereo processing schedule on the existing producer.

## Native performance comparison

All measurements below ran on the Mac's Core Audio output, **MacBook Pro
Speakers**, at 48 kHz. Although 256 frames are requested, the device delivered
128-frame callbacks in every measured run. The producer chunk remains 128 frames
and the queue capacity remains 1,024 frames (21.333 ms). Docker was idle during
measurements; container timings are not used as acceptance evidence.

Before changing the engine, the original app was rebuilt in Docker and its
30-second native transport/lifecycle session was run. It passed with zero
starvation, deadline misses or device errors. Its callback mean was 5.89 µs,
p99 histogram upper bound 20 µs and maximum 22.50 µs. Raw report:
`output/routing-before.json`; the original executable is retained at
`output/vira-routing-baseline`.

For a cleaner CPU/latency comparison, an isolated copy of the original HEAD was
built in `/private/tmp/vira-routing-legacy/app`, adding **only** the identical
`audio_benchmark.rs` harness, its CLI entry point, and a read-only callback gain
snapshot accessor. This snapshot has no routing changes. The same harness runs
in the new app. It loads Miracle and Simplex City, runs both at unity speed, sets
EQ low to .6, mid to .4 and filter to .2, uses .1 deck gain, and alternates A's
gain between .12 and .1 once per second. Measurements exclude preparation and a
three-second warmup. CPU is process user+system time divided by the 30-second
wall window, expressed as a percentage of one core. The latency probe measures
command submission to that gain appearing in **consumed callback telemetry**,
with 1 ms polling resolution; it is not a physical speaker measurement.

| Metric | Original, first run | Original, repeat | Routing, first run | Routing, optimized |
| --- | ---: | ---: | ---: | ---: |
| CPU, % of one core | 41.22 | 41.24 | 42.85 | 41.17 |
| Steady callback mean, µs | 5.61 | 5.54 | 5.92 | 5.53 |
| Full-run callback p99 upper bound, µs | 20 | 20 | 20 | 20 |
| Full-run callback max, µs | 21.13 | 22.38 | 20.33 | 19.33 |
| Control→callback latency median, ms | 23.37 | 23.49 | 23.96 | 23.48 |
| Control→callback latency p95, ms | 29.09 | 25.88 | 25.61 | 24.60 |
| Starved frames / deadline misses / device errors | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

The initial CPU increase was investigated. The voice render routine now uses
compile-time specialization for conventional versus routed playback, removing
routing-dependent mixer/fader branches inside the default voice path. Default
playback also skips storing player scratch buffers. The repeated native result
is within 0.08 percentage points of baseline CPU; callback mean differs by less
than .01 µs and median control latency by .02 ms. There is no measured material
default-chain regression in these short runs.

Raw steady reports are `output/routing-steady-before.json`,
`output/routing-steady-before-repeat.json`, `output/routing-steady-after.json`
and `output/routing-steady-after-optimized.json`. Reports remain ignored runtime
artifacts. CPU and callback evidence includes the benchmark's polling overhead
equally in both engines. Callback percentiles/maxima cover warmup as well as the
measurement window; the reported steady mean is calculated from count/sum
changes. This is a short local comparison, not a long production reliability
claim. Physical end-to-end latency is unmeasured and requires loopback hardware;
no new buffering, delay node or lookahead is introduced by routing.

### Final comparison with the GUI closed

Preview inspection discovered an older, paused GUI instance still open during
those earlier measurements. Its separate output stream was present in both
original and routed runs. It was closed and a final matched pair was run with
only the benchmark stream active. Treat this pair as the final acceptance
comparison; do not compare CPU across the different stream configurations.

| Metric | Original engine | Final routed engine |
| --- | ---: | ---: |
| CPU, % of one core | 44.45 | 44.27 |
| Steady callback mean, µs | 5.60 | 5.71 |
| Full-run callback p99 upper bound, µs | 10 | 10 |
| Full-run callback max, µs | 19.88 | 25.38 |
| Control→callback median, ms | 22.80 | 23.20 |
| Control→callback p95, ms | 24.28 | 24.89 |
| Queue capacity, ms | 21.333 | 21.333 |
| Starved frames / deadline misses / device errors | 0 / 0 / 0 | 0 / 0 / 0 |

The final CPU difference is −0.17 percentage points. Callback mean differs by
0.11 µs, while its native code is unchanged. The control latency difference is
below the probe's 1 ms polling resolution; no extra audio buffer is introduced.
Both callback maxima are below 1% of the 2,667 µs device callback budget. Raw
reports: `output/routing-steady-before-final.json` and
`output/routing-steady-after-final.json`.

## Automated verification

Docker verification passes: **86 frontend tests and 46 Rust tests**, TypeScript
checking, production frontend build, Rust formatting check and the complete
Apple Silicon macOS release bundle build.

Routing tests cover DAG/cycle rejection, invalid named ports, duplicate wires,
invalid built-in identities, invalid gain, disconnected-output silence,
branching/sends, external-sidechain compression and distinct dry/processed
outputs. Compiled trim/EQ/filter stages match the original fused mixer under
active settings within 1e-6. The conventional fast path remains sample-identical
after graph node/wire ordering and layout changes. Existing native deck,
transport, sync, click, cue, crossfader, meter and UI tests continue to pass.
Frontend tests cover named-port patching without applying audio early,
compressor insertion preserving the existing connection, multi-output ports,
validation failure and reverting to the accepted graph.

Graph validation, scheduling and all plan/processor allocation happen on an
ordinary command thread. At a producer command boundary, compatible DSP state
is moved without allocation, output changes ramp over 240 frames, and the old
boxed plan is passed through the retirement queue for destruction on an ordinary
thread. Layout-only changes retain the audio plan. Processing uses bounded stack
scratch buffers, a compiled schedule and pre-resolved input/output indices. The
Core Audio callback continues to consume the existing queue and has no graph
validation, traversal, rebuilding or additional allocation.

## Edited graph and native page preview

The GUI-closed 30-second `--native-routing-check` passed with a compressor after
Deck A EQ, Deck B player as its sidechain, and a parallel EQ-to-master send.
The session applied three live graph updates during playback and rejected three
feedback edits without replacing the accepted graph. It retained the existing
pause/seek, source sharing, failed/racing replacement and natural-ending checks.
There were zero starved frames, callback deadline misses and device errors;
callback mean was 6.29 µs and maximum 24.29 µs. Raw evidence:
`output/routing-edited-final.json`.

The rebuilt native page was inspected on macOS. Both deck groups, their initial
connections, named mixer inputs, processor insertion, compressor audio/sidechain
inputs and processed/dry outputs are visible. The native UI successfully inserted
a compressor into A EQ → filter, patched B player → sidechain, applied through
Tauri, selected its wire inspector, and restored the conventional factory graph.
Canvas zoom and Fit keep outputs visible beside the inspector. The final preview
is left on Routing with the factory graph accepted and no unapplied test edits.

## Scope and limits

The graph has at most 32 nodes and 128 connections. All cycles are rejected,
including zero-gain cycles; delayed feedback is not implemented. Ports carry
stereo audio and support summing and branching. Initial processors are built-in
Gain, Compressor, Ring modulation and Sine instrument; third-party plug-ins and
MIDI routing are outside this increment. Built-in deck/mixer/output nodes can be disconnected, deleted and repatched;
missing outputs/meters resolve to an immutable silence slot. Graphs and canvas layouts are
session-local; reopening the app starts from the factory chain. Wire gain is
linear 0–2×; final output clamping retains the existing safety behavior. Arbitrary
routing can intentionally bypass deck faders, crossfader or cue selection by
connecting directly to an output.

## Routing editor interaction update

The editor now stays mounted after its first visit; drafts, selections, canvas
position and undo/redo history survive page switches without applying audio.
CSS transforms replace CSS zoom, and pointer positions are converted using the
actual rendered canvas bounds. Canvas pointer capture ends wire creation on
release: only an input-port drop commits a wire; all other drops cancel. Escape,
pointer cancellation and window focus loss also cancel transient drags.

Double-clicking empty canvas or a cable opens categorized Effects / Instruments
menus; cable insertion keeps the original connection gain. Deck groups are
visual labels without collapse controls. Selection is visible for nodes/cables;
empty-space clicks deselect. Delete/Backspace removes a node and its attached
cables or a selected cable. Cmd-Z and Cmd-Shift-Z undo/redo whole edits; node
moves and continuous parameter drags are recorded as one action. Text input
retains its own keyboard editing behavior. Shortcuts only run on Routing and
are documented on the in-app Shortcuts page.

Built-in nodes may now be deleted as requested. Graph compilation still validates
the identity of every built-in that remains. Missing master/headphone/fader
indices resolve to one immutable, zero-filled scratch slot, including a wholly
empty graph; dangling wires and feedback still fail validation. The conventional
fast path and native device callback remain unchanged. Undo or Default chain
restores removed components.

Editor regression verification passes 97 frontend tests and 47 Rust tests.
New coverage includes a full App navigation test (Routing → Settings → Routing),
viewport offsets at 80% zoom, release-outside cancellation, multi-port drops,
menu insertion preserving gain, whole-node deletion/undo, built-in deletion and
missing-output silence, one-action node movement, and text-input isolation.

A separate macOS preview (with a distinct bundle identity) verified the new
gestures without restarting Paulo's existing loaded-deck session. Native Cmd-Z /
Cmd-Shift-Z undid/redid creation; the unapplied compressor survived visiting
Settings and returning to Routing. Output-to-empty dragging left no wire, while
an input-port drop created one. Native Backspace removed both selected cables
and selected nodes, and undo restored the node. Double-clicking a cable opened
the insertion menu; choosing Gain spliced it into the connection and Apply
succeeded. Deleting Master output also applied safely, and Default chain
restored all original nodes. The isolated preview was closed after testing;
the original session was left intact. Additional focus tests cover slider undo,
node selection after numeric editing, and leaving the editor without retaining
keyboard focus in hidden fields.
