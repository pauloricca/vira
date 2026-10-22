# VIRA local app — library and two native decks

While VIRA is open, including in the background with playback stopped, it prevents
idle system sleep and display sleep and renews macOS session activity every 15
seconds to keep the idle session active. These assertions are released when VIRA
quits (and macOS removes them if it crashes). Manual sleep, screen locking, logout,
lid closure, low-battery protection and enforced security policies can still take
precedence; VIRA does not change system preferences.

The **TEIA** workspace hosts a native stereo master effect and opens the reusable
Teia graph editor in a separate Tauri window. Add the stereo gain example, load
it on master, and open its editor. Edits apply live; Save is explicit and
acknowledged by Vira. Patch files, instance overrides and recovery drafts belong
to Vira. See [Teia handover](TEIA-HANDOVER.md) for the frozen dependency, supported
profile, close/save behavior and Docker build instructions.
The shared native Teia runtime supports filters, envelopes, effects, custom
waves, sequencers, media, Buffers and resource-free nested bounded repeats. The
editor uses the Vira theme. Sample/image imports create durable assets. Use
**Edit with dry master** to repair missing media. Meters/scopes, sample playheads,
Buffer previews and transient Button/Keys gestures control the existing native
instance through bridge v2. Explicit Save captures preserved root/group Buffer
recordings before writing JSON. Reset preserves those recordings in private
recovery and prepares replacement DSP off the audio thread.
**Run patch clock with decks stopped** advances sequencers independently.
Native MIDI input/output and ordered Note On/Off pulses are enabled. Queue
overflow suspends the effect to dry master; **Reset DSP** resumes. FFT remains
unsupported. Resource-heavy repeats remain gated pending macOS deadline evidence;
see the handover for exact bounds and remaining acceptance checks.
After a package refresh, reopen the rebuilt app and explicitly reload the patch
so its cached program uses the new snapshot.

In **Settings → Folders**, add or remove music folders and choose the Teia patch
directory with the native folder picker. Each music folder is a collection named
after its folder. Select a collection to the left of the library search; search,
sorting, track counts and Analyse all apply to that collection. The selection is
remembered, and changing collections keeps loaded decks playing. Choices persist in
`~/Library/Application Support/uk.ricca.vira/paths.json`. Music folder changes
apply immediately and refresh the collections. Teia patch folder changes apply
after quitting and reopening VIRA. Files are not moved. Keep `assets/` and `buffers/` beside
patches when moving a library. The preparation service mounts only the configured
music folders read-only; Docker Desktop must be running and allow access to those
folders. Collections have separate indexes; saved analysis and timing overrides
are shared by content in `generated/content/`. Opening or refreshing a collection
does not calculate audio hashes. Analyse or loading a track identifies that file
and restores matching saved work before doing any new analysis. Moving or renaming
unchanged files therefore preserves saved work on recognition. Legacy folder caches
are migrated lazily on use; the newest saved analysis and newest timing overrides
win independently. Recognition preserves save times. Identical copies share settings. `VIRA_APP_DIR`
can locate `app/compose.yaml` if the development checkout moves. A failed mount
is reported in the library; startup details are in the app support directory's
`preparation-start.log`. Refresh retries preparation startup.

**Start Session** in the library header shows a sortable **Played** column. A track
becomes **Yes** and its row dims as soon as it plays on either deck, including a
track already playing when the session starts. Loading a track or waiting for a
scheduled launch does not count. History covers every collection and remains when
a track stops or leaves a deck. **End Session** clears the history and hides the
column. Sessions last until ended
or the app is closed.

Select a readable library track and click **Play Next** or press **Cmd + N** to
mark an idea for later. Marked rows turn orange; the **Next** column appears only
while tracks are marked and numbers them in the order marked, across collections. Click **Cancel Play Next** or press
**Cmd + N** again to remove one and close the numbering gap. Sorting and searching
keep this order intact. When a track starts playing on either deck, its marker
is removed and the remaining tracks are renumbered. Loading alone or waiting for a
scheduled launch does not remove it. Planning marks work independently of sessions
and do not start playback automatically; they last until the app is closed.
The shortcut is available on the Decks page, outside text fields and dropdowns.

**Autopilot**, after Play Next, blinks while enabled. It starts a session if needed
and keeps an unplayed recommendation marked next when no manual plans remain.
Candidates must be analysed (draft, needs review, or approved) with a usable timing
grid, and come from the current collection and selected tags, ignoring search.
Settings → Automatic transitions → Autopilot next track selects Automatic (the
default, using the weights below) or List order. List order follows the current
library sort after the playing track, wrapping to remaining unplayed tracks;
with no current track it starts at the first eligible track. Both modes give manual
Play Next choices priority, even for previously played tracks. The choice persists.
Settings has independent 0–100 weights for BPM proximity (within 10% of the
playing track's original BPM), shared tags, harmonic compatibility (the same
key, neighbouring fifths, or relative major/minor), BPM direction, and randomness.
BPM direction adds a full factor score for continuing the previous completed
handoff's rise or fall in original BPM. The first track, equal BPM, or unknown BPM
gives no direction preference. Manual handoffs also establish direction while
Autopilot is off; ending the session resets it. Randomness adds an independent
uniform 0–1 value per candidate, multiplied by its weight, on each recommendation.
Its default weight is zero; BPM direction defaults to 50. Equal scores use a random
choice; played tracks are never automatically recommended again in that session.
The next track loads onto the stopped deck and the playing deck arms AUTO END
once both decks have timing grids and their loops are released. Manual Play Next
choices and tracks loaded onto the stopped deck take priority over recommendations.
Cancelling AUTO END or ending the session disables Autopilot. Enabling it never
starts playback; with empty decks it loads an eligible track for you to start (the first in List order).
When the eligible tracks are exhausted, it waits for a manual choice or a new session.

The deck workspace follows the minimalist interface reference: blue/orange shared
waveforms, one seekable full-track overview per deck, a central mixer, a searchable
single collection, and an empty performance-slot panel. Covers are requested only
near the viewport. Deck loads take priority through preparation, PCM transfer and
timing setup: background covers, library polls, scan steps and queued analysis jobs
wait until all pending deck loads finish. In-flight work finishes its current step;
an analysis process already running uses a lower CPU priority. Background work
resumes after success or failure, and abandoned service reservations expire.

