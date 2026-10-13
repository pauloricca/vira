# Musical Performance Engine — Concept & Spikes

## Concept

A macOS desktop performance instrument that combines minimalist DJ decks with polyphonic sampling, polymetric sequencing, external synths, and synchronised visuals.

Songs are more than audio files: their beatgrids, keys, chords, cue points and sections become a **musical timeline**. Performers can arm patterns to launch or restart on the next bar, a section boundary, or the last bar before a transition. Snippets from any track can overlap, ratchet, loop and receive independent processing. Saved MIDI patterns can transpose or follow a track's key, driving hardware synths alongside the mix. Visual systems can receive both live signals and advance notice of upcoming beats, phrases and changes.

The guiding idea: **a performance instrument whose sample library includes entire songs**, with one timeline orchestrating audio, MIDI and visuals.

## Architecture after spikes 1 and 2

- **macOS desktop UI:** retain Tauri after the native host experiment. React/TypeScript remains the planned product UI for decks, library, cue points, sequencer lanes, pattern arming, MIDI mapping and routing; spike 2 used only embedded HTML/Canvas and did not validate a React application.
- **Independent Rust performance core:** retain an in-process engine with a UI-independent, offline-renderable core. Spike 2 ran the existing real-time worker inside Tauri alongside rendering and background decoding; no separate audio process is required by the current evidence. Shared sample-based transport, global/song beat mappings, deterministic scheduling, per-sequence phase, polymeter, voice management, mixing and effects remain the planned product core.
- **Audio processing:** retain CPAL/Core Audio and native Rubber Band integration with Rust. R3 (Finer) remains the quality candidate and R2 (Faster) the lower-cost alternative; representative musical listening has not selected a winner. The spike preloads stereo WAVs; Symphonia decoding and whole-song memory management remain planned.
- **Audio worker and output:** carry forward the dedicated producer, bounded SPSC audio queue and thin output callback. On macOS, the producer uses verified real-time scheduling, a custom asynchronous Audio Workgroup and callback-signalled wake-ups. The callback only consumes prepared audio, inserts silence on starvation and records bounded telemetry; it must never decode, allocate unpredictably or wait. CPU sampling and report generation run on a supervisor thread. Scheduling/workgroup setup failure is explicit rather than silently falling back.
- **Host lifecycle and recovery:** retain CPAL/Core Audio; current evidence does not justify replacing it with direct Core Audio integration. Keep device monitoring, cancellation, stream teardown/reopening and report generation outside the callback. The POC detects default-device/rate changes, stream errors, callback stalls and long supervisor pauses, then makes bounded reopen attempts. Controlled reopening worked in-process, but restarts playback from frame zero. Persistent device identity, transport-preserving recovery, sample-rate policy and physical device/sleep validation remain engineering work.
- **Buffering and event preparation:** keep queue capacity configurable and measure live response delay separately. The tested 1,024-frame queue holds 21.33 ms at 48 kHz; this is not measured end-to-end latency. Simultaneous starts/seeks can still exhaust that reserve. Separating producer chunk size from device buffer size and faithfully preparing scheduled restarts are deferred engineering work. The experimental replacement-stretcher preparation was removed because it changed output.
- **MIDI and external instruments:** CoreMIDI/midir; instrument profiles for note/CC mappings, audio returns and calibrated latency. Lookahead schedules MIDI early so *returned sound* aligns with the mix.
- **Analysis and library (off the audio thread):** watched export folders, SQLite, waveform/tempo/beatgrid/key analysis (e.g. Essentia), with later chord and section analysis. Store confidence and permit manual correction.
- **Visual/event outputs:** publish timestamped musical events, upcoming-event windows, performance state and audio features via OSC/WebSocket (optionally MIDI). Consumers compensate for their own presentation latency.

**Timing principle:** distinguish global performance time, source-song position, and each sequence's phase. Events have intended audible/presentation times; outputs derive their own dispatch times. A deck jump or tempo change invalidates and republishes affected future schedules. Already-sent hardware messages cannot always be recalled, so keep dispatch horizons appropriately short.

