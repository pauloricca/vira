"""Full-track stereo playback preparation, independent of musical analysis."""
import hashlib
import json
import math
from pathlib import Path
import subprocess
import tempfile
import threading
import time
try:
    from .jobs import source_hash, atomic_json
except ImportError:
    from jobs import source_hash, atomic_json

CONVERSION_VERSION = "ffmpeg-stereo-f32le-48000-v1"
SETTINGS = {"sample_rate": 48000, "channels": 2, "format": "f32le"}
PEAK_BINS = 1024
FEATURE_VERSION = 4
FINE_FRAMES = 240 # 5 ms source-time buckets; no PCM in the webview


def conversion_version(sample_rate):
    return f"ffmpeg-stereo-f32le-{sample_rate}-v1"


def fine_frames(sample_rate):
    return int(sample_rate * .005 + .5)


def artifact_id(digest, sample_rate=48000):
    return hashlib.sha256((digest + conversion_version(sample_rate)).encode()).hexdigest()


def spectral_features(path, frames, width, current=lambda: True, sample_rate=48000):
    """Left-channel power spectra at 5 ms hops; bounded FFT batches."""
    import numpy as np
    pcm = np.memmap(path, dtype="<f4", mode="r", shape=(frames, 2))
    count = math.ceil(frames / fine_frames(sample_rate))
    features = np.zeros((count, 2), dtype=np.float32)
    window = np.hanning(1024)
    frequencies = np.fft.rfftfreq(1024, 1 / sample_rate)
    high = frequencies >= 3000
    low = (frequencies >= 40) & (frequencies < 250)
    previous = np.zeros(513)
    envelope = 0.0
    normalization = 1024 * (window ** 2).sum() / 2
    for first in range(0, count, 512):
        if not current():
            raise ValueError("Load superseded by a newer selection")
        centers = np.arange(first, min(first + 512, count)) * fine_frames(sample_rate)
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
    buckets = np.minimum(np.arange(count) * fine_frames(sample_rate) // width, len(overview)-1)
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


def valid_pcm(value, path, sample_rate=48000):
    try:
        length = path.stat().st_size
        return (length > 0 and length % 8 == 0 and value["pcm_bytes"] == length
                and value["frames"] == length // 8
                and value["duration_seconds"] == value["frames"] / sample_rate
                and isinstance(value["pcm_hash"], str) and len(value["pcm_hash"]) == 64
                and all(c in "0123456789abcdef" for c in value["pcm_hash"]))
    except (OSError, KeyError, TypeError):
        return False


def audio_info(path, sample_rate=48000):
    """Audition needs PCM integrity and duration, with no waveform or FFT work."""
    import numpy as np
    length = path.stat().st_size
    if not length or length % 8:
        raise ValueError("Prepared audio is empty or has incomplete stereo frames.")
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(65536):
            if not np.isfinite(np.frombuffer(block, dtype="<f4")).all():
                raise ValueError("Prepared audio contains non-finite samples.")
            digest.update(block)
    return dict(frames=length // 8, duration_seconds=length / 8 / sample_rate,
                pcm_bytes=length, pcm_hash=digest.hexdigest())


def valid_cached_audio(value, path, sample_rate=48000):
    """Check the descriptor without rereading or recomputing the prepared PCM."""
    try:
        length = path.stat().st_size
        frames = value["frames"]
        width = value["peak_frames"]
        if (not length or length % 8 or value["pcm_bytes"] != length
                or frames != length // 8 or width != max(1, math.ceil(frames / PEAK_BINS))
                or value["fine_peak_frames"] != fine_frames(sample_rate)
                or len(value["peaks"]) != math.ceil(frames / width)
                or len(value["fine_peaks"]) != math.ceil(frames / fine_frames(sample_rate))
                or not isinstance(value["pcm_hash"], str) or len(value["pcm_hash"]) != 64
                or any(c not in "0123456789abcdef" for c in value["pcm_hash"])):
            return False
        return all(isinstance(pair, list) and len(pair) == 2
                   and all(isinstance(sample, (int, float)) and math.isfinite(sample) and sample >= 0 for sample in pair)
                   for key in ("peaks", "fine_peaks") for pair in value[key])
    except (OSError, ValueError, KeyError, TypeError):
        return False


def pcm_info(path, include_features=True, current=lambda: True, sample_rate=48000):
    import numpy as np
    length = path.stat().st_size
    if not length or length % 8:
        raise ValueError("Prepared audio is empty or has incomplete stereo frames.")
    frames = length // 8
    width = max(1, math.ceil(frames / PEAK_BINS))
    peaks = np.zeros((math.ceil(frames / width), 2), dtype=np.float32)
    fine = np.zeros((math.ceil(frames / fine_frames(sample_rate)), 2), dtype=np.float32)
    digest = hashlib.sha256()
    position = 0
    with path.open("rb") as handle:
        while block := handle.read(65536):
            if not current():
                raise ValueError("Load superseded by a newer selection")
            digest.update(block)
            values = np.frombuffer(block, dtype="<f4").reshape(-1, 2)
            if not np.isfinite(values).all():
                raise ValueError("Prepared audio contains non-finite samples.")
            buckets = (np.arange(len(values)) + position) // width
            np.maximum.at(peaks, buckets, np.abs(values))
            np.maximum.at(fine, (np.arange(len(values)) + position) // fine_frames(sample_rate), np.abs(values))
            position += len(values)
    info = {"frames": frames, "duration_seconds": frames / sample_rate,
            "peak_frames": width, "peaks": peaks.tolist(), "fine_peak_frames": fine_frames(sample_rate), "fine_peaks": fine.tolist(), "pcm_hash": digest.hexdigest(), "pcm_bytes": length}
    if include_features:
        fine_features, features = spectral_features(path, frames, width, current, sample_rate)
        info.update(waveform_feature_version=FEATURE_VERSION, fine_features=fine_features, features=features)
        info["waveform_feature_hash"] = feature_hash(info)
    return info


class Preparation:
    def __init__(self, jobs):
        self.jobs = jobs
        # Serial decoding bounds temporary storage/CPU; analysis has its own worker.
        self.lock = threading.Lock()
        self.requests_lock = threading.Lock()
        self.requests = [0, 0]
        self.root = jobs.generated / "prepared"

    def source_matches(self, row):
        digest, stat = source_hash(self.jobs.music / row["filename"])
        if digest != row["source_hash"] or (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
            raise ValueError("Source changed. Refresh the library before loading.")

    def complete(self, deck, generation):
        with self.requests_lock:
            if self.requests[deck] == generation:
                self.requests[deck] = 0

    def prepare(self, track_id, deck=None, generation=None, audition=False, sample_rate=48000):
        if type(sample_rate) is not int or not 44100 <= sample_rate <= 192000:
            raise ValueError("Sample rate must be an integer between 44100 and 192000 Hz.")
        version = conversion_version(sample_rate)
        settings = {**SETTINGS, "sample_rate": sample_rate}
        if deck is not None:
            with self.requests_lock:
                if generation < self.requests[deck]:
                    raise ValueError("Load superseded by a newer selection")
                self.requests[deck] = generation
        def current():
            if deck is None:
                return True
            with self.requests_lock:
                return self.requests[deck] == generation
        with self.jobs.lock:
            row = self.jobs.rows.get(track_id)
            if not row or row["status"] != "ready":
                raise ValueError("Track is unavailable. Refresh the library.")
            row = dict(row)
        with self.lock:
            if not current():
                raise ValueError("Load superseded by a newer selection")
            # Resolve content once on use, restoring saved analysis before timing is read.
            row = self.jobs.identify(track_id)
            identity = artifact_id(row["source_hash"], sample_rate)
            directory = self.root / identity
            manifest = directory / "manifest.json"
            cached = None
            try:
                value = json.loads(manifest.read_text())
                if value["schema_version"] == 1 and value["artifact_id"] == identity and value["conversion_version"] == version and value["source_hash"] == row["source_hash"] and value["settings"] == settings:
                    if valid_pcm(value, directory / "audio.f32", sample_rate):
                        cached = value
                        if not audition and not valid_cached_audio(value, directory / "audio.f32", sample_rate):
                            cached.update(pcm_info(directory / "audio.f32", current=current, sample_rate=sample_rate))
                            atomic_json(manifest, cached)
                        if not audition and not valid_features(value, value):
                            fine_features, features = spectral_features(directory / "audio.f32", value["frames"], value["peak_frames"], current, sample_rate)
                            cached.update(waveform_feature_version=FEATURE_VERSION, fine_features=fine_features, features=features)
                            cached["waveform_feature_hash"] = feature_hash(cached)
                            atomic_json(manifest, cached)
            except (OSError, ValueError, KeyError, TypeError):
                pass
            if not current():
                raise ValueError("Load superseded by a newer selection")
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
                    if not current():
                        raise ValueError("Load superseded by a newer selection")
                    try:
                        command = ["ffmpeg", "-v", "error", "-protocol_whitelist", "file", "-i", str(snapshot),
                                   "-f", "f32le", "-ac", "2", "-ar", str(sample_rate), str(pcm)]
                        if deck is None:
                            subprocess.run(command, check=True, capture_output=True, timeout=120)
                        else:
                            with subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
                                deadline = time.monotonic() + 120
                                while process.poll() is None:
                                    if not current():
                                        process.terminate()
                                        process.wait()
                                        raise ValueError("Load superseded by a newer selection")
                                    if time.monotonic() > deadline:
                                        process.kill()
                                        process.wait()
                                        raise subprocess.TimeoutExpired(process.args, 120)
                                    time.sleep(.05)
                                if process.returncode:
                                    raise subprocess.CalledProcessError(process.returncode, process.args)
                    except subprocess.TimeoutExpired as exc:
                        raise ValueError("Audio preparation timed out. Retry loading the file.") from exc
                    except subprocess.CalledProcessError as exc:
                        raise ValueError("Cannot decode this source for playback.") from exc
                    cached = {"schema_version": 1, "conversion_version": version,
                              "settings": settings, "source_hash": row["source_hash"], "artifact_id": identity,
                              **(audio_info(pcm, sample_rate) if audition else pcm_info(pcm, current=current, sample_rate=sample_rate))}
                    if not current():
                        raise ValueError("Load superseded by a newer selection")
                    self.source_matches(row)
                    directory.mkdir(parents=True, exist_ok=True)
                    # Audio before manifest: interrupted conversion can never be a valid cache entry.
                    pcm.replace(directory / "audio.f32")
                    atomic_json(manifest, cached)
            self.source_matches(row)
            if not current():
                raise ValueError("Load superseded by a newer selection")
            with self.jobs.lock:
                if track_id not in self.jobs.rows:
                    raise ValueError("Source revision was superseded while preparing. Refresh and retry.")
            if audition:
                cached = {key: cached[key] for key in ("schema_version", "conversion_version", "settings", "source_hash", "artifact_id", "frames", "duration_seconds", "pcm_bytes", "pcm_hash")}
            return {**cached, "track_id": track_id, "title": row["title"], "artist": row["artist"], "filename": row["filename"]}

    def audio_path(self, identity):
        if len(identity) != 64 or any(c not in "0123456789abcdef" for c in identity):
            raise ValueError("Invalid prepared audio ID.")
        directory = self.root / identity
        value = json.loads((directory / "manifest.json").read_text())
        if value["artifact_id"] != identity or value["conversion_version"] != conversion_version(value["settings"]["sample_rate"]):
            raise ValueError("Prepared audio version mismatch.")
        path = directory / "audio.f32"
        if path.stat().st_size != value["pcm_bytes"]:
            raise ValueError("Prepared audio is incomplete. Retry loading the file.")
        return path
