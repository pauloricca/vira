# Steps 3–4 verification — 12 October 2026

Implemented independent A/B loading and playback through one native output
stream. The completed spikes remain unchanged. Reused their pinned Rubber Band
4.0 C ABI, macOS scheduling/workgroup shim, callback wake-up protocol and bounded
queue architecture. The product engine is long-lived and headless-capable.

## Regression checks in Docker

All 44 app checks passed: 24 Python service/analysis/preparation tests, 12 React
tests, and eight Rust tests. The four existing spike audio/DSP regression checks
also passed without modifications to the spike. TypeScript production builds,
Rust formatting and the Apple Silicon macOS cross-build succeeded.

Preparation tests verify complete stereo duration, channel-specific peaks,
analysis-independent loading, cache reuse, corrupted PCM/version rebuilding,
preserved-size/mtime content changes, source changes during decoding, decode
failure and invalid/removed source rejection. The original metadata/analysis
regressions remain included.

Rust checks exercise finite R3 ending, pause/resume output equivalence, unity-speed
seek/reset equivalence, independent commands, source sharing, stale installation
and stale transport rejection, queued-frame positions rather than decoder
lookahead, and consistent snapshots during concurrent callback publication.

React checks cover deck controls, mouse/keyboard seeking, internal-ID-only drops,
failed replacement retaining transport controls, and late load errors not
overwriting a newer request. Existing library/analysis UI checks still pass.

## Native engine session

Ran the compiled executable on this Mac through **MacBook Pro Speakers** using
the same product engine/backend as the graphical app. No Docker builds ran during
the measured session. Docker preparation/analysis remained available as the
intended concurrent development workload.

- A 30-second scripted native transport check passed.
- A repeatable **600.011-second** native session passed with two independent decks,
  pause/resume, seeks, stops, natural finite ending, a failed replacement,
  overlapping load requests, same-source sharing and repeated source replacement.
- Loading another source did not alter the other deck's generation/transport.
  New loads committed paused at frame zero; only the latest raced request committed.
- Reanalysis of Ya Mahla was requested at approximately 60 seconds while native
  playback continued. It completed during the session, without transport changes.
- Natural ending was checked by seeking B close to the end and requiring its
  position to reach the exact prepared duration and remain stopped without looping.

| Native setting / measurement | Result |
| --- | ---: |
| Engine | Rubber Band R3, unity speed, zero pitch shift |
| Output | Stereo float32, 48 kHz |
| Requested device buffer | 256 frames |
| Observed callbacks, min/max | 128 / 128 frames |
| Producer chunk | 128 frames |
| Bounded output queue | 1,024 frames, 21.333 ms capacity |
| Starved frames | **0** |
| Callback deadline misses | **0** |
| CPAL device errors | **0** |
| Workgroup interval / wake signal errors | **0 / 0** |
| Wake wait nonzero returns | **0** |
| Real-time policy | Verified at startup and exit |
| Maximum callback execution | 16.917 µs |
| Maximum callback arrival interval | 2.827 ms |
| Maximum producer chunk work | 8.546 ms |
| Producer chunks exceeding their nominal duration | 25,114 |
| Maximum recorded live source PCM | 283,106,312 bytes |
| Reported process peak RSS | 256,606,208 bytes (244.72 MiB) |

Some producer chunks exceed their 2.667 ms nominal duration, including the retained
restart/priming path. The queue absorbed this workload without observed starvation.
That does not establish a general reset-burst guarantee. Queue capacity is not
measured physical button-to-speaker latency.

The live PCM figure is logical buffer storage. RSS is the operating system's
resident-memory metric; it is not total allocated buffers or total desktop-app
memory, and the headless session excludes WebKit subprocesses. At the same-source
sharing check, both decks used one 116,269,968-byte source allocation. After
shutdown, the reported live source PCM was zero. Temporary replacement ownership
is released by the ordinary retirement thread.

Raw reports and progress logs are preserved under ignored `output/`:
`native-decks-short.json`, `native-decks-600.json`, and their `.log` files. The
reports include frame-derived playback state, source identities, compact peaks,
callback statistics, resources and the scripted checks. Run instructions are in
`README.md`.

## Prepared source measurements

All four supplied MP3s were prepared as full-track stereo sources. Each generated
1,024 channel-preserving peak buckets. These durations come from decoded 48 kHz
frames; small differences from FFprobe's library duration reflect codec padding.

| Track | Prepared duration (seconds) | Frames | Stereo PCM bytes |
| --- | ---: | ---: | ---: |
| Miracle | 302.786375 | 14,533,746 | 116,269,968 |
| Simplex City | 434.469646 | 20,854,543 | 166,836,344 |
| Point Of No Return | 283.952104 | 13,629,701 | 109,037,608 |
| Ya Mahla | 413.597813 | 19,852,695 | 158,821,560 |

Simplex City remained unanalysed while it loaded and played in the native session.
Preparation never implicitly requests musical analysis. The native per-source
preload guard is 256 MiB; streaming and larger-file support are deferred.

## Native graphical app

Visually inspected the final native dark layout on macOS. Dragged the Ya Mahla
library row onto A and verified its full-track stereo waveform, metadata, paused
zero position and actual duration. Started A, then used the accessible Load B row
action for Point Of No Return while A continued playing. B finished loading paused
at zero; starting it produced two independently advancing native-backed playheads.

Paused A and clicked its waveform: A sought while remaining paused and B continued
advancing. Keyboard Left moved A back five seconds; Home returned it to zero.
Resumed A, stopped B, and verified only B returned to zero. Mouse volume controls
updated their backend-reported gains. The GUI starvation and device-error counters
remained zero throughout this interaction. Left both loaded decks stopped at the
beginning, with the app and localhost service running for review.

The ten-minute measurement used the headless product engine; the final GUI
interaction is a separate shorter session. The playback-state read path also has
a Docker concurrency regression check for consistent callback snapshots. These
checks do not imply a ten-minute foreground React rendering stress test.

## Remaining limits

This is evidence for the tested two-deck local workload. It does not settle R3/R2
musical quality, measured physical latency, larger-library memory/cache policy,
other hardware, device switching, sleep/wake, automatic recovery or production
reliability. CPAL errors/starvation counters are not a hardware xrun or loopback
measurement. No sync, crossfader, stretching controls, MIDI or sequencing was added.
The broader step 5 review remains pending.