The workspace uses
an independent master BPM in the header, unset until the first deck plays. Buttons A → and B → drift it toward the selected track's original BPM, regardless of tempo lock.
Settings → Automatic transitions → **BPM shift** controls how far master tempo
moves toward the incoming track’s original BPM, from 0% (keep current tempo) to
100% (reach incoming BPM, the default). At 50%, 120 → 140 BPM ends at 130 BPM.
The setting persists and applies to the next transition, including fast transitions
and Autopilot. Existing keep-tempo preferences become 0%.
**AUTO NOW / AUTO END**, to the left of the loop controls, transition from the playing
deck to the loaded, stopped deck. Both tracks need usable timing grids and released
loops. AUTO NOW waits for the next matching phrase position on the beat grids;
AUTO END uses the latest matching position that leaves room for the overlap.
Phrase length follows the selected overlap, counted from each grid’s first downbeat.
The incoming deck starts exactly at its cue point (or its normal track start when
no cue has been moved), and the outgoing launch matches that cue’s phrase phase.
Partial bars and audio tails at EOF do not shift the mix off the grids; the
outgoing track may therefore finish fading before the file ends. If the chosen
length no longer fits, AUTO tries each shorter supported overlap, down to no
overlap at the end. The incoming track's length after its cue also limits the
overlap. This does not change the saved overlap setting. The
selected button blinks while armed and during the crossfade; press it again to
cancel. Double-click AUTO NOW or AUTO END to use **Fast transition overlap**
(default 4 bars) from Settings → Automatic transitions. Fast transitions blink
more quickly and leave the normal overlap setting unchanged. During the overlap, the outgoing deck fader falls from its current position
to zero, and the incoming fader rises from zero to the outgoing deck's starting
level. Arming either mode first lowers the stopped incoming deck's fader, so it
starts silently. The outgoing fader stays unchanged while AUTO is waiting. An off-center
crossfader moves gradually to center over the first bar (or a shorter overlap).
Cancellation releases automation and leaves playback, playheads, faders, EQ,
crossfader and master BPM at their current values so the DJ can take over mid-mix.
Manual transport, timing, deck tempo/lock, crossfader or active-transition fader
changes also cancel the transition, then apply only the requested control.
Master BPM changes and A → / B → drift keep the transition running. They take
over its tempo ramp; the remaining launch, fades and bass swap follow the new
master tempo in beats.
While AUTO is planned and waiting, drag its start, end or bass-swap marker on either
waveform to move that point on both decks by the same number of beats. Drag inside
the shaded transition away from a marker to move the whole region on that deck only.
All edits jump in four-bar steps relative to the original points, preserving phrase
position. Points stay ordered and within playable audio; the outgoing start must
remain ahead of playback. Crossfade mode allows start/end edits and adjusts its fade
points proportionally. Editing stops when the transition begins. Jumping to another
position on the outgoing deck while AUTO is waiting relocates that deck's region
and preserves the incoming deck's edited points. If too little outgoing material
remains, AUTO shortens the overlap while keeping the incoming start.
Waveform seeks during an active transition preserve fade and tempo progress and
recalculate the transition markers around the new playhead positions. The remaining
overlap shortens when needed to fit the playable material left on either deck.
Seeking the outgoing deck while AUTO is waiting replans its launch boundary.
EQ adjustments also leave AUTO running; scheduled bass changes still occur once,
and later manual EQ adjustments remain effective.
Moving the incoming fader while armed cancels AUTO and applies the manual position.
Cancelling before playback leaves its fader at the current position and the
incoming deck stopped.
Loop IN/OUT, loop lengths and loop release remain performance controls during AUTO.
They do not cancel either transition mode or stop the incoming deck. The master
beat clock keeps the planned launch, fader, tempo and bass-swap timing advancing
even when source positions repeat in a loop. This also applies to loops added
while AUTO is waiting for its scheduled boundary.

While AUTO is engaged, both deck overview waveforms and both rolling waveforms
show the scheduled transition: teal START/END guides and a shaded overlap, white
OUT FADE / IN FULL guides for Crossfade, or an amber BASS SWAP guide.
The markers use the native plan, including cue points, shorter overlaps and Smart's
selected drop or midpoint fallback. No overlap shows one HANDOFF marker. Markers
clear on completion or cancellation. Looping rolling waveforms retain the output
clock countdown, while overviews project upcoming events onto the looped source.

**Transition mode** in Settings offers **Crossfade**, **Bass swap** and **Smart**. Crossfade
raises the incoming fader from zero to its target over the first 80% of the
transition. The outgoing fader stays at its starting level for the first 20%,
then fades to zero over the remaining 80%. This keeps more energy in the middle.
Bass swap holds the outgoing fader during the first half while
raising the incoming fader from zero to match it, with the incoming bass killed. A quick
10 ms EQ swap just before the halfway beat kills the outgoing bass and restores
the incoming bass to unity. The outgoing fader then falls to zero over the second
half. As the incoming fader rises, the outgoing high EQ gradually falls from its
current setting to a full cut, reaching the cut when the incoming fader reaches
full level. The stopped deck's previous bass and high settings are restored at
the end; cancelling leaves the EQ at its current levels. A manual outgoing high-EQ
edit takes over that band for the rest of the transition. Manual EQ changes keep the transition
running; scheduled bass changes still fire once. EQ, trim and filter remain
available throughout the transition.
The selected mode also applies to library Play All; changes affect the next transition.

**Smart** uses the Bass swap method with a conservative bass-return detector. It
looks for at least two bass-light bars followed by an audible, sustained bass
return on an incoming bar boundary inside the overlap. The incoming fader reaches
the outgoing level at that drop, the bass swaps just before it, and the outgoing
fader falls to zero over the remaining overlap. If no clear candidate fits, every
fader, EQ and tempo action follows Bass swap's midpoint timing exactly. Cues,
shorter-overlap fallback and creative loops retain their existing behavior.
Smart also applies to library Play All. It detects bass returns rather than
promising to identify every musical drop; fills, swells and off-bar returns are
rejected conservatively. The raw stereo PCM is analyzed once on the ordinary
loading thread into a compact bass-energy profile shared with the loaded source.
Arming a transition inspects at most 32 bar boundaries, using the current timing
grid and cue; the playback path does no PCM analysis or FFT work.

**Settings → Automatic transitions** remembers the overlap (none, 1, 2, 4, 8,
16 or 32 bars) and the BPM shift percentage toward the incoming track's original
BPM across the overlap. Both decks lock when engaged. No overlap
hands off at the end. Settings changes apply to the next transition. Automatic
fader transitions also work with the manual crossfader hidden. Library Play All uses the
same overlap setting; change it in Settings → Automatic transitions.

Deck volume faders control native volume independently of the **GN** trim (−12 to +12 dB).
**LO / MD / HI** use a three-band kill EQ (−∞ to +6 dB, unity at the midpoint),
with 24 dB/oct crossovers at 250 Hz and 2.5 kHz. **FL** sweeps a low-pass to the
left (20 kHz down to 30 Hz) and a high-pass to the right (20 Hz up to 18 kHz);
the center bypasses the filter. Double-click any dial to reset. Dial changes
ramp over 10 ms, and settings carry over when replacing a loaded track.
Use **Timing & tempo** for grid editing, tempo presets and click volume.
Each deck header shows original BPM, the speed change (↑ faster / ↓ slower),
and current BPM. Drag or scroll the current BPM to change tempo; Shift-scroll
uses 0.01 BPM steps. Double-click either BPM to unlock and restore original speed.
In **MIDI map**, select the percentage change to learn a tempo slider relative
to the loaded track's original BPM (default −8% to +8%; edit From/To or Invert
in the mapping editor). The slider centre restores original speed. Manual tempo
controls require an unlocked deck; the current BPM also retains absolute BPM mapping.
Both controller mappings smooth playing tempo changes over 80 ms, preserving the
time stretcher's audio history throughout slider movements.
**Edit grid** enables dragging beat marks while the deck is stopped in that deck's rolling waveform.
Dragging anywhere shifts the whole grid without changing BPM. **Command-click**
any beat mark to pin it (shown green); subsequent drags scale the grid and BPM
around that beat. Start scaling away from the green pin, which stays fixed; scaling
stops at 30–300 BPM rather than reverting the drag. Command-click another beat to move the pin, or the pinned beat
to unpin and return to shifting. Without a pin, the hand cursor appears over beat marks,
with a horizontal resize cursor between marks. With a pin, the resize cursor appears
away from the pin and an unavailable cursor over the fixed pin. These cursors remain visible during playback while editing is paused. Save and Cancel clear the pin.
Play and pause freely while editing to listen with the unsaved draft grid.
Moving, scaling and pinning are disabled during playback and resume when paused.
The draft and pin survive playback; Cancel also restores the original audible grid. **Save grid** persists and applies
the draft; **Cancel** restores the previous grid without saving. Other timing
edits are disabled until the draft is saved or cancelled. Future controls are disabled;
**Approve analysis** marks a completed analysis as Approved
in the library. The timing grid's reviewed flag remains a separate assertion.
The last deck touched, including its top rolling waveform, receives ⌘B to set a
reference beat, ⌘⇧← / ⌘⇧→ to shift the bar start by one beat, and ⌘⇧A to
approve analysis. These shortcuts work with the timing panel closed. Reference beat edits require a stopped deck. Bar shifts also work when the target
is the only playing deck: the master clock follows the corrected grid while
audio position, playback speed and tempo lock stay unchanged. Analysis approval
also works during playback. The
active deck's A/B squares are filled in the deck and rolling
waveform; the other deck's squares are outlined.
the deck meters show post-fader peaks, and the stereo master meters show the
clamped output peaks. A dedicated 30 Hz feed accumulates native output samples
between meter requests, independently of transport polling. The display rises
immediately on each peak and falls at 24 dB/sec on the shared animation loop,
from −48 to 0 dBFS. Master gain and crossfading remain deferred.
Use each library row's **•••** menu for timing, analysis and Load A / Load B;
dragging rows onto decks remains available.
Use the thin play column after the row number to audition a library track through
**Cue headphones** (selected in Settings). The row button changes to Stop while
loading or playing. Auditioning uses an independent player
at the source's original speed outside Play All overlaps and never replaces or changes decks A/B. The
compact controls beside **Music library** show pause/resume, Stop, a seek slider
and elapsed/total time. Stop cancels pending preparation, releases the preview
and hides the controls. Audition playback joins any selected deck cue in the
headphones. The expanded library also offers **Play on Master** while both decks
are stopped; starting a deck stops a master audition.

