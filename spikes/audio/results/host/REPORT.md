# Spike 2 — quick native host POC

12 October 2026. **COMPLETE — closed by Paulo.** The POC is accepted as sufficient
to retain the architecture; leave the implementation as it stands. Physical
lifecycle and sustained reliability validation are deferred, not passed.

## Decision

Keep Tauri + the in-process Rust audio engine as the working architecture for now.
The busy host completed the short steady and aggressive cases without starvation,
callback execution overruns or device errors. This gives no immediate reason to
switch shells, replace CPAL or move the engine into another process. It does not
establish sustained reliability or close the full device/sleep lifecycle question.

## What was reused

The existing spike 1 crate, Rubber Band wrapper, manifests, bounded queue,
callback-signalled real-time producer and Audio Workgroup are shared unchanged in
structure. An optional Tauri feature adds a small embedded HTML/Canvas window,
status commands and two decode/waveform background workers. Playback adds
cancellation, supervisor-side recovery detection and callback-interval telemetry.
The headless comparison runs the exact same newly built binary without a window.
The prior spike 1 executable and measurements are preserved.

Tauri 2.8.5 and tauri-build 2.4.1 are exact dependencies. Cargo.lock also holds the
matching runtime 2.8.0, runtime-wry 2.8.1, macros/codegen 2.4.0 and utils 2.7.0:
resolving these independently to newer minor releases produced incompatible APIs.
Use locked builds. All builds, formatting, tests, media and report processing ran
in Docker. Native playback ran on the Mac after builds finished.

## Native measurements

Existing M1 Pro MacBook Pro; MacBook Pro Speakers; stereo 48 kHz; R3; six voices;
requested 256-frame buffer/producer block; 1,024-frame queue. Actual callbacks
were 128 frames, preserving the spike 1 requested/observed discrepancy.
Each normal run lasted ten seconds. Steady runs alternate host-mode order across
three repetitions; restart-heavy cases have one run per mode.

| Case | Runs | Completed | Starved frames | Callback overruns / device errors |
|---|---:|---:|---:|---:|
| Headless steady | 3 | 3 | 0 | 0 / 0 |
| Idle Tauri steady | 3 | 3 | 0 | 0 / 0 |
| Busy Tauri steady | 3 | 3 | 0 | 0 / 0 |
| Headless restart-heavy | 1 | 1 | 0 | 0 / 0 |
| Idle Tauri restart-heavy | 1 | 1 | 128 (2.67 ms) | 0 / 0 |
| Busy Tauri restart-heavy | 1 | 1 | 0 | 0 / 0 |
| Busy controlled reopen | 2 attempts | second completed | 0 | 0 / 0 |

**The idle restart-heavy run fails the zero-starvation criterion.** Its gap starts
at output frame 150,784 (3.1413 s). The render block at 149,760 includes four
simultaneous start events at 150,001, takes 17.25 ms and begins with only 768
queued frames (16 ms). This is consistent with spike 1's expensive restart bursts
exhausting the reserve. Correlation is not proof that Tauri contributes nothing;
a single short matched stress comparison cannot establish causality.

Maximum callback intervals across the comparison were 2.719–2.837 ms; callbacks
nominally cover 2.667 ms. These measure callback arrival intervals, not measured
speaker silence or end-to-end latency. No hardware xrun counter was available.

Busy steady runs recorded 394–448 complete decode/waveform passes per background
worker. Animation totals varied from 100 to 632 frames across the busy steady
runs; WebKit/visibility throttling means this was not constant 60 Hz load in every
repeat. The first busy steady run and the busy restart-heavy run recorded 632 and
622 frames respectively, with active background workers and zero starvation.
An additional idle smoke run also completed cleanly and is stored separately.

The controlled reopen request was scheduled 2.5 s after UI readiness. The first
attempt ended at 2.023 s relative to the measurement loop, the second began at
2.528 s, and it completed at 12.595 s. That confirms stream/worker teardown and
successful reopen in the same Tauri process. The roughly 505 ms gap between
attempts includes the deliberate 500 ms retry wait; **it is not measured audible
recovery latency**. Audio restarts from frame zero.

## Validation and limits

- Four existing Docker audio regression tests passed; formatting and helper-script
  syntax checks passed. Native cross-build succeeded using the existing Apple SDK.
- Physical device switching/unplugging, changing nominal sample rate, and actual
  sleep/wake were **not performed**. The POC contains bounded recovery handling
  and a manual procedure; it must not be described as proven hardware recovery.
- No representative musical listening, loopback latency, 30-minute soak or
  supported-polyphony claim. Process CPU/RSS excludes WebKit child processes.
- Default-device detection uses name + nominal rate, not a persistent device ID.
  Recovery restarts the test; there is no seamless resume or sample-rate conversion.

Evidence: [per-case summary](summary.json), [binary SHA-256](binary.sha256),
[device inventory](devices.json), [validation log](validation.txt), and the
individual JSON reports in this directory. Build/run and manual recovery steps:
[HOST-SPIKE.md](../../HOST-SPIKE.md).
