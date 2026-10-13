# Audio spike 1

**Status: spikes 1 and 2 COMPLETE (12 October 2026).** The audio harness and optional Tauri host are retained as the baseline for the next planned clock-alignment spike, when requested. See the [architecture decisions and deferred validation](../../performance-engine-concept.md), [scheduling results](results/worker-scheduling/REPORT.md) and [host results](results/host/REPORT.md). Musical quality, supported workload, physical device/sleep recovery and sustained reliability remain unvalidated.

A Rust harness for Rubber Band R2/R3, real-time-mode WAV auditions,
sample-positioned voice scripts, offline throughput diagnostics, and native
stereo playback with callback telemetry. Spike 2 adds an optional minimal Tauri
host in this same crate; see [host POC instructions](HOST-SPIKE.md).

**All compilation and test tooling runs in Docker.** Only the resulting macOS
executable runs on the host. No Homebrew/Rust installation is required. Linux
container throughput uses a different FFT and scheduler from native macOS and
must not be used to claim supported Mac polyphony or audio latency.

## Build and check

From `spikes/audio`:

```sh
docker compose build dev
docker compose run --rm dev cargo test --release --locked
docker compose run --rm dev cargo build --release --locked
```

Rust 1.90.0 and the multi-platform base-image digest are pinned. Cargo.lock pins
Rust dependencies. Rubber Band 4.0.0 is verified against a SHA-256 digest and
compiled at `-O3` using its upstream single-file build: no native threads,
BQResampler, built-in FFT on Linux, Accelerate/vDSP on macOS. System packages come
from Debian's package repositories; the complete container OS is not bit-for-bit
reproducible. Record the image ID with measurements. The C ABI wrapper owns each
native state and checks the reported engine version.

Development cache and binaries live in named Docker volumes. Audio, generated
manifests and reports live in ignored `media/` and `output/`. Selected JSON
measurements without source music can be retained in `results/`.

## Synthetic checks and diagnostic sweep

```sh
docker compose run --rm dev target/release/vira-audio-spike synth media
docker compose run --rm dev target/release/vira-audio-spike audition manifests/synthetic-audition.json output/auditions
docker compose run --rm dev python3 scripts/experiments.py --seconds 10 --run
docker compose run --rm dev target/release/vira-audio-spike probe output/boundary-probe.json
```

The generator writes 24 explicit manifests: R2/R3 × two decks plus 0/4/8/16
snippet voices × 128/256/512 frames. Sources loop; positions, speed and pitch vary
by voice. Scripts include simultaneous starts, non-block-aligned stops, seeks,
rapid retriggers, and tempo/pitch changes. All positions and durations are 48 kHz
frames, not interleaved samples. Event times refer to the rendered output timeline;
prebuffering delays wall-clock presentation. Native DSP can have an internal
response delay to live ratio changes, and its input cursor may be ahead of output.
A seek/retrigger clears old DSP state and reapplies padding/delay compensation.
There is deliberately no fade or crossfade: discontinuity clicks are possible and
should be recorded during listening, separately from starvation.

`--sources media/deck-a.wav media/deck-b.wav` selects explicitly supplied files.
Use excerpts longer than one second for the generated source positions. The
harness rejects out-of-range positions instead of silently substituting audio.
It preloads stereo 48 kHz WAV (integer PCM or float) and does no callback decoding.
Convert other formats in a container before running; there is no resampler or
compressed-file decoder in this minimal spike. Do not put private source files in
Git or the Docker image. The script hashes source files into an inventory.

## Native macOS build, still inside Docker

The cross-compiler uses Zig 0.14.1 and the installed Xcode macOS SDK. Docker cannot
normally share `/Applications`, so make an ignored local SDK copy once. This is
file copying only; it does not run a host compiler or install a host toolchain:

```sh
mkdir -p .deps
cp -R /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk .deps/MacOSX.sdk
docker compose --profile mac build mac-builder
docker compose --profile mac run --rm mac-builder
```

Do not redistribute the SDK or bake it into a published image. Alternatively set
`MACOS_SDK_PATH` to an existing directory Docker can read. Output is
`output/native/vira-audio-spike`, targeting Apple Silicon / macOS 13+.

Run the resulting executable on the Mac, from this same directory:

