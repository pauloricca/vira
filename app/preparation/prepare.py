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
FEATURE_VERSION = 4
FINE_FRAMES = 240 # 5 ms source-time buckets; no PCM in the webview


def artifact_id(digest):
    return hashlib.sha256((digest + CONVERSION_VERSION).encode()).hexdigest()


def spectral_features(path, frames, width):
    """Left-channel power spectra at 5 ms hops; bounded FFT batches."""
    import numpy as np
    pcm = np.memmap(path, dtype="<f4", mode="r", shape=(frames, 2))
    count = math.ceil(frames / FINE_FRAMES)
    features = np.zeros((count, 2), dtype=np.float32)
    window = np.hanning(1024)
    frequencies = np.fft.rfftfreq(1024, 1 / 48000)
    high = frequencies >= 3000
    low = (frequencies >= 40) & (frequencies < 250)
    previous = np.zeros(513)
    envelope = 0.0
    normalization = 1024 * (window ** 2).sum() / 2
    for first in range(0, count, 512):
        centers = np.arange(first, min(first + 512, count)) * FINE_FRAMES
        indices = centers[:, None] + np.arange(1024)[None, :] - 512
        samples = pcm[np.clip(indices, 0, frames - 1), 0].copy()
        samples[(indices < 0) | (indices >= frames)] = 0
        power = np.abs(np.fft.rfft(samples * window[None, :], axis=1)) ** 2
        magnitude = np.sqrt(power)
        for offset, spectrum in enumerate(magnitude):
            total = power[offset].sum()
            rms = np.sqrt(total / normalization)
            presence = np.sqrt(power[offset, high].sum() / max(total, 1e-12))
            # White is reserved for strong bass attacks; treble keeps the deck tint.
            low_power = power[offset, low].sum()
            low_rms = np.sqrt(low_power / normalization)
            flux = np.maximum(spectrum[low] - previous[low], 0).sum() / max(spectrum[low].sum(), 1e-12)
            rise = max(0, low_rms - envelope) / max(low_rms, 1e-6)
            novelty = np.sqrt(max(0, flux - .15) * max(0, rise - .1))
            audible = min(1, max(0, low_rms - .015) / .07)
            bass_weight = min(1, max(0, low_power / max(total, 1e-12) - .08) / .17)
            onset = min(1, novelty * audible * bass_weight * 5.6)
            envelope = max(low_rms, envelope * .92)
            strength = min(1, rms / .12)
            features[first + offset] = [min(1, presence * strength), onset]
            previous = spectrum
    # Keep one 5 ms stroke per attack, with 100 ms separation; avoid white clusters.
    scores = features[:, 1].copy()
    features[:, 1] = 0
    selected = np.zeros(count, dtype=bool)
    candidates = [i for i in range(count) if scores[i] > .35
                  and scores[i] == scores[max(0, i-2):min(count, i+3)].max()]
    for index in sorted(candidates, key=lambda i: (-scores[i], i)):
        if not selected[max(0, index-20):min(count, index+21)].any():
            features[index, 1] = scores[index]
            selected[index] = True
    overview = np.zeros((math.ceil(frames / width), 2), dtype=np.float32)
    buckets = np.minimum(np.arange(count) * FINE_FRAMES // width, len(overview)-1)
    np.maximum.at(overview, buckets, features)
    # A full-track pixel covers many attacks: show attack density rather than a white wall.
    totals = np.bincount(buckets, weights=features[:, 1], minlength=len(overview))
    counts = np.bincount(buckets, minlength=len(overview))
    overview[:, 1] = totals / np.maximum(1, counts)
    return features.tolist(), overview.tolist()


def feature_hash(value):
    data = [value["waveform_feature_version"], value["fine_features"], value["features"]]
    return hashlib.sha256(json.dumps(data, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def valid_features(value, info):
    import numpy as np
    if value.get("waveform_feature_version") != FEATURE_VERSION:
        return False
    for key, length in [("fine_features", len(info["fine_peaks"])), ("features", len(info["peaks"]))]:
        features = np.asarray(value.get(key, []), dtype=float)
        if features.shape != (length, 2) or not np.isfinite(features).all() or (features < 0).any() or (features > 1).any():
            return False
    return value.get("waveform_feature_hash") == feature_hash(value)


def pcm_info(path, include_features=True):
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
    info = {"frames": frames, "duration_seconds": frames / 48000,
            "peak_frames": width, "peaks": peaks.tolist(), "fine_peak_frames": FINE_FRAMES, "fine_peaks": fine.tolist(), "pcm_hash": digest.hexdigest(), "pcm_bytes": length}
    if include_features:
        fine_features, features = spectral_features(path, frames, width)
        info.update(waveform_feature_version=FEATURE_VERSION, fine_features=fine_features, features=features)
        info["waveform_feature_hash"] = feature_hash(info)
    return info


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
                    info = pcm_info(directory / "audio.f32", include_features=False)
                    if all(value[key] == info[key] for key in info):
                        cached = value
                        if not valid_features(value, info):
                            fine_features, features = spectral_features(directory / "audio.f32", info["frames"], info["peak_frames"])
                            cached.update(waveform_feature_version=FEATURE_VERSION, fine_features=fine_features, features=features)
                            cached["waveform_feature_hash"] = feature_hash(cached)
                            atomic_json(manifest, cached)
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
