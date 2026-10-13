# Step 1 verification — 12 October 2026

Scope: native app skeleton and bin listing only. The existing spike sources,
experiments and recorded evidence were preserved. Cross-compiler wrapper scripts,
the small existing window icon, and the tested Tauri dependency versions were
reused in the separate app.

## Docker checks

- React/TypeScript production build passed.
- Four React tests passed: startup metadata, refresh removal reconciliation,
  service-error/retry and stale-table display, disabled refresh while scanning,
  and duration formatting (grouped into four test cases).
- Six Python service tests passed using real FFmpeg-generated temporary MP3/WAV
  files: embedded tags, missing tags without filename splitting, durations,
  corrupt/unsupported isolation, additions/removals/revision changes, PCM-only
  WAV support, direct-child scanning, symlink rejection, probing timeouts,
  source changes mid-scan, missing/empty bin, and HTTP input restrictions.
- Two Rust tests passed: fixed-bin/schema/track validation, path rejection,
  missing duration, incompatible schemas and duplicate IDs.
- Rust formatting check passed. Both dependency lockfiles are included.
- Final npm audit reported zero vulnerabilities in the installed dependency set.
- Docker cross-build of the Apple Silicon macOS Tauri executable succeeded using
  the read-only spike SDK. No host project toolchains were installed.

## Native checks

Ran `output/VIRA.app/Contents/MacOS/vira --scan-library` on macOS against the
Docker service. It returned four ready rows and the fixed absolute bin path.
Metadata read from the supplied MP3s:

| Embedded title | Embedded artist | FFprobe duration (seconds) | Display |
| --- | --- | ---: | --- |
| Ya Mahla | Acid Arab, Wael Alkak | 413.622857 | 6:53 |
| Point Of No Return | Adam Port, Monolink | 283.977143 | 4:43 |
| Miracle | Adriatique, WhoMadeWho | 302.811429 | 5:02 |
| Simplex City | Afriqua | 434.494694 | 7:14 |

Launched the native bundle and visually inspected the dark two-panel shell and
library table on macOS. All titles, original filenames, artists, durations and
unanalysed states were visible; BPM/key were blank. Refresh populated the table.
The initial simultaneous headless/GUI scans also exercised the service's busy
409 response; the next Refresh recovered successfully.

Stopped the Docker service and clicked Refresh in the native window. It displayed
the service startup command and explicitly marked the existing table as the last
successful scan, potentially out of date. Restarted the service and clicked
Refresh: the error cleared and the four rows remained. Quit and relaunched the
bundle with the service running: startup automatically listed all four tracks.
Left the working native app and preparation service running for review.

## Limits

Tag fallbacks, source additions/removals/changes and bad-file handling were
verified with synthetic container fixtures rather than modifying Paulo's music.
The supplied bin has only four readable MP3s. Large-library scan times are not
validated; metadata inspection is serial, with bounded per-file and native
request timeouts. Generated metadata uses size/mtime revisions; content hashes
for analysis/prepared artefacts are deferred to the next steps.

No analysis, PCM preparation, waveform rendering, deck transport or audio stream
exists in this increment. No audio timing, reliability, memory, latency or
musical-accuracy acceptance is claimed. The broader milestone's remaining
acceptance items belong to steps 2–5.
