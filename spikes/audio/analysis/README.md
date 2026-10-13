# Spike 4: automatic song preparation

**Status: COMPLETE (12 October 2026), closed at Paulo's request.** See
[closure notes](CLOSURE.md) for findings, decisions and deferred validation.
The remaining accuracy checks below are product follow-up, not open spike work.

Small offline POC alongside spikes 1/2. Reuses their Docker base and directory
layout; no Rust/Tauri/DSP changes were necessary. An independent batch process
exports JSON suitable for a future library importer. User music is mounted read-only.

From the repository root:

```sh
# Existing spike-1 base; only needed if audio-dev is missing:
docker compose -f spikes/audio/compose.yaml build dev
docker compose -f spikes/audio/analysis/compose.yaml build
docker compose -f spikes/audio/analysis/compose.yaml run --rm analysis
docker compose -f spikes/audio/analysis/compose.yaml up -d review
```

Open http://localhost:8044/results/analysis/review.html. Listen with and without
the grid click. Change BPM (including half/double), phase in seconds and key.
Replay to hear changes. Corrections persist in this browser's local storage,
keyed by source SHA-256; export them as JSON to retain elsewhere. The original
analysis is immutable. The checkbox is a human assertion, not a computed pass.
Interaction-span timing includes pauses and does not establish active work time.
Each song now includes a waveform drawn from its decoded preview PCM. Orange
dashed markers are the raw detected beat timestamps; mint markers are the current
editable BPM/phase grid used by the click. Use the excerpt selector for start,
middle or end, zoom up to 8× and pan with the position slider. Click the waveform
to position the cursor, then use the matching excerpt's playback button to listen
from there. A moving white cursor follows playback. Grid edits stop playback and
redraw immediately after committing the field. These views cover the existing
12-second excerpts, not the whole song; timing labels use whole-song seconds.
Stop the server with `docker compose -f spikes/audio/analysis/compose.yaml down`.
The server binds only to host loopback but exposes the audio spike directory.

```sh
# Fast regression checks without scanning music:
docker compose -f spikes/audio/analysis/compose.yaml run --rm analysis --test-only
```

Outputs: `results/analysis/summary.json`, `REPORT.md`, `review.html` and private
12-second mono WAV previews in `output/analysis/`. Do not redistribute previews
or source music. Override `--input` / `--output` for batch CLI runs; review paths
assume the default output layout. Rerunning replaces generated reports but keeps
saved browser corrections. Source hashes identify content; filenames are labels.

Method: FFmpeg decodes the full song to 22.05 kHz mono, Librosa tracks beats from
onset strength (256-sample hop, ~11.6 ms resolution), then a linear fit estimates
BPM/phase and reports discrepancies from the detected beat sequence. Thirty-second
harmonic chroma windows are compared to Krumhansl-Schmuckler major/minor profiles.
Candidate correlations and agreement across windows indicate ambiguity; they are
not calibrated confidence probabilities. Window changes may reflect instrumentation,
modal music, real modulation or estimation errors. Beat phase is not a downbeat.
Key review is flagged for a top correlation below 0.6, a top-two margin below 0.1,
or less than 70% agreement across windows; these are provisional heuristics.
Full-song decoding uses memory proportional to duration; streaming is future work.

The chosen baseline favors a quick, inspectable POC. It does not compare Essentia,
learned models, or native analysis speed. Four tracks are not a deliberately varied
benchmark. No annotated references were supplied, so real beat/key accuracy,
half/double-tempo error rates and manual correction effort remain unverified.
See PLAN.md for provisional gates and the generated report for measurements.
Sections/chords are excluded because they were not required for this POC.

References: [Librosa beat tracking](https://librosa.org/doc/0.11.0/generated/librosa.beat.beat_track.html),
[chroma](https://librosa.org/doc/0.11.0/generated/librosa.feature.chroma_stft.html),
[harmonic/percussive separation](https://librosa.org/doc/0.11.0/generated/librosa.decompose.hpss.html).

Audition controls: each song has live Song volume and Click volume sliders
(including mute). Click follows defaults to the yellow raw detected beat times;
select Green fitted grid to hear the constant BPM/offset fit instead. Switching
click source stops playback; press the excerpt button again. Volume changes take
effect during playback. Maximum song/click gains are 0.65/0.35 for mix headroom;
percentages are relative control levels. Audition settings reset on page reload;
saved BPM/key/grid corrections are unchanged.