In the expanded library, **Play All** is available while both decks are stopped.
Enable it and choose the overlap in **Settings → Automatic transitions**
(**No overlap**, **1**, **2**, **4**, **8**, **16** or **32 bars**),
and audition any row to continue through the remaining playable rows in the
currently displayed order (including its search and sorting). This order is
captured when auditioning starts; the last track ends playback without looping.
The next track preloads while the current track plays. With an overlap, their
beat grids share the same bar phase and BPM, with a gradual tempo ramp from the
outgoing track's original BPM to the incoming track's original BPM using the
selected transition mode. Pitch stays unchanged. The incoming track continues at its original
BPM after the transition. Missing/stale grids, tracks
too short for the chosen overlap, or loading past the overlap boundary use
consecutive playback instead. Starting either deck stops Play All. Turning Play
All off keeps the current track playing at its original BPM. Changing overlap
length during a transition applies to the following transition.

Audition preparation skips deck waveform peaks and frequency shading and returns
only audio metadata. The native engine retains up to two recent audition sources
within a 256 MiB total cache, so repeat previews can reuse verified PCM after
source validation. Cold previews still decode and load the complete song before
starting; playback is not streamed. Deck loading adds waveform data on demand
while reusing the already decoded PCM.

Collection rows show number, cover tile, title, artist, rounded BPM, Camelot and
musical key (for example, 8B / Cmaj), A/B key compatibility, length and analysis
status. Compatibility dots range from red to green using Camelot wheel distance;
same key, neighbouring keys and relative major/minor score highest. They update
when tracks load on either deck and can be sorted independently. A missing key
or empty deck shows no score. The title's tooltip shows the source filename, and search also
matches it. The old expandable estimate row has been removed.
The **Settings** tab beside the workspace tabs shows the shared waveform zoom,
music folder and refresh control, native audio status, master BPM, and the persisted master tempo drift rate (default 1 BPM/sec). Returning to Decks keeps the selected zoom and deck playback state. Pinch over either top rolling waveform to zoom both rows together, snapping to the existing 1, 2, 4, and 8-bar intervals around the fixed playheads.

The **Sources** dropdown beside the rolling-waveform zoom selects which rows are
visible and remembers the selection. Deck A and Deck B are enabled initially.
Other options are the non-deck routing nodes with an unmuted path to Master,
including patches, input devices, generators and effects; cue-only paths are
excluded. Their rows show captured audio to the left of the shared output-time
playhead, with the master beat grid across the row and no seeking. Capture retains about 82 seconds at
5 ms peak resolution, including while a row is hidden; applying an audio-routing
change starts a fresh history. Extra rows scroll within the waveform area.

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

The native backend uses persisted folder settings, with the original absolute
`MUSIC_BIN` as its default; launch directory does not change it. Compose mounts
the selected music folder into `/music` read-only and `app/generated/` separately
read/write. VIRA verifies the service's folder identity before opening/refreshing
and reconfigures the mount on a background thread when needed. Neither the
service nor app modifies source music.

Startup and Refresh scan direct children, using FFprobe to read embedded title,
artist and duration for MP3, PCM WAV, Ogg (`.ogg`, Vorbis or Opus), and WebM (Vorbis or Opus, including files mislabeled `.mp3`). Missing title uses the complete filename
stem; missing artist uses `Unknown artist`. Source filenames are available in the
title tooltip and library search. Subfolders are skipped. Unsupported, damaged, non-regular and
symlink files get individual error rows. There is no recursive scan or watcher.

The service publishes port 47831 on **127.0.0.1 only**. The webview can invoke
`refresh_library`, `get_library_state`, `analyse_track`, `load_track`,
`get_audio_state` and `deck_control`; it has no filesystem/shell
plugins or direct HTTP access. The backend sends requests to fixed service
endpoints on background threads, validates IDs/schema and verifies an analysis
ID belongs to a readable library row. It supplies the active music folder label. Probing
is limited to the file protocol, with a 15-second per-file timeout. Concurrent
scans return a retry message. The native request has a 120-second total timeout;
very large/problematic bins can exceed it in this initial serial implementation.

At startup, the app first shows saved library rows whose files still have the same
size. A background scan probes file metadata and reconciles the collection without
hashing audio or searching shared saved work. New files and changed files appear
after that scan. **Refresh** waits for a complete metadata scan.

Each successful scan writes `generated/library-v2.json` atomically (the original
metadata-only v1 snapshot is also retained). Row IDs encode collection, relative
filename, size and mtime. Content hashes are separate and may be absent until a
track is analysed or loaded. Unchanged local entries can show saved analysis using
file stats; same-size/mtime byte changes are detected when the file is used, not
while browsing. No snapshot is silently substituted when the service fails. The
UI labels any previous table as potentially out of date and allows Refresh to retry.

## Analyse one file

Click **Analyse** in a readable row. It queues only that source. Other rows remain
unanalysed unless selected. A single background worker processes jobs in order;
repeated requests for the same unchanged queued/running file are deduplicated.
The queue holds at most 32 waiting jobs plus the active job, and returns a concise
retry message when full. The UI polls authoritative library state once per second;
it ignores responses superseded by Refresh or a newer state revision.

**Analyse all** beside Refresh queues readable tracks in the current search view
whose analysis is Not analysed, Stale, or Failed. It skips completed and already
queued jobs, and waits for queue capacity when the view contains more tracks than
the queue can hold. Refresh cancels any remaining bulk requests.

The worker copies the selected file to temporary container storage while hashing
it, checks the requested revision, then invokes a single-file subprocess. It
uses `preparation/baseline.py`, based on the closed spike's method:
FFmpeg full-song mono 22.05 kHz decoding, Librosa onset/beat tracking, constant-grid
fitting, and harmonic chroma/Krumhansl-Schmuckler key candidates. There is no batch
scan, preview generation or engine comparison. Grid fitting now seeds tempo from
short runs and fits timestamps supporting the earliest coherent beat phase,
so breakdowns and offbeat tracker slips do not skew the whole song. Diagnostics
retain disagreement with all detected beats, including the supported fraction;
an unstable tracker still requires review. A separate phase calibration uses
repeatable PCM attack starts to remove spectral tracker delay, preserving tempo
and source-time silence. Its measured correction/support are saved alongside the
original tracker anchor; residual diagnostics describe the tracker fit before
this correction.
Untrimmed boundary candidates are retained separately. After fitting and attack
calibration, earlier candidates may extend the grid only when they agree with
the established pulse and a PCM attack. Recovery preserves fitted BPM and beat
phase, skips silence and unsupported candidates, and records the number of
recovered beat positions. The earliest supported beat is provisionally treated
as beat one of a 4/4 bar; musical downbeat detection remains unimplemented.
Dependencies are pinned to the spike's `requirements.lock.txt`.

Completed results preserve raw detected beats, fitted BPM/offset, residual/tempo
diagnostics, key candidates, per-window candidates and ambiguity flags separately
in generated analysis records. The collection shows the BPM, key and status.
**Analysed · draft** means completion, not musical verification; specific fit/key
warnings select **Needs review**. Explicit approval changes the status to
**Approved** and survives service restarts for the same source. Reanalysis resets it.
The baseline's general half/double-tempo/phase
advisory is retained in the result data for every non-silent result.

