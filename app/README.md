# VIRA local app — library and two native decks

The deck workspace follows the minimalist interface reference: blue/orange shared
waveforms, one seekable full-track overview per deck, a central mixer, a searchable
single collection, and an empty performance-slot panel. The header shows an independent master BPM, starting at 120. Buttons ← A and ← B drift it toward an unlocked deck's tempo.
Deck volume faders control native gain. Expand **Timing & tempo** for grid editing,
tempo presets and click volume. Future controls are disabled;
deck/master meters are inactive placeholders (one per deck, stereo master) until
the engine supplies level telemetry. Master gain and crossfading remain deferred.
Use each library row's **•••** menu for timing, analysis and Load A / Load B;
dragging rows onto decks remains available.
Collection rows show number, cover tile, title, artist, BPM, key, length and
analysis status. The title's tooltip shows the source filename, and search also
matches it. The old expandable estimate row has been removed.
The **Settings** tab beside the workspace tabs shows the shared waveform zoom,
music folder and refresh control, native audio status, master BPM, and the persisted master tempo drift rate (default 1 BPM/sec). Returning to Decks keeps the selected zoom and deck playback state.

The application window itself stays fixed. The deck row keeps a constant height,
the library and performance panels fill the remaining space, and only the library
track list scrolls when it has more rows than fit. Expanded deck timing controls
scroll inside their deck; the library timing editor opens over the workspace.
The Settings page scrolls inside its panel if the window is too short.
Interface text cannot be selected and controls are omitted from keyboard Tab
navigation. Editable fields still accept text after a click.

Tauri + React/TypeScript app shell with two empty deck panels and a working music
library with per-file draft analysis, full-track waveforms and independent native
playback. This implements **steps 1–4** of the library-and-decks plan. The closed
spikes remain unchanged.

## Start on this Mac

Docker Desktop must be running. The existing read-only SDK copy from the spike
is used by default. All dependency installation, builds, media processing and
tests run in Docker; only the compiled app runs on macOS.

```sh
cd /Users/pauloricca/Desktop/projects/vira/app
docker compose up -d --build --wait preparation
docker compose run --rm --build builder
open output/VIRA.app
```

The first build downloads the pinned toolchain/dependencies. Subsequent builds
reuse Docker volumes. This cross-build targets Apple Silicon, macOS 13 or newer.
If the SDK copy is unavailable, point `MACOS_SDK_PATH` at an existing local Apple
SDK when invoking Compose; it is mounted read-only. No host toolchain installs
are required. This is a local development bundle, without signing or installer
distribution.

The native backend has one absolute `MUSIC_BIN` constant in
`src-tauri/src/lib.rs`; launch directory does not change it. Compose mounts this
repository's `music/` into `/music` read-only and `app/generated/` separately
read/write. Keep the app in this repository so the mount matches the fixed bin.
Neither the service nor app modifies source music.

Startup and Refresh scan direct children, using FFprobe to read embedded title,
artist and duration for MP3 and PCM WAV. Missing title uses the complete filename
stem; missing artist uses `Unknown artist`. Source filenames are available in the
title tooltip and library search. Subfolders are skipped. Unsupported, damaged, non-regular and
symlink files get individual error rows. There is no recursive scan or watcher.

The service publishes port 47831 on **127.0.0.1 only**. The webview can invoke
`refresh_library`, `get_library_state`, `analyse_track`, `load_track`,
`get_audio_state` and `deck_control`; it has no filesystem/shell
plugins or direct HTTP access. The backend sends requests to fixed service
endpoints on background threads, validates IDs/schema and verifies an analysis
ID belongs to a readable library row. It supplies the fixed bin label. Probing
is limited to the file protocol, with a 15-second per-file timeout. Concurrent
scans return a retry message. The native request has a 120-second total timeout;
very large/problematic bins can exceed it in this initial serial implementation.

Each successful scan writes `generated/library-v2.json` atomically (the original
metadata-only v1 snapshot is also retained). IDs encode relative filename, size,
mtime and SHA-256 content hash. Refresh rereads metadata and hashes readable
sources, so even content changed with a preserved size/mtime invalidates estimates.
No snapshot is silently substituted when the service fails. The UI labels any
previous table as potentially out of date and allows Refresh to retry.

