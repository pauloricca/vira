# Teia native host integration

Vira hosts one independent Teia stereo processor on **master output after Vira
routing/mix**, in the existing native 128-frame/48 kHz producer. Its result
replaces the master mix; it is not added to a parallel dry copy. Headphone cue
routing is unchanged. No audio crosses either webview. Additional instances and
arbitrary routing placements remain future milestones.

## Use and ownership

Rebuild in Docker and reopen `output/VIRA.app`. Open **TEIA**, add/load the stereo
gain example, then open its editor. The dedicated Tauri window mounts the existing
`HostedNodeEditor` with `theme="vira"`; its generic bridge controls the live native
instance. It creates no AudioContext or competing WASM/audio engine. After a
package refresh, explicitly reload the patch to compile against the new snapshot.

Structural edits debounce for 100 ms and prepare on ordinary threads. Compatible
numeric edits preserve generation and DSP state. Failed/superseded preparation
keeps the last valid instance. Instance overrides rebind by persistent parameter
ID. Resource-definition and snapshot-reference changes require replacement;
wave/sequence edits can restart voices/tails.

Vira owns patch JSON, source-hash conflicts, compiled cache, overrides, media and
recovery. The default library is `~/Library/Application Support/uk.ricca.vira/patches`;
Settings → Folders selects a persistent replacement, applied after reopening
VIRA. `VIRA_TEIA_PATCH_DIR` supplies the default when no folder settings exist. Discovery scans direct regular `.json` files.
Import preserves JSON and rejects duplicate names. Save writes JSON only after
an explicit editor request and replies after persistence. Save As requires a new
filename. Invalid drafts can be saved while the last valid graph continues,
unless capturing preserved Buffers requires that exact draft to be installed.

Close offers Save, Keep draft, Discard or Cancel. Keep draft preserves the live
instance and recovery document; Discard reapplies the saved graph. Recovery uses
`.vira-session.json`, separate from patch files. Restart validates source hash
and snapshot compatibility before restoring. Missing/changed files require an
explicit load. Deck/routing project restoration is outside this integration.
**Edit with dry master** opens a missing-media graph over a passthrough instance.

Imported media is immutable under `assets/`; captured Buffer samples are immutable
little-endian f32 under `buffers/<sha256>.f32`. Preserve both directories when
moving the library. Asset creation does not save patch JSON. Unused assets remain
available to unsaved/recovery drafts. Teia's external Buffer package format is
not imported directly.

## Frozen dependency and reusable handover

Current snapshot: package 0.1.0, bridge **2**, execution revision **4**, program 1,
profile `native-scalar-v1`; source commit
`ecd5e17b8a8ca21d65958ecfb067d8ee2993253b`, **dirty source=true**. The manifest
SHA-256, rather than that commit alone, identifies the imported bytes:
`40bf20e14c3654afd269d25c3d80124f6e2175366c59be8afeb4905d0f2874fb`.

The hosted editor now renders host parameters as sliders and sends generation
checked changes through the Vira bridge. Vira returns live parameter feedback to
keep the displayed values synchronized.

`vendor/teia-hosted` contains the complete matching package; `vendor/teia-kernel`
contains matching native source. `vendor/teia-native/Cargo.toml` is a Vira-owned
rlib adapter, avoiding an unused cdylib whose export flags the cross-linker cannot
consume. No upstream source edits or lint suppression are needed. The original
Teia checkout was not modified.

`vendor/teia-review/host-handover.md` and `hosted-artifact-hashes.json` preserve
Teia's API/ownership documentation and receipt. `hosted-native-tests.rs` is the
matching archived upstream integration harness. Run `node scripts/verify-teia.mjs`
in Docker: it validates artifacts, native source, receipt and harness hashes.
Always update frontend/native artifacts together and rebuild both halves.

Distribution remains local/private. Publish a future reviewed release as a Vira
Git tag with these pinned directories and docs, or a release archive containing
all of them. Download the complete archive/tag, verify the manifest/receipt,
then build; never download just an editor bundle. No publication or deployment
has been performed. The former implementation prompt is retained with a
superseded notice in `TEIA-NEXT-AGENT-PROMPT.md`.

## Bridge and audio boundary

`teia.rs` owns files, sessions, validation, revision/generation gates and preparation.
`teia_audio.rs` owns bounded render commands, acknowledgement, retirement and
native processing. `teia_bridge.rs` translates bridge-v2 facilities and policy;
`teia_facilities.rs` transfers prepared owners and flat observations across
bounded queues. `teia_window.rs` authenticates window commands. `TeiaEditor.tsx`
and `teiaWire.ts` adapt HostBridge and typed sample arrays to Tauri JSON. Only the
editor window issues editor commands; only main loads/controls the master insert.

