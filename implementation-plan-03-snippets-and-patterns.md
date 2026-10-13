# VIRA milestone 3 — cue snippets and quantised patterns

Status: implementation plan only. Depends on milestone 2's reviewed grids, musical transport and tempo mapping.

## Outcome

Paulo can define a few snippets within a song, trigger overlapping voices, and arm one repeating pattern to start on the next bar or a manually labelled section boundary. The decks continue playing while patterns use their songs as sample sources.

This is the first increment that exercises the core idea: a performance instrument whose sample library includes entire songs.

Keep milestone 2's stacked rolling A/B waveforms above the decks, with fixed centred playheads and close-up beat grids. Reference the root mock-up [VIRA Dark DJ Interface.png](VIRA%20Dark%20DJ%20Interface.png) at `/Users/pauloricca/Desktop/projects/vira/VIRA Dark DJ Interface.png` for their placement. Add visible cue-region boundaries and section markers to these rolling views when in range, using the same source/time mapping; retain editing on the deck/editor waveform. The mock-up's additional performance slots and controls do not expand this milestone's scope.

## Foundation and scope

Reuse the accepted native engine, timing mappings, source preparation, waveform UI and user-metadata persistence. Keep the spike experiments unchanged. Follow `AGENTS.md`: builds, tests and preparation in Docker; actual audio on macOS.

Start with one active pattern and a provisional maximum of four simultaneous snippet voices alongside the two decks. Validate this workload before increasing it. A simple pattern editor and controls are sufficient. Ratchets, polymeter, multiple pattern lanes, scale lock, pitch controls, filters/effects, MIDI, visuals and automatic sections are deferred.

## Snippet and section preparation

- Add editable cue regions on a loaded track's waveform: name, start and end. Store exact source-time/frame boundaries, separately from analysis and grid corrections.
- Allow free placement and optional snapping to the reviewed beat grid. Provide playhead-to-start/end controls and a way to audition the selected region.
- Validate `0 ≤ start < end ≤ source duration`. Moving or deleting a region must not invalidate a sounding voice's immutable snapshot.
- A trigger creates a new finite voice; overlapping triggers do not restart an existing one. Snippets stop at their end, with short attack/release transitions to avoid abrupt boundary clicks. Do not loop a snippet internally in this milestone.
- Snippet playback follows global tempo relative to the source track's reviewed BPM, preserving pitch. Source transport is independent: seeking or stopping a deck does not seek already sounding snippets.
- Add manually named section markers at reviewed bar boundaries. A section is an explicit source position/name, not an automatically inferred label or a promise of verse/chorus recognition.
- Save cues/sections by source content hash and version. Content changes make them stale; reanalysis and grid editing do not silently move frame-anchored regions. Revalidate section alignment after grid corrections.

## Minimal pattern editor

- One editable one-bar 4/4 pattern with 16 equal step positions. Each enabled step references a saved snippet and has a gain/velocity. Support multiple steps referencing the same snippet.
- Provide pattern name, source track, step toggles, snippet selection, pattern gain, Arm, Restart next bar and Stop controls.
- Persist pattern definitions and stable snippet references. Missing/deleted/stale references produce an actionable validation error and prevent arming.
- Keep pattern phase independent of deck source position. Pattern events derive from the global musical transport; deck jumps do not implicitly reset the pattern.
- Manual snippet triggers launch at the earliest available engine output position and display their actual state. Pattern triggers use scheduled musical positions. Neither action depends on JavaScript timer timing.

## Arming and launch semantics

- **Next bar:** arm for the next strictly future global bar boundary. Show the intended launch beat/bar and an Armed state; arming itself produces no sound.
- **Section boundary:** explicitly bind the launch to a section marker on deck A or B. Use that deck's source-to-global mapping to find the next forward crossing; the deck must have a reviewed grid and valid forward playback.
- If the target section is already passed, reject arming with a clear message. Do not invent another occurrence in an unlooped song.
- Seeking, stopping, replacing the bound deck, editing its grid/section, or changing leader cancels a pending section launch visibly. A tempo change retains the musical target and recalculates its output time. Starting after cancellation requires a new Arm action.
- Once launched, the one-bar pattern repeats on the global clock. Deck seeks do not reset it. Restart next bar schedules its phase to reset at the next global bar.
- Stop cancels future pattern events and releases its active voices through short tails. If the global musical transport stops, stop the pattern and release voices; define that explicit transport control in the UI rather than inferring it from either deck's Play button.
- Editing a running pattern applies a validated immutable definition at the next bar boundary. Editing does not cause duplicated events, and already sounding voices retain their original region snapshot.
- Permit one pending launch/restart action. A newer action replaces the older one visibly. Cancel removes the pending action.

