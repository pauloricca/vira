import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
from preparation.timing import Timing
from preparation.jobs import LibraryJobs, atomic_json, ANALYZER_VERSION, ANALYSIS_SCHEMA, validate_result


def result(flags=None):
    return {"grid": {"bpm": 120.0, "offset_seconds": .1, "residual_p95_ms": 5.0,
                     "end_minus_start_residual_ms": 1.0, "tempo_spread_percent": .1, "thirds_bpm": [120] * 3},
            "beats_seconds": [.1, .6, 1.1], "keys": [{"key": "C major", "correlation": .8}],
            "window_keys": [], "flags": flags or ["metrical_level_and_phase_unverified"],
            "tempo_alternatives": [60, 120, 240], "duration_seconds": 2}


class JobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.music = self.root / "music"
        self.music.mkdir()
        self.generated = self.root / "generated"
        self.managers = []
        self.release = threading.Event()

    def tearDown(self):
        self.release.set()
        for manager in self.managers:
            manager.close()
        self.temp.cleanup()

    def manager(self, analyzer=lambda *_: result(), capacity=32):
        manager = LibraryJobs(self.music, self.generated, analyzer, capacity)
        self.managers.append(manager)
        return manager

    def row(self, name="one.wav", content=b"source bytes"):
        path = self.music / name
        if not path.exists():
            path.write_bytes(content)
        stat = path.stat()
        return {"id": name, "filename": name, "title": name, "artist": "Unknown artist",
                "size_bytes": stat.st_size, "modified_ns": str(stat.st_mtime_ns),
                "duration_seconds": 2, "status": "ready", "error": None}

    def track(self, manager, index=0):
        return manager.state()["tracks"][index]

    def test_key_only_preserves_manual_timing_and_allows_approval(self):
        calls = []
        def analyze(snapshot, work, key_only=False):
            calls.append(key_only)
            return {"grid": None, "beats_seconds": [], "keys": [{"key": "D minor", "correlation": .9}], "window_keys": [], "flags": []}
        manager = self.manager(analyze)
        manager.reconcile([self.row()])
        track_id = self.track(manager)["id"]
        grid = {"bpm": 127.5, "downbeat_seconds": .2, "reviewed": True}
        Timing(manager).save(track_id, grid, [.2, .7])
        manager.request(track_id, key_only=True)
        manager.pending.join()
        self.assertEqual(calls, [True])
        self.assertEqual(Timing(manager).get(track_id)["grid"], grid)
        self.assertEqual(self.track(manager)["timing_bpm"], 127.5)
        self.assertEqual(self.track(manager)["analysis"]["result"]["keys"][0]["key"], "D minor")
        manager.approve(track_id)
        self.assertEqual(self.track(manager)["analysis"]["state"], "approved")

    def test_key_only_preserves_existing_analysis_grid_and_beats(self):
        def analyze(snapshot, work, key_only=False):
            value = result()
            if key_only:
                value.update(grid=None, beats_seconds=[], keys=[{"key": "D minor", "correlation": .9}])
            return value
        manager = self.manager(analyze)
        manager.reconcile([self.row()])
        track_id = self.track(manager)["id"]
        manager.request(track_id)
        manager.pending.join()
        manager.request(track_id, key_only=True)
        manager.pending.join()
        actual = self.track(manager)["analysis"]["result"]
        self.assertEqual(actual["grid"], result()["grid"])
        self.assertEqual(actual["beats_seconds"], result()["beats_seconds"])
        self.assertEqual(actual["keys"][0]["key"], "D minor")

    def test_only_selected_file_serial_and_deduplicated(self):
        started = threading.Event()
        calls = []
        def analyze(snapshot, _):
            calls.append(snapshot.read_bytes())
            started.set()
            self.assertTrue(self.release.wait(5))
            return result()
        manager = self.manager(analyze)
        manager.reconcile([self.row(), self.row("two.wav", b"other bytes")])
        first, second = manager.state()["tracks"]
        manager.request(first["id"])
        self.assertTrue(started.wait(5))
        manager.request(first["id"])
        self.assertEqual(self.track(manager, 1)["analysis"]["state"], "not_analysed")
        manager.request(second["id"])
        self.assertEqual(self.track(manager, 1)["analysis"]["state"], "queued")
        self.assertEqual(len(calls), 1)
        self.release.set()
        manager.pending.join()
        self.assertEqual(calls, [b"source bytes", b"other bytes"])
        self.assertTrue(all(t["analysis"]["state"] == "analysed" for t in manager.state()["tracks"]))

    def test_persistence_review_flags_and_restart_restore(self):
        manager = self.manager(lambda *_: result(["ambiguous_key", "grid_needs_review"]))
        source = self.row()
        manager.reconcile([source])
        manager.request(self.track(manager)["id"])
        manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["state"], "needs_review")
        cached = json.loads(manager.cache_path("one.wav").read_text())
        self.assertEqual(cached["schema_version"], ANALYSIS_SCHEMA)
        self.assertEqual(cached["analyzer_version"], ANALYZER_VERSION)
        self.assertEqual(cached["source"]["source_hash"], self.track(manager)["source_hash"])
        reopened = self.manager(lambda *_: self.fail("Restoring must not run analysis"))
        reopened.reconcile([self.row()])
        self.assertEqual(self.track(reopened)["analysis"], self.track(manager)["analysis"])

    def test_approval_changes_and_persists_analysis_status(self):
        manager = self.manager(lambda *_: result(["ambiguous_key"]))
        manager.reconcile([self.row()])
        track_id = self.track(manager)["id"]
        with self.assertRaisesRegex(ValueError, "Analyse this track"):
            manager.approve(track_id)
        manager.request(track_id)
        manager.pending.join()
        before = self.track(manager)["analysis"]["result"]
        grid = {"bpm": 123, "downbeat_seconds": .2, "reviewed": False}
        Timing(manager).save(track_id, grid, [.2, .7])
        approved = manager.approve(track_id)
        self.assertEqual(Timing(manager).get(track_id)["reference_beats"], [])
        self.assertEqual(Timing(manager).get(track_id)["grid"], grid)
        self.assertEqual(approved["tracks"][0]["analysis"]["state"], "approved")
        self.assertEqual(approved["tracks"][0]["analysis"]["result"], before)
        reopened = self.manager(lambda *_: self.fail("Restoring must not run analysis"))
        reopened.reconcile([self.row()])
        self.assertEqual(self.track(reopened)["analysis"]["state"], "approved")
        self.assertEqual(Timing(reopened).get(track_id)["reference_beats"], [])
        self.assertEqual(Timing(reopened).get(track_id)["grid"], grid)

    def test_same_stat_content_changes_are_checked_on_use_not_scan(self):
        manager = self.manager()
        manager.reconcile([self.row()])
        old_id = self.track(manager)["id"]
        manager.request(old_id)
        manager.pending.join()
        path = self.music / "one.wav"
        stat = path.stat()
        path.write_bytes(b"changed byte")
        self.assertEqual(path.stat().st_size, stat.st_size)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        manager.reconcile([self.row()])
        row = self.track(manager)
        self.assertEqual(row["id"], old_id)  # Scanning deliberately uses only file stats.
        with self.assertRaisesRegex(ValueError, "Source changed"):
            manager.identify(old_id)
        self.assertEqual(self.track(manager)["analysis"]["state"], "stale")
        self.assertIsNone(self.track(manager)["analysis"]["result"])
        manager.request(old_id)
        manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["state"], "analysed")

    def test_late_result_cannot_replace_new_source_result(self):
        started = threading.Event()
        calls = []
        def analyze(snapshot, _):
            calls.append(snapshot.read_bytes())
            if len(calls) == 1:
                started.set()
                self.assertTrue(self.release.wait(5))
            return result()
        manager = self.manager(analyze)
        manager.reconcile([self.row()])
        manager.request(self.track(manager)["id"])
        self.assertTrue(started.wait(5))
        (self.music / "one.wav").write_bytes(b"new revision")
        manager.reconcile([self.row()])
        new_id = self.track(manager)["id"]
        manager.request(new_id)
        self.release.set()
        manager.pending.join()
        cached = json.loads(manager.cache_path("one.wav").read_text())
        self.assertEqual(cached["source"]["id"], new_id)
        self.assertEqual(cached["analysis"]["state"], "analysed")
        self.assertEqual(calls, [b"source bytes", b"new revision"])

    def test_change_without_refresh_rejects_completion(self):
        def analyze(*_):
            (self.music / "one.wav").write_bytes(b"changed")
            return result()
        manager = self.manager(analyze)
        manager.reconcile([self.row()])
        manager.request(self.track(manager)["id"])
        manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["state"], "stale")
        self.assertIsNone(self.track(manager)["analysis"]["result"])

    def test_removed_job_and_queued_superseded_source_are_discarded(self):
        started = threading.Event()
        calls = []
        def analyze(snapshot, _):
            calls.append(snapshot.read_bytes())
            started.set()
            self.assertTrue(self.release.wait(5))
            return result()
        manager = self.manager(analyze)
        manager.reconcile([self.row(), self.row("two.wav")])
        first, second = manager.state()["tracks"]
        manager.request(first["id"])
        self.assertTrue(started.wait(5))
        manager.request(second["id"])
        (self.music / "one.wav").unlink()
        (self.music / "two.wav").write_bytes(b"superseded")
        manager.reconcile([self.row("two.wav")])
        self.release.set()
        manager.pending.join()
        self.assertEqual(len(calls), 1)
        self.assertIsNone(self.track(manager)["analysis"]["result"])
        self.assertNotEqual(json.loads(manager.cache_path("one.wav").read_text())["analysis"]["state"], "analysed")

    def test_failure_is_local_persisted_and_retryable(self):
        attempts = []
        def analyze(*_):
            attempts.append(1)
            if len(attempts) == 1:
                raise ValueError("Decode failed")
            return result()
        manager = self.manager(analyze)
        manager.reconcile([self.row(), self.row("two.wav")])
        track_id = self.track(manager)["id"]
        manager.request(track_id)
        manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["error"], "Decode failed")
        self.assertEqual(self.track(manager, 1)["analysis"]["state"], "not_analysed")
        reopened = self.manager()
        reopened.reconcile([self.row()])
        self.assertEqual(self.track(reopened)["analysis"]["state"], "failed")
        manager.request(track_id)
        manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["state"], "analysed")

    def test_version_corruption_and_interrupted_jobs(self):
        manager = self.manager()
        manager.reconcile([self.row()])
        row = self.track(manager)
        envelope = {"schema_version": ANALYSIS_SCHEMA, "analyzer_version": ANALYZER_VERSION,
                    "source": manager.identity(row), "analysis": {"state": "analysing", "result": None, "error": None}}
        path = manager.cache_path(row["filename"])
        atomic_json(path, envelope)
        self.assertEqual(manager.cached(row)["state"], "failed")
        envelope["analyzer_version"] = "future-method"
        atomic_json(path, envelope)
        self.assertEqual(manager.cached(row)["state"], "stale")
        path.write_text("corrupt JSON")
        self.assertEqual(manager.cached(row)["state"], "stale")
        self.assertEqual(list(path.parent.glob("tmp*")), [])

    def test_rejects_paths_unknown_ids_and_invalid_worker_result(self):
        manager = self.manager(lambda *_: {"grid": None})
        manager.reconcile([self.row()])
        with self.assertRaises(ValueError):
            manager.request("../music/one.wav")
        manager.request(self.track(manager)["id"])
        manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["state"], "failed")
        invalid = result()
        invalid["grid"]["bpm"] = float("nan")
        with self.assertRaises(ValueError):
            validate_result(invalid)

    def test_queue_full_preserves_unrequested_row(self):
        started = threading.Event()
        def analyze(*_):
            started.set()
            self.assertTrue(self.release.wait(5))
            return result()
        manager = self.manager(analyze, capacity=1)
        manager.reconcile([self.row(), self.row("two.wav"), self.row("three.wav")])
        tracks = manager.state()["tracks"]
        manager.request(tracks[0]["id"])
        self.assertTrue(started.wait(5))
        manager.request(tracks[1]["id"])
        with self.assertRaisesRegex(ValueError, "queue is full"):
            manager.request(tracks[2]["id"])
        self.assertEqual(self.track(manager, 2)["analysis"]["state"], "not_analysed")
        self.release.set()
        manager.pending.join()

    def test_corrupt_estimates_and_persistence_failure_stay_local(self):
        from unittest.mock import patch
        manager = self.manager()
        manager.reconcile([self.row()])
        for key, value in [("flags", [{}]), ("beats_seconds", [-1]), ("keys", [{"key": {}, "correlation": .5}]), ("tempo_alternatives", ["120"])]:
            invalid = result()
            invalid[key] = value
            with self.assertRaises(ValueError):
                validate_result(invalid)
        with patch.object(manager, "persist", side_effect=OSError("read-only")):
            with self.assertRaisesRegex(ValueError, "Cannot save"):
                manager.request(self.track(manager)["id"])
        self.assertEqual(self.track(manager)["analysis"]["state"], "not_analysed")
        self.assertEqual(manager.pending.unfinished_tasks, 0)
        original = manager.persist
        def cannot_complete(row, shared=False):
            if row["analysis"]["state"] == "queued":
                original(row)
            else:
                raise OSError("disk full")
        with patch.object(manager, "persist", side_effect=cannot_complete):
            manager.request(self.track(manager)["id"])
            manager.pending.join()
        self.assertEqual(self.track(manager)["analysis"]["state"], "failed")
        self.assertIn("Cannot persist", self.track(manager)["analysis"]["error"])
        self.assertIsNone(self.track(manager)["analysis"]["result"])


