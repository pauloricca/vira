# VIRA milestone 2 — editable timing and deck sync

Status: implemented; automated and native checks pass, with supplied-track musical listening/review still pending. Evidence is tracked in [app/VERIFICATION-MILESTONE-2.md](app/VERIFICATION-MILESTONE-2.md).

The subsequent user-requested optimisation expands playback to 0.5–2.0× and
replaces the initial rolling renderer/visual clock. See
[optimisation evidence](app/VERIFICATION-OPTIMISATION.md); the provisional limits
below remain the original plan context.

## Outcome

Paulo can correct a track's musical timing, save it, audition a beat/bar click, change deck tempo without changing pitch, and synchronise two decks using an explicit leader. Two stacked rolling waveforms above the decks make nearby audio and beat alignment visible around a fixed central playhead. This builds on the working library, analysis and native playback from milestone 1.

## Layout reference and rolling waveforms

Use the root mock-up [VIRA Dark DJ Interface.png](VIRA%20Dark%20DJ%20Interface.png), located at `/Users/pauloricca/Desktop/projects/vira/VIRA Dark DJ Interface.png`, as the rough layout reference. Follow its full-width top waveform area: A above B, immediately above the two deck panels, with matching deck colours/labels and a central vertical playhead spanning both rows. Design polish and the mock-up's other controls are outside this requirement.

- Keep each playhead fixed at the horizontal centre. Audio peaks and beat/bar lines scroll from right to left during forward playback; the centre corresponds to that deck's backend audible-position estimate.
- Show a few beats on either side, initially four before and four after the playhead. Offer a shared simple zoom setting. This is a close-up view alongside the existing full-track deck overview waveforms, not a replacement for them.
- Use a shared horizontal scale in output time so both decks can be compared meaningfully. At the leader/master tempo, the default window spans eight beats in total; before a tempo reference exists use an explicit time-window fallback. Map each deck's source peaks/grid through its own playback speed. Independently playing decks with different target tempos must visibly have different beat spacing; do not normalise their grids to imply alignment.
- Render each deck's applied grid with beat lines, stronger downbeat/bar lines and compact bar/beat labels. Distinguish draft versus reviewed grids, and omit invented beat lines when timing is unavailable. Grid edits appear only after Apply, consistently with the deck timing model.
- Use finer cached waveform peaks appropriate to this zoom level; avoid magnifying the 1,024-bucket full-track overview. Use the same source-time mapping for waveform peaks and grid markers so they scroll together.
- Drive animation from authoritative backend position/tempo snapshots with bounded visual interpolation. Pause freezes the row; seeks and source replacements re-anchor it promptly. Show empty space outside source boundaries while retaining the centred playhead. Do not generate audio events from animation frames.
- Keep these top rows display-only initially; retain seek and timing-edit controls on the deck/editor waveforms. Do not add scratching or drag-to-nudge behaviour in this milestone.

## Foundation and scope

Retain Tauri/React, the in-process Rust engine, CPAL/Core Audio, Rubber Band R3 and the dedicated real-time producer with bounded queues. Preserve the closed spikes and existing regression evidence. Follow `AGENTS.md`: build, test and prepare media in Docker; run the compiled macOS app natively for audio measurements.

Use a manually reviewed **constant-tempo grid** for this milestone. Automatic analysis remains a suggestion. Variable-tempo maps, automatic downbeat detection, key correction, harmonic sync, independent pitch controls, snippets, sequencing, MIDI and visuals are deferred.

## Track preparation

- Add a small timing editor accessible from a library row or loaded deck, with BPM, first-downbeat time in seconds, half/double BPM, and a control to set the first downbeat at the current waveform position.
- The first-downbeat anchor defines both grid phase and bar numbering. Use 4/4 initially, with the anchor labelled bar 1, beat 1. Beats before the anchor retain consistent numbering; explain this in the editor.
- Show grid lines and stronger bar lines over a zoomable waveform. Support mouse/keyboard seek and inspecting the beginning, middle and end. Existing 1,024 overview buckets may be insufficient for fine placement: generate/cache finer peak levels as needed, without sending full PCM to the webview.
- Offer a beat/bar click with independent song/click volumes. Generate and mix it in the native engine using the same musical-to-audio mapping as playback; accent downbeats. It should follow tempo changes and seeking. Keep it off by default.
- Save user timing separately from immutable analysis, associated with source content hash and schema version. Reanalysis must not overwrite corrections. Changed content makes corrections stale and requires explicit review; a renamed identical source may reuse them.
- Distinguish detected beats, automatic fitted grid and user grid. Avoid treating fitted offset as a detected downbeat. Provide Reset to analysis suggestion without silently marking the result reviewed.
- Allow an explicit Reviewed state after the user has checked alignment. Reviewed is a user assertion, not an accuracy score. BPM must be finite and positive; anchors must lie within the source. Define supported BPM limits and handle invalid input locally.

## Timing model

Introduce an explicit musical transport rather than deriving musical position from UI clocks or decoder read cursors. Distinguish output sample time, source position, global beat position and deck grid position. Store beat positions with sufficient precision and calculate event sample positions from a stable anchor; avoid repeatedly adding rounded samples-per-beat.