These rules deliberately keep section-dependent arming distinct from an already running pattern's independent phase.

## Engine work

Build a deterministic scheduler that maps global beats to output sample positions. Split render work at event boundaries where needed; avoid cumulative timing drift, duplicated events at chunk boundaries and one-block-late starts. Offline and native playback must use the same scheduler.

Use immutable definitions and bounded commands across the UI/audio boundary. Tag scheduled actions with generation/revision identities so cancelled launches and replaced sources cannot execute later. Prepare source buffers and DSP resources outside deadline-critical rendering where possible; validate any prepared-state optimisation against the intended audio behaviour. Preserve the known distinction between fresh and reset stretcher state.

Share immutable prepared source PCM between decks and snippets. Keep independent transport/DSP state per sounding voice, and retire resources off the audio callback. Declare a deterministic voice-limit policy: when four snippet voices are active, steal the oldest with a short release transition, or reject the trigger if safe stealing cannot yet meet the budget. Pick one behaviour, expose it in telemetry and document it; do not allow unbounded allocation.

Keep the output callback thin. Capture bounded counters for trigger lateness, rejected/stolen voices, scheduler errors and starvation. Musical timing uses output-frame scheduling; UI playhead interpolation is for display only.

## Implementation order

1. Cue-region/section models, persistence, waveform controls and validation. Reuse prepared full-track sources.
2. Manual overlapping snippet playback, finite ends, gain, boundary transitions and explicit voice limits. Verify native performance before introducing repeated triggers.
3. One-bar pattern model and deterministic offline scheduler, including exact event boundaries, cancellation and phase reset.
4. Native pattern playback with next-bar arming, then section-bound arming and the defined deck-change cancellation rules.
5. Minimal editor/state feedback, real-song performance session and documentation. Address reset bursts against this workload before adding more voices or musical features.

## Acceptance

- Cues, sections and pattern survive restart, are source-version aware, and cannot silently play a missing or changed region.
- Overlapping manual triggers produce distinct voices while both decks continue. Finite boundaries and Stop release correctly; active voices use stable definitions during edits.
- Deterministic render tests cover next-bar launches, sample positions not aligned with producer chunks, repeated loops without drift, live tempo changes, restart, cancellation and pattern edits. Compare intended event positions with observed audio attacks using a known synthetic source and compensated DSP delay.
- Adopt milestone 2's controlled timing tolerance where applicable; distinguish musical scheduling precision from transient movement introduced by stretching and from physical output latency.
- A section launch fires on the selected deck crossing. Seek/stop/replacement/edit cancels a pending launch, and an already running pattern preserves its global phase through deck seeks.
- Voice-limit behaviour is deterministic and visible; no stale scheduled action executes after cancellation or replacement.
- Run at least ten minutes natively with two supplied songs, a repeating pattern, overlapping snippets, tempo changes and repeated starts/stops. Record actual workload, engine settings, observed starvation/errors and listening feedback. Require no observed starvation/device errors in that session before accepting the workload.
- Verify cue attacks and releases musically, rather than relying only on sample comparisons. Retain existing library, analysis, sync and transport checks.

## Deliverables and next-chat prompt

Deliver the working snippet/pattern increment, focused regression tests, a reproducible session script and verification report. Record the adopted voice policy and supported tested workload. Leave broader sequencing and integrations for later plans.

> Read `AGENTS.md`, `performance-engine-concept.md`, the app documentation, `implementation-plan-02-timing-and-sync.md` and `implementation-plan-03-snippets-and-patterns.md`. Confirm milestone 2's required timing foundation exists, then implement only milestone 3. Reuse the native clock/audio architecture, keep cue metadata separate from analysis, implement the stated launch/cancellation rules and verify overlapping voices and deterministic pattern timing. Build/test in Docker, measure audio natively, and report remaining acceptance gaps.
