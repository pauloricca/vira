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


def validate_references(references, duration):
    if not isinstance(references, list) or len(references) > 2 or any(
        isinstance(value, bool) or not isinstance(value, (int, float))
        or not math.isfinite(value) or not 0 <= value < duration
        for value in references
    ):
        raise ValueError("Reference beats must contain at most two positions within the source.")
    return references


class Timing:
    def __init__(self, jobs):
        self.jobs = jobs
        self.root = jobs.generated / "timing"

    def row(self, track_id):
        return self.jobs.identify(track_id)

    def read(self, row):
        stale = False
        # A filename pointer only signals stale corrections; it never reuses them.
        pointer = self.root / ("name-" + hashlib.sha256(row["filename"].encode()).hexdigest() + ".json")
        try:
            stale = json.loads(pointer.read_text())["source_hash"] != row["source_hash"]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        grid = None
        references = []
        try:
            envelope = self.jobs.content.read("timing", row["source_hash"])
            if envelope is None:
                raise FileNotFoundError()
            if envelope["schema_version"] != 1 or envelope["source_hash"] != row["source_hash"]:
                raise ValueError("Incompatible timing")
            grid = validate_grid(envelope["grid"], row["duration_seconds"])
            references = validate_references(envelope.get("reference_beats", []), row["duration_seconds"])
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
                "reference_beats": references,
                "state": "reviewed" if grid and grid["reviewed"] else "draft" if grid else "stale" if stale else "unprepared",
                "suggestion": suggestion}

    def get(self, track_id):
        with self.jobs.lock:
            return self.read(self.row(track_id))

    def save(self, track_id, grid, reference_beats=None):
        with self.jobs.lock:
            row = self.row(track_id)
            validate_grid(grid, row["duration_seconds"])
            references = validate_references(reference_beats if reference_beats is not None else [], row["duration_seconds"])
            self.jobs.content.write("timing", row["source_hash"],
                        {"schema_version": 1, "grid": grid, "reference_beats": references})
            atomic_json(self.root / ("name-" + hashlib.sha256(row["filename"].encode()).hexdigest() + ".json"),
                        {"source_hash": row["source_hash"]})
            return self.read(row)
