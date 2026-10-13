# VIRA — first playable library and decks

Status: steps 1–4 (library, analysis/persistence, and two independent native decks) implemented on 12 October 2026 in
`app/`. See [development instructions](app/README.md) and
[step 1 verification](app/VERIFICATION.md) and
[step 2 verification](app/VERIFICATION-STEP-2.md) and
[steps 3–4 verification](app/VERIFICATION-STEPS-3-4.md). Step 5 remains the broader
final verification/documentation milestone; the ten-minute native session and
focused regression checks described below have already been exercised.

## Outcome

A local macOS development app with a music-file table below two decks. Paulo can analyse an individual file, inspect the resulting metadata in its row, drag the track onto either deck, see its waveform and play it. Both decks can play independently at the same time.

This is a deliberately small first product step. Follow the broad arrangement of the supplied `VIRA Dark DJ Mixing Interface.png`: deck A on the left, deck B on the right, library table underneath. Use ordinary controls and a simple dark layout; visual polish is not a deliverable.

The original reference is `/Users/pauloricca/Downloads/VIRA Dark DJ Mixing Interface.png`. The updated root reference is `/Users/pauloricca/Desktop/projects/vira/VIRA Dark DJ Interface.png`. Its top stacked rolling waveforms, with centred playheads and close-up beat grids, are specified in `implementation-plan-02-timing-and-sync.md` as the next increment; retain this milestone's full-track deck overviews. Other reference controls are inspiration, not requirements.

## Agreed foundation

- Use Tauri + React/TypeScript with an in-process Rust audio engine, CPAL/Core Audio and the dedicated real-time producer/queue approach retained by the spikes.
- Preserve the existing spike harnesses and recorded evidence. Reuse the relevant native integration and worker code without replacing their historical experiments with product code.
- Retain Rubber Band R3 as the initial engine configuration at unity speed and pitch. This milestone does not expose stretching controls or settle R3/R2 musical quality.
- Follow `AGENTS.md`: installations, builds, tests, media preparation and offline analysis run in Docker; the compiled macOS app runs natively for actual playback. Do not install project toolchains on the host.
- Keep the completed spikes closed. The concept document's proposed MIDI/visual experiment is outside this milestone.

## User flow and screen

```text
+--------------------------------+--------------------------------+
| DECK A                         | DECK B                         |
| Title / artist                 | Title / artist                 |
| Full-track waveform + playhead | Full-track waveform + playhead |
| Play/Pause  Stop  Time  Volume  | Play/Pause  Stop  Time  Volume  |
| Loading / error status         | Loading / error status         |
+--------------------------------+--------------------------------+
| Music folder: …/vira/music                         Refresh       |
+-----------------------------------------------------------------+
| Title | Artist | Duration | BPM* | Key* | Analysis | Analyse      |
| Track rows: drag to either deck                                 |
+-----------------------------------------------------------------+
| *Automatic estimates; review warnings available in each row     |
+-----------------------------------------------------------------+
```

### Music bin and table

- Hard-code `/Users/pauloricca/Desktop/projects/vira/music` in one backend configuration constant. Do not resolve it from the launch working directory.
- Scan direct children on startup and on an explicit Refresh action. Recursive folders, watching, folder selection and general library management are deferred.
- Support the existing MP3 files and PCM WAV files initially. Show unsupported or unreadable files as such when encountered; one bad file must not prevent the rest of the table from loading.
- Read title, artist and duration without requiring musical analysis. Prefer embedded tags; use the filename stem when title is absent and `Unknown artist` when artist is absent. Do not invent artist/title by splitting filenames.
- Show title, artist, duration, estimated BPM, estimated key, analysis state and a per-row Analyse/Reanalyse action. Keep the filename available as secondary text or a tooltip so duplicate titles are distinguishable.
- Keep BPM/key blank until a matching result exists. Display queued, analysing, analysed, needs review, stale and failed states clearly. Failed jobs have a concise error and a retry action.
- An expanded row or tooltip can expose grid residual, ambiguity flags and alternate key candidates. Do not present correlation scores as confidence percentages.

### Per-file analysis