Click **Reanalyse** or **Retry** to identify the file and restore compatible saved
work if available; otherwise a new analysis runs. Queued, analysing,
analysed, needs review, stale and failed states are distinct. BPM/key stay blank
for unfinished, failed or stale results. Request/job errors are local to the row.

Each per-filename file in `generated/analysis/` contains the schema version,
analyzer version, source ID/revision/content hash, state and complete result.
Completed analysis and approval are also saved in `generated/content/analysis/`
by content hash, independently of the collection and filename. Analysis requests
copy/hash only the requested source, check shared saved work, then skip numerical
analysis when a compatible completed result exists. Deck preparation also identifies
the requested file and restores its saved analysis before reading timing. A lookup
is not a save: timestamps change only for actual analysis/approval or manual timing
edits. Old per-folder caches are inspected lazily on first recognition; when entries
conflict, their saved timestamp (or legacy file modification time) selects the newest
analysis and newest timing independently. Legacy files remain available on disk.
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
converts the complete song with FFmpeg to stereo float32 at the engine rate, and derives up
to 1,024 stereo peak buckets from those exact samples. Peaks preserve channel
and time correspondence. Each deck displays one combined waveform, using the
larger channel peak per bucket, while playback stays stereo. These are full-song
waveforms, not the spike's excerpts.
The Docker service caches versioned PCM/peaks outside the source bin. Matching
content/settings are reusable; incomplete or incompatible caches are rebuilt.
On a cache hit, saved peaks are reused without scanning the PCM again. Native loading
validates the descriptor and streamed PCM checksum, rejecting same-size corruption. Full PCM never travels
through webview commands/events.

Each successful load installs only the selected deck, paused at the beginning.
The mixer **Gain** knob is saved automatically as `gain_db` in per-track metadata
under `~/Library/Application Support/uk.ricca.vira/track-metadata/`, keyed by the
source content hash. Loading the same audio on either deck restores that gain,
including after restarting the app or moving the file. New content starts at 0 dB.
The deck volume fader stays at its current level when loading another track.
The loading preference resets EQ and filter; saved track gain is always restored. Double-clicking Gain saves its 0 dB reset. Source music files stay read-only.
For tracks with a timing grid, the first beat is playable zero: load, Stop,
Cue and Home start there, and the deck clock reads 0:00. Seeking, scrubbing,
master alignment and loops stay between that boundary and the source end.
A one-bar loop at zero covers the first four beats without the leading gap.
Waveforms retain source timestamps internally so saved timing references remain
valid; the overview and elapsed clock show only the playable portion.
The current source keeps playing while a replacement is prepared; failed loading
keeps it usable and displays an error. If loads race on one deck, the latest
request is the only one that may commit. The other deck continues independently.
The same source can occupy both decks, sharing immutable PCM but retaining two
separate R3/transport states.

- **Play / Pause** resumes or holds position. Playing after a natural end restarts
  the song from the beginning. Reaching the end stops unless a loop is active.
- **Loops** use bar lengths in 4/4: 1/4 is one beat, 1 is one bar, and 2 is two
  bars. By default, a length loops the grid segment containing the playhead;
  Settings can switch to starting at the playhead. Click the same length
  again to release it, or a different length to switch. IN and OUT mark a manual
  loop and snap to the nearest beat by default when a grid is available; a
  separate Settings option allows exact playhead placement. Both waveforms show
  the loop bounds. OUT or the active length releases the loop. On a playing
  locked deck with SLIP off, release waits for the master's phase to match OUT
  using Settings → Locked deck start (Bar or Beat), then continues from OUT.
  It does not advance the resume position while looping. For an OUT point within
  a bar or beat, the exit waits for that same position within the master's bar
  or beat. Repeated presses keep the same queued exit. The deck
  shows “Loop release queued” while it waits. Unlocked and paused releases remain
  immediate. SLIP still returns immediately to its advancing background playhead.
- **SLIP** keeps a background playhead moving while a loop repeats. Releasing
  the loop resumes at the background position. It pauses and follows tempo with
  the deck, and stays enabled when another track loads on that deck.
- **Cue** uses Pioneer-style transport behavior. While paused away from Cue,
  press to set it at the current position. On a locked deck, it snaps to the nearest
  bar or beat according to Settings → Locked deck start, within the playable track.
  During playback, press to return to Cue
  and pause. While paused at Cue, hold to audition; release returns and pauses.
  Press Play while holding Cue to continue playing after release. Pointer and
  Space/Enter holds are supported, and cancellation/window focus loss ends audition.
  The amber overview marker shows Cue. Each newly loaded deck starts with Cue at
  zero; Cue is temporary for that load. Returning to Cue and auditioning are immediate,
  including on a deck locked to the master tempo.
- **Stop** pauses and returns to the beginning, preserving Cue.
- On paused/stopped decks, drag the full-track overview playhead to seek silently.
  Drag the top rolling waveform beneath its fixed center playhead to scrub audibly,
  forwards or backwards, with continuous motion smoothing and cubic audio
  interpolation. Audio fades to silence when the pointer stops. Clicking the
  rolling waveform grabs it without jumping. Release leaves the deck paused at
  the selected position. While playing, click either waveform to jump to the
  nearest position with the same phase as the deck immediately before the jump,
  using the selected beat/bar setting. Playing clicks retain tempo lock and do
  not start a scrub gesture. Tracks without a timing grid seek exactly.
  Paused seeking and scrubbing retain tempo lock. Use left/right arrows for
  five-second jumps, or Home/End for the track boundaries; playing keyboard seeks
  preserve phase too. Exact seeks to the end stop playback.
- **Key** opens a dropdown with the twelve keys in the track's detected major or
  minor mode. Original is marked in the deck's colour; Best match is marked in the
  other deck's colour, using that deck's current sounding key. Same-mode matches
  use the same root; different-mode matches use the relative major/minor. Both
  marks appear when the original is already the best match. Selecting a key uses
  the shortest semitone shift (at most six), independently of BPM. The button's
  `*` marks a changed key; selecting Original resets it. Shifts survive transport,
  looping and tempo changes, and reset on loading another track. Key selection
  requires an analysed key, a loaded deck and the running audio engine. Library
  compatibility indicators follow the shifted keys. Pitch changes use the same
  5 ms transition/re-prime path as tempo changes; musical listening on macOS is
  still required to judge transition and vocal quality.
- **Volume** sets per-deck gain from zero to one. The mix applies 0.45 headroom per
  deck and a final sample clamp; the default deck gain is 0.8.
- **Crossfader** blends A and B with an equal-power curve: full A at the left,
  full B at the right, and −3 dB per deck at centre. Gain changes ramp over 5 ms.
  Double-click to centre. Settings → Mixer → Show crossfader saves visibility;
  hiding it bypasses attenuation on both decks, and showing it restores its position.
  Channel meters remain before the crossfader; master meters show the resulting mix.

The output is one in-process CPAL/Core Audio stereo stream. A persistent producer
owns the two native Rubber Band 4.0 R3 voices, initially at unity speed/pitch. It renders
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

Full-track preloading is capped at **4 hours per source**, independent
of output sample rate. Stereo float PCM uses about 1.29 GiB per hour at 48 kHz
and 2.57 GiB per hour at 96 kHz; available memory can limit practical track length.
Failed audio-buffer reservations return an actionable memory error.
Larger sources fail with an actionable limit message. The
native cache holds weak references; source buffers are released after the last
voice/preparation owner retires. Temporary replacement buffers can increase
memory above the two active sources. Streaming and larger files
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

Tests generate synthetic MP3/WAV/Ogg fixtures in temporary container storage and
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

Use **Edit timing** on a loaded deck. Source BPM
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
content-hash records under `generated/content/timing/`. Reanalysis cannot overwrite them;
identical moved, renamed or copied sources reuse them on recognition. A filename pointer signals stale corrections
when bytes change. Stale values cannot be loaded or used for sync; explicitly
prepare/review the changed source. **Apply to deck** saves, then applies only to
that deck generation. Other loaded decks keep their applied grid until Apply or
reload. Applying a grid retains source position, returns to its source tempo,
clears that deck’s master tempo lock.

