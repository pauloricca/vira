# Teia milestone 1 verification

Scope: frozen Teia native scalar profile, one master stereo insert, exposed
parameters, dedicated Tauri editor window, live Apply and explicit Save.
The original Teia repository was not edited. No release or deployment was made.

## Docker checks

- Frozen hosted artifact and native-source SHA-256 verification passed.
- Upstream Teia native harness: 9/9 passed, including simultaneous/offset events,
  host timeline, stereo isolation and allocation guards.
- Upstream Node contract harness: 12/13 passed. The failure is the media test's
  assumption that a Sample node remains the last node after serialization, which
  deliberately sorts nodes by ID. Vira's separate identity-based media-preservation
  regression passes. The upstream harness/source was preserved, not rewritten.
- Vira frontend tests: 114 tests (including 5 Teia tests).
- Vira Rust tests: 62 unit tests plus 2 producer integration tests passed.
- New native producer tests guard allocations and deallocations during first
  installation and parameter application; verify master stereo processing, cue
  preservation, stale-generation rejection and superseded-install rollback.
- Host tests verify Apply never writes the patch file, invalid drafts preserve
  the live graph, override persistence and identity replacement, Save conflicts,
  Save As, safe filenames and draft/bypass/override restoration.
- Frontend tests verify stereo compilation, persistent Params identity,
  source-hash forwarding, editor/load exclusion and unsupported-graph errors.
- Both frontend entrypoints and the Apple Silicon macOS executable are rebuilt
  through Docker. Final build/check status is recorded in output/teia-build.log.

Linux/container tests establish deterministic logic and guarded render paths;
they do not establish macOS scheduling deadlines or physical speaker latency.

## Native GUI/audio acceptance still required

Reopen the rebuilt output/VIRA.app. In TEIA, add Stereo gain.json and load it on
master. Play a track and move gain between 1 and 0.5: master changes while cue
headphones retain their existing signal. Open the dedicated editor, edit the
Audio Input level or connections, then check live feedback and unchanged file
contents until Save. Change master BPM with a supported Tempo patch to inspect
host-timeline behavior.

Make an unsupported graph edit: the working document should show a diagnostic
while the last valid graph keeps running. Save that editable document, then
restore a valid graph. Test Save As and an external-file Save conflict. Close
with Cancel, Keep draft, Save, and Discard; reopen to inspect draft recovery.
Restart to verify the saved reference, overrides and bypass state. Native device
starvation/producer-deadline and audible-transition measurements remain pending;
no browser/GUI or hardware acceptance is claimed from Docker results.

The current host profile deliberately rejects MIDI programs and media assets.
Additional runtime instances, arbitrary routing placement, native MIDI routing,
scopes/meters beyond peak/parameter feedback, and general project restoration
remain future milestones. The original runtime excluded filters, envelopes and
delays; the shared-runtime refresh below supersedes that restriction.

## Earlier package refresh — 15 October 2026 (superseded)

The refreshed upstream contract harness passes 14/15; the same node-ordering
fixture fails. The native harness passes 9/10; its new extreme-bend fixture
expects Audio Out=12,000, while the existing DSP output stage clamps to 8.
Both upstream tests/sources remain unchanged. Vira's new producer regression
scales the Bend result before Audio Out, checking exponent/ratio limits through
normal host installation. Updated Vira test/build logs are in
`output/teia-update-{frontend-tests,rust-tests,build}.log`.

Vira refresh verification passed: 114 frontend tests and 65 Rust tests
(62 unit + 3 producer integration), including the bend scaling/limit regression.
The complete VIRA.app is rebuilt with the refreshed frontend and native source.
Native GUI/device deadline acceptance remains separate and unmeasured here.

## Shared-runtime refresh — 15 October 2026

Snapshot manifest SHA-256:
`f0bc8446afe2566ba83fc929813d0b17038375df405ab49cd390c29c49ec92ad`.
The hosted package and native source were copied together, verified against all
manifest hashes, and the upstream handover was archived. Teia was unchanged.
Its embedded source provenance is 9cdf8ac + dirty=true, including the subsequent
hosted Vira theme. Vira opts into that scoped theme through the editor's new
optional prop. The package remains 0.1.0. Native source and equivalence evidence
are unchanged by the final theme refresh.