- Analyse processes only the selected file. Use a serial background job queue; deduplicate repeated requests for the same unchanged file.
- Reuse the existing FFmpeg/Librosa POC method initially, with a narrow single-file input/output interface. Do not perform an analysis-engine comparison or attempt to fix global grid fitting in this milestone.
- Retain raw detected beats, fitted BPM/grid offset, fit diagnostics, key candidates and flags separately. Present results as draft estimates; `analysed` means the job completed, not that its musical interpretation is verified.
- Publish the result back to the matching row without blocking the UI or interrupting native playback. Reanalysis must not alter a deck's transport or playback speed.
- Persist versioned results and their source identity so reopening the app does not require reanalysis. Never modify tags or overwrite source music.

### Deck loading and playback

- Drag an internal track row onto deck A or B. Transfer a backend track ID, not an arbitrary path supplied by the frontend. Provide small Load A/Load B row actions as an accessible fallback.
- Loading does not require beat/key analysis. Decode preparation and waveform generation are independent of musical analysis.
- Show loading/error state, title, artist, full-track waveform, playhead, elapsed/total time, Play/Pause, Stop and volume. Add the upper stacked rolling waveform strip in milestone 2 according to `implementation-plan-02-timing-and-sync.md`.
- Load paused at the beginning. Play resumes; Pause holds position; Stop returns to the beginning; reaching the end stops playback without looping. Clicking the waveform seeks within the track.
- Both decks feed one native output stream and can run independently, including when they contain the same source track. Include per-deck gain and conservative mix headroom; no full mixer or crossfader is required.
- Loading another track replaces only the target deck. Prepare the new audio away from the real-time path, then replace and stop that deck at a controlled boundary; keep the previous track usable if preparation fails. The other deck keeps playing.
- If two loads race for the same deck, only the latest requested load may commit. Old completions must not overwrite newer choices.
- Drive the playhead from backend playback-position state that accounts for queued audio, not from the decoder read cursor or a frontend timer. This need not claim sample-exact physical speaker timing.

## Minimal technical approach

### Development runtime boundary

Create the product app separately from `spikes/audio/`, for example in `app/`. Reuse its Docker cross-build setup and extract only the audio components needed for two persistent decks. Keep the native engine headless-capable.

For this local milestone, use a Docker preparation service for metadata inspection, file decoding, waveform generation and analysis. Bind its small API only to localhost; mount the fixed music bin read-only and a separate generated-data directory read/write. The Tauri Rust backend mediates requests and validates track IDs. The webview does not receive unrestricted filesystem or shell access.

Reuse FFmpeg for tags and conversion to full-length stereo 48 kHz PCM, and Librosa for musical analysis. This bridges the existing WAV-only audio harness to the actual MP3 bin without adding a native decoder or installing Python/FFmpeg on the host. It is a development dependency, not the intended shipping architecture. Document how to start it; show an actionable unavailable-service message when Docker/service startup is missing. Do not introduce Docker-based audio playback.

Preparation for deck loading produces full-length audio and compact waveform peaks. Existing 12-second mono review previews are insufficient. Compute peaks from the playback source, preserve its duration and channel/time correspondence, and send only compact peak arrays to the UI—not full PCM through Tauri events.

### State and persistence

Use a small versioned JSON index and per-source cache files rather than a general library database for this milestone. Keep generated data outside the source bin and out of version control.

- Track identity: canonical bin-relative path plus a source revision; record size/mtime for cheap invalidation and a content hash for prepared/analysed artefacts.
- File metadata: original filename, embedded title/artist, duration and supported/readable status.
- Analysis: analyzer/schema version, source hash, detected beats, fitted grid, key candidates, diagnostics and completion/error state.
- Prepared audio: source hash, conversion version/settings, PCM path and waveform peaks.
- Deck state: current track/revision, load generation, transport state, audible-position estimate, duration and gain.

Refresh reconciles additions, removals and changed files. Reject results for superseded source revisions and write completed cache entries atomically. Removed files become unavailable for new loading; already prepared playback need not stop. Do not hash or read whole files in the audio worker.

### Native audio and UI boundary

The spike's finite scripted renderer must become a long-lived two-deck engine. Add bounded control commands for prepared-source installation, play, pause, stop, seek and gain. Decode, allocate large buffers and dispose of old sources off the real-time path. Define queue-full behaviour rather than blocking the audio callback.