**Development environment:** run dependency installation, builds, tests, media preparation and offline experiments in Docker. Cross-compile the macOS executable in Docker using the installed Apple SDK mounted read-only; run only the built application on bare metal for actual Core Audio measurements. Container timings are diagnostic and must not be presented as Mac audio-performance acceptance evidence.

## Spike sequence

These experiments target uncertainties that could change the architecture, language, platform or product scope. Before each spike, define the target hardware, workload and measurable acceptance criteria. Record the evidence and resulting decision; build only enough to answer the question.

1. **Audio quality, performance + native DSP viability — COMPLETE (12 October 2026).** The headless harness demonstrated Rust/native Rubber Band integration and substantially improved native playback with an appropriately scheduled audio worker. Paulo accepted this as sufficient to retain the architecture and stop the spike here. This closes the architecture experiment, not production sound-quality or reliability validation.
   - **Decision:** retain Rust + Rubber Band, the queued producer architecture and the macOS real-time worker. Keep R3/R2 available. Supported polyphony, latency targets and musical settings remain uncommitted; the evidence and deferred work are recorded below.

2. **macOS host + audio integration — COMPLETE (12 October 2026).** The minimal Tauri host reused spike 1's engine and passed all nine short steady comparisons across headless, idle and busy modes. A controlled reopen succeeded. One idle restart-heavy run inserted 2.67 ms of silence, consistent with the existing restart limitation. Paulo accepted the POC as sufficient to close the architecture experiment and leave the implementation as it stands. See the [host instructions](spikes/audio/HOST-SPIKE.md) and [native evidence](spikes/audio/results/host/REPORT.md).
   - **Decision:** retain Tauri, CPAL/Core Audio and the in-process Rust engine with its dedicated real-time worker. Physical device changes, sample-rate changes, actual sleep/wake and sustained reliability are deferred validation, not implied passes.

3. **Audio, MIDI and visual clock alignment — next planned experiment, when requested.** Can internal audio, a hardware synth's recorded audio return and a separate visual receiver maintain the required alignment? Use a minimal repeated event stream to measure fixed offsets, jitter and drift over a sustained run, including under load. Verify timestamp conversion between the audio, MIDI and visual clocks, multichannel audio routing, and how much measured latency can be compensated. Report residual jitter separately from compensated latency.
   - **Decisions at stake:** master-clock ownership, clock conversion, MIDI/audio APIs, routing and latency-compensation architecture, and visual transport requirements.

4. **Automatic song-analysis viability — COMPLETE (12 October 2026).** Paulo accepted the quick POC as sufficient and requested closure. The Docker analyzer ran on all four supplied songs, with waveform review, detected-beat/grid click comparison and correction controls. Individual detections appeared useful during review, but the whole-song constant-grid fit was unreliable on two tracks. Completion closes the experiment, not musical accuracy validation. See the [closure notes](spikes/audio/analysis/CLOSURE.md), [POC instructions](spikes/audio/analysis/README.md) and [results](spikes/audio/results/analysis/REPORT.md).
   - **Decision:** retain offline analysis as draft metadata with manual review and correction. Preserve detected beats separately from fitted grids; do not treat the current global fit as a reliable automatic sync source. No final analysis-engine selection or automatic-key accuracy claim.

Routine feature work—sequencer behaviour, envelopes and filters, pattern reuse, MIDI learn, library watching, caching, waveform views and UI construction—belongs in implementation after these decisions. It does not need a separate spike.

## Spike 1 completed implementation

The standalone headless harness in `spikes/audio/` provides native Rubber Band R2/R3 integration, offline WAV rendering and real-time stereo playback. Scripted sample-positioned starts, stops, retriggers, seeks and ratio changes exercise two decks and overlapping snippets. Sources are preloaded outside the callback. Spike 1 did not build a Tauri UI; spike 2 subsequently added the optional host described below. A musical scheduler, analysis system, database, MIDI, visual outputs and general effects system remain unimplemented.

Rubber Band 4.0.0 and the toolchain are pinned. Reproducible Docker build/run instructions, manifests, anonymous synthetic auditions, settings keys, machine-readable measurements and detailed reports are available in the harness. Only the cross-built native executable runs on the Mac.

