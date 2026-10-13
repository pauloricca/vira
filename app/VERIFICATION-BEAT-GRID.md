# Beat-grid investigation — 13 October 2026

## Follow-up: consistent attack offset

The first fix aligned the grid to tracker timestamps, leaving the tracker's
systematic attack delay visible. Paulo's follow-up screenshots identify this on
all four tracks. An independent PCM phase calibration now finds repeatable
attack starts around the fitted beats; it does not change tempo or trim audio.

| Source | Measured phase correction | Corrected anchor (s) | Supporting attacks |
|---|---:|---:|---:|
| Point Of No Return | −27.94 ms | 0.339105 | 28 |
| Miracle | −31.74 ms | 0.297301 | 58 |
| Simplex City | −27.31 ms | 0.053650 | 54 |
| Ya Mahla | −26.50 ms | 0.759760 | 33 |

The calibration uses approximately 1 ms PCM energy buckets. For attacks over a
quiet floor it finds the earliest small energy rise; over audible tails it
backtracks a sharp rise to its foot. At least eight attacks and a repeatable
cluster within 6 ms are required before moving the grid. Unsupported tracks
retain their fitted phase. The tracker anchor, correction, and support count
are preserved explicitly. Existing residual diagnostics continue to describe
the raw tracker fit before attack calibration; raw detected beats remain intact.

The corrected first anchors for Simplex City and Point Of No Return agree with
the independent .01-amplitude PCM crossing within .4 ms; Miracle is within 4 ms.
Ya Mahla's anchor is on a later beat, consistent with its original beat numbering.
These measurements verify attack alignment, not musical downbeat annotations.
Analyzer v3 invalidates prior estimate caches without changing saved user timing.

Validation adds exact synthetic click onset checks with leading silence of
0, .137, 2, and 10 seconds (within 3 ms), unchanged tempo, and no correction for
silence or constant energy. Full Docker preparation suite: 38 tests.

## Original grid-fit investigation

The constant-grid fitter accumulated beat indices from successive tracker
intervals, then fitted all timestamps equally. Tracker phase changes and count
errors during breakdowns therefore skewed otherwise steady opening sections.

| Local source | Previous BPM / anchor (s) | Robust BPM / anchor (s) |
|---|---:|---:|
| Point Of No Return | 122.63136 / 0.33140 | 121.99966 / 0.36705 |
| Miracle | 123.28775 / 0.46743 | 122.99973 / 0.32904 |
| Simplex City | 125.00156 / 0.08564 | 124.99931 / 0.08096 |
| Ya Mahla | 118.99907 / 0.78589 | 118.99911 / 0.78626 |

These measurements use the supplied local files' detected timestamps, not human
beat annotations. Point Of No Return's old p95 fit residual was 256 ms; Miracle's
was 188 ms. With robust fitting, their first five tracker timestamps agree with
the grid within 8 ms. Raw tracking still switches phase: approximately 41% and
81% respectively support the opening phase within 25 ms. Their full-track
diagnostics continue to require review. This fixes grid fitting, not all tracker
errors, musical meter, or bar-one/downbeat identification.

The new fit seeds tempo from short runs, selects the earliest coherent phase,
assigns each timestamp to its nearest beat independently, and repeatedly fits
supporting timestamps. Missing beats cannot propagate a count error. Residuals
still include every raw detected beat; local tempo diagnostics retain the
original tracker behavior. Analyzer version v2 invalidates old estimate caches.
User-saved timing is independent and remains authoritative.

## Timestamp audit

Analysis decodes the entire source to mono 22,050 Hz with FFmpeg. Playback and
waveform preparation decode the entire same content to stereo 48,000 Hz. Neither
path trims silence. Analysis converts beat frames using hop 256 at 22,050 Hz;
waveform buckets use 240 source frames at 48,000 Hz. Grid lines and waveform tiles
share the same source window and playback speed in RollingRow.

The first samples exceeding amplitude .01 in mono versus prepared stereo were:

| Source | Analysis mono (s) | Playback stereo (s) |
|---|---:|---:|
| Point Of No Return | 0.339138 | 0.339125 |
| Miracle | 0.293878 | 0.293729 |
| Simplex City | 0.053878 | 0.054042 |
| Ya Mahla | 0.255374 | 0.255396 |

This gives no evidence of a leading-silence or decoder timestamp offset in these
files. Onset estimates have finite time resolution and attack latency; exact
sample alignment with musical beats remains unverified. Display clock latency
could affect the playhead relative to audible output, but moves grid and waveform
together and cannot explain their relative mismatch in the screenshot.

White waveform strokes are an independent bass-attack visualization computed
from prepared PCM. They are not the beat tracker's output. Numbered lines are a
constant grid, using saved user timing if present, otherwise the analysis draft.
The screenshot alone does not identify which tracks or saved grids were loaded.

## Validation

Docker preparation suite: 36 tests passed. New regressions cover phase slips,
later majority offbeats, missing beats, short fits, and leading silence of
0, .137, 2, and 10 seconds. The original silence, constant tempo, and changing
tempo checks also pass. Leading silence preserves the first beat's source time
within 25 ms and tempo within .1 BPM. No host toolchain was installed or used.