## Analyse one file

Click **Analyse** in a readable row. It queues only that source. Other rows remain
unanalysed unless selected. A single background worker processes jobs in order;
repeated requests for the same unchanged queued/running file are deduplicated.
The queue holds at most 32 waiting jobs plus the active job, and returns a concise
retry message when full. The UI polls authoritative library state once per second;
it ignores responses superseded by Refresh or a newer state revision.

The worker copies the selected file to temporary container storage while hashing
it, checks the requested revision, then invokes a single-file subprocess. It
reuses `preparation/baseline.py`, an unchanged copy of the closed spike's method:
FFmpeg full-song mono 22.05 kHz decoding, Librosa onset/beat tracking, constant-grid
fitting, and harmonic chroma/Krumhansl-Schmuckler key candidates. There is no batch
scan, preview generation, engine comparison or alteration to the fitting method.
Dependencies are pinned to the spike's `requirements.lock.txt`.

Completed results preserve raw detected beats, fitted BPM/offset, residual/tempo
diagnostics, key candidates, per-window candidates and ambiguity flags separately
in generated analysis records. The collection shows the BPM, key and status.
**Analysed · draft** means completion, not musical verification; specific fit/key
warnings select **Needs review**. The baseline's general half/double-tempo/phase
advisory is retained in the result data for every non-silent result.

Click **Reanalyse** for a fresh job or **Retry** after a failure. Queued, analysing,
analysed, needs review, stale and failed states are distinct. BPM/key stay blank
for unfinished, failed or stale results. Request/job errors are local to the row.

Each per-filename file in `generated/analysis/` contains the schema version,
analyzer version, source ID/revision/content hash, state and complete result.
Writes use temporary files and atomic replacement. Reopening and Refresh restore
matching completed results without reanalysis. Source or analyzer changes mark
old entries stale; corrupt entries remain retryable. Interrupted queued/running
jobs become Failed after a service restart and require an explicit Retry.
Results for removed or superseded revisions cannot overwrite newer entries.
The worker rechecks the live source hash at completion even if Refresh was not
pressed. A service restart is detected by its instance ID; click Refresh to
reconcile and restore the table.

Full-song decoding and temporary snapshots use memory/disk proportional to song
length; streaming and cache eviction are deferred. FFmpeg decoding is limited to
120 seconds and each analysis subprocess to ten minutes. All work stays in Docker
and never modifies source tags/files. Analysis never changes deck transport,
gain, waveform or playback speed.

## Load and play

Drag a readable library row onto **Deck A** or **Deck B**, or use the row's
**Load A / Load B** buttons. The internal drag transfers only the library track
ID; external filenames/paths are not accepted. Analysis is not required.

Preparation independently snapshots the selected source, checks its revision,
converts the complete song with FFmpeg to stereo float32 48 kHz, and derives up
to 1,024 stereo peak buckets from those exact samples. Peaks preserve channel
and time correspondence. Each deck displays one combined waveform, using the
larger channel peak per bucket, while playback stays stereo. These are full-song
waveforms, not the spike's excerpts.
The Docker service caches versioned PCM/peaks outside the source bin. Matching
content/settings are reusable; altered/corrupt caches are rebuilt. Native loading
validates the descriptor and streamed PCM checksum. Full PCM never travels
through webview commands/events.

Each successful load installs only the selected deck, paused at the beginning.
The current source keeps playing while a replacement is prepared; failed loading
keeps it usable and displays an error. If loads race on one deck, the latest
request is the only one that may commit. The other deck continues independently.
The same source can occupy both decks, sharing immutable PCM but retaining two
separate R3/transport states.

- **Play / Pause** resumes or holds position. Playing after a natural end restarts
  the song from the beginning. Reaching the end itself stops without looping.
- **Stop** pauses and returns to the beginning.
- Click the waveform to seek. Focus it and use left/right arrows for five-second
  jumps, or Home/End for the track boundaries. Seeking preserves playing/paused
  state except at the end, which stops.
- **Volume** sets per-deck gain from zero to one. The mix applies 0.45 headroom per
  deck and a final sample clamp; the default deck gain is 0.8. No crossfader or sync
  is included. The two decks remain unsynchronised.