Each deck supports the full 15–600 target BPM range, regardless of its source BPM.
Rubber Band R3 uses duration ratio = source BPM / target BPM, with independent pitch scale
`2^(semitones / 12)`. Unreviewed grids can be auditioned. Controller tempo sweeps
ramp the live ratio over 80 ms without resetting R3. Other tempo changes reset/re-prime R3 at the
producer boundary using the current precise source anchor, discard old prepared
DSP output and crossfade from the last output over 5 ms. This is a short transition,
not a guarantee that stretched song attacks remain sample-exact.

The master BPM is independent of either deck and is unset until the first deck plays at its current tempo. The lock icon beside
an applied deck's BPM locks it to the master if it has a timing grid.
Large BPM differences are allowed, including when drifting the master to another
deck's original tempo while keeping followers locked. Draft grids can be locked, so review
their musical timing before relying on alignment. Both decks can lock at once. A locked
deck's BPM and manual tempo controls are greyed out. Unlocking preserves its
current target BPM. Manual deck tempo changes unlock that deck;
replacing or applying a grid clears only that deck's lock. Pause and Stop leave
the lock armed. Each deck remembers its lock state across app restarts and restores
it when a track with a usable timing grid is loaded. Empty decks do not clear saved
locks. Locking a playing deck seeks to the nearest source position with
the master's selected beat or bar phase. When Play starts a locked deck while another deck is
running, the Bar setting (the default) joins the current bar immediately during
its first beat by seeking to the nearest matching source bar phase. From beat 2 onward,
it waits for the next matching bar.
The Beat setting waits for the next matching beat. A queued deck keeps its audio
and pickup at the cue; if there is not enough time for the pickup before the
imminent selected boundary, it starts for the following beat or bar.
Pause or Stop cancels the pending launch. The first deck to play starts the master clock at its own
current grid position, including a pickup beat before the first downbeat, without
seeking its audio. Both locked
decks use that same phase, and follow master tempo changes at render boundaries.

The header's A → and B → buttons, before master BPM, move the master toward the selected
track's original grid BPM at the configured BPM per second, whether locked or unlocked.
Double-click sets the master to that original BPM immediately. These buttons preserve both decks' lock
states. The drift rate is in Settings, defaults to 1 BPM/sec, and persists locally.
Settings also permits setting the master BPM directly. Range failures are
reported instead of silently clipping; a drift stops before it would take a
locked deck outside its supported speed range. A manual per-deck phase bias and
external clock integration remain future work.

In **Timing & tempo**, **Set reference beat** marks the exact playhead position.
With that panel open, double-click the top rolling waveform to mark the clicked
source position instead. Without a BPM, the first flag waits for a second reference (keep the track loaded).
The pair is treated as consecutive bar starts when that gives 30–300 BPM;
shorter gaps use adjacent beats, and longer gaps use whole bars nearest 120 BPM.
The earlier reference becomes bar 1, beat 1; the resulting grid is a draft.
Approve is hidden until a timing grid is available.
With an existing BPM, the first flag shifts the source beat grid without
changing BPM; the earliest grid beat in the track becomes bar 1, beat 1.
The second flag fits BPM so both flags fall on beats. A third flag replaces the
oldest. Flags appear on the rolling and full-track waveforms while the panel is
open. The adjusted source grid, BPM, and flags are saved with the track and
restored after restarting VIRA. The panel's **Track BPM**, **Set BPM**, **Half BPM**,
**Double BPM**, and **Original BPM** controls save and apply source-grid corrections
during playback without changing the deck’s speed or tempo lock. A playing, locked deck
updates the master BPM by the same ratio (Half/Double BPM halves/doubles it).
Corrections on stopped decks or decks waiting to launch leave the master BPM unchanged.
Original BPM restores the analysis suggestion's BPM, preserving
the downbeat and reference flags. BPM corrections clear timing review. Reference and bar-start edits require a
stopped deck and clear deck sync.
Playback BPM remains controlled by the deck header.
Track BPM can also be entered before analysis: Set BPM creates and saves a draft
grid starting at the track's playable start (zero for an unanalysed track).
The grid is immediately available for playback, tempo lock, and reference-beat adjustments.

The top A/B rows retain a fixed central playhead and use a shared output-time
window: eight beats at master tempo. Shared zoom offers 4/8/16/32
beats (2/4/8/16 s fallback). Each row maps source peaks and grid through its own
speed, so different target tempos have different beat spacing. Draft grids are
fainter; unavailable grids draw no markers. Empty space outside source boundaries
remains empty. The overviews stay seekable and the top rows also support paused scrubbing.
Moving triangle markers jump by whole phrases while retaining the current musical
phase. During playback they crossfade the continuing outgoing audio into the new
position over 30 ms by default. Settings → Waveform jumps → Jump crossfade saves
a duration from 5–100 ms, or Off. Paused jumps remain immediate. The producer
reserves both overlap buffers when loading the voice; the destination clock
starts at the jump boundary and advances throughout the overlap.

Preparation caches stereo peaks at 240 source frames (5 ms). The native load keeps
those saved fine peaks for the webview, which fetches them once per active artifact
without a second preparation request and retains at most active-source caches;
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

The playback tempo range is **15–600 BPM** for every track, controlled from the deck header.
Source timing remains 30–300 BPM, giving playback speeds of 0.05–20× at the
extremes. Locking follows the master across this entire range, preserving pitch.

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
white on strong attacks. Left-channel power spectra use 1024-sample Hann windows
and 5 ms hops. Playback and the amplitude peak envelope remain stereo. Brightness
combines treble proportion and absolute RMS; positive spectral flux and
a separate 40–250 Hz envelope identify strong bass attacks for white highlights.
Treble attacks retain the deck colour; highlights are narrowed to one 5 ms bucket
with at least 100 ms between candidates. Sustained bass remains dark.
These are source-audio cues, independent of playback gain and tempo. Cached
preparation gains versioned frequency features automatically on the next load.
Rolling, overview and timing views share the shading. Close-up maxima preserve
short attacks. The full-track overview averages attack strength into density
to avoid saturating entire passages white.

Frequency features persist in `generated/prepared/<artifact-id>/manifest.json`
and are reused across loads and service restarts. Version and checksum checks
reject stale or damaged shading. Feature repair reuses valid PCM without decoding.
Cache checks still validate source/PCM integrity and amplitude peaks, but skip
FFT analysis when frequency features are valid.


### Master and headphone outputs

Open **SETTINGS** in the workspace tabs, select **Master out** and **Cue headphones**, then
click **Apply outputs**. Master defaults to the system output; cue starts off.
Selections are saved in `~/Library/Application Support/uk.ricca.vira/audio.json`.
**Internal working audio rate** defaults to **Audio device native rate**, adopting
the selected master's advertised current/default sample rate. Alternatively select
44.1, 48, 88.2, 96, 176.4 or 192 kHz; fixed rates also set the master stream rate,
and options unsupported by the selected master are disabled. The preference is
saved alongside the output routes. Select a stereo channel pair for each output.
Master and cue can share a device when their channels do not overlap. For the
Starlight, select the device for both, master channels **1–2**, and cue channels
**3–4**. Both mixes are written directly into one four-channel stream at 44.1 kHz.
The master stream does not resample engine output. A separate cue device opens
at its own native rate; the bounded stereo bridge adapts the cue mix to that rate.
Old output settings default to channels 1–2. Channel choices are saved and
validated against the device's available channels at its selected rate.

Changing the engine rate shows **Apply outputs & restart VIRA**. Save grid and
patch edits first: the restart clears loaded decks. Preparation generates a
separate PCM/waveform cache for each rate; existing 48 kHz caches remain reusable
when returning to 48 kHz. BPM, saved beat grids and analysis are source-time
metadata and remain valid. Pitch processing, filters, MIDI clocks and patch
instruments use the engine rate for the entire app session. Saved patch Buffers
are restored at that rate; a Buffer that would exceed native sample capacity
is rejected with an actionable error rather than changing its duration.

