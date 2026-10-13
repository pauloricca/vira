# Milestone 2 verification — 12 October 2026

Implementation is present. Acceptance is conditional on the native and listening
items below; automatic analysis and a Reviewed checkbox are not accuracy evidence.
Closed spikes and their reports are unchanged. No later-milestone features added.

## Adopted rules before verification

Source grids: constant 4/4, 30–300 BPM, finite anchor within source, anchor bar 1
beat 1; negative/zero bars before it. Playback range: 0.8–1.25 source speed.
Controlled beat-click alignment gate: <=10 ms after the 5 ms transition settles.
Known synthetic source-event displacement is separately tested with a <=30 ms
fixture bound; this does not extend the click gate to arbitrary stretched attacks.

Commands apply at the next 128-frame producer boundary after already prepared
1,024-frame output-queue audio. Ratio changes discard pending DSP output and
re-prime R3 at a precise current-source anchor; pitch scale remains one. The
callback stays a bounded consumer/telemetry publisher. Short transitions crossfade
from the previous sample for 240 output frames. No larger queue hides starvation.

Sync uses nearest valid bar phase modulo four, earlier on exact ties. First leader
selection leaves the other deck independent; switching existing leadership aligns
or arms the other deck once. Leader pause holds global phase, while the follower
can continue at the current target; resume aligns again. Manual follower seek or
tempo disables sync. Stop/end preserves armed membership but pauses only that deck.
Apply retains source position, returns to source tempo, clears affected membership;
Apply on the leader clears leadership and follower sync. Replace follows the same
membership rules. No automatic leadership changes. These rules are documented in
the README and exercised separately from listening tests.

## Docker evidence

- Preparation/library/analysis/timing suite: 28 tests. Restart and reanalysis retain
  corrected grids; identical renamed content reuses them; altered bytes with
  preserved timestamps become stale. Invalid/non-finite inputs and corrupt timing
  envelopes fail locally. Existing analysis regression coverage retained.
- React suite: 15 tests. Save vs Apply, reset clearing Reviewed, negative bar
  numbering, invalid editor inputs, shared output scale, unequal tempo spacing,
  library retry behaviour, transport independence and stale load errors.
- Rust suite: 17 tests. Source/output mappings, negative beats, nearest valid phase,
  phase-preserving ratio changes, range rejection, armed starts, paused leader,
  seek/stop/end/resume, switching leadership, replacement and stale pair commands,
  invalid/unreviewed grids, explicit removal, and controlled rendered audio.
- Rendered tone: 440 Hz measured at speeds 0.8 and 1.25. A 480,000-source-frame
  fixture rendered 600,000 and 384,000 output frames respectively.
- Controlled native-engine click outputs at 100, 120 and 125 BPM: measured onset
  difference 0 output samples for these fixtures, after transitions settled.
- Known synthetic source events at 1/3/6 seconds: measured peak offsets
  −1.125/−0.688/−0.562 ms at 0.8×; +0.292/+0.417/+0.562 ms at 1.25×.
  R3 can displace real musical transients locally; these are limited fixture results.
- Apple Silicon macOS release cross-build uses the existing SDK read-only in
  Docker. No host project toolchain was installed.

Raw logs: `output/milestone2-{preparation,ui,rust}-tests.log` and
`output/milestone2-macos-build.log`. Commands are in the README.

## Native evidence

Native settings: product CPAL/Core Audio stream, stereo float32 48 kHz, requested
256-frame device buffer, 128-frame producer chunks, 1,024-frame queue, pinned
Rubber Band 4 R3, pitch scale one, verified real-time/workgroup policy. Song gain
0.08 per deck in scripted timing checks. The supplied sources are Miracle and
Simplex City. Temporary 120/110 BPM reviewed test fixtures exercise sync's gate;
they are never saved and are not assertions of those songs' actual musical timing.

The initial 30-second native run passed: zero starvation/device errors, maximum
callback transport phase difference about 0.011 ms. A first long-run attempt
stopped around 60 seconds because the script selected a follower before observing
a queued leadership change. Counters remained zero up to that point. The harness
now waits for the consumed-frame acknowledgement; this failed attempt is not
counted as a completed soak.

The corrected ten-minute native timing soak passed, with 119 action checkpoints:
zero starvation frames, device errors, callback deadline misses, workgroup errors,
wake errors or scheduling-policy failures. Maximum callback-derived phase error:
0.026042 ms. The actual callback size was 128 frames despite the requested 256.
Device: MacBook Pro Speakers. Peak RSS: 327,155,712 bytes. Maximum callback work:
22.042 µs; maximum producer chunk: 12,412.208 µs. 30,236 producer chunks exceeded
the nominal 128-frame duration, while the queue remained supplied. This exposes
DSP burst work rather than hiding it or treating every slow producer chunk as a
device underrun. Background Docker tests/builds ran during part of this session.

Raw evidence: `output/native-timing-600-final.json` and corresponding `.log`.
The final Clear deck/webview-generation additions were separately regression tested
and built after this soak started; the timing/DSP path exercised by the soak was
unchanged. The original 30-second `--native-check` also passed on the final build,
including failed/racing loads, shared-source isolation, pause/seek/stop and natural
end. Evidence: `output/native-milestone1-regression.json`.

## Final native graphical check

Opened the final compiled app through the native macOS UI. Compared its full-width
stacked A/B rows above the retained deck overviews to the supplied mock-up. Loaded
Ya Mahla on A and Point Of No Return on B, retaining their unreviewed automatic
suggestions. Verified deck colours, stronger bar markers and compact labels,
a centred white playhead spanning both rows, and empty space before the beginning
and after the end. Their close-up peaks showed useful transient detail.

At equal target BPM (118.999072), both rows had equal beat spacing while their
independent phase remained visibly different. Then set A to 95.2 BPM (~0.8×) and
B to 153.28 BPM (~1.25×): beat spacing differed visibly on the shared output scale.
Paused A and observed its position/row remain fixed while B continued. Shared
zoom changed from 8 to 16 beats and back. Native counters remained at zero through
several minutes of this foreground waveform rendering and tempo/seek actions.
This is a shorter graphical session, not a ten-minute foreground rendering soak.

The editor restored the fitted suggestion as unreviewed, inspected middle/end,
rejected 700 BPM locally with Save/Apply disabled, and supported native keyboard
Home followed by Right to reach a 10 ms source cursor. Editing the preview did
not change the deck grid or target tempo. Enabling sync on these draft grids
showed the expected reviewed-timing error. Checked independent native click volume
(0.13 while song gain was 0.02), then turned it off. This confirms the control/path,
not a musical listening judgement.

Cleared leader A while B played: leadership disappeared, A became empty, and B
continued independently at its existing target. Final app state: A empty, B stopped
at zero and source tempo, click off, default eight-beat zoom. Final GUI counters:
zero starvation and device errors. No supplied-source user timing was saved or
marked Reviewed during automated/native graphical checks.

## Pending musical acceptance

A human must manually prepare/review supplied tracks and listen to independent
song/click levels at start, middle and end; record drift and stretch quality.
No saved source has been silently marked Reviewed by the automated checks.
Physical output/loopback alignment, speaker latency, sleep/device recovery and
other hardware are unverified. Container throughput is not native acceptance.
A ten-minute headless soak is distinct from foreground waveform rendering.