The output is one in-process CPAL/Core Audio stereo stream. A persistent producer
owns the two native Rubber Band 4.0 R3 voices at unity speed/pitch. It renders
128-frame chunks into a bounded 1,024-frame SPSC queue, independently of the
requested 256-frame device buffer. The worker retains the spike's verified macOS
real-time scheduling, asynchronous Audio Workgroup, and callback-signalled wake
ups. The callback only consumes frames, inserts/counts silence on starvation,
publishes bounded playback telemetry, and signals the producer.

The accepted DSP reset path is retained for seek/stop; only one control command
is applied per producer chunk to limit reset bursts. New voices and whole-song
buffers are built on ordinary threads. Replaced/stale voices are handed through
a bounded retirement queue for destruction on an ordinary thread. Control queue
capacity is 32; a full queue returns a retry message instead of blocking the
callback. Commands carry the installed generation, so a late Play for the old
track cannot start a newly installed source.

Positions come from the last source frame consumed by the native callback,
including queue delay. The UI receives state at roughly five updates per second
and interpolates within a short bounded window. This is an audible-position
estimate, not physical speaker timing or measured end-to-end latency. The output
status exposes starvation and device errors during development. Scheduling/output
failure is explicit; automatic device/sleep recovery remains deferred.

Full-track preloading is capped at **256 MiB stereo PCM per source** (about 11.65
minutes at 48 kHz). Larger sources fail with an actionable limit message. The
native cache holds weak references; source buffers are released after the last
voice/preparation owner retires. Temporary replacement buffers can increase
memory above the two active sources. Streaming, cache eviction and larger files
remain later work.

```sh
# Stop the preparation service; the app shows an actionable error on Refresh.
docker compose stop preparation
# Restart it and click Refresh in the app.
docker compose up -d --wait preparation
# Stop the local services when finished.
docker compose down
```

## Verify

```sh
cd /Users/pauloricca/Desktop/projects/vira/app
docker compose run --rm --build preparation-tests
docker compose run --rm builder sh -c 'npm ci && npm run build && npm test && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml --locked'
# Native backend scan, with the service running (no host media processing).
output/VIRA.app/Contents/MacOS/vira --scan-library
# Inspect job state through the native backend without rescanning.
output/VIRA.app/Contents/MacOS/vira --library-state
# Request one job with an ID returned by the library (never a path).
output/VIRA.app/Contents/MacOS/vira --analyse-track TRACK_ID
# Repeatable native transport check, then the ten-minute workload.
# Close the graphical app first so there is only one VIRA output stream.
output/VIRA.app/Contents/MacOS/vira --native-check 30 output/native-decks-short.json
output/VIRA.app/Contents/MacOS/vira --native-check 600 output/native-decks-600.json
```

Tests generate synthetic MP3/WAV fixtures in temporary container storage and
cover tags, fallback names, duration, bad-file isolation, source revisions,
addition/removal, non-PCM WAV, symlinks, missing/empty bin, probing timeouts,
files changing mid-scan, HTTP input restrictions, response validation and UI
retry/stale-table behaviour. Analysis tests cover serial execution, deduplication,
selected-file isolation, persistence/restoration, failed/retried/interrupted jobs,
source changes with preserved timestamps, failed/late job rejection, bounded
queues, malformed cache data and the baseline's original synthetic checks.
The native scan command also provides a smoke test
of the actual backend/service boundary. macOS visual verification and supplied
music observations are recorded in `VERIFICATION.md` and `VERIFICATION-STEP-2.md`.
Deck/native evidence is recorded in `VERIFICATION-STEPS-3-4.md`. The native
session uses supplied music, quiet gains, simultaneous decks, pause/resume,
seeks, failed/racing replacements, shared sources, natural ending, and (for the
ten-minute run) Docker analysis during playback. Container tests are not native
timing evidence. Raw native reports live under ignored `output/`.

Step 5 remains a broader verification/documentation milestone. Device switching,
sleep/wake recovery, physical latency, musical R3/R2 quality comparisons and
longer production reliability testing are not implied by this local increment.

## Milestone 2 — editable timing, tempo and sync

Timing/sync is implemented on top of the library and native decks. The earlier
milestone-1 descriptions of unity-only speed and independent-only decks are
superseded by this section. See `VERIFICATION-MILESTONE-2.md` for acceptance
status and measured limits.

