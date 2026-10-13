"""Serial analysis queue and versioned per-source persistence, off the UI thread."""
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import subprocess
import sys
import tempfile
import threading
import uuid

# Kept here too so the HTTP service never imports the numerical toolchain.
ANALYZER_VERSION = "librosa-0.11.0-poc-v3-attack-phase"
ANALYSIS_SCHEMA = 1
LIBRARY_SCHEMA = 2
MAX_PENDING = 32


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False, encoding="utf-8") as handle:
            name = handle.name
            json.dump(value, handle, ensure_ascii=False, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def source_hash(path, snapshot=None):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Source is unavailable or a symbolic link. Refresh the library.")
    before = path.stat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
            if snapshot:
                snapshot.write(block)
    after = path.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise ValueError("Source changed while reading. Refresh and retry.")
    return digest.hexdigest(), after


def blank(state="not_analysed", error=None):
    return {"state": state, "result": None, "error": error}


def validate_result(result):
    # Fail a malformed worker/cache locally instead of publishing broken estimates.
    if not isinstance(result, dict) or not isinstance(result.get("flags"), list):
        raise ValueError("Invalid analysis result.")
    for key in ("beats_seconds", "keys", "window_keys"):
        if not isinstance(result.get(key), list):
            raise ValueError("Invalid analysis result.")
    def number(value):
        return type(value) in (int, float) and math.isfinite(value)
    if not all(isinstance(flag, str) for flag in result["flags"]):
        raise ValueError("Invalid analysis flags.")
    if not all(number(beat) and beat >= 0 for beat in result["beats_seconds"]):
        raise ValueError("Invalid detected beats.")
    if result["beats_seconds"] != sorted(result["beats_seconds"]):
        raise ValueError("Detected beats are not ordered.")
    if "tempo_alternatives" in result and (not isinstance(result["tempo_alternatives"], list)
            or not all(number(bpm) and bpm > 0 for bpm in result["tempo_alternatives"])):
        raise ValueError("Invalid tempo alternatives.")
    grid = result.get("grid")
    if grid is not None:
        if not isinstance(grid, dict):
            raise ValueError("Invalid grid diagnostics.")
        for key in ("bpm", "offset_seconds", "residual_p95_ms", "end_minus_start_residual_ms", "tempo_spread_percent"):
            if not number(grid.get(key)):
                raise ValueError("Invalid grid diagnostics.")
        if grid["bpm"] <= 0:
            raise ValueError("Invalid fitted BPM.")
        if not isinstance(grid.get("thirds_bpm"), list) or not all(number(bpm) and bpm > 0 for bpm in grid["thirds_bpm"]):
            raise ValueError("Invalid local tempo diagnostics.")
    for candidate in result["keys"]:
        if not isinstance(candidate, dict) or not isinstance(candidate.get("key"), str) or not number(candidate.get("correlation")):
            raise ValueError("Invalid key candidate.")
    json.dumps(result, allow_nan=False)
    return result


def run_analysis(snapshot, work):
    result_path = work / "result.json"
    try:
        subprocess.run([sys.executable, str(Path(__file__).with_name("analysis_worker.py")),
                        "--input", str(snapshot), "--output", str(result_path)],
                       check=True, capture_output=True, timeout=600)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Analysis timed out after ten minutes. Retry the selected file.") from exc
    except subprocess.CalledProcessError as exc:
        # Keep numerical tracebacks in service logs, with concise row-local errors.
        print(exc.stderr.decode(errors="replace")[-4000:], file=sys.stderr, flush=True)
        raise ValueError("Analysis could not decode or process this file. Retry or inspect service logs.") from exc
    return validate_result(json.loads(result_path.read_text(encoding="utf-8")))


class LibraryJobs:
    def __init__(self, music, generated, analyzer=run_analysis, capacity=MAX_PENDING):
        self.music, self.generated, self.analyzer = music, generated, analyzer
        self.lock = threading.RLock()
        self.rows = {}
        self.revision = 0
        self.instance_id = uuid.uuid4().hex
        self.pending = queue.Queue(capacity)
        self.tokens = {}
        self.worker = threading.Thread(target=self._work, daemon=True, name="serial-analysis")
        self.worker.start()

    def cache_path(self, filename):
        return self.generated / "analysis" / (hashlib.sha256(filename.encode()).hexdigest() + ".json")

    def cached(self, row):
        path = self.cache_path(row["filename"])
        if not path.exists():
            return blank()
        try:
            envelope = json.loads(path.read_text(encoding="utf-8"))
            if (envelope["schema_version"] != ANALYSIS_SCHEMA or envelope["analyzer_version"] != ANALYZER_VERSION
                    or envelope["source"] != self.identity(row)):
                return blank("stale", "Source or analyzer version changed. Reanalyse this file.")
            analysis = envelope["analysis"]
            if analysis["state"] in ("queued", "analysing"):
                return blank("failed", "Analysis was interrupted by a service restart. Retry this file.")
            if analysis["state"] in ("analysed", "needs_review"):
                validate_result(analysis["result"])
            elif analysis["state"] != "failed":
                raise ValueError("Invalid cached state")
            elif not isinstance(analysis.get("error"), str) or analysis.get("result") is not None:
                raise ValueError("Invalid cached failure")
            return analysis
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return blank("stale", "Cached analysis is unreadable or incompatible. Reanalyse this file.")

    @staticmethod
    def identity(row):
        return {key: row[key] for key in ("id", "filename", "size_bytes", "modified_ns", "source_hash")}

    def persist(self, row):
        atomic_json(self.cache_path(row["filename"]), {
            "schema_version": ANALYSIS_SCHEMA, "analyzer_version": ANALYZER_VERSION,
            "source": self.identity(row), "analysis": row["analysis"]})

    def reconcile(self, tracks):
        # Hash outside the state lock; HTTP state polling remains cheap during scans.
        for row in tracks:
            row["source_hash"] = None
            if row["status"] == "ready":
                try:
                    digest, stat = source_hash(self.music / row["filename"])
                    if (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
                        raise ValueError("File changed during scanning. Refresh to retry.")
                    row["source_hash"] = digest
                    row["id"] = hashlib.sha256(json.dumps([row["filename"], row["size_bytes"], row["modified_ns"], digest]).encode()).hexdigest()
                except (OSError, ValueError) as exc:
                    row.update(status="unreadable", error=str(exc))
        with self.lock:
            previous = self.rows
            self.rows = {}
            for row in tracks:
                old = previous.get(row["id"])
                row["analysis"] = copy.deepcopy(old["analysis"]) if old else self.cached(row)
                self.rows[row["id"]] = row
            self.revision += 1
            return self.state()

    def state(self):
        with self.lock:
            return {"schema_version": LIBRARY_SCHEMA, "revision": self.revision, "instance_id": self.instance_id,
                    "tracks": copy.deepcopy(list(self.rows.values()))}

    def request(self, track_id):
        with self.lock:
            row = self.rows.get(track_id)
            if not row or row["status"] != "ready":
                raise ValueError("Track is unavailable or has changed. Refresh the library.")
            if row["analysis"]["state"] in ("queued", "analysing"):
                return self.state()  # Same unchanged source has at most one active job.
            if self.pending.full():
                raise ValueError("Analysis queue is full. Wait for a job to finish and retry.")
            old = row["analysis"]
            row["analysis"] = blank("queued")
            try:
                self.persist(row)
            except OSError:
                row["analysis"] = old
                raise ValueError("Cannot save analysis job. Check the generated-data mount.")
            token = self.tokens.get(track_id, 0) + 1
            self.tokens[track_id] = token
            self.pending.put_nowait((copy.deepcopy(row), token))
            self.revision += 1
            return self.state()

    def _current(self, row, token):
        return self.rows.get(row["id"]) if self.tokens.get(row["id"]) == token else None

    def _work(self):
        while True:
            item = self.pending.get()
            try:
                if item is None:
                    return
                self._analyze(*item)
            except Exception as exc:
                print(f"Analysis worker error: {exc}", file=sys.stderr, flush=True)
            finally:
                self.pending.task_done()

    def _analyze(self, requested, token):
        with self.lock:
            row = self._current(requested, token)
            if not row:
                return  # Removed/superseded before the job started.
            row["analysis"] = blank("analysing")
            self.revision += 1
        result, failure = None, None
        try:
            with tempfile.TemporaryDirectory(prefix="vira-analysis-") as directory:
                work = Path(directory)
                snapshot = work / ("source" + Path(requested["filename"]).suffix)
                with snapshot.open("wb") as handle:
                    digest, stat = source_hash(self.music / requested["filename"], handle)
                if digest != requested["source_hash"] or (stat.st_size, str(stat.st_mtime_ns)) != (requested["size_bytes"], requested["modified_ns"]):
                    raise ValueError("Source changed before analysis. Refresh and retry.")
                result = validate_result(self.analyzer(snapshot, work))
        except Exception as exc:
            failure = str(exc) or "Analysis failed. Retry this file."
        # Check again even without Refresh: never publish a result for changed content.
        unchanged = False
        try:
            digest, stat = source_hash(self.music / requested["filename"])
            unchanged = digest == requested["source_hash"] and (stat.st_size, str(stat.st_mtime_ns)) == (requested["size_bytes"], requested["modified_ns"])
        except (OSError, ValueError):
            pass
        with self.lock:
            row = self._current(requested, token)
            if not row:
                return  # Late completions cannot overwrite a newer revision/cache.
            if not unchanged:
                row["analysis"] = blank("stale", "Source changed or was removed during analysis. Refresh and reanalyse.")
            elif failure:
                row["analysis"] = blank("failed", failure)
            else:
                # The baseline's universal advisory flag does not mean a fitting
                # failure. Other ambiguity/fit flags select Needs review.
                review = set(result["flags"]) - {"metrical_level_and_phase_unverified"}
                row["analysis"] = {"state": "needs_review" if review else "analysed", "error": None, "result": result}
            try:
                self.persist(row)
            except OSError:
                row["analysis"] = blank("failed", "Cannot persist analysis. Check the generated-data mount and retry.")
            self.revision += 1

    def close(self):
        self.pending.join()
        self.pending.put(None)
        self.worker.join(timeout=5)