The original provisional envelope included stereo 48 kHz, requested buffers of 128/256/512 frames, two decks plus 0/4/8/16 snippets, normal speeds around 0.8–1.25 and pitch shifts of ±3 semitones, with 0.5/2.0 as exploratory extremes. These are test inputs, not product requirements. The container load sweep covered the voice counts; native playback checks reached two decks plus four snippets. Representative music, listening approval and the planned 30-minute soak were not completed and are explicitly deferred.

## Spike 1 findings — 12 October 2026

**Status: COMPLETE — closed by Paulo on 12 October 2026.** Leave the implementation as it stands and retain the architecture informed by these results. The experiment demonstrated working Rust/native integration and a substantial scheduling improvement. Completion does not mean that musical sound quality, sustained low-latency reliability or a supported voice count has been validated.

Implementation and commands: [audio harness README](spikes/audio/README.md). Detailed evidence: [results report](spikes/audio/results/REPORT.md), [native playback summary](spikes/audio/results/native-summary.json) and [container sweep summary](spikes/audio/results/container/summary.json).

### What works

- All build and test tooling runs in Docker, including cross-compilation of an Apple Silicon executable. That executable successfully played through the MacBook Pro speakers without a host Rust or Rubber Band installation.
- The observed machine is an M1 Pro MacBook Pro with 32 GB RAM. Rubber Band 4.0.0 is pinned; both R2 and R3 are exercised in real-time processing mode.
- Four automated integration tests passed, checking duration, pitch, stereo consistency, impulse alignment and sample-positioned starts/stops/retriggers. The checks caught and corrected output-draining and tail-handling defects.
- Generated 45 anonymous, level-matched synthetic comparison pairs. Completed 24 container load cases and six short native playback checks. These are integration and diagnostic results; the configurations have not received musical listening approval.

### Initial playback results (before the scheduling follow-up)

The native checks used two decks plus four snippets, for ten seconds per run. The small routine that hands prepared audio to the speakers always completed within its measured time budget. However, the worker preparing that audio sometimes failed to keep the queue supplied. The output then inserted silence. This is **buffer starvation**, and it means those runs fail the proposed no-starvation criterion even though the output routine itself was fast.

Five of the six native runs observed starvation. One R3 stress run with a larger queue had none. That queue could hold about **85 ms of audio**, compared with about **21 ms** in the smaller-queue comparison. Preparing more audio in advance can absorb delays, but creates a responsiveness tradeoff for live actions. These figures describe queue capacity, not measured button-to-sound latency; end-to-end latency is still unknown. A single clean ten-second run is not evidence of sustained reliability.

Steady playback with the smaller queue also starved, so rapid retriggers are not the whole explanation. This motivated the scheduling comparison below, which improved steady playback and exposed residual bursts around restarts. Core Audio also delivered callbacks containing half the requested frame count; the reports preserve both figures, and the discrepancy needs investigation.

R2 used less processing time than R3 in the tested configurations. In the native six-voice checks, peak sampled process CPU was roughly 22% of one core for R2 and 51–59% for R3. That suggests average processing capacity may not be the only problem: occasional delays matter even when average load is modest. It does not establish the cause of starvation or prove that either engine sounds good enough. Short-file memory use was modest, but whole-song preload costs have not been tested.

### Accepted architecture decision

**Retain Rust + Rubber Band and close this spike.** The improved real-time producer and bounded queue were subsequently carried into spike 2. There is no evidence here that justifies abandoning Rust or choosing another stretching library. Keep R3 as the quality candidate and R2 as the cheaper comparison; musical auditions must decide whether their sound is acceptable. Do not adopt the larger queue as the product solution until its responsiveness is measured against an agreed target.

The container sweep is not a Mac polyphony benchmark: it uses a different FFT implementation and some runs overlapped build activity. Native checks were short and synthetic. No representative musical listening feedback, measured end-to-end latency or 30-minute soak is available. No supported workload is declared.

### Worker scheduling follow-up — 12 October 2026

The original interruptions were not a fair measure of a properly scheduled audio worker. A follow-up retained the same small queue (about 21 ms capacity) and compared the original polling worker, callback-triggered wake-ups alone, and wake-ups plus macOS real-time scheduling and an asynchronous Audio Workgroup.

