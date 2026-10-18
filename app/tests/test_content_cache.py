"""Deferred recognition across moves, renames, duplicates and legacy conflicts."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import wave

from preparation.jobs import ANALYSIS_SCHEMA, ANALYZER_VERSION, ContentStore, LibraryJobs, atomic_json
from preparation.service import inspect_file, scan_bin
from preparation.prepare import Preparation
from preparation.timing import Timing


def estimate(bpm=120):
    return {"grid": {"bpm": bpm, "offset_seconds": .1, "residual_p95_ms": 1,
                     "end_minus_start_residual_ms": 0, "tempo_spread_percent": 0, "thirds_bpm": [bpm] * 3},
            "beats_seconds": [.1, .6], "keys": [], "window_keys": [], "flags": []}


class ContentCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.generated = self.root / "generated"
        self.content = ContentStore(self.generated)
        self.managers = []
        self.calls = []
        self.first = self.manager("first")
        self.second = self.manager("second")
        self.source = self.first.music / "song.wav"
        with wave.open(str(self.source), "wb") as audio:
            audio.setnchannels(2)
            audio.setsampwidth(2)
            audio.setframerate(48000)
            audio.writeframes(b'\x00\x01\x00\x02' * 96000)

    def tearDown(self):
        for jobs in self.managers:
            jobs.close()
        self.temp.cleanup()

    def manager(self, name):
        music = self.root / name
        music.mkdir()
        def analyze(*_):
            self.calls.append(name)
            return estimate()
        jobs = LibraryJobs(music, self.generated / "libraries" / name, analyze, namespace=name, content=self.content)
        self.managers.append(jobs)
        return jobs

    def scan(self, jobs):
        return jobs.reconcile(scan_bin(jobs.music, jobs.generated)["tracks"])["tracks"][0]

    def analysed(self):
        row = self.scan(self.first)
        self.first.request(row["id"])
        self.first.pending.join()
        self.first.approve(row["id"])
        grid = {"bpm": 123, "downbeat_seconds": .2, "reviewed": True}
        Timing(self.first).save(row["id"], grid, [.2, 1.2])
        return self.first.state()["tracks"][0], grid

    def move(self):
        target = self.second.music / "renamed.wav"
        shutil.move(self.source, target)
        stat = target.stat()
        os.utime(target, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1000000000))
        return self.scan(self.second)

    def test_scan_does_not_hash_or_search_shared_caches(self):
        with patch("preparation.jobs.source_hash", side_effect=AssertionError("No hashes while scanning")), patch.object(self.content, "read", side_effect=AssertionError("No shared lookup while scanning")):
            row = self.scan(self.first)
        self.assertIsNone(row["source_hash"])
        self.assertEqual(row["analysis"]["state"], "not_analysed")
        self.assertIsNone(self.content.legacy)

    def test_analyse_after_move_and_rename_restores_without_reanalysis(self):
        original, grid = self.analysed()
        saved = self.content.read("analysis", original["source_hash"])["saved_ns"]
        moved = self.move()
        self.assertIsNone(moved["source_hash"])
        self.assertEqual(moved["analysis"]["state"], "not_analysed")
        self.second.request(moved["id"])
        self.second.pending.join()
        restored = self.second.state()["tracks"][0]
        self.assertEqual(restored["analysis"]["state"], "approved")
        self.assertEqual(self.calls, ["first"])
        timing = Timing(self.second).get(moved["id"])
        self.assertEqual(timing["grid"], grid)
        self.assertEqual(timing["reference_beats"], [.2, 1.2])
        self.assertEqual(self.content.read("analysis", original["source_hash"])["saved_ns"], saved)
        self.assertEqual(list(self.first.music.iterdir()), [])
        self.assertEqual([p.name for p in self.second.music.iterdir()], ["renamed.wav"])

    def test_deck_preparation_restores_analysis_and_overrides_on_use(self):
        original, grid = self.analysed()
        moved = self.move()
        prepared = Preparation(self.second).prepare(moved["id"])
        self.assertEqual(prepared["source_hash"], original["source_hash"])
        self.assertEqual(self.second.state()["tracks"][0]["analysis"]["state"], "approved")
        self.assertEqual(Timing(self.second).get(moved["id"])["grid"], grid)
        self.assertEqual(self.calls, ["first"])

    def test_different_content_does_not_reuse_analysis_or_overrides(self):
        original, grid = self.analysed()
        moved = self.move()
        path = self.second.music / moved["filename"]
        with path.open("ab") as handle:
            handle.write(b"different bytes")
        moved = self.scan(self.second)
        self.second.request(moved["id"])
        self.second.pending.join()
        self.assertEqual(self.calls, ["first", "second"])
        self.assertNotEqual(self.second.state()["tracks"][0]["source_hash"], original["source_hash"])
        self.assertIsNone(Timing(self.second).get(moved["id"])["grid"])
    def test_old_analyzer_keeps_approval_and_manual_overrides(self):
        original, grid = self.analysed()
        path = self.content.root / "analysis" / (original["source_hash"] + ".json")
        value = json.loads(path.read_text())
        value["analyzer_version"] = "old-analyzer"
        atomic_json(path, value)
        moved = self.move()
        self.second.request(moved["id"])
        self.second.pending.join()
        self.assertEqual(self.calls, ["first"])
        self.assertEqual(self.second.state()["tracks"][0]["analysis"]["state"], "approved")
        self.assertEqual(Timing(self.second).get(moved["id"])["grid"], grid)

    def test_local_and_legacy_approval_survives_analyzer_update(self):
        original, _ = self.analysed()
        path = self.first.cache_path(original["filename"])
        value = json.loads(path.read_text())
        value["analyzer_version"] = "old-analyzer"
        atomic_json(path, value)
        self.assertEqual(self.first.cached(original)["state"], "approved")
        shutil.rmtree(self.content.root)
        legacy = ContentStore(self.generated)
        self.assertEqual(legacy.read("analysis", original["source_hash"])["analysis"]["state"], "approved")
        self.assertEqual(self.first.cached({**original, "modified_ns": "0"})["state"], "stale")
        value["schema_version"] = 0
        atomic_json(path, value)
        self.assertEqual(self.first.cached(original)["state"], "stale")
        value["schema_version"] = ANALYSIS_SCHEMA
        value["analysis"]["state"] = "analysed"
        atomic_json(path, value)
        self.assertEqual(self.first.cached(original)["state"], "stale")
        self.assertEqual(self.first.cached(original)["result"], original["analysis"]["result"])

    def test_stale_shared_data_remains_usable_until_reanalysis(self):
        original, _ = self.analysed()
        path = self.content.root / "analysis" / (original["source_hash"] + ".json")
        value = json.loads(path.read_text())
        value["analyzer_version"] = "old-analyzer"
        value["analysis"]["state"] = "analysed"
        atomic_json(path, value)
        moved = self.move()
        restored = self.second.identify(moved["id"])
        self.assertEqual(restored["analysis"]["state"], "stale")
        self.assertEqual(restored["analysis"]["result"], original["analysis"]["result"])
        self.assertEqual(Timing(self.second).get(moved["id"])["suggestion"]["bpm"], 120)
        self.assertEqual(self.second.cached(restored)["result"], original["analysis"]["result"])
        self.second.request(moved["id"])
        self.second.pending.join()
        self.assertEqual(self.calls, ["first", "second"])
        self.assertEqual(self.second.state()["tracks"][0]["analysis"]["state"], "analysed")

    def test_stale_analysis_can_be_approved_and_persisted_without_reanalysis(self):
        original, _ = self.analysed()
        path = self.content.root / "analysis" / (original["source_hash"] + ".json")
        value = json.loads(path.read_text())
        value["analyzer_version"] = "old-analyzer"
        value["analysis"]["state"] = "analysed"
        atomic_json(path, value)
        moved = self.move()
        self.second.identify(moved["id"])
        approved = self.second.approve(moved["id"])["tracks"][0]["analysis"]
        self.assertEqual(approved["state"], "approved")
        self.assertEqual(approved["result"], original["analysis"]["result"])
        self.assertIsNone(approved["error"])
        self.assertEqual(self.second.cached(self.second.state()["tracks"][0]), approved)
        self.assertEqual(self.content.read("analysis", original["source_hash"])["analysis"], approved)
        self.assertEqual(self.calls, ["first"])
        self.second.rows[moved["id"]]["analysis"] = {"state": "stale", "result": None, "error": None}
        with self.assertRaisesRegex(ValueError, "Analyse this track"):
            self.second.approve(moved["id"])

    def test_recognising_an_existing_legacy_row_keeps_its_approval_and_save_time(self):
        original, _ = self.analysed()
        saved = self.content.read("analysis", original["source_hash"])["saved_ns"]
        shutil.rmtree(self.content.root)
        self.first.content = ContentStore(self.generated)
        self.first.request(original["id"])
        self.first.pending.join()
        self.assertEqual(self.calls, ["first"])
        self.assertEqual(self.first.state()["tracks"][0]["analysis"]["state"], "approved")
        self.assertEqual(self.first.content.read("analysis", original["source_hash"])["saved_ns"], saved)

    def test_late_older_writes_cannot_replace_newer_settings(self):
        digest = hashlib.sha256(b"same content").hexdigest()
        self.content.write("timing", digest, {"saved_ns": 20, "grid": {"bpm": 130}})
        self.content.write("timing", digest, {"saved_ns": 10, "grid": {"bpm": 120}})
        self.assertEqual(self.content.read("timing", digest)["grid"]["bpm"], 130)

    def test_legacy_conflicts_use_latest_save_per_kind_and_recognition_keeps_timestamps(self):
        digest = hashlib.sha256(self.source.read_bytes()).hexdigest()
        for name, bpm, analysis_ns, timing_ns in [("old-a", 120, 10_000, 40_000), ("old-b", 130, 30_000, 20_000)]:
            root = self.generated / "libraries" / name
            analysis = root / "analysis" / "old-name.json"
            timing = root / "timing" / (digest + ".json")
            atomic_json(analysis, {"schema_version": ANALYSIS_SCHEMA, "analyzer_version": ANALYZER_VERSION,
                                  "source": {"source_hash": digest},
                                  "analysis": {"state": "approved", "error": None, "result": estimate(bpm)}})
            atomic_json(timing, {"schema_version": 1, "source_hash": digest,
                                "grid": {"bpm": bpm, "downbeat_seconds": .1, "reviewed": True}, "reference_beats": [.1]})
            os.utime(analysis, ns=(analysis_ns, analysis_ns))
            os.utime(timing, ns=(timing_ns, timing_ns))
        row = self.scan(self.first)
        identified = self.first.identify(row["id"])
        self.assertEqual(identified["analysis"]["result"]["grid"]["bpm"], 130)
        self.assertEqual(Timing(self.first).get(row["id"])["grid"]["bpm"], 120)
        self.assertEqual(self.content.read("analysis", digest)["saved_ns"], 30_000)
        self.assertEqual(self.content.read("timing", digest)["saved_ns"], 40_000)
        self.first.identify(row["id"])
        # Rebuilding the migration index must not mistake recognition for an edit.
        reopened = ContentStore(self.generated)
        self.assertEqual(reopened.read("analysis", digest)["saved_ns"], 30_000)
        self.assertEqual(reopened.read("timing", digest)["saved_ns"], 40_000)
        Timing(self.first).save(row["id"], {"bpm": 140, "downbeat_seconds": .3, "reviewed": True})
        self.assertEqual(Timing(self.first).get(row["id"])["grid"]["bpm"], 140)
        self.assertEqual(self.content.read("analysis", digest)["saved_ns"], 30_000)
