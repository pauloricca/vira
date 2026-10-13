# Spike 4 — quick song preparation POC

Scope fixed before running: all four supplied MP3s, whole-song beat tracking and
key candidates, with 12-second start/middle/end listening excerpts. No sections,
chords, downbeats, library database, native integration or new audio engine.
Reuse spike 1/2's Docker environment and keep all analysis off the audio thread.
Librosa is a low-cost baseline, not a bake-off or a selection over Essentia.

Provisional gates: synthetic constant-tempo beatgrid within 30 ms at the 95th
percentile; a known tempo change must trigger review; silence must not produce
a usable grid or key. For real songs, flag fitted-grid residual p95 > 40 ms,
start-to-end signed residual change > 30 ms, local tempo spread > 1%, and weak or
inconsistent key candidates. These are consistency diagnostics, NOT accuracy
against annotated beats. Always expose half/double tempo and key alternatives.

Human acceptance remains pending: listen at start/middle/end, verify metrical
level and phase, confirm key by ear/instrument, and record corrections and time.
Target <= 60 seconds of manual work per song, verified grid error <= 30 ms and
no unnoticed half/double-tempo errors. Four supplied tracks are convenience
material, not evidence for every genre, live drums or changing tempo.

Container wall time is recorded only as offline cost; no macOS performance claim.
