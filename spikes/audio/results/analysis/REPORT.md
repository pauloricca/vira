# Spike 4 — measured results

**Spike COMPLETE (12 October 2026), closed at Paulo's request.** See the
[closure notes](../../analysis/CLOSURE.md). These are automatic estimates;
accuracy and correction-time gates remain unverified, deferred product validation.

| Song | BPM | Grid residual p95 | Key candidate | Flags |
|---|---:|---:|---|---|
| Acid Arab, Wael Alkak - Ya Mahla.mp3 | 118.999 | 10.2 ms | C major | metrical_level_and_phase_unverified, ambiguous_key |
| Adam Port, Monolink - Point Of No Return.mp3 | 122.631 | 256.4 ms | A minor | metrical_level_and_phase_unverified, grid_needs_review, ambiguous_key |
| Adriatique, WhoMadeWho - Miracle.mp3 | 123.288 | 187.6 ms | C major | metrical_level_and_phase_unverified, grid_needs_review |
| Afriqua - Simplex City.mp3 | 125.002 | 11.8 ms | F minor | metrical_level_and_phase_unverified, ambiguous_key |

Grid residuals measure agreement with detected beats, not annotated ground truth.
See summary.json for whole-track beat timestamps, key alternatives, per-window keys, hashes and container timings.
Open review.html through the documented local server to audition and export manual corrections.

Decision: viable as an offline draft-metadata POC. Require editable BPM, phase and key; do not depend on unreviewed automatic metadata.
No engine bake-off, section labels, downbeats, native throughput claim or genre-wide accuracy conclusion.
