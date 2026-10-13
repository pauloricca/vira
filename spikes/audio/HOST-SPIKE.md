# Spike 2: minimal macOS host

**Status: COMPLETE (12 October 2026), closed by Paulo.** Retain Tauri,
CPAL/Core Audio and the in-process Rust engine; leave this implementation as it
stands. See the [results](results/host/REPORT.md) and
[architecture decisions](../../performance-engine-concept.md). Physical device,
sample-rate and sleep/wake checks remain deferred validation. The procedures
below are retained for future explicitly requested work.

A quick Tauri 2 proof of concept inside spike 1's crate. `--features host` adds a
window; normal headless builds do not compile Tauri. No React, Node toolchain,
second DSP implementation or IPC audio process is needed. The embedded HTML
exists solely to exercise WebKit rendering and Tauri command traffic.

## Scope and criteria

Target: existing Apple Silicon Mac, default stereo 48 kHz output, R3, six synthetic
voices, 256-frame producer/requested device buffer, 1,024-frame queue. These are
comparison inputs, not a product workload commitment.

Compare the same executable in headless, idle Tauri and busy Tauri modes. Require
completed runs, zero starved frames, zero callback execution overruns and zero
reported device errors. Verify UI animation and background work actually ran.
Repeat the steady case three times; run the existing restart-heavy script once
per mode to separate known DSP restart bursts from possible host effects. The
controlled reopen probe must stop the first stream and complete a fresh second
attempt. It is not evidence of physical device or sleep/wake recovery.

Busy mode draws 48 waveform lanes (1,600 points each) every animation frame and
polls Rust status four times per second. Two ordinary Rust threads repeatedly
load the source WAVs and derive waveform peaks, sleeping 5 ms between passes.
Pass counts and UI frame counts confirm load. Process CPU/RSS exclude WebKit's
separate rendering process. Rendering load is synthetic, not an implementation
of library analysis or a saturation benchmark.

## Build and run

From `spikes/audio`, using the existing SDK copy and Docker images:

```sh
docker compose run --rm dev cargo fmt --check
docker compose run --rm dev cargo test --release --locked
docker compose --profile mac run --rm mac-builder sh scripts/build-host.sh
docker compose run --rm dev python3 scripts/prepare-host-checks.py
```

Once all builds finish, run only the native executable on the Mac:

```sh
sh scripts/run-host-checks.sh
```

Then summarize in Docker:

```sh
docker compose run --rm dev python3 scripts/summarize-host-checks.py
```

For a visible interactive ten-second run:

```sh
output/native/vira-host-spike host results/host/manifests/six-steady.json output/host-manual.json busy
```

`idle` disables background workers and reduces drawing to two lanes. The window
stays open after completing; launch again for another run. The reopen button is
for use during playback. `VIRA_HOST_AUTO_EXIT=1` closes the automated comparison
window after saving. `VIRA_HOST_RESTART_AFTER_MS=2500` injects a controlled reopen.
The original native spike executable remains separately available; comparisons
use `vira-host-spike play ...` so build/dependency differences are held constant.

## Device recovery behaviour and manual checks

Only supervisor-thread code probes the default output (name + nominal rate), at
200 ms intervals. On a changed fingerprint, CPAL error, one second without
callback progress, or a supervisor wall-clock pause over two seconds, stop the
stream, cancel and join its worker, then reopen the
current default device. Retry at most three times, 500 ms apart. Playback starts
at frame zero. Unsupported stereo float32 48 kHz output fails explicitly. This
POC does not preserve transport phase, resample or guarantee seamless recovery.
Devices with identical names may escape fingerprint detection. Callbacks that
resume before the watchdog runs may not trigger recovery after a short suspend.

For longer manual checks, generate a longer manifest in Docker. While playing,
switch the default audio device or unplug it, change its nominal rate in Audio
MIDI Setup, and sleep/wake the Mac in separate runs. Preserve JSON reports and
record the action/time and audible result. Confirm the actual hardware action
occurred, whether an attempt stopped, and whether a subsequent attempt completed.
Do not treat the controlled reopen probe as a substitute for these checks.

Reports preserve each attempt, its stop reason and start/end offsets, callback
starvation ranges, maximum callback interval, worker scheduling verification,
background pass counts and UI animation statistics. The callback interval is a
host-clock diagnostic, not measured audible silence, hardware xruns or end-to-end
latency. An interruption outside callbacks can be invisible to starved-frame
counts. Physical recovery and sustained reliability remain pending unless native
evidence is recorded in `results/host/REPORT.md`.
