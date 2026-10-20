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
import time
import uuid

# Kept here too so the HTTP service never imports the numerical toolchain.
ANALYZER_VERSION = "librosa-0.11.0-poc-v5-genre-tempo"
ANALYSIS_SCHEMA = 1
LIBRARY_SCHEMA = 2
MAX_PENDING = 32


def compatible_analysis(envelope):
    return isinstance(envelope, dict) and envelope.get("schema_version") == ANALYSIS_SCHEMA


def saved_analysis(envelope):
    analysis = envelope["analysis"]
    if envelope.get("analyzer_version") != ANALYZER_VERSION and analysis["state"] != "approved":
        return {**analysis, "state": "stale", "error": None}
    return analysis


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


def run_analysis(snapshot, work, key_only=False):
    result_path = work / "result.json"
    try:
        subprocess.run(["nice", "-n", "10", sys.executable, str(Path(__file__).with_name("analysis_worker.py")),
                        "--input", str(snapshot), "--output", str(result_path), *(["--key-only"] if key_only else [])],
                       check=True, capture_output=True, timeout=600)
    except subprocess.TimeoutExpired as exc:
        raise ValueError("Analysis timed out after ten minutes. Retry the selected file.") from exc
    except subprocess.CalledProcessError as exc:
        # Keep numerical tracebacks in service logs, with concise row-local errors.
        print(exc.stderr.decode(errors="replace")[-4000:], file=sys.stderr, flush=True)
        raise ValueError("Analysis could not decode or process this file. Retry or inspect service logs.") from exc
    return validate_result(json.loads(result_path.read_text(encoding="utf-8")))


def entry_id(row):
    # Row identity is cheap and location-specific; content identity is resolved on demand.
    return hashlib.sha256(json.dumps([row["filename"], row["size_bytes"], row["modified_ns"]], ensure_ascii=False).encode()).hexdigest()


class ContentStore:
    """Shared saved work, looked up only when a track is used or analysed."""
    def __init__(self, generated):
        self.generated = generated
        self.root = generated / "content"
        self.lock = threading.RLock()
        self.legacy = None

    def index_legacy(self):
        # This reads saved metadata, never source audio, and never runs during a scan.
        index = {}
        roots = [self.generated, *sorted((self.generated / "libraries").glob("*"))]
        for root in roots:
            for kind in ("analysis", "timing"):
                for path in (root / kind).glob("*.json"):
                    try:
                        value = json.loads(path.read_text())
                        digest = value.get("source_hash") or value.get("source", {}).get("source_hash")
                        if not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
                            continue
                        if kind == "analysis":
                            if not compatible_analysis(value):
                                continue
                            analysis = value["analysis"]
                            if analysis["state"] not in ("analysed", "needs_review", "approved", "stale"):
                                continue
                            validate_result(analysis["result"])
                            value = {**value, "analysis": saved_analysis(value)}
                        elif value.get("schema_version") != 1 or not isinstance(value.get("grid"), dict):
                            continue
                        value = {**value, "source_hash": digest, "saved_ns": value.get("saved_ns", path.stat().st_mtime_ns)}
                        key = (kind, digest)
                        if key not in index or value["saved_ns"] > index[key]["saved_ns"]:
                            index[key] = value
                    except (OSError, ValueError, KeyError, TypeError, AttributeError):
                        continue
        self.legacy = index

    def read(self, kind, digest):
        with self.lock:
            path = self.root / kind / (digest + ".json")
            try:
                value = json.loads(path.read_text())
                if not isinstance(value, dict):
                    value = None
            except (OSError, ValueError, TypeError):
                value = None
            if self.legacy is None:
                self.index_legacy()
            legacy = self.legacy.get((kind, digest))
            if legacy and (value is None or legacy["saved_ns"] > value.get("saved_ns", 0)):
                # Preserve the original save time. Recognition is never a new edit.
                value = legacy
                atomic_json(path, value)
            return copy.deepcopy(value)

    def write(self, kind, digest, value):
        with self.lock:
            value = {**value, "source_hash": digest, "saved_ns": value.get("saved_ns", time.time_ns())}
            path = self.root / kind / (digest + ".json")
            try:
                current = json.loads(path.read_text())
                if current.get("saved_ns", 0) > value["saved_ns"]:
                    return current
            except (OSError, ValueError, TypeError, AttributeError):
                pass
            atomic_json(path, value)
            return value