Across three repeats each of two-deck steady playback, six-stream steady playback and the aggressive six-stream script, starvation occurred in **8/9 polling runs, 6/9 wake-up-only runs and 0/9 real-time runs**. Each run lasted ten seconds. The real-time policy was verified at startup and exit, with no workgroup errors. No container builds ran during playback tests. This supports changing the Mac harness default to the real-time worker; it does not establish long-term reliability or measured end-to-end latency.

A final-build 60-second aggressive run still inserted **2.67 ms of silence** once, near simultaneous snippet restarts. A 128-frame check was clean; a 512-frame check with the same queue capacity inserted 85.33 ms across 16 gaps, also aligned with start/seek-containing blocks. Larger producer chunks leave less queued audio while expensive resets execute. Device buffer and producer chunk size are coupled in the harness, so this is not a device-buffer-only comparison. Scheduling is substantially improved, but the no-starvation criterion is still unmet. Smaller independent producer chunks, earlier publication of completed audio and faithful preparation of scheduled restarts are candidates for deferred engineering work.

CPU bookkeeping now runs outside the audio worker, and reports include the exact output-frame ranges where silence was inserted. The original worker modes remain selectable for comparison. Builds and source checks still run entirely in Docker.

A separate attempt to prepare replacement stretcher states before scheduled restarts changed the output after tempo/pitch changes and a subsequent seek in regression tests. That prototype was excluded. The clean scheduling results use the existing restart path; preparing future triggers faithfully remains further work.

See the [worker scheduling report](spikes/audio/results/worker-scheduling/REPORT.md) for repeat-by-repeat results, confirmation checks and limitations. The larger 85 ms queue is no longer the only configuration with clean short-run evidence. Representative musical listening and a sustained soak remain deferred product validation.

### Deferred engineering and product validation

These items remain visible after closing spike 1; none is claimed as passed:

1. **Restart bursts and buffering:** separate producer chunk size from device buffer size, investigate earlier publication of completed audio and faithful preparation of scheduled starts/seeks. Preserve output-equivalence checks; the rejected prototype must not be treated as the solution.
2. **Targets and musical quality:** agree target hardware, minimum voice count, acceptable live response delay and normal speed/pitch range. Obtain authorised representative music and record Paulo's R2/R3 listening preferences on drums, vocals, dense mixes, sustained textures and attack-start snippets.
3. **Native validation:** investigate requested versus observed callback sizes, audit native DSP allocation behaviour, measure whole-song preload costs and actual end-to-end latency, and extend the native voice sweep using the improved worker. Queue capacity alone cannot establish response delay.
4. **Sustained reliability:** after agreeing the workload and settings, run the planned 30-minute native soak. Require zero observed callback overruns and starvation, record device errors and listening observations, and state observability limits before declaring that workload supported.

## Spike 2 completed implementation and findings — 12 October 2026

**Status: COMPLETE — closed by Paulo on 12 October 2026.** Leave the implementation as it stands. The short POC is sufficient to retain the host architecture; completion does not mean that physical device recovery, sleep/wake or sustained reliability has been validated.

The optional Tauri host lives in the existing `spikes/audio/` crate and shares its Rubber Band integration, audio queue and real-time producer. It adds embedded HTML/Canvas rendering, status commands, two ordinary background WAV-decode/waveform workers, cancellation, callback-interval telemetry and bounded stream reopening. The headless comparison uses the same new executable without opening a window. The original spike 1 executable and measurements are preserved. React and the product UI were not needed for this experiment.

All compilation, formatting, regression checks and report processing ran in Docker. The cross-built macOS executable ran on the M1 Pro MacBook Pro after builds finished, using its speakers, stereo 48 kHz, R3, six synthetic voices, a requested 256-frame buffer/producer block and a 1,024-frame queue. Actual callbacks remained 128 frames. Normal runs lasted ten seconds.

| Native comparison | Runs | Result |
|---|---:|---|
| Headless steady | 3 | All completed; zero starvation, callback overruns or device errors |
| Idle Tauri steady | 3 | All completed; zero starvation, callback overruns or device errors |
| Busy Tauri steady | 3 | All completed; zero starvation, callback overruns or device errors |
| Headless restart-heavy | 1 | Completed cleanly |
| Idle Tauri restart-heavy | 1 | Completed with 128 starved frames (2.67 ms); no callback overruns or device errors |
| Busy Tauri restart-heavy | 1 | Completed cleanly |
| Busy controlled reopen | 2 attempts | First stopped as requested; second completed cleanly |

