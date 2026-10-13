# Spike 4 closure — 12 October 2026

**COMPLETE.** Paulo requested that the spike be left as it stands and closed.
No additional algorithm work, listening campaign or engine comparison is required
to close this experiment. Completion does not mean all provisional accuracy gates
passed.

## What we learned

- The offline path works on all four supplied MP3s. FFmpeg decoding, Librosa beat
  tracking, harmonic-chroma key candidates, JSON output and local waveform/audio
  review provide a usable preparation POC alongside the existing audio harness.
  Processing took approximately 18–25 seconds per track in Docker, excluding
  synthetic warm-up and preview writing; this is not native Mac timing evidence.
- The constant-tempo synthetic test achieved 17.7 ms p95 error. Silence produced
  no usable grid/key; a synthetic tempo change was flagged. Key-profile orientation
  was checked, not musical key accuracy.
- The detected yellow beats and green constant grid are different outputs. The
  green grid comes from least-squares fitting of beat time against inferred beat
  number across the entire song. Its times are offset + n × 60 / BPM. It does not
  snap to each yellow detection. Missed/extra detections, metrical changes or
  inconsistent timing can undermine this fit; the precise cause for these songs
  was not isolated.
- Ya Mahla and Simplex City had internally consistent fits (10.2 and 11.8 ms p95
  residuals). Point Of No Return and Miracle did not (256.4 and 187.6 ms). These
  numbers measure agreement with detected beats, not ground-truth accuracy.
- Paulo observed that yellow detections sounded correctly placed in the reviewed
  example while green markers/clicks were displaced. Screenshots also exposed the
  mismatch. This is evidence against the current fit, not a quantified accuracy
  result for every detected beat. The mismatch occurs without user edits; earlier
  emphasis on saved edits did not explain that failure.
- Key estimates remain provisional. Three tracks triggered ambiguity heuristics;
  no reference keys or completed key-listening validation were recorded.

## Retained decision

Use offline analysis to propose editable metadata. Preserve raw detected beat
positions independently of any fitted constant grid, and distinguish their
quality indicators. Do not rely on the present global fit for automatic sync.
Librosa remains the POC baseline; this experiment did not select it over Essentia
or other engines. Keep analysis outside the real-time audio path.

The review page retains start/middle/end waveforms, zoom/pan, seekable playback,
per-song Stop, separate live song/click volumes, and selectable yellow-detection
or green-grid clicks. Yellow detections are now the default click source. Grid
offset replaces the confusing phase label. Browser corrections remain separate
from immutable analysis; export is available. Volume/source choices reset on reload.

## Deferred product work

- Improve and evaluate grid fitting before automatic synchronization: investigate
  outliers, missed/extra beats and beat-number assignment; consider robust or
  local/segmented fits. These are candidate approaches, not validated fixes.
- Validate metrical level, half/double-tempo errors, beat phase, changing tempo and
  key against annotated, deliberately varied material. Four convenience tracks
  do not establish genre-wide accuracy. Downbeats and sections were not analyzed.
- Measure actual manual correction effort. Interaction-span timestamps include
  idle time and UI testing; they do not establish the proposed 60-second target.
- Native throughput, large-library memory/caching, Rust/library integration and
  concurrent analysis/audio-load validation remain implementation work.

Source music and audition WAVs remain local. No deployment or audio-engine
changes were needed. Spike 3 remains the next planned experiment when requested.
