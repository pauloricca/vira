import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from preparation.service import inspect_file
from preparation.jobs import LibraryJobs
from preparation.prepare import Preparation, pcm_info


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.music = self.root / "music"
        self.music.mkdir()
        self.path = self.music / "stereo.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*440*t)|0.1*sin(2*PI*660*t):s=48000:d=2", str(self.path)], check=True)
        self.jobs = LibraryJobs(self.music, self.root / "generated")
        self.jobs.reconcile([inspect_file(self.path)])
        self.track_id = self.jobs.state()["tracks"][0]["id"]
        self.prepare = Preparation(self.jobs)

    def tearDown(self):
        self.jobs.close()
        self.temp.cleanup()

    def test_full_duration_stereo_peaks_and_no_analysis_dependency(self):
        descriptor = self.prepare.prepare(self.track_id)
        self.assertEqual(descriptor["frames"], 96000)
        self.assertEqual(descriptor["duration_seconds"], 2)
        self.assertEqual(descriptor["pcm_bytes"], 96000 * 8)
        self.assertLessEqual(len(descriptor["peaks"]), 1024)
        self.assertAlmostEqual(max(p[0] for p in descriptor["peaks"]), .2, delta=.001)
        self.assertAlmostEqual(max(p[1] for p in descriptor["peaks"]), .1, delta=.001)
        self.assertEqual(self.jobs.state()["tracks"][0]["analysis"]["state"], "not_analysed")
        with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Cache must not decode again")):
            self.assertEqual(self.prepare.prepare(self.track_id), descriptor)

    def test_changed_source_rejects_cached_audio_even_before_refresh(self):
        old = self.prepare.prepare(self.track_id)
        stat = self.path.stat()
        content = self.path.read_bytes()
        self.path.write_bytes(content[:-1] + bytes([content[-1] ^ 1]))
        os.utime(self.path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, "Source changed"):
            self.prepare.prepare(self.track_id)
        self.jobs.reconcile([inspect_file(self.path)])
        new = self.prepare.prepare(self.jobs.state()["tracks"][0]["id"])
        self.assertNotEqual(old["artifact_id"], new["artifact_id"])
        self.assertNotEqual(old["source_hash"], new["source_hash"])

    def test_corrupt_pcm_and_conversion_version_are_rebuilt(self):
        old = self.prepare.prepare(self.track_id)
        path = self.prepare.audio_path(old["artifact_id"])
        with path.open("r+b") as handle:
            handle.write(b"\0" * 8)
        self.assertEqual(self.prepare.prepare(self.track_id)["pcm_hash"], old["pcm_hash"])
        manifest = path.parent / "manifest.json"
        value = json.loads(manifest.read_text())
        value["conversion_version"] = "obsolete"
        manifest.write_text(json.dumps(value))
        self.assertEqual(self.prepare.prepare(self.track_id)["conversion_version"], old["conversion_version"])

    def test_changed_during_decode_and_failure_do_not_commit_cache(self):
        real_run = subprocess.run
        def change(*args, **kwargs):
            result = real_run(*args, **kwargs)
            with self.path.open("ab") as handle:
                handle.write(b"changed")
            return result
        with patch("preparation.prepare.subprocess.run", side_effect=change):
            with self.assertRaisesRegex(ValueError, "Source changed"):
                self.prepare.prepare(self.track_id)
        self.assertEqual(list(self.prepare.root.glob("*/manifest.json")), [])
        self.jobs.reconcile([inspect_file(self.path)])
        self.track_id = self.jobs.state()["tracks"][0]["id"]
        with patch("preparation.prepare.subprocess.run", side_effect=subprocess.CalledProcessError(1, "ffmpeg")):
            with self.assertRaisesRegex(ValueError, "Cannot decode"):
                self.prepare.prepare(self.track_id)
        self.assertEqual(list(self.prepare.root.glob("*/manifest.json")), [])

    def test_removed_unknown_and_invalid_artifact_ids(self):
        with self.assertRaises(ValueError):
            self.prepare.prepare("../music/stereo.wav")
        with self.assertRaises(ValueError):
            self.prepare.audio_path("../../elsewhere")
        self.path.unlink()
        with self.assertRaises(ValueError):
            self.prepare.prepare(self.track_id)
        incomplete = self.root / "incomplete.f32"
        incomplete.write_bytes(b"123")
        with self.assertRaises(ValueError):
            pcm_info(incomplete)
