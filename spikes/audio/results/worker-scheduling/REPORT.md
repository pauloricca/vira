# Audio worker scheduling follow-up

**Spike 1: COMPLETE, 12 October 2026.** Paulo chose to retain this implementation and close the architecture experiment. See the [architecture decision and deferred work](../../../../performance-engine-concept.md). The measurements below do not establish production reliability.

12 October 2026. This follow-up tests whether the first spike's interruptions were
caused or aggravated by the minimal worker scheduling. It retains R3, the same
synthetic sources and a **1,024-frame queue (21.33 ms capacity)**. It does not
increase the reserve to the earlier 85 ms configuration.

## Changes tested

- `poll`: ordinary worker using the original sleep-and-check scheme.
- `signal`: ordinary worker woken by the audio callback using a Mach semaphore.
  The callback never waits. Arming and rechecking available queue space prevents
  a notification being lost between the space check and the wait.
- `realtime`: the same wake-up mechanism, plus a verified Mach time-constraint
  policy and Apple's custom asynchronous Audio Workgroup API. It is now the
  macOS default; the other modes remain available for comparison.

CPU sampling and JSON bookkeeping run on the ordinary supervisor thread in all
three modes, making the new comparison consistent. Callback silence gaps and slow
producer blocks have bounded, preallocated tracing. The report records policy
verification at entry/exit, workgroup errors and notification errors. Setup failure
is an error, not a silent downgrade to an ordinary thread.

All compilation and automated tests ran in Docker. The built app ran on the M1 Pro
MacBook Pro speakers at 48 kHz. No Docker builds ran alongside these native timing
experiments. Unrelated background system activity was not artificially eliminated.

## Matched results

Three repetitions per scenario/mode, ten seconds each, in a seeded shuffled order:
**27 native runs**. Requested device buffer: 256 frames; observed callback: 128
frames. There were no measured callback execution overruns or reported device
errors in the matched runs. The real-time policy was confirmed at activation and
exit, and all real-time workgroup operations reported success.

| Scenario | Poll: missing audio, ms | Signal only: missing audio, ms | Real-time + workgroup: missing audio, ms |
| --- | --- | --- | --- |
| Two decks, steady | 26.67 / 8.00 / 152.00 | 16.00 / 0 / 0 | 0 / 0 / 0 |
| Two decks + four snippets, steady | 21.33 / 8.00 / 0 | 34.67 / 18.67 / 0 | 0 / 0 / 0 |
| Two decks + four snippets, aggressive script | 42.67 / 37.33 / 10.67 | 189.33 / 69.33 / 50.67 | 0 / 0 / 0 |

Each cell lists the three individual runs. Durations are total silence inserted,
not necessarily a single gap. Exact gap ranges and full metrics are in the
per-run JSON files and `summary.json`. Gap traces were checked against the total
starved-frame counts; no trace entries were lost.

**Result:** starvation occurred in 8/9 polling runs and 6/9 signal-only runs,
versus 0/9 real-time runs. Wake-ups alone were not a consistent remedy. Real-time
scheduling plus the workgroup produced a clear improvement in this experiment,
without increasing queue capacity. Priority and workgroup membership were tested
as one combination, so this does not isolate their individual contributions.

## Final-build confirmation

The final binary defaults to real-time mode on macOS. It was then tested without
an explicit mode argument, with the same six-stream stress script:

| Duration | Requested device / producer block | Queue capacity | Missing audio |
| --- | ---: | ---: | ---: |
| 60 seconds | 256 frames | 1,024 frames | 128 frames = 2.67 ms, one gap |
| 10 seconds | 128 frames | 1,024 frames | None observed |
| 10 seconds | 512 frames | 1,024 frames | 4,096 frames = 85.33 ms, 16 gaps |

All three completed with zero measured callback overruns, zero device errors,
zero workgroup errors and real-time policy present at exit. **The longer check did
not pass the no-starvation criterion.** The scheduling change is a substantial
improvement, not a complete fix.

The 60-second gap occurred around output time 3.141 seconds, at a producer block
containing four simultaneous snippet restarts. That block took about 13.79 ms with
640 queued frames (13.33 ms of reserve). Nearby reset-containing blocks took
roughly 13–17 ms. The 512-frame case's 16 gaps also align with blocks containing
simultaneous starts/seeks after accounting for earlier inserted silence.

This is now evidence for a remaining burst-work problem around resets. With a
fixed queue capacity, a larger producer block can leave less prepared audio when
processing begins: the 512-frame case repeatedly began expensive blocks with only
512 queued frames (10.67 ms). It also withholds a whole block until its rendering
finishes. Device buffer and producer block are coupled in this harness, so that
comparison does not isolate device buffer size alone. A larger requested device
buffer should not be interpreted as automatically safer in this implementation.

Deferred engineering work: separate producer chunk size from device buffer size, investigate publishing
completed audio before an expensive event, and develop a faithful way to prepare
scheduled restarts. None of those changes should be assumed to remove the need for
measuring latency and a sustained no-starvation run.

## Restart preparation experiment

A separate prototype preconstructed and primed replacement stretchers for known
starts/seeks before playback. Its regression test matched output before a ratio
change, but differed after a subsequent seek in both R2 and R3 (maximum sample
absolute difference approximately 0.179 and 0.157 on the test signal). Fresh state
was therefore not established as equivalent to resetting a previously used
stretcher. This is not a musical-quality judgement, but it prevents claiming the
prototype is a transparent scheduling optimisation.

That prototype was removed from the runnable harness. The successful comparisons
use the existing reset/retrigger path. Faithful preparation of future triggers
remains separate work; it was not needed to obtain these short clean runs.

Inspection also found that R2 reset clears its maximum process-size setting. The
wrapper now reapplies the 512-frame bound after reset. Confirmation uses the final
build; the matched comparison used the prior build. Both binary hashes are saved.

## Limits and decision

Keep the real-time worker as the default Mac experiment path, but do not declare
the low-latency reliability problem solved. Retain the small
queue while testing further; these results remove the immediate need to adopt an
85 ms queue just to make these short scripts work. This is **not** a measured
21 ms button-to-sound latency or a supported-polyphony guarantee.

The requested/observed callback-size discrepancy remains. Native DSP allocation
behaviour has not been comprehensively audited; scheduling cannot prevent an
expensive processing burst, allocation or operating-system stall from causing a
future miss. The policy is verified at the endpoints, not continuously.

Representative music, listening approval, agreed workload/latency targets and the
30-minute acceptance soak remain deferred product validation. Spike completion records the decision to retain the architecture and stop experimentation here; it does not convert short clean runs into a sustained-reliability pass.