class BaselineTests(unittest.TestCase):
    def test_original_synthetic_checks(self):
        from preparation.baseline import checks
        checked = checks()
        self.assertTrue(checked["silence_rejected"])
        self.assertTrue(checked["tempo_change_flagged"])

    def test_single_file_worker_no_previews_or_batch(self):
        import subprocess
        import sys
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "silence.wav", root / "estimate.json"
            subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=22050:cl=mono", "-t", "2", str(source)], check=True)
            subprocess.run([sys.executable, "preparation/analysis_worker.py", "--input", str(source), "--output", str(output)], check=True, timeout=120)
            estimate = json.loads(output.read_text())
            self.assertEqual(estimate["flags"], ["silence_or_too_short"])
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["estimate.json", "silence.wav"])

class MetadataEditTests(unittest.TestCase):
    setUp = JobTests.setUp
    tearDown = JobTests.tearDown
    manager = JobTests.manager
    row = JobTests.row
    track = JobTests.track

    def test_edits_survive_refresh_restart_and_reanalysis_without_changing_audio(self):
        manager = self.manager()
        original = self.row()
        manager.reconcile([original])
        track_id = self.track(manager)["id"]
        audio = (self.music / original["filename"]).read_bytes()
        saved = manager.save_metadata(track_id, {"title": "Edited title", "artist": "Edited artist", "key": "F# minor"})["tracks"][0]
        self.assertEqual(saved["metadata_key"], "F# minor")
        self.assertEqual(saved["analysis"]["state"], "not_analysed")
        self.assertEqual(manager.rows[track_id]["analysis"]["result"], None)
        manager.request(track_id)
        manager.pending.join()
        self.assertEqual(self.track(manager)["metadata_key"], "F# minor")
        self.assertEqual(manager.rows[track_id]["analysis"]["result"]["keys"][0]["key"], "C major")
        manager.reconcile([self.row()])
        restarted = self.manager()
        restarted.seed([self.row()])
        restored = self.track(restarted)
        self.assertEqual((restored["title"], restored["artist"]), ("Edited title", "Edited artist"))
        self.assertEqual(restored["metadata_key"], "F# minor")
        self.assertEqual(restored["duration_seconds"], original["duration_seconds"])
        self.assertEqual((self.music / original["filename"]).read_bytes(), audio)

    def test_metadata_validation_and_title_only_save_preserve_key(self):
        manager = self.manager()
        manager.reconcile([self.row()])
        track_id = self.track(manager)["id"]
        for edits in ({"title": "", "artist": "a"}, {"title": "x", "artist": "a", "key": "H major"}, {"title": "x", "artist": "a", "bpm": 120}):
            with self.assertRaises(ValueError):
                manager.save_metadata(track_id, edits)
        manager.save_metadata(track_id, {"title": "Title", "artist": "", "key": "D major"})
        manager.save_metadata(track_id, {"title": "Renamed", "artist": "Artist"})
        self.assertEqual(self.track(manager)["metadata_key"], "D major")
        manager.save_metadata(track_id, {"title": "Renamed", "artist": "Artist", "key": ""})
        self.assertEqual(self.track(manager)["metadata_key"], "")