The idle restart-heavy run fails the zero-starvation criterion. Its gap starts at output frame 150,784, near a block containing four simultaneous starts at frame 150,001. That block took 17.25 ms with only 16 ms of queued audio available. This is consistent with spike 1's restart bursts exhausting the reserve; one matched stress comparison cannot prove that Tauri makes no contribution.

The rendering and background load actually ran: busy steady runs recorded 394–448 decode/waveform passes per worker and 100–632 animation frames. Rendering was not maintained at 60 Hz in every repeat; visibility/WebKit throttling limits the load claim. The first busy steady run and busy restart-heavy run recorded 632 and 622 animation frames respectively with no starvation. Maximum callback intervals across the comparison were 2.719–2.837 ms, against a nominal 2.667 ms callback duration. These are callback-arrival diagnostics, not measured audible interruptions or end-to-end latency; process CPU/RSS also excludes WebKit child processes.

The controlled reopen stopped the first attempt and completed a fresh second attempt in the same Tauri process. The approximately 505 ms between attempts includes the deliberate 500 ms retry wait and is not measured audible recovery latency. Playback restarts from frame zero. Four existing audio regression tests, formatting and helper-script syntax checks passed; the native build succeeded with the existing SDK and locked matching Tauri dependencies.

### Accepted architecture decision

**Retain Tauri + CPAL/Core Audio + an in-process Rust engine and close spike 2.** Keep the dedicated real-time audio worker isolated from UI work and ordinary background processing. Current evidence does not warrant a native shell, direct Core Audio replacement or a separate audio process. Keep the core headless-capable so future changes can be compared against the same baseline.

### Deferred host engineering and validation

1. **Physical lifecycle checks:** default-device switching/unplugging, nominal sample-rate changes and actual sleep/wake were not performed. Exercise these separately and measure interruptions and recovery; the controlled reopen is not a substitute.
2. **Recovery semantics:** replace name/rate fingerprinting with persistent device identity where needed, define supported sample rates and transport behaviour, and validate cancellation/reopening under device failures. The POC has bounded retries and restarts at frame zero; it provides neither seamless resume nor resampling.
3. **Representative host load:** validate the eventual React UI, sustained foreground rendering and real library/analysis workloads. Account for WebKit child-process CPU and memory. Short synthetic comparisons do not establish a supported product workload.
4. **Audio reliability:** carry forward spike 1's restart/buffer limitations, requested-versus-observed callback discrepancy, musical listening, loopback latency and sustained-soak work. The observed 2.67 ms gap remains a failure of the zero-starvation target.

Implementation and commands: [host POC instructions](spikes/audio/HOST-SPIKE.md). Detailed evidence: [host results report](spikes/audio/results/host/REPORT.md) and [per-case summary](spikes/audio/results/host/summary.json).

**Next handoff:** spikes 1, 2 and 4 are complete; do not extend them without a new request. Spike 3 (audio, MIDI and visual clock alignment) is the next planned experiment when requested. Reuse the existing engine and optional host, define the hardware/routing and alignment criteria first, and preserve the distinction between fixed latency, jitter and drift. Keep builds and tooling in Docker and run native audio/device measurements on the Mac. The deferred items above and in the spike 4 closure notes remain visible product engineering work.

## Initial milestone

A minimal playable demo: **two synced decks, a few cue-triggered snippet voices, two polymetric sequences with ratchets, an armed section launch, one key-following external synth with compensated audio return, and a basic visual subscriber**. No polished interface or automatic chord transcription needed yet.

The playable demo remains future work. Spikes 1, 2 and 4 are complete, retaining Rust + Rubber Band, Tauri, CPAL/Core Audio, the in-process real-time worker and an offline draft-metadata analysis workflow. Spike 4's completion does not accept automatic grid/key accuracy. The clock-alignment experiment and deferred analysis/audio/host validation still inform implementation and the supported workload.