The headphone buttons above the channel faders select deck A, B, or both for
cue. Cue follows trim, EQ and filter, and bypasses channel volume and crossfader.
The transport CUE button continues to set/return to the deck's cue point.
Changing outputs at the same engine rate preserves loaded tracks and transport. Disconnected explicit
outputs wait for reconnection instead of falling back to another device; cue
failure leaves master playback running. Settings refreshes the device list
and displays output errors. A bounded stereo queue with interpolation compensates
for small clock differences between devices; physical headphone latency remains
device dependent. Dual-device listening still needs verification on macOS hardware.

### Audio Routing page

In the Decks **Patches** panel, **BYPASS** beside ON/OFF passes the patch's audio
inputs directly to its existing destinations. ON/OFF is disabled while bypassed.
OFF and BYPASS pause the patch DSP and its clock; parameter edits apply when
processing resumes. Multiple stereo inputs sum while
preserving left/right channels and routing gains. OFF still silences the patch;
turning it ON restores its chosen bypass state. Patches without audio inputs
have bypass disabled. The bypass choice persists with the session.

**ROUTING** opens a stereo audio patchbay. Deck A and B keep their labeled, color-coded groups;
player → trim → EQ → filter → fader is the initial chain. These nodes retain the
Decks page's controls. Crossfader/mix and cue mix retain their existing controls;
Master and Cue outputs use the devices selected in Settings. No MIDI routing
is included.

Connected audio input devices appear in the **Input devices** palette list, which
refreshes automatically. Drag a device onto the canvas (or double-click it) to add
its source node. Input nodes can be removed and added again from the list.
Connect a source's audio output to a processor, patch, mix, or output and select
**Apply routing** to begin capture. Each device supplies its first two channels;
mono inputs feed both stereo channels. Native device sample rates are converted
to the routing engine's selected rate. macOS microphone permission is required.
Disconnected inputs become silent; reconnect the device and apply routing again
to restart capture. Capture errors appear when applying routing.

Drag an output port onto an input port. Release anywhere else to cancel.
Multiple destinations create branches; multiple wires feeding an input sum their
signals. Select a wire to change its linear gain (0–2×) or disconnect it. Choose a
node from the categorized left palette. Drag it onto the canvas to place it, or
double-click its palette entry to place it in the visible canvas center. The
palette includes effects, instruments and saved patches. Default deck components,
mix nodes and outputs stay on the canvas and cannot be removed.
**New patch** creates a saved patch, registers its session instance and opens Teia.
Saved patches added here also appear in Decks; their ports here carry audio. Drag node headers to
arrange the canvas. Zoom / Fit shows the whole graph; scroll to reach its full area.

Built-in processors initially include Gain, a 4:1 Compressor with a named
sidechain input and separate processed/dry outputs, a sine instrument with
sine/cosine outputs (20–2,000 Hz at 0.1 amplitude), and a Ring modulator with
separate audio/carrier inputs and processed/dry outputs. Compressor threshold is
linear amplitude (0.01–1); its detector follows its own audio when no sidechain
wire exists. A connected silent sidechain remains a silent external detector.
The node/port schema supports multiple named stereo audio inputs and outputs;
this increment does not host third-party plug-ins.

Edits are staged. **Apply routing** validates and publishes the complete graph;
invalid ports, duplicate wires, non-finite/out-of-range values and all directed
cycles are rejected without changing the current audio configuration. The graph
is limited to 128 nodes and 512 wires. Select an added node or any cable, then
press Delete / Backspace to remove it; removing a node also removes its cables.
Default nodes can still be moved and their cables edited.
Disconnected outputs are silent. Revert edits restores the last accepted graph;
Default chain stages the factory configuration. Cmd-Z / Cmd-Shift-Z undo and
redo draft edits, including complete node moves and node/cable deletions.
Drafts, selections and edit history survive switching to other workspace pages.
Click empty space to deselect; Escape cancels a drag.
Removing a
patch node removes its canvas placement and cables, keeping the session instance
in Decks and its file in the library. Accepted graphs/layouts are
session-local, and opening VIRA again starts with the conventional chain.

A graph compiler validates and orders nodes on an ordinary command thread. The
producer executes a precompiled bounded schedule with stack scratch buffers;
it does not allocate, discover topology or rebuild graphs per frame. Graph swaps
occur at existing 128-frame command boundaries, preserve compatible processor
state, ramp output for 5 ms and retire old plans through the existing ordinary
thread retirement queue. Layout-only updates do not swap the audio plan. The
conventional graph selects the original fused deck/mixer path, with the original
click, cue, fader and crossfader behavior. The Core Audio callback is unchanged.

Native benchmark evidence and limits are in `VERIFICATION-ROUTING.md`. Repeat the
steady workload with the GUI closed:

```sh
output/VIRA.app/Contents/MacOS/vira --audio-benchmark 30 output/routing-steady.json
output/VIRA.app/Contents/MacOS/vira --native-routing-check 30 output/routing-edited.json
```

The first measures steady process CPU, callback execution, dropouts and measured
control-to-consumed-callback latency under a fixed two-deck EQ/filter workload.
The second runs the existing native transport/lifecycle harness with a compressor
between Deck A's EQ and filter, Deck B feeding its sidechain, and an additional
parallel EQ send to master. Physical device latency requires loopback hardware.

### Track tags

The Tags sidebar sits to the left of the library table. Create a tag with the
New tag field and + (or Enter), then drag a track onto the tag to assign it.
A track can belong to several tags. Click tags to toggle filters; multiple
selected tags show tracks matching **any** selected tag, combined with the
current music folder and search. All clears the tag filter.

Assigned tags appear beneath track titles. Open a track's Actions menu to check
or uncheck its tags. Hover over a sidebar tag and click × to delete it after
confirmation; Cancel or Escape leaves it intact. Deleting a tag removes only
that tag and its assignments, never the songs or music files.

Tags are saved atomically in `~/Library/Application Support/uk.ricca.vira/tags.json`,
separately from analysis and folder scans, and persist across app restarts.

In either library size, Cmd/Ctrl-click toggles individual tracks and Shift-click
selects a range in the current displayed order (Cmd/Ctrl+Shift adds a range).
Dragging any selected row onto a tag assigns that tag to the entire selection.
Dragging an unselected row selects and drags that track alone.

In the expanded library, **Tag tracks** switches the sidebar from filtering to
assignment checkboxes for the selected tracks. A normal tick means every selected
track has the tag; a grey tick means only some do. Click an empty or grey tick to
assign the tag to all selected tracks, or a normal tick to remove it from all.
Tag filters pause while Tag tracks is enabled; the folder and search still apply.
Bulk assignments are saved together, and failed saves leave existing assignments
intact.

### Melodic, percussion and cue point patterns

The **Patterns** workspace contains reusable, persistent MIDI loops. Create a
pattern, select a CoreMIDI destination and channel, and launch it on the next beat
or bar. Each pattern has its own transport; several can play together. The audio
engine must be running. Patterns keep the master beat moving even when both decks
are stopped, and use the same master tempo as the decks.

Choose **+ Melodic pattern** for the existing scale-relative piano roll, or
**+ Percussion pattern** for a loop that starts with zero rows. In a percussion
pattern, click **+ Add row**, then configure its name, fixed MIDI note (0–127)
and optional channel (1–16). Click a row header to reopen its configuration.
An empty channel uses the routed channel; a row channel overrides it. Percussion
notes keep their fixed pitch across root/scale changes. Row edits apply to its
existing notes, and deleting a row removes its notes. Both pattern types support
the same note gestures, velocity, timing, duplication, persistence and routing.

Choose **+ Cue point pattern** for four fixed A–D rows. Connect its **cue gates**
output to a deck's **cue trigger** input, including the Active deck node. Each
note presses that saved cue at note-on and releases it at note-off, returning the
paused playhead to the cue. Resize the note to play a shorter or longer section;
empty cue slots are skipped and never created by a sequence. Cue gates are
independent of the deck's pitch input and use the native timestamped event queue.
Stopping a pattern or disconnecting its route releases its held gates. Cue
patterns share the other patterns' loop length, timing, duplication and storage.

Pattern canvas titles show the pattern name. Rename the title or the detailed
editor's name field to update the same saved name; the canvas omits the duplicate
name/status line inside the node.