Use **Timing** on a library row or **Edit timing** on a loaded deck. Source BPM
supports 30–300; first downbeat must be within the source. The constant 4/4 grid
labels the anchor bar 1, beat 1. Before it, bars 0, −1, … retain beats 1–4.
Half/double BPM, a 10 ms keyboard cursor, Shift ±1 s, window zoom, beginning /
middle / end and **Downbeat at cursor** support manual placement. The editor
shows a preview; it never changes a deck merely by typing. A deck editor can
seek the loaded audio for audition, with independent song and click volumes.
The click is off initially, uses a short native sine burst and accents downbeats.

**Reviewed by me** is a user assertion. Changing a timing field clears that
checkbox. **Reset to analysis suggestion** restores the fitted phase/BPM as an
unreviewed preview, never a detected downbeat. Raw detected beats and diagnostics
remain in the analysis review. **Save timing** writes only separate version-1
content-hash records under `generated/timing/`. Reanalysis cannot overwrite them;
identical renamed sources reuse them. A filename pointer signals stale corrections
when bytes change. Stale values cannot be loaded or used for sync; explicitly
prepare/review the changed source. **Apply to deck** saves, then applies only to
that deck generation. Other loaded decks keep their applied grid until Apply or
reload. Applying a grid retains source position, returns to its source tempo,
clears that deck’s master tempo lock.

Each deck's target BPM is bounded to 0.5–2.0 times its applied source BPM.
Rubber Band R3 uses duration ratio = source BPM / target BPM, with pitch scale
one. Unreviewed grids can be auditioned. Tempo changes reset/re-prime R3 at the
producer boundary using the current precise source anchor, discard old prepared
DSP output and crossfade from the last output over 5 ms. This is a short transition,
not a guarantee that stretched song attacks remain sample-exact.

The master BPM is independent of either deck and starts at 120. The lock icon beside
an applied deck's BPM locks it to the master if it has a timing grid and
the master fits its supported speed range. Draft grids can be locked, so review
their musical timing before relying on alignment. Both decks can lock at once. A locked
deck's BPM and manual tempo controls are greyed out. Unlocking preserves its
current target BPM. Manual deck tempo changes or seeking unlock that deck;
replacing or applying a grid clears only that deck's lock. Pause and Stop leave
the lock armed. Locking a playing deck seeks to the nearest source position with
the master's selected beat or bar phase. When Play starts a locked deck while another deck is
running, its cue waits for the next matching master beat or bar phase, selected
in Settings (Bar by default). Its audio and
pickup stay at the cue instead of skipping ahead; if there is not enough time
for the pickup before the imminent selected boundary, it starts for the following
beat or bar.
Pause or Stop cancels the pending launch. The first deck to play starts the master clock at its own
current grid position, including a pickup beat before the first downbeat, without
seeking its audio. Both locked
decks use that same phase, and follow master tempo changes at render boundaries.

The header's ← A and ← B buttons, to the right of master BPM, move the master toward the selected unlocked
deck at the configured BPM per second. Double-click sets the master to that deck's
BPM immediately. These buttons preserve both decks' lock
states. The drift rate is in Settings, defaults to 1 BPM/sec, and persists locally.
Settings also permits setting the master BPM directly. Range failures are
reported instead of silently clipping; a drift stops before it would take a
locked deck outside its supported speed range. A manual per-deck phase bias and
external clock integration remain future work.

**Clear deck** removes that source and cancels pending preparations; a later load
is protected by its generation. Source-specific commands are generation guarded.

The top A/B rows retain a fixed central playhead and use a shared output-time
window: eight beats at master tempo. Shared zoom offers 4/8/16/32
beats (2/4/8/16 s fallback). Each row maps source peaks and grid through its own
speed, so different target tempos have different beat spacing. Draft grids are
fainter; unavailable grids draw no markers. Empty space outside source boundaries
remains empty. The overviews stay seekable and the top rows are display-only.
Preparation caches stereo peaks at 240 source frames (5 ms). The webview fetches
fine peaks once per active artifact and retains at most active-source caches;
200 ms transport polling sends only overview peaks and applied timing. Animation
interpolates authoritative callback snapshots for at most 300 ms; pause freezes,
and seek/load/ratio changes re-anchor. UI frames never schedule audio events.