```sh
output/native/vira-audio-spike devices
output/native/vira-audio-spike play output/manifests/r3-snippets4-buffer256.json output/native-play.json
```

Playback uses the default stereo float32 48 kHz output. Unsupported format or
buffer settings fail explicitly. It requests the manifest's buffer size and
records observed callback frame sizes. Run a short test before a long one;
output volume is controlled by macOS and manifest gains.

For the eventual 30-minute soak, first obtain listening approval of the engine
and settings and agree the minimum workload/latency. Generate long manifests in
Docker, then run the selected native executable (no container audio forwarding):

```sh
docker compose run --rm dev python3 scripts/experiments.py --seconds 1800 --sources media/deck-a.wav media/deck-b.wav
output/native/vira-audio-spike play output/manifests/r3-snippets4-buffer256.json output/soak.json
```

This example is provisional, not an agreed 4-snippet requirement. Deferred product validation needs
a completed run, zero observed callback deadline misses, zero starved frames,
zero device errors, and recorded listening observations. A missing device or an
unrun soak is pending, not a pass.

## Listening comparisons

Copy `manifests/synthetic-audition.json` to an ignored manifest, replacing excerpts
with authorised drums, vocals, dense mixes, sustained textures and attack-start
snippets. Each excerpt identifies its source, start and length. `speeds` are
playback speed: 1.25 is faster; native duration ratio is **1 / speed**. Pitch ratio
is **2^(semitones / 12)**. The matrix includes independent speed changes, pitch
changes at speed 1, and combinations. Use 0.5/2.0 only as exploratory extremes.

The audition command writes pairs with anonymous A/B names and seeded random
engine assignment, a separate `settings-key.json`, and `listening.csv`. Keep the
key away from the listener until judgements are captured. Levels are matched by
stereo RMS to a common target (normally -20 dBFS RMS), reduced for shared peak
headroom; this is not perceptual LUFS normalisation. Judge transient sharpness,
groove, vocal character and stereo stability. Synthetic sound does not establish
musical quality. Use the native executable for final vDSP-backed renders if
container comparisons reveal an issue that could be FFT-dependent.

Both engines use real-time mode, linked stereo, pitch-high-consistency and their
standard windows/default transient options. Startup silence and reported start
delay are handled explicitly. Finite renders feed extra silence before finalising
to drain the resampler, discard start delay, and trim to the requested scaled
source duration. Padding, tail input and trimmed output are in the key. There is
no offline-mode comparison disguised as a real-time render.

## Measurement interpretation

- `bench MANIFEST REPORT [WAV]`: unpaced, single-producer diagnostic. A block over
  its nominal device deadline is **not a callback miss**. Optional WAV writing
  adds I/O to wall time, outside measured producer block time.
- `play MANIFEST REPORT`: native DSP on one producer; bounded SPSC frame queue;
  callback only copies frames or inserts silence and increments preallocated
  atomic statistics. No locks, decoding, native DSP, allocations or logging in the
  application callback. CPAL/driver internals are not allocation-audited here.
- Native `process()` timing and total producer-block timing separate major DSP
  work from scheduling/mixing/reset overhead. `probe` measures a trivial C getter
  plus FFI, not isolated `process()` call overhead. Do not attribute all remaining
  producer time to Rust; reset/retrieve and instrumentation also contribute.
- Histograms use 10 µs buckets up to 100 ms plus an overflow bucket. Exact maxima
  are retained. Callback timing excludes the statistics update itself. Device
  stream errors are counted, but there is no hardware xrun counter, callback
  start-jitter measure or loopback end-to-end latency measurement.
- Device buffer duration, queue capacity, native start delay and end-to-end
  latency are distinct. The queue is initially prefilled; capacity is reported,
  not asserted as measured latency. The JSON reports end-to-end latency as null.
- CPU is process CPU time; playback reports peak utilisation sampled over roughly
  one-second windows (100% means one core). Shorter runs may have no full window.
  RSS is process peak resident memory; preloaded PCM bytes are reported separately.
- Starvation inserts silence and advances the device timeline; queued audio may
  then play late. This makes the run fail acceptance; no recovery promise is made.

## Licences and scope

