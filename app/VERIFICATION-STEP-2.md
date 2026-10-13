# Step 2 verification — 12 October 2026

Scope: selected-file analysis, serial jobs, persistence and source invalidation.
No deck loading or audio playback was added. The closed spikes were preserved;
`preparation/baseline.py` is an unchanged copy of the spike analyzer. The product
calls only its estimate function through a narrow single-file worker, without
batch processing, previews, new grid fitting or an engine comparison.

## Docker verification

- React/TypeScript production build and native Apple Silicon cross-build passed.
- Nine React tests passed, covering the existing library behaviours plus selected
  track-ID requests, queued/running button handling, polled result display,
  review diagnostics, row-local retries, removal during requests, older poll
  responses and retention of a failed Refresh warning during successful polling.
- Nineteen Python tests passed: the six metadata/service regressions, eleven queue
  and cache regressions, and two baseline/worker regressions. Covered selected-file
  isolation, serial execution, deduplication, bounded queue rejection, completed
  cache restoration, interrupted/failed/retried jobs, corruption/version mismatch,
  persistence failure, source changes with preserved size/mtime, late results,
  removal and queued superseded sources. HTTP rejects paths and unknown IDs.
- The original baseline's synthetic 120 BPM, tempo-change, silence and key-profile
  checks passed. The single-file worker produced only its requested JSON output
  for a synthetic silent WAV; no previews or batch output were generated.
- Three Rust tests passed for library/schema/source validation, ID/path rejection,
  incomplete-state result rejection and duplicate identities. Formatting passed.
- Builds, tests, media preparation and numerical work ran in Docker. Only the
  compiled Tauri bundle/backend commands ran on macOS.

## Native app observations

Clicked **Analyse Point Of No Return**, then **Analyse Ya Mahla** in the native
app. Point Of No Return entered Analysing while Ya Mahla remained Queued. Refresh
worked during the active job without cancelling/replacing either job. The UI
published both completed rows automatically; Miracle and Simplex City retained
blank BPM/key and Not analysed, proving no implicit whole-bin analysis.

| Selected track | Draft fitted BPM | Top key candidate | Grid residual p95 | Raw beats | State |
| --- | ---: | --- | ---: | ---: | --- |
| Point Of No Return | 122.63136 | A minor | 256.389 ms | 579 | Needs review |
| Ya Mahla | 118.99907 | C major | 10.163 ms | 811 | Needs review |

Point Of No Return flagged grid disagreement and ambiguous key. Ya Mahla flagged
ambiguous key. Both retained the general unverified metrical-level/phase advisory.
Expanded the Point Of No Return row on macOS and verified residual, offset,
end/start drift, tempo alternatives and alternate key correlations. The UI clearly
labels correlations as scores rather than confidence probabilities.

Worker-reported decode/estimate times were approximately 33.04 seconds for Point
Of No Return and 24.18 seconds for Ya Mahla. These are container diagnostics,
excluding queue wait, imports and source snapshot/hash overhead. They establish
neither native analysis performance nor audio timing.

Restarted the preparation service after completion. The app detected a new
service instance and requested Refresh. Refresh restored both saved results,
including beats and flags, without launching new jobs. Quit and relaunched the
native bundle: startup again restored both results with the other rows still
unanalysed. Also inspected restored state through the native `--library-state`
command. Generated versioned cache records include the actual source revision
and SHA-256 hash. Left the updated app and service running for review.

## Limits

Automatic estimates remain draft interpretations, with the original baseline's
known constant-grid and key ambiguity limitations. No musical-accuracy claim or
manual grid/key correction UI was added. Error, invalidation and race cases used
synthetic temporary container fixtures; Paulo's original music was never changed.

Full-song mono decoding and temporary source snapshots remain proportional to
song duration; large-library streaming/cache eviction is deferred. Current scans
hash readable sources outside the audio/UI paths. The scan deadline, ten-minute
job deadline and single-worker queue are development limits, not throughput
guarantees. Native playback does not exist yet, so simultaneous playback/analysis
acceptance and audio interruption measurements remain pending for steps 3–5.
