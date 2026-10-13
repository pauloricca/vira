# Spike 1 — initial implementation and evidence

**Follow-up:** the [worker scheduling experiment](worker-scheduling/REPORT.md)
subsequently produced nine clean matched real-time runs with the original small
queue. The initial measurements below remain historical evidence; they do not
describe the new default worker. **Spike 1 was marked complete by Paulo on 12 October 2026**, retaining the improved architecture. Musical quality and production reliability validation are deferred; see the [completed decision and roadmap](../../../performance-engine-concept.md).

Recorded 12 October 2026. **Historical initial measurements; musical quality and supported workload remain unvalidated.** Development, dependency installation,
compilation, synthetic tests and result processing run in Docker. The Apple Silicon
executable was cross-built in Docker and successfully ran through Core Audio on the
host. The abandoned project-local host Rust installation was removed.

## Measured facts

Target observed: MacBookPro18,3, M1 Pro (6 performance + 2 efficiency cores), 32 GiB,
macOS 26.1. Default output: MacBook Pro Speakers. The user has not yet confirmed this
as the acceptance target. See `environment.json`, `native-devices.json` and
`container-images.txt`. No personal music directories were searched.

Rubber Band 4.0.0, optimised Rust 1.90.0, real-time mode, standard windows, linked
stereo, pitch-high-consistency, no native threading, BQResampler. Native macOS uses
vDSP; Linux Docker uses the built-in FFT. Native compilation used Zig 0.14.1 and a
read-only copy of the installed Xcode macOS 26.2 SDK. The executable needs no Rust,
Homebrew or Rubber Band installation on the host.

Four release integration tests passed:

1. R2/R3 output duration, finite samples, stereo equality and independently shifted
   tone frequency at speeds 0.5, 0.8, 1, 1.25 and 2 with pitches -3, 0 and +3.
2. Unity-speed impulse placement within 16 samples after delay compensation.
3. Script action parsing, including rejection of a misspelled action argument.
4. Exact non-block-aligned starts/stops and deterministic retrigger output.

`cargo clippy --release --locked -- -D warnings` passed. These checks ran in Docker.
They caught and corrected drain sizing and finite-tail handling before measurement.
No waveform or automated check was treated as listening approval.

Generated **45 anonymous pairs / 90 WAVs** from deterministic synthetic tones,
impulses and textures: 3 excerpts × 5 speeds × 3 pitches × R2/R3. They are in
`../output/auditions/`, with an independent settings key and listening sheet. Input
manifests, source hashes and the settings key are retained under `container/`.
Audio itself is ignored by version control.

All 24 provisional unpaced container load cases completed (10 seconds of rendered
audio each). These are **diagnostics**, not device acceptance. Some overlapped
container build activity, so the CPU environment was not controlled.

| Engine | Snippets beside 2 decks | Wall/audio ratio across buffer cases | Peak RSS, MiB |
| --- | ---: | ---: | ---: |
| R2 | 0 | 0.074–0.076 | 17.3 |
| R2 | 4 | 0.299–0.304 | 25.4 |
| R2 | 8 | 0.574–0.576 | 35.1 |
| R2 | 16 | 1.255–1.503 | 55.2 |
| R3 | 0 | 0.233–0.241 | 17.8 |
| R3 | 4 | 0.824–0.830 | 33.3 |
| R3 | 8 | 1.426–1.537 | 48.9 |
| R3 | 16 | 2.712–2.861 | 80.5 |

A wall/audio ratio above 1 means slower than playback speed in that container
experiment. It does not establish the Mac's supported polyphony. Source PCM preload
for these two 8-second stereo files is 6,144,000 bytes, shared among voices.

The container getter probe took 2,674,708 ns for 1,000,000 calls (~2.67 ns/call).
It includes the native getter and C ABI, not `process()` integration overhead.
Reports separately time native processing and total producer blocks; their
difference includes mixing, reset/retrieval, timing instrumentation and scheduling.
These measurements do not support attributing limitations to Rust.

## Native playback checks

Six 10-second runs completed at 48 kHz, two decks plus four snippets. All had zero
**measured callback execution overruns** and zero CPAL device error reports.
Most had starvation, so they do **not** pass the proposed no-starvation criterion.
The application callback maximum across these runs was 6.083 µs, but that does not
include driver work, callback arrival jitter or the statistics update itself.

| Engine/scenario | Requested buffer | Observed callback frames | Queue capacity | Starved frames |
| --- | ---: | ---: | ---: | ---: |
| R2 stress | 256 | 128 | 1,024 | 4,480 |
| R3 stress | 128 | 64 | 512 | 10,368 |
| R3 stress | 256 | 128 | 1,024 | 9,984 |
| R3 stress | 512 | 256 | 2,048 | 2,560 |
| R3 stress, larger queue | 256 | 128 | 4,096 | 0 |
| R3 steady, initial starts only | 256 | 128 | 1,024 | 1,792 |

Observe the buffer discrepancy rather than assuming the requested size was applied.
The reports record callback sizes; this is not a direct query of the hardware's
internal buffer. R3 peak process CPU over roughly one-second windows ranged from
50.8% to 58.5% of one core, with peak RSS about 53–55 MiB; R2 reached 22.1% and
45.5 MiB. Exact values and block-time maxima are in `native-summary.json` and the
per-run JSON files. Producer wall-time spikes include possible OS preemption.

The 4,096-frame queue represents **85.33 ms of capacity**; the original 1,024-frame
queue represents 21.33 ms. Neither is a measured end-to-end latency. Stretcher
start delays are also reported independently (R3 typically 2,048 frames at unity
pitch, varying with pitch). Input padding and output trimming compensate source
alignment; they do not remove the physical buffering needed for live output.

**Inference:** the single successful larger-queue run shows that buffering can
absorb bursts on this workload. Steady playback also starving means retrigger cost
alone is insufficient to explain the result. These short, unisolated runs cannot
distinguish all DSP bursts from producer wake-up/preemption effects. The larger
queue is an experimental latency tradeoff, not a recommended product setting.
No architectural change is justified from this evidence alone.

## Listening feedback and unresolved questions

No authorised representative musical files or listening feedback were supplied.
Transient sharpness, groove, vocal character and stereo stability are **unvalidated**.
Synthetic examples cannot settle the quality choice. No audible-glitch observations
were collected; telemetry cannot substitute for listening.

The minimum acceptable snippet count, latency and normal tempo/pitch range are
unconfirmed. The 30-minute acceptance soak has **not** been run. No supported
workload or glitch-free claim is established. No loopback end-to-end measurement,
hardware xrun counter, callback arrival-jitter analysis, or device recovery test
was performed (device recovery belongs to spike 2).

## Initial recommendation (superseded by the follow-up decision)

Retain Rust + native Rubber Band for further evaluation. Keep R3 as the quality
candidate and R2 as the lower-cost comparison, using the recorded options; do not
select a winner before musical auditions. Keep the producer/queue approach as a
spike implementation only. Low-latency scheduling and retrigger preparation need
further controlled measurement before committing to an engine architecture.

Deferred product validation: obtain authorised representative excerpts and Paulo's acceptance targets,
run and score the anonymous pairs, then run the accepted configuration through the
native load sweep. Repeat the queue-size comparison under controlled load and
investigate the observed/requested buffer discrepancy. Only then choose the
minimum workload/buffer and perform the documented 30-minute native soak. The
README includes exact container build, manifest-generation and native run commands.