Docker verification:

- Vira frontend: 115/115 tests passed.
- Vira Rust: 63 unit tests + 4 producer integration tests passed.
- Teia hosted contracts: 15/15 passed, resolving the previously recorded failure.
- Teia native library via Vira's adapter: 31/31 passed, including shared-runtime
  equivalence. The artifact also ships upstream Linux native/Node-WASM evidence
  for 53 fixtures; that is separate from Vira or macOS acceptance.
- Producer allocation/deallocation guards cover install/render and native reset
  for LowpassFilter, HighpassFilter, Delay, Chorus, Reverb, Compress, Limiter,
  Envelope, Follower and Equalizer. Existing controls/cue/generation tests pass.
- Native resource-admission regression rejects media/wave/sequencer/repeat/FFT
  bindings and Buffer state. The frontend compiles a connected lowpass graph.
- Full macOS ARM64 build passed, including frontend typechecks and native link;
  `output/VIRA.app` contains the refreshed editor and native runtime.

Logs: `output/teia-refresh-{frontend,rust,equivalence,contracts,build}.log`.
The current toolchain reports implicit raw-pointer autoreferences in Teia;
Vira's rlib adapter retains those as warnings instead of changing upstream bytes.
GUI/audio device behavior and macOS deadline evidence remain unmeasured.

Reopen the rebuilt app and explicitly reload a patch. Filters/envelopes/effects
are now offered in its editor. Confirm live Apply changes audio and explicit
Save writes the file; a resource-backed graph must report a diagnostic while
the last valid graph continues. No refresh or launch was performed here.

## Expanded resources/MIDI and Vira theme — 15 October 2026

Snapshot manifest SHA-256:
`f7b8aaae6d3ab57348319b0c98761a5e945b99d5cce21382b31e0be99f9c37bc`.
Package 0.1.0, source 9cdf8ac + dirty=true. Refreshed complete artifacts, matching
native source and handover; imported the latest scoped Vira theme. Original Teia
files were not modified.

Docker checks passed:

- 117 frontend tests, including resource picker/compiler and MIDI selection.
- 69 Vira Rust unit tests and 7 producer integration tests.
- 15 hosted contract tests and 31 Teia native library tests via Vira's adapter.
- Allocation/deallocation guards cover install/render/reset for all **58**
  packaged shared fixtures, including resource-bearing graphs and top-level
  repeats. This differs from the upstream verification.json's separate claim
  about **53** native/Node-WASM fixtures; do not conflate the evidence sets.
- Sample-offset MIDI gate timing, stale generations and preallocated queues;
  future events do not block earlier events arriving later in the queue.
- PCM/float WAV parsing, stereo-to-mono decode, asset deduplication/integrity,
  missing/nonportable references, image/wave/sequence resource conversion.
- Resource edits change runtime generation and do not save patch files; explicit
  Save persists durable references. Failed resource preparation retains the last
  installation. Dry-draft opening preserves the file and requests initial Apply.
- Idle patch clock advances a sample timeline. FFT, MIDI pulse nodes and nested
  repeat structures are rejected explicitly instead of silently misrendering.

Full app build includes frontend typechecking, latest editor/theme and macOS
ARM64 native compilation/link. Logs are `output/teia-features-{frontend-tests,
rust,contracts,equivalence,frontend-build,build}.log`.

No GUI/device tests were run. Specifically unverified on macOS: media picker and
canvas previews, afconvert's installed codecs, CoreMIDI discovery/reconnection/
cleanup, physical MIDI/audio timing, audible resource replacement/tails, and
producer deadlines with the enlarged workload. Native cross-compilation and
Linux container tests are not that acceptance evidence.

User checks after reopening `output/VIRA.app`:

1. Reload the patch after the snapshot change; open its Vira-themed editor.
2. Select sample/image media inside the editor, add a CustomWave or Sequencer,
   Apply edits and confirm files change only on explicit Save. Reopen the patch
   with its assets directory intact. Use Edit with dry master for missing media.
3. Run the patch clock with decks stopped, then start/stop decks and check phase
   priority. Change sequence events/wave points and check safe replacement.