Carry forward callback-signalled worker wake-ups, verified real-time scheduling, bounded output buffering and telemetry. Separate producer chunk size from the requested device buffer size. Account for the known expensive restart/reset path when implementing load and seek; do not resurrect the rejected replacement-stretcher optimisation as if it were validated.

Use source sharing where useful when the same prepared track occupies both decks. Full-track preloading is acceptable for this two-deck milestone if its memory cost is measured and temporary replacement buffers are released. Streaming and large-library PCM caching policy can follow later.

Expose modest-rate state updates to React; interpolate the visual playhead between authoritative updates. Keep rendering, job updates and filesystem operations away from the output callback. Retain starvation/error counters to make playback failures visible during development.

## Implementation sequence

1. **App skeleton and bin listing.** Establish the Docker-built native Tauri/React app, preparation service, fixed-bin scan and tagged title/artist/duration table. Verify startup, refresh, missing tags and unavailable-service handling.
2. **Single-file analysis and persistence.** Add per-row requests, serial queue, state updates, result display, review flags, retry and source-version invalidation. Reuse the POC algorithm without widening its claims.
3. **One working deck.** Prepare full-song PCM/peaks, load by row action and drag/drop, render a waveform, and connect play/pause/stop/seek/gain to native playback.
4. **Second independent deck.** Add simultaneous playback, safe source replacement, stale-load protection and independent playheads. Exercise loading and analysis while the other deck plays.
5. **Verify and document.** Run focused tests in Docker, exercise the built app on the Mac with the supplied music, record audio errors/starvation and memory behaviour, and write reproducible development/run instructions.

Each step should leave a usable increment. Do not implement the concept's sequencer or larger playable milestone alongside this work.

## Acceptance checklist

- Launching lists the supported contents of the hard-coded bin with title, artist and duration; Refresh notices additions/removals/changes.
- Analyse on one row runs one musical-analysis job and updates that row with estimated BPM/key and any review warnings. Errors are local to the row and retryable.
- Reopening restores valid analysis. Changed source content cannot silently retain old results or prepared audio.
- An unanalysed track can be dragged to either deck, displays its full-track waveform and plays through the native engine.
- Play/pause/stop/seek and volume behave as specified; the displayed playhead follows backend state and reaches the end correctly.
- Both decks play together. Replacing/loading/seeking one deck does not reset the other; latest-request-wins behaviour is verified.
- The UI remains usable during preparation/analysis. Test playback while analysing another supplied track and record any interruptions.
- Use a repeatable native session of at least ten minutes with both decks, pauses, seeks and replacements. Require zero observed starvation/device errors for the tested session before marking playback acceptance complete; fix observed failures rather than hiding them with a success label. This does not replace later latency measurement or the longer production soak.
- Record actual source durations, peak memory, requested/observed callback sizes and engine settings. Do not infer end-to-end latency or supported production polyphony from these measurements.
- Add focused regression tests for source invalidation, failed/late jobs, deck command isolation and transport transitions. Preserve existing relevant audio regression checks. Review the simple layout visually on macOS.
- Provide one documented development startup path using Docker and the built native app. No deployment or distributable installer is required.

## Explicitly deferred

Automatic sync, tempo/pitch controls, grid correction UI, downbeat/section editing, cue points, loops, snippets, sequencers, ratchets, MIDI, visuals, effects, crossfading, recording, artwork, playlists, search/filtering, recursive scanning, folder watching, preferences, polished styling and advanced device recovery.

Automatic analysis remains advisory. Playing two independent decks does not imply they are beat-synchronised. The screenshot's Sync, Cue, FX, mixer, section markers and extra navigation should not become placeholder features in this milestone.

## Suggested implementation-chat prompt

> Read `AGENTS.md`, `performance-engine-concept.md` and `implementation-plan-01-library-and-decks.md`. Implement only the first library-and-two-decks milestone described in the plan. Reuse the accepted spike architecture and analysis baseline, preserve spike evidence, keep builds/tests/preparation in Docker and run native audio on macOS. Work incrementally through the plan, verify with the supplied music bin, and report any acceptance items that could not be verified. Do not expand into sync, sequencing, MIDI, visuals or design polish.