The producer owns output sample count, source-frame anchors, deck beats and
the independent master phase. Already queued audio remains ordered before a command; commands
apply at the next 128-frame producer boundary (one command per chunk). This
accounts for the 1,024-frame queue rather than pretending controls apply at UI
wall time. Callback telemetry publishes grid/tempo/phase with consumed frames.
Master musical phase advances with output sample time only while a deck plays;
it freezes when all decks are paused, stopped or ended. The first deck to resume
anchors that phase to its current grid position. A later locked deck aligns its
grid's bar phase to the running clock on lock, or queues its cue for a matching
future phase on Play.

```sh
cd /Users/pauloricca/Desktop/projects/vira/app
docker compose run --rm --build preparation-tests
docker compose run --rm builder sh -c 'npm run build && npm test && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml --locked -- --nocapture'
docker compose up -d --build --wait preparation
docker compose run --rm builder
# Close the GUI first; this measures one product engine stream on macOS.
output/VIRA.app/Contents/MacOS/vira --native-timing-check 30 output/native-timing-short.json
output/VIRA.app/Contents/MacOS/vira --native-timing-check 600 output/native-timing-600.json
open output/VIRA.app
```

The timing harness never saves its temporary test grids or asserts musical review
of the supplied songs. It exercises real PCM with master tempo drift and a locked
deck. Its callback
phase evidence is distinct from controlled rendered click alignment and physical
speaker timing. Retain `--native-check` for milestone-1 lifecycle regression checks.


## Rendering/tempo optimisation follow-up

The tempo range is now **0.5–2.0×**, with Half speed, Original tempo and Double
speed shortcuts. This is 15–600 target BPM across the supported source-grid range,
bounded to half/double each track's actual source BPM. Source timing remains
30–300 BPM; sync rejects targets outside the follower range.

Rolling rows use cached Retina canvas tiles and a max-peak pyramid. A shared
visual loop updates canvases and overview playheads directly, without React
commits or SVG path reconstruction per frame. Offscreen rows and hidden documents
stop drawing; tile caches stay near the visible source window. Transport polls
send source metadata only when its installed generation changes. The visual clock
estimates request latency, smoothly corrects ordinary snapshot jitter, preserves
monotonic forward motion and uses explicit backend position epochs for seeks and
sync repositioning. It freezes extrapolation after 500 ms without a fresh snapshot.

The visual loop normally uses requestAnimationFrame. If a visible webview supplies
persistently slow callbacks, it switches to one paced timer targeting 60 updates/s.
Both rAF cadence and submitted-update cadence remain separately recorded; the
latter is not a physical panel-refresh measurement. No UI callback generates audio.
The Display counter reports visual updates/s. Thirty-second bounded summaries are
written on ordinary threads to ignored `output/render-canvas.jsonl`.

Song/click sliders provide immediate local feedback while waiting for the audio
snapshot, then reconcile with native state. Click-off playback skips click timing
and sine calculations entirely. Wide zoom/extreme tempo combinations retain beat
lines while thinning labels to readable bar labels.

Evidence: `VERIFICATION-OPTIMISATION.md`; the original milestone reports retain
their historical range/settings. Extreme stretching can alter attacks and texture;
source-event/pitch checks do not replace musical listening.

## Frequency shading

Waveforms retain dark deck tints, brighten with energy above 3 kHz and approach
white on strong attacks. Left-channel power spectra use 1024-sample Hann windows and 5 ms
hops. Playback and the amplitude peak envelope remain stereo. Brightness combines treble proportion
and absolute RMS; positive spectral flux and a rising RMS envelope mark attacks.
These are source-audio cues, independent of playback gain and tempo. Cached
preparation gains versioned frequency features automatically on the next load.
Rolling, overview and timing views share the shading. Overview maxima preserve
short attacks but compress their timing at full-track scale.

Frequency features persist in `generated/prepared/<artifact-id>/manifest.json`
and are reused across loads and service restarts. Version and checksum checks
reject stale or damaged shading. Feature repair reuses valid PCM without decoding.
Cache checks still validate source/PCM integrity and amplitude peaks, but skip
FFT analysis when frequency features are valid.
