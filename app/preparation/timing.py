"""User assertions keyed by content, never written into analysis envelopes."""
import hashlib
import json
import math
try:
    from .jobs import atomic_json, source_hash
except ImportError:
    from jobs import atomic_json, source_hash


def validate_grid(grid, duration):
    if not isinstance(grid, dict) or set(grid) != {"bpm", "downbeat_seconds", "reviewed"}:
        raise ValueError("Timing requires BPM, first downbeat and reviewed state.")
    for key in ("bpm", "downbeat_seconds"):
        if isinstance(grid[key], bool) or not isinstance(grid[key], (float, int)) or not math.isfinite(grid[key]):
            raise ValueError("Timing values must be finite numbers.")
    if not 30 <= grid["bpm"] <= 300:
        raise ValueError("Supported source BPM is 30–300.")
    if not 0 <= grid["downbeat_seconds"] < duration:
        raise ValueError("First downbeat must lie within the source.")
    if not isinstance(grid["reviewed"], bool):
        raise ValueError("Reviewed must be a user assertion.")
    return grid


class Timing:
    def __init__(self, jobs):
        self.jobs = jobs
        self.root = jobs.generated / "timing"

    def row(self, track_id):
        row = self.jobs.rows.get(track_id)
        if not row or row["status"] != "ready":
            raise ValueError("Source unavailable. Refresh the library.")
        digest, _ = source_hash(self.jobs.music / row["filename"])
        if digest != row["source_hash"]:
            raise ValueError("Source changed. Refresh before reviewing timing.")
        return row

    def read(self, row):
        path = self.root / (row["source_hash"] + ".json")
        stale = False
        # A filename pointer only signals stale corrections; it never reuses them.
        pointer = self.root / ("name-" + hashlib.sha256(row["filename"].encode()).hexdigest() + ".json")
        try:
            stale = json.loads(pointer.read_text())["source_hash"] != row["source_hash"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        grid = None
        try:
            envelope = json.loads(path.read_text())
            if envelope["schema_version"] != 1 or envelope["source_hash"] != row["source_hash"]:
                raise ValueError("Incompatible timing")
            grid = validate_grid(envelope["grid"], row["duration_seconds"])
            stale = False
        except FileNotFoundError:
            pass
        except (OSError, ValueError, KeyError, TypeError):
            stale = True
        suggestion = (row.get("analysis", {}).get("result") or {}).get("grid")
        if suggestion:
            suggestion = {"bpm": suggestion["bpm"], "downbeat_seconds": suggestion["offset_seconds"], "reviewed": False}
            try:
                validate_grid(suggestion, row["duration_seconds"])
            except ValueError:
                suggestion = None
        return {"schema_version": 1, "source_hash": row["source_hash"], "grid": grid,
                "state": "reviewed" if grid and grid["reviewed"] else "draft" if grid else "stale" if stale else "unprepared",
                "suggestion": suggestion}

    def get(self, track_id):
        with self.jobs.lock:
            return self.read(self.row(track_id))

    def save(self, track_id, grid):
        with self.jobs.lock:
            row = self.row(track_id)
            validate_grid(grid, row["duration_seconds"])
            atomic_json(self.root / (row["source_hash"] + ".json"),
                        {"schema_version": 1, "source_hash": row["source_hash"], "grid": grid})
            atomic_json(self.root / ("name-" + hashlib.sha256(row["filename"].encode()).hexdigest() + ".json"),
                        {"source_hash": row["source_hash"]})
            return self.read(row)
