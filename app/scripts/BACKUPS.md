Run `python3 app/scripts/backup-user-data.py` from the repository (or invoke the
script by its absolute path). Python 3's standard library is the only requirement.
The default destination is the repository's `backups/` directory; use
`--output /absolute/folder` to change it. Backups are ignored by Git.

Quit VIRA first for a consistent snapshot across files. The script detects a file
changing while it is copied and fails without publishing an incomplete archive.
Each successful ZIP has a local timestamp with UTC offset and is CRC-verified.
Its manifest records original paths, SHA-256 hashes and unavailable locations.
Check those unavailable locations if a collection is on a disconnected drive.

Includes application support settings, instruments, patterns, tags, hot cues,
plugin states, WebKit persistent settings (including MIDI mappings), macOS
preferences, configured and default patch libraries including hidden session and
routing files, patch assets/buffers, saved timing/grids,
analysis approvals, metadata edits and legacy library indexes. Regenerable audio,
waveform and analysis execution caches in `app/generated` are omitted; saved
analysis records are retained because they also contain user approval state.
Application caches, plugin discovery caches, logs and temporary files are omitted.
Source music is not copied; only its saved metadata and folder settings are kept.
Third-party plugin installations are not copied; reinstall those separately.

To restore, quit VIRA, preserve any existing data, and copy the ZIP's `files/`
contents back under `/` following `manifest.json`'s original absolute paths.
Restore to adjusted locations if moving to a different user account, and update
`paths.json` accordingly. Restart VIRA to regenerate caches. The archive contains
personal settings and patch media; keep it somewhere private.