Installation acknowledgement follows a producer block. Audible output is behind
Vira's existing output queue. Old instances, plans and replaced Buffer storage
retire on ordinary threads. The render owner receives no JSON, filesystem work,
blocking locks, preparation, allocation or destruction of these payloads.

Reset DSP prepares a fresh instance off-render and installs it at a block boundary;
it never invokes the native whole-engine reset in the producer. Preserved root/
group Buffers are captured into private recovery references first, independently
of explicit patch Save. Other voices/tails restart. Device/system reset requests
suspend Teia to dry master while ordinary-thread preparation completes. Queue/
event overflow cancels the MIDI generation and stays suspended until explicit
Reset DSP. A failed reset reports its diagnostic. The editor resynchronizes its
generation after replacement.

## Enabled facilities and limits

- CustomWave, Sequencer/Roll, SamplePlayer, Image and Buffer resources are prepared
  off-render with `Instance::new_with_resources`. Media limits: 64 MiB per file/
  decoded sample, 128 MiB combined; images at most 1024 pixels per side. Rust
  decodes PCM/float WAV; macOS `afconvert` handles other supported audio offline
  with time/size limits. SamplePlayer receives mono. Image previews use canvas.
- Resource-free nested Spread/Spawn use Teia's hierarchical bounded evaluator,
  at most four template levels and 1024 total slots. Vira chooses up to 16 items
  per template to fit that bound and a 64 MiB pool budget. Exhaustion is reported.
  **Buffer, Delay, Chorus, Reverb, Limiter and comb filters inside repeats remain
  rejected by Vira's deadline policy**: voice reuse can clear resource storage on
  the producer. Teia implements these; macOS deadline validation is outstanding.
- Instance-scoped feedback supplies meters, scopes, sample playheads and Buffer
  previews at about 20 Hz. Current bounds: 16 monitor registers, four scopes
  (32–256 points), four sample bindings (16 heads each), four root/group Buffer
  previews (64 points each), 2048 flat values per update. Deferred/dropped values,
  queued notes and event overflow counters are included. Buffer preview bins are
  point observations, not extrema over every intervening sample.
- Button/Keys gestures use ordered, generation/layout-checked transient events.
  Vira serializes requests and schedules transitions at least one sample apart;
  pointer release, blur, disconnect and close release held values. They do not
  rewrite defaults, history or patch JSON. Main parameter controls remain cheap
  bounded Control updates. MIDI hardware is not required for gestures.
- Buffer capture freezes writes while the render owner copies at most 1024
  samples per boundary into preallocated storage, then releases the token.
  Cancellation/timeout releases at the next boundary. Clear/copy/restore prepare
  replacement storage off-render; swapping retains heads and the compiled target
  length (short content zero-pads, long content truncates). JSON restores accept
  up to 960000 finite samples and resample off-render.
- Explicit Save first captures preserved (`on reset = preserve`) root/group
  Buffers from the exact installed document/revision, persists content-addressed
  samples, then saves the returned document with durable references. Generation/
  cancellation checks reject stale capture. A capture failure retains unsaved
  changes and shows its explanation. Repeated Buffer persistence is not assigned
  an implicit item policy; repeated resource graphs remain gated as above.
- Deck playback owns sample-accurate tempo/phase. **Run patch clock with decks
  stopped** (also editor TRANSPORT/Space) advances an idle-deck clock at master
  BPM. Its enabled state is recovered; phase restarts on app restart.
- CoreMIDI endpoints are selected on TEIA and stored in `.vira-midi.json`.
  Note/CC/pitch bend and send nodes are enabled, including ordered Note On/Off
  pulses. Teia delivers successive notes every two samples (one blank sample
  between); bursts are ordered but incur that serialization delay. Bounded
  native pulse capacity is 4096. Vira additionally budgets 256 input events per
  block. Device calls/output scheduling run on a worker; timestamp heap, sample
  offsets and generation/route epochs fence stale events. Late input is counted.
  No MIDI clock, SysEx, aftertouch or per-node MIDI learn UI is advertised.

FFT remains disabled in Teia's native profile. Its implementation plan is in the
upstream handover. Physical MIDI/audio timing, device reconnect/cleanup, GUI
behavior and worst-case producer deadlines still require macOS acceptance.
Container allocation guards and cross-compilation are not device evidence.

## Verification and rebuild

Run checks in Docker. `npm test` covers Vira's frontend;
`cargo test --manifest-path src-tauri/Cargo.toml --locked` covers its host/producer;
`cargo test --manifest-path vendor/teia-native/Cargo.toml` covers the native library
and archived upstream harness. Run hosted contracts separately with Node.
`VERIFICATION-TEIA.md` records evidence and remaining acceptance checks.

Rebuild **the complete app** with `docker compose -f app/compose.yaml run --rm
builder` from the repository root (or `scripts/build-app.sh` when service setup/
launch is wanted). Frontend build alone does not refresh `output/VIRA.app`.