class LibraryJobs:
    def __init__(self, music, generated, analyzer=run_analysis, capacity=MAX_PENDING, namespace="", content=None):
        self.background = lambda: None
        self.music, self.generated, self.analyzer = music, generated, analyzer
        self.namespace = namespace
        self.content = content if content is not None else ContentStore(generated)
        self.lock = threading.RLock()
        self.rows = {}
        try:
            self.metadata = json.loads((generated / "metadata.json").read_text())
            if not isinstance(self.metadata, dict):
                self.metadata = {}
        except (OSError, ValueError):
            self.metadata = {}
        self.revision = 0
        self.instance_id = uuid.uuid4().hex
        self.scan_pending = False
        self.scan_error = None
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
            if (not compatible_analysis(envelope)
                    or any(envelope["source"].get(key) != row[key] for key in ("filename", "size_bytes", "modified_ns"))
                    or (row.get("source_hash") is not None and envelope["source"].get("source_hash") != row["source_hash"])):
                return blank("stale", "Source or analyzer version changed. Reanalyse this file.")
            analysis = envelope["analysis"]
            if envelope.get("analyzer_version") != ANALYZER_VERSION and analysis.get("result") is None:
                return blank("stale")
            if analysis["state"] in ("queued", "analysing"):
                return blank("failed", "Analysis was interrupted by a service restart. Retry this file.")
            if analysis["state"] in ("analysed", "needs_review", "approved", "stale") and analysis.get("result") is not None:
                validate_result(analysis["result"])
            elif analysis["state"] == "not_analysed" and analysis.get("result") is None and analysis.get("error") is None:
                pass
            elif analysis["state"] != "failed":
                raise ValueError("Invalid cached state")
            elif not isinstance(analysis.get("error"), str) or analysis.get("result") is not None:
                raise ValueError("Invalid cached failure")
            digest = envelope["source"].get("source_hash")
            if digest is not None and (not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest)):
                raise ValueError("Invalid saved source hash")
            if analysis["result"] is not None and digest is None:
                raise ValueError("Saved analysis is missing its source hash")
            row["analysis_saved_ns"] = envelope.get("saved_ns", path.stat().st_mtime_ns)
            row["source_hash"] = digest
            return saved_analysis(envelope)
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            return blank("stale", "Cached analysis is unreadable or incompatible. Reanalyse this file.")

    @staticmethod
    def identity(row):
        identity = {key: row[key] for key in ("id", "filename", "size_bytes", "modified_ns", "source_hash")}
        identity["id"] = row.get("_local_id", row["id"])
        return identity

    def persist(self, row, shared=False):
        if shared:
            row["analysis_saved_ns"] = time.time_ns()
        atomic_json(self.cache_path(row["filename"]), {
            "schema_version": ANALYSIS_SCHEMA, "analyzer_version": ANALYZER_VERSION,
            "source": self.identity(row), "analysis": row["analysis"], "saved_ns": row.get("analysis_saved_ns", 0)})
        if shared and row.get("source_hash") and row["analysis"]["state"] in ("analysed", "needs_review", "approved"):
            self.content.write("analysis", row["source_hash"], {
                "schema_version": ANALYSIS_SCHEMA, "analyzer_version": ANALYZER_VERSION, "analysis": row["analysis"], "saved_ns": row["analysis_saved_ns"]})

    def namespace_rows(self, tracks):
        for row in tracks:
            local = entry_id(row)
            row["_local_id"] = local
            row["id"] = hashlib.sha256((self.namespace + local).encode()).hexdigest() if self.namespace else local
        return tracks

    def restore_timing_bpm(self, row):
        # Read saved metadata only; scans must never hash audio to find corrections.
        try:
            from .timing import Timing
        except ImportError:
            from timing import Timing
        grid = Timing(self).read(row)["grid"] if row.get("source_hash") else None
        row["timing_bpm"] = grid["bpm"] if grid else None

    def reconcile(self, tracks):
        # Metadata/stat reconciliation never reads or hashes source audio.
        self.namespace_rows(tracks)
        with self.lock:
            previous = self.rows
            self.rows = {}
            for row in tracks:
                row["source_hash"] = None
                old = previous.get(row["id"])
                if old:
                    row["source_hash"] = old.get("source_hash")
                    row["analysis_saved_ns"] = old.get("analysis_saved_ns", 0)
                    row["analysis"] = copy.deepcopy(old["analysis"])
                else:
                    row["analysis"] = self.cached(row)
                self.restore_timing_bpm(row)
                self.rows[row["id"]] = row
            self.revision += 1
            return self.state()

    def shared_analysis(self, digest):
        value = self.content.read("analysis", digest)
        try:
            if (not compatible_analysis(value)
                    or value["source_hash"] != digest or value["analysis"]["state"] not in ("analysed", "needs_review", "approved", "stale")):
                return None
            validate_result(value["analysis"]["result"])
            return {**value, "analysis": saved_analysis(value)}
        except (TypeError, ValueError, KeyError):
            return None

    def identify(self, track_id):
        row, path = self.source(track_id)
        digest, stat = source_hash(path)
        if (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
            raise ValueError("Source changed. Refresh the library.")
        if row.get("source_hash") and digest != row["source_hash"]:
            with self.lock:
                current = self.rows.get(track_id)
                if current:
                    current["source_hash"] = None
                    current["timing_bpm"] = None
                    current["analysis"] = blank("stale", "Source changed. Analyse to identify the new content.")
                    self.revision += 1
            raise ValueError("Source changed. Refresh the library.")
        restored = self.shared_analysis(digest)
        with self.lock:
            current = self.rows.get(track_id)
            if current is None:
                raise ValueError("Source was removed. Refresh the library.")
            current["source_hash"] = digest
            self.restore_timing_bpm(current)
            # A running job owns its row until completion.
            if restored and current["analysis"]["state"] not in ("queued", "analysing"):
                current["analysis"] = restored["analysis"]
                current["analysis_saved_ns"] = restored.get("saved_ns", 0)
            self.persist(current)
            self.revision += 1
            return copy.deepcopy(current)

    def seed(self, tracks):
        """Publish size-checked saved rows while a full scan runs in the background."""
        with self.lock:
            if self.revision:
                return self.state()
            for row in self.namespace_rows(tracks):
                row["analysis"] = self.cached(row)
                self.restore_timing_bpm(row)
                self.rows[row["id"]] = row
            self.revision += 1
            return self.state()

    def metadata_row(self, original):
        row = copy.deepcopy(original)
        edits = self.metadata.get(row.get("_local_id", row["id"]), {})
        for field in ("title", "artist"):
            if field in edits:
                row[field] = edits[field]
        if "key" in edits:
            row["metadata_key"] = edits["key"]
        return row

    def save_metadata(self, track_id, edits):
        if not isinstance(edits, dict) or set(edits) not in ({"title", "artist"}, {"title", "artist", "key"}):
            raise ValueError("Invalid metadata fields.")
        if any(not isinstance(value, str) or len(value) > 300 for value in edits.values()):
            raise ValueError("Metadata fields must be text of at most 300 characters.")
        edits = {field: value.strip() for field, value in edits.items()}
        if not edits["title"]:
            raise ValueError("Title is required.")
        keys = {f"{root} {mode}" for root in ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B") for mode in ("major", "minor")}
        if "key" in edits and edits["key"] not in keys | {""}:
            raise ValueError("Choose a valid major or minor key.")
        with self.lock:
            row = self.rows.get(track_id)
            if row is None:
                raise ValueError("Track is unavailable. Refresh the library.")
            identity = row.get("_local_id", row["id"])
            updated = {**self.metadata, identity: {**self.metadata.get(identity, {}), **edits}}
            atomic_json(self.generated / "metadata.json", updated)
            self.metadata = updated
            self.revision += 1
            return self.state()

    def state(self):
        with self.lock:
            return {"schema_version": LIBRARY_SCHEMA, "revision": self.revision, "instance_id": self.instance_id,
                    "scan_pending": self.scan_pending, "scan_error": self.scan_error,
                    "tracks": [self.metadata_row(row) for row in self.rows.values()]}

    def source(self, track_id):
        """Resolve an opaque current track ID without accepting a caller-supplied path."""
        with self.lock:
            row = self.rows.get(track_id)
            if not row or row["status"] != "ready":
                raise ValueError("Track is unavailable or has changed. Refresh the library.")
            return self.metadata_row(row), self.music / row["filename"]

    def request(self, track_id, key_only=False):
        with self.lock:
            row = self.rows.get(track_id)
            if not row or row["status"] != "ready":
                raise ValueError("Track is unavailable or has changed. Refresh the library.")
            if row["analysis"]["state"] in ("queued", "analysing"):
                return self.state()  # Same unchanged source has at most one active job.
            if self.pending.full():
                raise ValueError("Analysis queue is full. Wait for a job to finish and retry.")
            old = row["analysis"]
            # Preserve an already displayed legacy result before the queue record
            # replaces its local envelope. This copies saved metadata, not audio.
            if (old["state"] in ("analysed", "needs_review", "approved")
                    and row.get("source_hash") and row.get("analysis_saved_ns", 0) > 0):
                self.content.write("analysis", row["source_hash"], {
                    "schema_version": ANALYSIS_SCHEMA, "analyzer_version": ANALYZER_VERSION,
                    "analysis": old, "saved_ns": row["analysis_saved_ns"]})
            row["analysis"] = blank("queued")
            try:
                self.persist(row)
            except OSError:
                row["analysis"] = old
                raise ValueError("Cannot save analysis job. Check the generated-data mount.")
            token = self.tokens.get(track_id, 0) + 1
            self.tokens[track_id] = token
            requested = copy.deepcopy(row)
            if key_only:
                requested["_key_previous"] = copy.deepcopy(old)
            self.pending.put_nowait((requested, token))
            self.revision += 1
            return self.state()

    def approve(self, track_id):
        with self.lock:
            row = self.rows.get(track_id)
            if not row or row["status"] != "ready":
                raise ValueError("Track is unavailable or has changed. Refresh the library.")
            if row["analysis"]["state"] == "approved":
                return self.state()
            if row["analysis"]["state"] not in ("analysed", "needs_review", "stale") or row["analysis"]["result"] is None:
                raise ValueError("Analyse this track before approving its analysis.")
            digest, stat = source_hash(self.music / row["filename"])
            if digest != row["source_hash"] or (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
                raise ValueError("Source changed. Refresh and reanalyse before approving.")
            previous = row["analysis"]
            row["analysis"] = {**previous, "state": "approved", "error": None}
            try:
                timing = self.content.read("timing", row["source_hash"])
                if timing and timing.get("reference_beats"):
                    self.content.write("timing", row["source_hash"],
                                       {**timing, "reference_beats": [], "saved_ns": time.time_ns()})
                self.persist(row, shared=True)
            except OSError:
                row["analysis"] = previous
                raise ValueError("Cannot save analysis approval. Check the generated-data mount.")
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
                self.background()
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
        result, failure, restored = None, None, None
        digest = None
        try:
            self.background()
            with tempfile.TemporaryDirectory(prefix="vira-analysis-") as directory:
                work = Path(directory)
                snapshot = work / ("source" + Path(requested["filename"]).suffix)
                with snapshot.open("wb") as handle:
                    digest, stat = source_hash(self.music / requested["filename"], handle)
                if (stat.st_size, str(stat.st_mtime_ns)) != (requested["size_bytes"], requested["modified_ns"]):
                    raise ValueError("Source changed before analysis. Refresh and retry.")
                requested["source_hash"] = digest
                restored = None if "_key_previous" in requested else self.shared_analysis(digest)
                if restored is not None and restored["analysis"]["state"] == "stale":
                    restored = None
                if restored is None:
                    self.background()
                    result = validate_result(self.analyzer(snapshot, work, key_only=True) if "_key_previous" in requested else self.analyzer(snapshot, work))
                    if "_key_previous" in requested:
                        previous = requested["_key_previous"]["result"]
                        base = copy.deepcopy(previous) if previous else {"grid": None, "beats_seconds": [], "flags": []}
                        for field in ("keys", "window_keys", "key_window_agreement", "duration_seconds", "analysis_seconds"):
                            if field in result:
                                base[field] = result[field]
                        base["flags"] = [flag for flag in base["flags"] if flag != "ambiguous_key"] + result["flags"]
                        result = validate_result(base)
        except Exception as exc:
            failure = str(exc) or "Analysis failed. Retry this file."
        # Check again even without Refresh: never publish a result for changed content.
        unchanged = False
        try:
            self.background()
            after_digest, stat = source_hash(self.music / requested["filename"])
            unchanged = after_digest == requested["source_hash"] and (stat.st_size, str(stat.st_mtime_ns)) == (requested["size_bytes"], requested["modified_ns"])
        except (OSError, ValueError):
            pass
        with self.lock:
            row = self._current(requested, token)
            if not row:
                return  # Late completions cannot overwrite a newer revision/cache.
            if not unchanged:
                row["analysis"] = blank("stale", "Source changed or was removed during analysis. Refresh and reanalyse.")
            elif failure:
                row["analysis"] = {**requested["_key_previous"], "error": failure} if "_key_previous" in requested else blank("failed", failure)
            elif restored:
                row["analysis"] = restored["analysis"]
                row["analysis_saved_ns"] = restored.get("saved_ns", 0)
            else:
                # The baseline's universal advisory flag does not mean a fitting
                # failure. Other ambiguity/fit flags select Needs review.
                review = set(result["flags"]) - {"metrical_level_and_phase_unverified"}
                row["analysis"] = {"state": "needs_review" if review else "analysed", "error": None, "result": result}
            if unchanged:
                row["source_hash"] = requested["source_hash"]
            try:
                self.persist(row, shared=unchanged and not failure and restored is None)
            except OSError:
                row["analysis"] = blank("failed", "Cannot persist analysis. Check the generated-data mount and retry.")
            self.revision += 1

    def close(self):
        self.pending.join()
        self.pending.put(None)
        self.worker.join(timeout=5)
