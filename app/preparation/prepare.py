"""Full-track stereo playback preparation, independent of musical analysis."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import threading
try:
    from .jobs import source_hash, atomic_json
except ImportError:
    from jobs import source_hash, atomic_json

CONVERSION_VERSION = "ffmpeg-stereo-f32le-48000-v1"
SETTINGS = {"sample_rate": 48000, "channels": 2, "format": "f32le"}
PEAK_BINS = 1024
FINE_FRAMES = 240 # 5 ms source-time buckets; no PCM in the webview


def artifact_id(digest):
    return hashlib.sha256((digest + CONVERSION_VERSION).encode()).hexdigest()


def pcm_info(path):
    import numpy as np
    length = path.stat().st_size
    if not length or length % 8:
        raise ValueError("Prepared audio is empty or has incomplete stereo frames.")
    frames = length // 8
    width = max(1, math.ceil(frames / PEAK_BINS))
    peaks = np.zeros((math.ceil(frames / width), 2), dtype=np.float32)
    fine = np.zeros((math.ceil(frames / FINE_FRAMES), 2), dtype=np.float32)
    digest = hashlib.sha256()
    position = 0
    with path.open("rb") as handle:
        while block := handle.read(65536):
            digest.update(block)
            values = np.frombuffer(block, dtype="<f4").reshape(-1, 2)
            if not np.isfinite(values).all():
                raise ValueError("Prepared audio contains non-finite samples.")
            buckets = (np.arange(len(values)) + position) // width
            np.maximum.at(peaks, buckets, np.abs(values))
            np.maximum.at(fine, (np.arange(len(values)) + position) // FINE_FRAMES, np.abs(values))
            position += len(values)
    return {"frames": frames, "duration_seconds": frames / 48000,
            "peak_frames": width, "peaks": peaks.tolist(), "fine_peak_frames": FINE_FRAMES, "fine_peaks": fine.tolist(), "pcm_hash": digest.hexdigest(), "pcm_bytes": length}


class Preparation:
    def __init__(self, jobs):
        self.jobs = jobs
        # Serial decoding bounds temporary storage/CPU; analysis has its own worker.
        self.lock = threading.Lock()
        self.root = jobs.generated / "prepared"

    def source_matches(self, row):
        digest, stat = source_hash(self.jobs.music / row["filename"])
        if digest != row["source_hash"] or (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
            raise ValueError("Source changed. Refresh the library before loading.")

    def prepare(self, track_id):
        with self.jobs.lock:
            row = self.jobs.rows.get(track_id)
            if not row or row["status"] != "ready":
                raise ValueError("Track is unavailable. Refresh the library.")
            row = dict(row)
        with self.lock:
            self.source_matches(row)
            identity = artifact_id(row["source_hash"])
            directory = self.root / identity
            manifest = directory / "manifest.json"
            cached = None
            try:
                value = json.loads(manifest.read_text())
                if value["schema_version"] == 1 and value["artifact_id"] == identity and value["conversion_version"] == CONVERSION_VERSION and value["source_hash"] == row["source_hash"] and value["settings"] == SETTINGS:
                    info = pcm_info(directory / "audio.f32")
                    if all(value[key] == info[key] for key in info):
                        cached = value
            except (OSError, ValueError, KeyError, TypeError):
                pass
            if cached is None:
                self.root.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory(prefix="prepare-", dir=self.root) as temporary:
                    work = Path(temporary)
                    snapshot = work / ("source" + Path(row["filename"]).suffix)
                    with snapshot.open("wb") as handle:
                        digest, stat = source_hash(self.jobs.music / row["filename"], handle)
                    if digest != row["source_hash"] or str(stat.st_mtime_ns) != row["modified_ns"]:
                        raise ValueError("Source changed before decoding. Refresh and retry.")
                    pcm = work / "audio.f32"
                    try:
                        subprocess.run(["ffmpeg", "-v", "error", "-protocol_whitelist", "file", "-i", str(snapshot),
                                        "-f", "f32le", "-ac", "2", "-ar", "48000", str(pcm)],
                                       check=True, capture_output=True, timeout=120)
                    except subprocess.TimeoutExpired as exc:
                        raise ValueError("Audio preparation timed out. Retry loading the file.") from exc
                    except subprocess.CalledProcessError as exc:
                        raise ValueError("Cannot decode this source for playback.") from exc
                    cached = {"schema_version": 1, "conversion_version": CONVERSION_VERSION,
                              "settings": SETTINGS, "source_hash": row["source_hash"], "artifact_id": identity,
                              **pcm_info(pcm)}
                    self.source_matches(row)
                    directory.mkdir(parents=True, exist_ok=True)
                    # Audio before manifest: interrupted conversion can never be a valid cache entry.
                    pcm.replace(directory / "audio.f32")
                    atomic_json(manifest, cached)
            self.source_matches(row)
            with self.jobs.lock:
                if track_id not in self.jobs.rows:
                    raise ValueError("Source revision was superseded while preparing. Refresh and retry.")
            return {**cached, "track_id": track_id, "title": row["title"], "artist": row["artist"], "filename": row["filename"]}

    def audio_path(self, identity):
        if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
            raise ValueError("Invalid prepared audio ID.")
        directory = self.root / identity
        value = json.loads((directory / "manifest.json").read_text())
        if value["artifact_id"] != identity or value["conversion_version"] != CONVERSION_VERSION:
            raise ValueError("Prepared audio version mismatch.")
        path = directory / "audio.f32"
        if path.stat().st_size != value["pcm_bytes"]:
            raise ValueError("Prepared audio is incomplete. Retry loading the file.")
        return path
