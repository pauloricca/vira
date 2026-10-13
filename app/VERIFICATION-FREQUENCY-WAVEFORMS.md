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