Rubber Band is GPL-2.0-or-later, or available under a commercial licence. Its
single-file source includes third-party components with their notices. Preserve
upstream COPYING and source notices when distributing under GPL; decide licensing
before distributing a proprietary product. CPAL, rtrb, serde, serde_json, cc and
anyhow are MIT/Apache-2.0; hound is Apache-2.0; libc is MIT/Apache-2.0. Zig is an
MIT-licensed build tool. Apple frameworks/SDK follow Apple's terms. This spike
does not make a product distribution/licensing decision.

References: [Rubber Band integration notes](https://breakfastquay.com/rubberband/integration.html),
[C API](https://breakfastquay.com/rubberband/code-doc/rubberband-c_8h.html),
[upstream compilation notes](https://github.com/breakfastquay/rubberband/blob/v4.0.0/COMPILING.md).

The cross-build uses a small compiler-driver adapter to translate Rust/cc-rs target
flags to Zig, place SDK C headers after libc++ headers, and allow Apple's enum
forward-declaration extension. Apple SDK deprecation warnings are expected. The
export script replaces the executable inode to avoid macOS reusing a stale
code-signature cache when rebuilding the same path.

## Worker scheduling experiment

`play MANIFEST REPORT [poll|signal|realtime]` selects a worker mode:

- `poll`: ordinary worker, original 100 µs sleep-and-check loop.
- `signal`: ordinary worker, notified by a nonblocking Mach semaphore signal from
  the callback. An arm/recheck protocol avoids lost wake-ups; the worker has a
  100 ms watchdog wait for shutdown/error recovery, not a periodic work timer.
- `realtime`: the same notification scheme plus a Mach time-constraint policy and
  a custom asynchronous Audio Workgroup. This worker renders ahead through a
  queue, so it does not join the device's synchronous workgroup. Policy setup and
  workgroup join must succeed; there is no silent fallback. Reports verify policy
  at activation and exit and count interval errors. The requested per-block CPU
  budget is 75% of the producer block period, preemptible, with a one-period
  constraint. These are experimental scheduling parameters, not a CPU reservation
  or a guarantee that the OS never preempts/demotes the worker.

All modes now sample CPU on the ordinary supervisor thread. The audio worker keeps
only preallocated timing records during rendering. Rubber Band's internal
allocation behaviour has not been comprehensively audited, so real-time scheduling
alone is not a claim of a fully real-time-safe processing path.

Reports include contiguous silence-gap ranges in output frames and a bounded
trace of slow producer blocks. Trace overflows are counted. A gap can shift queued
source audio later, so use both output-frame gaps and render-frame traces when
correlating with scripted events. Startup prebuffer blocks appear in producer
traces but precede device playback. Callback timing includes the wake-up signal,
but excludes the statistics update itself.

Generate the matched comparison plan inside Docker, finish all builds, then run
only the built application on the Mac:

```sh
docker compose run --rm dev python3 scripts/prepare-worker-checks.py
scripts/run-worker-checks.sh
docker compose run --rm dev python3 scripts/summarize-worker-checks.py
```

The plan repeats each combination three times in seeded shuffled order: two decks
steady, two decks plus four snippets steady, and the same six streams under the
original aggressive script; each uses poll/signal/realtime. All use the same
1,024-frame queue (21.33 ms capacity), requested 256-frame device buffer and
10-second duration. Longer confirmation runs are reported separately. Do not run builds alongside timing experiments.

Apple references: [asynchronous audio workgroups](https://developer.apple.com/documentation/audiotoolbox/adding-asynchronous-real-time-threads-to-audio-workgroups)
and [Mach thread scheduling](https://developer.apple.com/library/archive/documentation/Darwin/Conceptual/KernelProgramming/scheduler/scheduler.html).

The native macOS default is now `realtime`; `poll` remains the Linux/default comparison mode.
A preconstructed-restart prototype was excluded after it changed the output after
tempo/pitch changes in both R2 and R3. Scheduling tests retain the existing restart
path; a faithful preparation scheme remains future work.

## Spike 4: song analysis

The quick offline analyzer reuses this Docker environment and lives in
[analysis/](analysis/README.md). It exports beat/key estimates and a local
start/middle/end audition page with editable BPM, phase and key. See the
[measured results](results/analysis/REPORT.md). Spike 4 is COMPLETE at Paulo's
request; [closure notes](analysis/CLOSURE.md) record the grid-fit limitation and
deferred musical validation.
