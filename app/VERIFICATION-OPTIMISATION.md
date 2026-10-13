# Waveform and tempo optimisation — 12 October 2026

The requested rendering/transport changes and expanded tempo range are implemented.
This supersedes milestone 2's provisional 0.8–1.25× range. Source grids remain
30–300 BPM; playback supports 0.5–2.0× with pitch scale one. Half/original/double
shortcuts use the precise source BPM, avoiding rounded boundary requests.

## Changes

- Replace per-frame React/SVG reconstruction with a shared display loop, canvas
  raster tiles and a max-peak pyramid. Source peaks stay aligned with the grid.
  Nearby tiles are bounded; old sources are released. Resize work occurs through
  observers, not layout reads every frame. Offscreen rows stop painting.
- Update overview playheads/time directly rather than rendering the full deck on
  every animation frame. Preserve accessible seeks, keyboard controls and editor.
- Preserve source metadata/peak identity across polls. Native telemetry sends
  source metadata only for a changed generation; unchanged-source snapshots are
  compact. Source clearing/replacement remains explicit and generation guarded.
- Use a continuous, monotonic display clock. Estimate snapshot age from request
  timing and spread ordinary corrections over time instead of resetting to every
  response. Position epochs make even small explicit seeks re-anchor immediately;
  tempo re-primes preserve the epoch. Pause holds; stale telemetry extrapolation
  freezes after 500 ms. Visual callbacks never schedule audio.
- Keep rAF as the normal driver. Eight persistently slow visible callbacks select
  one paced timer targeting 60 visual updates/s. rAF cadence remains separately
  measured, rather than misreporting the timer as improved rAF delivery. Hidden
  documents stop the loop, and the final unsubscribe cancels all timers/callbacks.
- Skip click beat/sine calculations when click volume is zero. Song/click sliders
  provide immediate feedback while pending native snapshots and later reconcile.
- Keep all beat lines at extreme zoom/tempo combinations, but thin overlapping
  labels to readable bar labels. Preserve empty space outside the source.

## Native rendering evidence

Instrumented original SVG rendering and optimised rendering on the same MacBook
Pro M1 Pro, macOS 26.1, Retina VIRA window. Loaded Ya Mahla and Point Of No Return.
The baseline used their draft automatic grids, default eight-beat zoom and unity
speed. Raw evidence is under ignored `output/`.

| Path | Measured visual update rate | p95 update gap | Worst sampled gap |
| --- | ---: | ---: | ---: |
| Original React/SVG (first five 30 s samples) | 14.27–14.47/s | 72–74 ms | 134 ms |
| Canvas with rAF only | about 14.1–14.2/s | 74 ms | 92 ms |
| Canvas with paced fallback, visible/unfocused samples | 53.7–54.3/s | 21 ms | 22 ms |
| Final pacing, focused native UI at 0.5× A / 2.0× B | 60.17–60.23/s | 17 ms | 19 ms |

Canvas-only did not fix the low callback rate; it made drawing inexpensive.
The measured rAF cadence remained around 14–18/s in the paced tests, including
focused samples. The timer therefore addresses observed slow callback delivery,
not an assumed CPU bottleneck or a change to system power/display settings.
Final focused samples had zero update gaps over 25 ms, and mean per-row drawing
cost around 0.13 ms (including new-tile preparation over the sample history).
The two foreground tracks at opposite speed limits retained zero native starvation
and device-error counters. That UI workload used zero song gains after initial
control testing; Rubber Band still processed the real source PCM. Separate quiet
native audio verification is recorded below.

These numbers measure submitted visual updates, not photons, physical panel refresh
or speaker latency. The baseline did not record focus status; later samples record
both DOM/native window focus and visibility. Do not infer an exact platform cause
from focus alone. This investigation is consistent with the broader distinction
between rendering work and callback scheduling documented by [WebKit's power
usage guidance](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)
and [its rAF-versus-timer performance issue](https://bugs.webkit.org/show_bug.cgi?id=211624).
No private WebKit APIs, unreviewed plugin, host toolchain or OS setting change was
used.

Logs: `output/render-svg-baseline.jsonl`, `output/render-canvas.jsonl`.
The earlier canvas records without a driver field are the rAF-only experiment;
`animation_driver: paced-timer` identifies the fallback. The Display counter reports
visual update cadence, and recording occurs only on ordinary threads.

## Regression and audio evidence

Docker: 23 frontend checks and 18 Rust checks pass; the existing preparation service
is unchanged. New checks cover delayed/uneven snapshots without reverse motion,
small seeks, pause, replacement, stale telemetry, tempo changes, cached peak maxima,
shared output-time spacing, absence of per-frame React commits, exact tempo presets,
slow-driver cleanup and compact source-metadata delivery.

Rendered 440 Hz references retained 440 Hz at 0.5, 0.8, 1.25 and 2.0×. A 480,000
source-frame reference produced 959,999 frames at 0.5× (within one frame of the
960,000-frame ideal), 600,000 at 0.8×, 384,000 at 1.25× and 240,000 at 2×.
Controlled native-engine click renders aligned to zero measured onset samples at
60/100/120/125/200 BPM, after their transitions. The existing <=10 ms controlled
click gate is retained. Known source-event peak offsets ranged from -6.104 ms at
half speed to +1.833 ms at double speed on these fixtures; the separate <=30 ms
transient-fixture gate passed. This does not promise sample-exact real-song attacks.

Native expanded-range session: passed for 180 seconds (35 action checkpoints). It uses the product engine,
real Miracle/Simplex City PCM, quiet 0.08 song gains, 60/120/220 BPM target changes,
explicit leader switches, seek/re-sync, pause/resume and replacement. Test grids
are temporary and never saved as user review. The queue remains 1,024 frames;
starvation is reported directly rather than hidden by increasing buffering.
Final results: zero starvation frames, device errors, callback deadline misses or
workgroup errors; verified real-time scheduling. Maximum callback-derived phase
error 0.041667 ms. Actual callback size 128 frames; maximum callback work 19.791 µs,
maximum producer chunk 14,441.958 µs. Raw report:
`output/native-extreme-tempo-180.json` and corresponding log.

## Reproduce

```sh
cd /Users/pauloricca/Desktop/projects/vira/app
docker compose run --rm builder sh -c 'npm run build && npm test && cargo fmt --manifest-path src-tauri/Cargo.toml --check && cargo test --manifest-path src-tauri/Cargo.toml --locked -- --nocapture'
docker compose run --rm builder
# Close the GUI before a single-stream native audio check.
output/VIRA.app/Contents/MacOS/vira --native-timing-check 180 output/native-extreme-tempo-180.json
open output/VIRA.app
```

Musical listening at extreme stretches, physical display presentation timing,
physical speaker alignment and a new ten-minute soak across these wider limits
remain separate acceptance work. The previous ten-minute narrower-range evidence
is preserved. No supplied song was silently marked Reviewed.