4. Choose MIDI endpoints on TEIA. Check Note/CC input and send nodes, bypass,
   reset, graph replacement and unplug/reconnect. Queue overflow must report
   paused MIDI; Reset DSP resumes. No MIDI device APIs run on the audio producer.
5. Buffer processing is available, but Save does not capture live recordings.
   Meter/Scope/Buffer visualization, Button/Keys transient gestures, nested
   repeats, MIDI pulse collisions and FFT are specified in
   `TEIA-NEXT-AGENT-PROMPT.md` for Teia's next implementation.

## Bridge v2 / hosted native facilities — 15 October 2026

This section supersedes the facility gates in earlier entries. Imported complete
matching artifacts/native source and preserved upstream handover, receipt and
native integration harness. Snapshot manifest SHA-256:
`51646e3f647cfa296a7a1e1dc18b16d6c76bf5e4be7a2ca9338332f7119b5853`.
Source `3e5ba9f2bf17673225e7eeff45efac7c14080aa2`, dirty=true; bridge2,
executionRevision3. Original Teia checkout was not modified.

Docker verification:

- 128 frontend tests, including JSON/Float32Array Buffer bridge roundtrip.
- 76 Vira Rust unit tests and eight producer integration tests.
- 31 packaged native library tests plus 20 matching archived native conformance
  cases (51 total); 20 hosted contract tests.
- Artifact/native-source integrity and receipt/harness hash verification.
- Producer allocation/deallocation guards cover all 62 packaged native fixture
  installations/render/reset requests and staged observation, Buffer capture and
  replacement. Reset now prepares replacement off-render. Resource-heavy repeat
  fixtures can be tested directly without being admitted by Vira's host policy.
- Host regressions cover ordered transient controls and session reopening,
  capture-before-Save, no implicit patch write, preserved Buffer recovery on
  reset, and generation replacement. Existing sample-offset MIDI, safe resource
  application and failed-preparation retention tests remain passing.
- Full frontend typecheck/build plus native macOS ARM64 link; complete rebuilt
  `output/VIRA.app`. Logs: `output/teia-v2-{frontend-tests,rust,native,contracts,
  build}.log`. SDK availability and existing dead-code warnings remain.

Teia's receipt separately records **57 of 62** native–WASM comparison fixtures
with zero sample difference. Vira did not rerun that comparison and does not
claim all 62 have native–WASM parity. The excluded comparison kinds are Sequencer,
Roll, CustomWave, SamplePlayer and Image.

Enabled now: instance-scoped meters/scopes/playheads/Buffer previews, Button/Keys
gestures, staged root/group Buffer capture/clear/copy/restore, explicit Save
capture, ordered MIDI Note On/Off pulses and resource-free nested bounded repeats.
Preserved recordings captured during Reset live in private recovery references;
only explicit Save writes patch JSON. Buffer replacement retains compiled target
length. Observation count/point limits and pulse burst latency are documented in
`TEIA-HANDOVER.md`.

Still gated: FFT (Teia implementation outstanding); Buffer, buffered effects and
comb filters inside repeats (host deadline acceptance outstanding). Repeated
Buffer snapshot persistence needs an explicit concrete-item restore policy.
No macOS GUI/device/deadline acceptance was performed. In particular, capture
freeze duration, burst MIDI latency, native observation overhead, output cleanup,
device reconnect and audible replacement need real-device measurement.

After reopening the rebuilt app and reloading a patch:

1. Open the Vira-themed editor, connect Meter/Scope and check feedback follows
   the loaded instance. Confirm scopes/Buffer previews have bounded data.
2. Press/release Button/Keys, blur/close, reopen and change graphs; no held gate
   should survive cleanup and no gesture should dirty the patch.
3. Record a preserved root/group Buffer, capture/export, clear/copy/restore,
   Reset DSP, then explicitly Save. Verify JSON changes only on Save and reopened
   content survives with the `buffers/` directory intact. Edit during capture
   must reject stale capture rather than bind it to a successor installation.
4. Send simultaneous MIDI note bursts; pulses preserve order with one delivery
   per two samples. Exercise overflow and endpoint replacement; paused status
   must stay dry until Reset DSP and old queued events must not reach a new graph.
5. Try resource-free nested repeats; exhaustion must be visible. Resource-heavy
   repeats and FFT must report a diagnostic and retain the valid live instance.