For a constant grid, source beat position is `(source_seconds - downbeat_seconds) × source_BPM / 60`. Playback speed is `target_BPM / source_BPM`; translate that explicitly to Rubber Band's duration-ratio convention. Test both directions.

Tempo changes must preserve musical phase through a new tempo anchor. Apply controls at defined output positions, accounting for prepared audio and DSP delay. Keep frontend state informational; the audio engine owns timing.

Time-stretching may move transients locally. Validate measured beat alignment through rendered or captured audio as well as mathematical clock agreement. Do not promise every attack remains sample-exact.

## Deck tempo and sync behaviour

- Add target BPM and a bounded tempo control to each deck. Start with the existing normal speed range of 0.8–1.25 as a provisional supported range, exposed clearly. Preserve pitch. Out-of-range sync requests fail with a useful message rather than silently clipping the target.
- A deck needs valid source BPM for BPM-based control. Unreviewed timing may still be auditioned, but enabling sync requires reviewed timing on both decks.
- Select A or B explicitly as leader; do not automatically switch leadership during playback. The leader's target BPM drives the follower. Display leader and sync state clearly.
- Enabling sync on a playing follower aligns tempo and bar phase to the leader, using a defined seek at a render boundary with a short transition to avoid a discontinuity click. Choose the nearest valid source position with the matching bar phase, so enabling sync does not jump arbitrarily to the same song bar number. Report the repositioning.
- Enabling sync on a paused follower arms it; Play starts it at a matching leader bar phase. If the leader is paused, retain the tempo relationship but defer phase alignment until playback can reference the leader.
- Leader tempo changes propagate to the follower at the same intended output position. Disabling sync preserves the current target tempo and lets the deck continue independently.
- A leader seek rebases the shared phase; a synced follower follows that phase using the same explicit alignment rule. A manual follower seek disables sync. Stop or natural end pauses that deck; the other continues at its current tempo. Resume re-establishes alignment where applicable.
- Replacing either track clears its sync membership. Removing the leader clears leadership and follower sync without stopping the other deck. Switching leader preserves playback continuity and performs one explicit follower alignment.
- Editing active grid metadata must be an explicit Apply action. Applying it clears affected sync and rebases that deck's grid without an unexpected automatic seek. Saved corrections do not silently change another playing deck.

These are initial product rules. Resolve any implementation ambiguity in favour of visible, predictable behaviour and document the final rule before testing it.

## Implementation order

1. Versioned user-grid storage, editor, reviewed/stale states and regression coverage for persistence and reanalysis.
2. Precise source/global/output mappings, native grid click and waveform beat/bar overlays, including the stacked top rolling waveforms with centred playheads and finer peak data; audition manual corrections on supplied tracks.
3. Independent pitch-preserving tempo control, preserving phase and using backend position telemetry through changing ratios.
4. Explicit leader/follower sync with the lifecycle rules above and visible failure states.
5. Native musical verification and documentation. Address burst work exposed by seeks/ratio changes without dropping the thin-callback architecture or hiding starvation.

## Acceptance

- A corrected BPM/downbeat survives app and preparation-service restarts; reanalysis retains it and changed content invalidates it.
- Clicks and overlays use the same saved grid. On a manually prepared supplied track, check alignment at the start, middle and end. Record drift and listening observations; do not infer correctness from overlays alone.
- Visually verify the top rolling A/B rows against `VIRA Dark DJ Interface.png`: centred playheads, several nearby beats on each side, readable beat/downbeat markers, shared zoom and retained deck overviews. Verify pause, seeks, source boundaries/replacement and tempo changes. At equal tempos the grids have equal spacing; unsynchronised phase remains visible, and differing tempos do not falsely appear aligned. Sustained waveform rendering must not introduce observed audio starvation.
- Tempo changes preserve pitch and musical phase. Verify synthetic reference timing, pitch and known sample events in Docker, then audition real material natively.
- Before sync acceptance, define a measured alignment tolerance. Proposed starting gate: no more than 10 ms beat-click misalignment in controlled engine renders after alignment/transition settles. This measures the controlled timing path, not automatic detection accuracy or physical device latency.
- Test leader changes, paused starts, seeks, stops, natural ends, track replacement, invalid grids and range failures. No stale command may affect a replaced source.
- Run at least ten minutes natively with two real songs, tempo changes and repeated sync actions; record zero observed starvation/device errors and disclose any unverified cases. Keep container throughput separate from native evidence.
- Retain milestone 1 functionality and relevant tests. Document source versus target BPM, reviewed timing, sync rules and known limitations.

## Deliverables and next-chat prompt

Deliver the working timing/sync increment, focused regression checks, reproducible commands and a verification report. Record adopted tempo range, alignment tolerance, native settings and any pending listening checks. Do not extend into the next milestone.

> Read `AGENTS.md`, `performance-engine-concept.md`, the app README/verification reports and `implementation-plan-02-timing-and-sync.md`. Implement only milestone 2, preserving the existing library and independent playback. Keep analysis advisory, save user timing separately, implement the documented sync semantics, and verify the native audio path. Keep development tooling in Docker and report acceptance evidence and unresolved items.