Several patterns can connect to the same device MIDI input. Drag from each
pattern's MIDI output to that input, or from the device input to each pattern's
MIDI output. Adding a cable preserves the other patterns' connections and
independent playback. Pattern root note and scale inputs still accept one source.

Click empty grid space to add a note, click a note to delete it, drag a note to
move it, or drag its right edge to resize it. Grid values range from quarter notes
to 32nd notes. Set Length to any integer from 1 to 65,536 steps and choose a
Step size from 1/4 to 1/32, independently of the editing grid. For example,
7 steps at 1/16 loop every 1.75 beats, enabling polymeters. Existing bar-based
patterns retain their length. The grid shows five octaves of scale
degrees, with mapped MIDI notes beside them. Key, Major / Natural minor / Dorian /
Mixolydian scale and base octave remap the melody without changing its stored
degrees or octave offsets. Rename inline; duplicate and delete are in the editor
header. Shortening a loop removes notes beyond its end and clips crossing notes.

Instrument timing advance sends feeding patterns early, with **no upper limit**
on the non-negative millisecond value. Set it in
Instruments and save; each destination supplies its own timing through filters
and other transformations. Timing edits preserve running pattern phase and held
notes; events already handed to CoreMIDI retain their existing timestamps.
Legacy pattern/output compensation fields remain readable but routed playback
uses the destination instrument’s timing instead.

Snap to grid starts enabled. Disable it to move and resize notes freely in time;
new notes always start in the clicked grid cell. Pitch stays scale relative.

Scheduling runs on a native worker from the Core Audio playback timestamp and
master beat anchor; webview polling only displays the playhead. Events use exact
CoreMIDI host timestamps and a 5 ms scheduling horizon, plus the configured early
advance. Active note ownership is counted across patterns sharing a channel/pitch.
Loop ends release notes before retriggering them. Clock alignment defaults to
Master beat / bar, with launch and stop quantised to the selected boundary.
Tempo only launches and stops immediately (allowing the destination's scheduling
advance), keeps tempo with the master, and preserves its local loop phase across
master phase jumps. In either mode loops repeat at their own step length, without
resetting at bar boundaries. Changing alignment applies to subsequent transport
commands without restarting a running loop. Edits to a
running pattern preserve its scheduling cursor unless its destination changes.
Master phase jumps release and requeue events at the next selected master beat/bar
boundary; tempo-only patterns retain their loop phase. Missing audio clock, MIDI device
disconnection and application exit release owned notes. A stalled worker skips
stale events instead of emitting a burst of old note-ons.

Pattern definitions are atomically saved to
`~/Library/Application Support/uk.ricca.vira/patterns.json`. Play state is ephemeral;
reopening the app never starts external instruments automatically. The version's
`kind: melodic` and `mode: relative` fields separate the current editor from future
drum and absolute-pitch representations. Real hardware latency and timing must be
checked on macOS; container tests do not measure Core Audio / external MIDI timing.

### Pattern patching canvas

Patterns opens on a musical patching canvas. Double-click a pattern (or use its
Expand button) for the piano roll; **Canvas** restores the overview without
interrupting playback. Node positions, instruments and cables are saved with the
pattern bank. Existing MIDI output selections migrate to instrument nodes and
cables automatically.

The categorized left palette lists reusable patterns, decks, MIDI destinations,
MIDI sources and every saved Teia patch. Drag entries onto the canvas or
double-click them to add at its visible center. **New patch** creates and opens
a Teia patch; adding a saved patch loads the same session instance used in Decks
and Routing. Patch ports on this canvas carry MIDI. Teia
instruments use their existing audio connections on Routing. Instrument nodes
expose a latched **note out** and a full **MIDI out** only when they have an
available MIDI source. Destination-only endpoints show only **MIDI in**. External devices auto-match input/output names; select a specific source
in the selection controls below the canvas, or add an input-only controller from MIDI sources.
The device Channel selector offers **All** (the default) or channels **1–16**.
A numbered channel filters its incoming MIDI and note value and selects the channel
for MIDI sent to that device; All preserves each event’s original channel.
Patterns also expose a latched **note out**, alongside **MIDI out**, and can run
without a MIDI destination. Their last played note is shown on the canvas.
Deck A/B expose their analysed key plus the deck's current pitch shift (major or
natural minor); unknown deck keys leave the pattern's manual mapping in use.

The **Active deck** entry in the Decks palette creates a moving deck node. It
follows the only playing deck, otherwise the louder of the two playing decks,
using a 100 ms stereo energy envelope after channel EQ and fader (before the
crossfader). Equal levels follow the deck that started most recently. With both
stopped it retains its previous target; initially it uses A. Quantised launches
count when playback actually begins. The node shows its current A/B target and
provides the same root-note, scale and note-input ports as a fixed deck. Switching
replans existing MIDI routes and releases notes owned on the old destination.
Selection is measured on the audio clock, independently of UI polling.

Patch lime **note out** and orange **scale** outputs to the matching pattern
inputs independently. Each mapping input accepts one source, and a source can feed
several patterns. Drag cyan **MIDI out** to an instrument's **MIDI in** or a deck's
**note in**. Multiple destinations can be patched from one pattern. Select a cable and choose Disconnect (or press
Delete); drag either white endpoint to reconnect. Releasing outside a matching
port cancels. Node headers drag, Escape cancels gestures, and Cmd+Z / Cmd+Shift+Z
undo and redo canvas changes. Delete removes any selected node and its cables;
pattern definitions remain available in the palette. Connections apply as they
are saved. Empty-space and cable double-clicks do not create nodes.

Every MIDI cable has a stable note owner. Removing or reconnecting it releases
notes on its previous destination. External MIDI notes use destination/channel/
pitch ownership counts. Teia events carry a route epoch: disconnecting invalidates
queued note-ons before they reach the DSP, and the render boundary releases only
that route's sounding notes. Another pattern sharing the same channel/pitch is
kept sounding. Teia scheduling has a 40 ms horizon to precede the audio producer's
bounded queue; quantised stops retain timestamped note-offs until the stop boundary.


Patterns root note and scale use separate canvas ports. Note cables are lime,
MIDI cables are cyan, and scale cables are orange. Either input may be patched independently; the unpatched
setting remains editable. Existing combined key cables migrate to two separate
cables without changing the saved note degrees.

Each deck has a MIDI note input. Patch a pattern's MIDI output into it to sequence
deck transposition on the audio render clock. C4 (MIDI 60) preserves the manual
pitch; notes above/below add/subtract semitones, clamped to the existing ±6-semitone
range. The latest held note wins, falling back to earlier held notes and then the
manual pitch. Note release, cable disconnection/reconnection and track replacement
clear the appropriate ownership, including future queued notes. External MIDI and
Teia destinations remain available alongside deck targets. A deck root output
cannot feed the same pattern that modulates its pitch, preventing pitch feedback.


Pattern and device **note out** is a continuous last-note value: note-on updates it; note-off
and velocity-zero note-on leave it unchanged. It remains latched until a new note
is played, including when all keys have been released. A new cable immediately
receives the current value. Disconnecting a cable restores an unpatched pattern's
manual root and releases notes owned by that route. The display shows the last
note received. Root mappings use its pitch class while retaining the pattern's
octave setting. Deck key/root and scale outputs retain their separate meanings.

Device **MIDI out** carries the original external MIDI messages, including note
on/off, controller, pitch bend, pressure, program change, clock, system common and
SysEx (up to 65,535 bytes per message). Streams preserve running status and realtime
bytes interleaved with SysEx. Teia outputs carry the messages emitted by the patch;
Teia inputs accept the note, controller and bend event types supported by the
existing hosted engine. MIDI callbacks copy bounded packets to the ordinary MIDI
worker. Device loss, overflow, source changes and cable reconnection release the
old route's owned notes and cancel pending internal notes.


