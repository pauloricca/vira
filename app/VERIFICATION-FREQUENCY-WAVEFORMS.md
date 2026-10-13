# Frequency waveform prototype — 2026-10-13

Extended the existing canvas/SVG renderer; no waveform dependency was present.
Frequency shading uses offline left-channel power spectra above 3 kHz and RMS strength.
White attacks use positive spectral flux gated by a rising amplitude envelope.
5 ms feature buckets align with source fine peaks. Coarse buckets retain maxima.
No FFT or PCM transfer occurs in the rendering or audio callback.

Docker checks: production TypeScript/Vite build, 36 frontend tests, 22 Rust tests,
and 28 existing preparation tests pass. Six preparation tests pass after adding
frequency discrimination, quiet treble, left-channel isolation, silence and short
noise attack coverage. Docker macOS release bundle built successfully.

Visual balance with real music and macOS rendering cadence have not been measured
for this prototype. Full-track maxima can make dense passages brighter than the
close-up view. Thresholds are an initial tuning choice, not a frequency display
with individually labelled bands. Reload tracks to populate the new features.

Single-channel follow-up: frequency features use only the left channel. Feature
version 2 invalidates previous shading caches on load; stereo PCM is unchanged.

Caching follow-up: seven preparation tests pass, including restart reuse with
FFT disabled, version migration, and feature checksum repair without decoding.

Contrast follow-up: feature version 3 detects positive spectral flux and rising
envelopes separately in 40–180, 180–1000, 1000–3000 and 3000–24000 Hz bands.
Sustained brightness is reduced and uses a steeper treble curve. Transients reach
white sooner; overview transient strength is averaged rather than maximised.
Docker preparation regression checks cover attacks over continuous bass and steady
bass rejection. 40 frontend tests and the production build pass. Visual tuning
against the supplied screenshots' tracks remains a listening/viewing follow-up.

Kick emphasis follow-up: feature version 4 restricts white candidates to strong
40–250 Hz attacks with sufficient bass energy, rather than the maximum across
all bands. Local peak selection and 100 ms separation retain one 5 ms stroke
per attack. The white mapping now starts at .45 and reaches white at .9.
Eight preparation tests pass, including kick-over-bass reaching white, noise
bursts staying below white and steady bass rejection. Frontend checks pass.
These are bass-attack cues rather than an instrument classifier; bass notes can
still qualify. Real-track visual balance remains to be checked in the app.

Body brightness follow-up: display-only curve changed from
`0.22 + 0.42 * high^1.2` to `0.40 + 0.40 * high^0.55`. This lifts the base
and midrange while keeping white attack selection unchanged. Existing frequency
caches remain valid; no source reprocessing is needed for this adjustment.
