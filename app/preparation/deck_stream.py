"""Cheap deck bootstrap and retention of PCM decoded by progressive loading."""
import hashlib
import json
import math
from pathlib import Path
try:
    from .jobs import atomic_json
    from .prepare import artifact_id, conversion_version, valid_pcm
    from .timing import Timing
except ImportError:
    from jobs import atomic_json
    from prepare import artifact_id, conversion_version, valid_pcm
    from timing import Timing


def open_deck(preparation, body):
    if (not isinstance(body, dict) or set(body) != {"track_id", "deck", "generation", "sample_rate"}
            or not isinstance(body["track_id"], str) or len(body["track_id"]) != 64
            or any(c not in "0123456789abcdef" for c in body["track_id"])
            or type(body["deck"]) is not int or body["deck"] not in (0, 1)
            or type(body["generation"]) is not int or body["generation"] < 1
            or type(body["sample_rate"]) is not int or not 44100 <= body["sample_rate"] <= 192000):
        raise ValueError("Invalid progressive deck request.")
    row, path = preparation.jobs.source(body["track_id"])
    stat = path.stat()
    if path.is_symlink() or (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
        raise ValueError("Source changed. Refresh the library before loading.")
    with preparation.requests_lock:
        if body["generation"] < preparation.requests[body["deck"]]:
            raise ValueError("Load superseded by a newer selection")
        preparation.requests[body["deck"]] = body["generation"]
    rate = body["sample_rate"]
    frames = math.ceil(row["duration_seconds"] * rate)
    if not 0 < frames <= rate * 14400:
        raise ValueError("Track exceeds the four-hour playback limit.")
    digest = row.get("source_hash") or row["id"]
    grid = Timing(preparation.jobs).read(row) if row.get("source_hash") else {"grid": None, "suggestion": None}
    return dict(schema_version=1, conversion_version=conversion_version(rate),
                settings={"sample_rate": rate, "channels": 2, "format": "f32le"},
                source_hash=digest, identity_pending=not bool(row.get("source_hash")), artifact_id=artifact_id(digest, rate),
                track_id=row["id"], title=row["title"], artist=row["artist"], filename=row["filename"],
                frames=frames, duration_seconds=frames / rate, pcm_bytes=frames * 8, pcm_hash="0" * 64,
                progressive=True, loaded_frames=0, waveform_revision=0,
                grid=None if grid.get("state") == "stale" else grid["grid"] or grid["suggestion"])


def retain_stream(preparation, track, rate, path, frames, digest):
    row = preparation.jobs.identify(track)
    identity = artifact_id(row["source_hash"], rate)
    directory = preparation.root / identity
    value = dict(schema_version=1, conversion_version=conversion_version(rate),
                 settings={"sample_rate": rate, "channels": 2, "format": "f32le"},
                 source_hash=row["source_hash"], artifact_id=identity, frames=frames,
                 duration_seconds=frames / rate, pcm_bytes=frames * 8, pcm_hash=digest)
    with preparation.lock:
        directory.mkdir(parents=True, exist_ok=True)
        # Existing valid manifests may already contain expensive waveform features.
        import json
        try:
            previous = json.loads((directory / "manifest.json").read_text())
            if previous.get("pcm_hash") == digest and (directory / "audio.f32").stat().st_size == frames * 8:
                return
        except (OSError, ValueError, TypeError):
            pass
        Path(path).replace(directory / "audio.f32")
        atomic_json(directory / "manifest.json", value)


def stream_cached(handler, preparation, row, rate):
    if not row.get("source_hash"):
        return False
    identity = artifact_id(row["source_hash"], rate)
    directory = preparation.root / identity
    path = directory / "audio.f32"
    try:
        manifest = json.loads((directory / "manifest.json").read_text())
        if (manifest.get("source_hash") != row["source_hash"] or manifest.get("artifact_id") != identity
                or manifest.get("conversion_version") != conversion_version(rate) or not valid_pcm(manifest, path, rate)):
            return False
    except (OSError, ValueError, KeyError, TypeError):
        return False
    # Integrity is checked incrementally by native loading against the completed
    # descriptor. Serving cached PCM requires neither FFmpeg nor an up-front hash.
    handler.protocol_version = "HTTP/1.1"
    handler.send_response(200)
    handler.send_header("Content-Type", "application/octet-stream")
    handler.send_header("X-Vira-Duration-Seconds", str(manifest["duration_seconds"]))
    handler.send_header("Transfer-Encoding", "chunked")
    handler.send_header("Connection", "close")
    handler.end_headers()
    handler.close_connection = True
    with path.open("rb") as pcm:
        while block := pcm.read(65536):
            handler.wfile.write(f"{len(block):x}\r\n".encode() + block + b"\r\n")
    handler.wfile.write(b"0\r\n\r\n")
    return True