The **Transformations** palette contains **Octave shift** and **Filter**. Each
accepts multiple cables on its Note and MIDI inputs and exposes both output types; transformations can
be chained and their outputs can feed multiple destinations. Set Octaves inside
the shift node (−10 to +10). Filter passes pitches strictly Above or Below its
selected note; the threshold itself is excluded. Both transform note-on/off and
polyphonic pressure consistently, preserve channels and other MIDI messages,
and drop pitches outside 0–127. Note outputs retain their latched-value behavior.
Each source-to-destination path retains independent note ownership (up to 256 paths).
Changing settings or removing a route releases notes owned by the old route.

Routing and the Patterns canvas share `frontend/Patching.tsx` and
`frontend/patching.css`: page layout, headings, toolbar controls, node headers,
node width, port geometry, borders, colours, selection, categorized palettes,
drop/visible-center placement, node/cable deletion and keyboard handling. Audio
and musical graphs retain their own signal validation and publishing rules.
`frontend/patchLibrary.ts` shares patch creation and session loading with Decks.
Keep canvas chrome in that stylesheet; `patterns.css` contains only the melodic
editor and pattern-specific content such as its note preview.

**Instruments** stores named sets of optional hardware connections. Create an
instrument, name it, choose its audio input/output and MIDI input/output, then
click **Save instruments**. Audio input receives from the instrument; audio
output sends to it. Choose one hardware channel for mono or two independently
selected channels for stereo. Mono capture duplicates to both graph channels;
mono sends average left and right. MIDI input and output have independent
channel selectors: **All** receives every input channel and preserves source
channels on output. Definitions persist in the app support `instruments.json`.

In **Routing → Instruments**, add the named instrument once. Its left audio port
sends to the instrument and its right audio port receives from it, when those
connections are configured. Cable these ports to decks, effects, or patch audio ports
and **Apply routing**. In **Patterns → Instruments**, add a named instrument and
connect its MIDI/note ports to patterns, patches, or other destinations. Saved
cables refer to the instrument identity, so renaming or changing its connections
updates existing routes. Removing an audio connection removes its endpoint and
cables; a deleted MIDI instrument remains visibly missing with disabled ports.
Explicit audio devices never fall back to the system speakers. Device support,
round trip latency, and independent hardware clocks need verification on macOS.

### MIDI interface mappings

MIDI discovery initializes on the macOS main event loop before audio/MIDI workers
start. Device notifications trigger an immediate routing inventory scan, with a
one-second fallback scan. Enabled controllers reconnect automatically when plugged
back in; **Refresh MIDI controllers** also reads the current system inventory.

The native hot-plug regression test creates a separate-process MIDI source twice
with the same negative ID, receives CC messages on both connections, and verifies
both removals. Cross-build in Docker, then run the device measurement on macOS:

```sh
cd app
docker compose run --rm builder sh -c 'scripts/mac-cc -DVIRA_TEST_INITIALIZE tests/native/midi_hotplug.c src-tauri/native/teia_midi.c -framework CoreMIDI -framework CoreFoundation -o output/midi-hotplug-test'
./output/midi-hotplug-test
```

Enable controller inputs under **Settings → MIDI controllers**, then use **MIDI map**
next to CPU usage in the footer. Yellow outlines indicate mappable controls; click
one and move a controller knob/fader or press a note-sending button. The first CC
or nonzero-velocity Note On from an enabled input binds its device ID, channel,
message type and CC/note number. Note Off and zero-velocity Note On never learn. Green outlines indicate saved mappings.
The extra footer edits the range, inversion and behavior, relearns or removes a
mapping, and lists saved mappings. Turn mapping mode off to perform with the
controller. MIDI routing input selection is independent of mapping permissions.

Controller behaviour in Settings defaults to **Grab**: absolute CC knobs and sliders
wait until their position meets or crosses the current value before taking over.
Changes elsewhere require pickup again. **Jump** applies each movement immediately.
This preference persists locally and does not affect press, gate or note mappings.

Mappings and controller permissions persist locally. Absolute mappings scale CC
0–127 into a target range and respect its bounds and step; choices select discrete
options. Press mappings trigger at the rising midpoint crossing, while gate
mappings follow press/release (Cue defaults to gate and releases on disable,
disconnect or entering mapping mode). Multiple targets may share a CC or note. CC and note numbers are distinct sources;
existing CC mappings remain compatible. Note buttons trigger at any nonzero
velocity, and gate mappings release on Note Off (including zero-velocity Note On).
Absolute note mappings use press velocity; releases leave the value unchanged.

`MidiTarget` and `useMidiTargets` in `frontend/MidiMapping.tsx` are the common
adapter contract: a stable ID, label, kind, bounds/choices, availability, a current-value read callback, and an
apply callback. `useMidiControl` also supplies outline/selection attributes;
`MidiButton`, `MidiInput` and `MidiSelect` adapt standard controls. Use explicit
`midiId` values for dynamic labels or repeated controls. Entity targets must use
persistent entity IDs, never selection indexes. Pattern handlers remain registered
for every pattern and note, independently of the visible selection. Routing node
parameters use saved node IDs; patch knobs use the patch filename and parameter ID.
Deleted or unavailable targets are inert and remain removable from saved mappings.
Existing routing node parameters and cable gains are always live. **Apply routing**
commits structural edits (new/removed nodes and cables, reconnections). Parameters
on new nodes become live after those nodes are applied. Ordinary text fields and cable ports are not MIDI
value targets. Native CC/note collection shares the MIDI routing worker and uses a
bounded queue outside the audio callback; callbacks never invoke the UI.


Rolling waveforms can learn MIDI controller wheels in MIDI map mode. Select the
waveform, turn the wheel, then choose its encoding in the mapping editor:
two’s complement (1/127), offset (65/63), sign magnitude (1/65), or absolute
with wrap. Invert reverses direction. Wheel mappings bypass controller pickup.
Settings → Waveform MIDI wheels stores independent playing and stopped movement
amounts in milliseconds per MIDI step (defaults: 2 ms playing, 20 ms stopped).
The native audio engine smooths motion: playing decks temporarily adjust speed
without seeking or changing their selected BPM; stopped decks audition forwards
and backwards, retaining motion between MIDI messages. Playing decks must be
unlocked. Locking cancels pending movement, and stale track commands are ignored.


Two-finger trackpad scrolling over a deck’s rolling waveform uses the same native
smoothed jog path. Horizontal and vertical scrolling both work; the dominant axis
is used so diagonal gestures do not double the movement. Settings → Waveform
trackpad stores independent playing/stopped sensitivities (defaults: 0.5/5 ms per
scroll pixel), separate from MIDI wheel settings. Playing decks must be unlocked.
Pinch gestures continue to zoom. Trackpad movement also works in Edit grid mode
without changing the draft grid or its pinned beat; pointer dragging still edits
the grid. MIDI map mode and grid saving disable trackpad movement. Queued scrolling is discarded when the deck changes or is locked.

Settings → Playback → **Vinyl stop** is enabled by default and remembered between
launches. Pausing or stopping a deck brakes its audio over 300 ms, lowering speed
and pitch to silence. Pause resumes from the brake’s final position at the normal
selected tempo; Stop returns to the track start. Cue release and cancelled
scheduled starts stay immediate. Disable Vinyl stop for immediate transport stops.


In **Instruments → MIDI output**, **Send MIDI clock** sends 24 clock pulses per
master beat while the global clock advances. **Send transport messages** reveals
**Send Play every**, with intervals of **1, 2, 4, 16 or 32 bars** (default: 1).
It sends MIDI Start at the first beat of each selected global bar group, anchored
to global beat zero; a bar is four beats. Enabling it mid-group waits for the next
boundary. Track Play, Pause and Stop do not trigger transport messages. This
feature sends no MIDI Stop, Continue or Song Position Pointer messages.

Both options default off and are saved per instrument. They work without a
Patterns cable. Timing advance sends pattern notes, MIDI clock and periodic Play
messages early by the configured milliseconds, using a five millisecond queue
horizon. Instruments sharing a physical output use one MIDI clock stream with
the greatest clock-enabled advance. Each instrument’s Play schedule uses its own
timing advance. Their Play schedules combine and simultaneous
identical Play messages are sent once. External hardware timing requires macOS
testing.
