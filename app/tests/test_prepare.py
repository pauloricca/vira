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

    def test_device_rates_have_separate_reusable_caches_and_matching_waveforms(self):
        from preparation.prepare import artifact_id, fine_frames
        identities = set()
        for rate in (44100, 48000, 96000):
            with self.subTest(rate=rate):
                playback = self.prepare.prepare(self.track_id, audition=True, sample_rate=rate)
                self.assertEqual(playback["frames"], rate * 2)
                self.assertEqual(playback["duration_seconds"], 2)
                self.assertEqual(playback["settings"]["sample_rate"], rate)
                self.assertEqual(playback["artifact_id"], artifact_id(playback["source_hash"], rate))
                identities.add(playback["artifact_id"])
                with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Rate cache must reuse PCM")):
                    complete = self.prepare.prepare(self.track_id, sample_rate=rate)
                self.assertEqual(complete["pcm_hash"], playback["pcm_hash"])
                self.assertEqual(complete["fine_peak_frames"], fine_frames(rate))
                self.assertAlmostEqual(len(complete["fine_peaks"]) * fine_frames(rate) / rate, 2, delta=.006)
                import numpy as np
                pcm = np.fromfile(self.prepare.audio_path(complete["artifact_id"]), dtype="<f4").reshape(-1, 2)
                # Preparing at another rate must preserve pitch as well as duration.
                frequency = np.fft.rfftfreq(len(pcm), 1 / rate)[np.abs(np.fft.rfft(pcm[:, 0])).argmax()]
                self.assertAlmostEqual(frequency, 440, delta=.5)
                with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Cache must survive service restart")), patch("preparation.prepare.pcm_info", side_effect=AssertionError("Matching waveforms must be reused")):
                    self.assertEqual(Preparation(self.jobs).prepare(self.track_id, sample_rate=rate), complete)
        self.assertEqual(len(identities), 3)
        for invalid in (0, 22050, 192001, True, "44100", 44100.0):
            with self.assertRaisesRegex(ValueError, "Sample rate"):
                self.prepare.prepare(self.track_id, sample_rate=invalid)

    def test_ogg_vorbis_and_opus_prepare_for_audition_and_decks(self):
        import numpy as np
        for codec in ("libvorbis", "libopus"):
            with self.subTest(codec=codec):
                path = self.music / f"{codec}.ogg"
                subprocess.run(["ffmpeg", "-v", "error", "-i", str(self.path), "-c:a", codec, str(path)], check=True)
                self.jobs.reconcile([inspect_file(path)])
                row = self.jobs.state()["tracks"][0]
                self.assertEqual(row["status"], "ready")
                audition = self.prepare.prepare(row["id"], audition=True)
                deck = self.prepare.prepare(row["id"])
                self.assertEqual(audition["pcm_hash"], deck["pcm_hash"])
                self.assertAlmostEqual(deck["duration_seconds"], 2, delta=.02)
                self.assertTrue(deck["peaks"])
                pcm = np.fromfile(self.prepare.audio_path(deck["artifact_id"]), dtype="<f4").reshape(-1, 2)
                self.assertTrue(np.isfinite(pcm).all())
                for channel, expected in ((0, 440), (1, 660)):
                    frequency = np.fft.rfftfreq(len(pcm), 1 / deck["settings"]["sample_rate"])[np.abs(np.fft.rfft(pcm[:, channel])).argmax()]
                    self.assertAlmostEqual(frequency, expected, delta=1)

    def test_audition_skips_waveforms_and_deck_upgrade_reuses_pcm(self):
        with patch("preparation.prepare.pcm_info", side_effect=AssertionError("Audition must not calculate waveforms")), patch("preparation.prepare.spectral_features", side_effect=AssertionError("Audition must not run FFT")):
            preview = self.prepare.prepare(self.track_id, audition=True)
        self.assertEqual(preview["frames"], 96000)
        self.assertNotIn("peaks", preview)
        self.assertNotIn("fine_features", preview)
        with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Deck upgrade must reuse audition PCM")):
            deck = self.prepare.prepare(self.track_id)
        self.assertEqual(deck["pcm_hash"], preview["pcm_hash"])
        self.assertGreater(len(deck["peaks"]), 0)
        manifest = self.prepare.audio_path(deck["artifact_id"]).parent / "manifest.json"
        value = json.loads(manifest.read_text())
        value["waveform_feature_version"] = 0
        manifest.write_text(json.dumps(value))
        with patch("preparation.prepare.spectral_features", side_effect=AssertionError("Audition must not repair unused features")), patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Audition must reuse decoded PCM")):
            self.assertEqual(self.prepare.prepare(self.track_id, audition=True), preview)

    def test_deck_audio_is_available_before_waveform_generation(self):
        with patch("preparation.prepare.pcm_info", side_effect=AssertionError("Playback must precede waveform work")):
            playback = self.prepare.prepare(self.track_id, deck=0, generation=1, audition=True)
        self.assertNotIn("peaks", playback)
        pcm = self.prepare.audio_path(playback["artifact_id"])
        self.assertEqual(pcm.stat().st_size, playback["pcm_bytes"])
        with patch("preparation.prepare.subprocess.Popen", side_effect=AssertionError("Waveform upgrade must reuse PCM")):
            complete = self.prepare.prepare(self.track_id, deck=0, generation=1)
        self.assertEqual(complete["pcm_hash"], playback["pcm_hash"])
        self.assertTrue(complete["peaks"])

    def test_full_duration_stereo_peaks_and_no_analysis_dependency(self):
        descriptor = self.prepare.prepare(self.track_id)
        self.assertEqual(descriptor["frames"], 96000)
        self.assertEqual(descriptor["duration_seconds"], 2)
        self.assertEqual(descriptor["pcm_bytes"], 96000 * 8)
        self.assertLessEqual(len(descriptor["peaks"]), 1024)
        self.assertAlmostEqual(max(p[0] for p in descriptor["peaks"]), .2, delta=.001)
        self.assertAlmostEqual(max(p[1] for p in descriptor["peaks"]), .1, delta=.001)
        self.assertEqual(self.jobs.state()["tracks"][0]["analysis"]["state"], "not_analysed")
        with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Cache must not decode again")), patch("preparation.prepare.spectral_features", side_effect=AssertionError("Cache must not run FFT again")), patch("preparation.prepare.pcm_info", side_effect=AssertionError("Cache must not recalculate peaks")):
            self.assertEqual(self.prepare.prepare(self.track_id), descriptor)

    def test_features_persist_across_restart_and_repair_without_decode(self):
        descriptor = self.prepare.prepare(self.track_id)
        restarted = Preparation(self.jobs)
        with patch("preparation.prepare.spectral_features", side_effect=AssertionError("Persisted features must be reused")):
            self.assertEqual(restarted.prepare(self.track_id), descriptor)
        manifest = self.prepare.audio_path(descriptor["artifact_id"]).parent / "manifest.json"
        for change in [lambda v: v.update(waveform_feature_version=1), lambda v: v["fine_features"][0].__setitem__(0, .999)]:
            value = json.loads(manifest.read_text())
            change(value)
            manifest.write_text(json.dumps(value))
            with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("Feature repair must reuse PCM")):
                self.assertEqual(restarted.prepare(self.track_id), descriptor)

    def test_frequency_brightness_and_short_attacks(self):
        import numpy as np
        path = self.root / "features.f32"
        t = np.arange(48000) / 48000
        def measure(samples):
            np.stack([samples, -samples], axis=1).astype("<f4").tofile(path)
            return np.asarray(pcm_info(path)["fine_features"])
        left = .3 * np.sin(2 * np.pi * 100 * t)
        right = .3 * np.sin(2 * np.pi * 8000 * t)
        np.stack([left, right], axis=1).astype("<f4").tofile(path)
        unequal = np.asarray(pcm_info(path)["fine_features"])
        self.assertTrue(np.allclose(unequal, measure(left)))
        low = measure(.3 * np.sin(2 * np.pi * 100 * t))
        high = measure(.3 * np.sin(2 * np.pi * 8000 * t))
        self.assertGreater(high[10:-10, 0].mean(), low[10:-10, 0].mean() + .7)
        quiet = measure(.001 * np.sin(2 * np.pi * 8000 * t))
        self.assertLess(quiet[:, 0].max(), .02)
        signal = np.zeros(48000)
        signal[24000:24480] = np.random.default_rng(7).normal(0, .4, 480)
        attack = measure(signal)
        self.assertLess(attack[98:103, 1].max(), .35)
        self.assertEqual(attack[:90].max(), 0)
        self.assertTrue(np.isfinite(measure(np.zeros(48000))).all())

    def test_attacks_stand_out_over_sustained_bass(self):
        import numpy as np
        path = self.root / "bass-attacks.f32"
        t = np.arange(96000) / 48000
        bass = .4 * np.sin(2 * np.pi * 60 * t)
        signal = bass.copy()
        rng = np.random.default_rng(9)
        for frame in [24000, 48000, 72000]:
            signal[frame:frame+480] += rng.normal(0, .14, 480) * np.exp(-np.arange(480) / 200)
        def measure(samples):
            np.stack([samples, samples], axis=1).astype("<f4").tofile(path)
            return np.asarray(pcm_info(path)["fine_features"])
        steady = measure(bass)
        features = measure(signal)
        self.assertLess(steady[20:-20, 1].max(), .22)
        for bucket in [100, 200, 300]:
            self.assertLess(features[bucket-2:bucket+4, 1].max(), .45)
        self.assertLess(features[120:180, 1].max(), .22)
        kick = bass.copy()
        attack_time = np.arange(4800) / 48000
        kick[48000:52800] += .5 * np.sin(2 * np.pi * 160 * attack_time) * np.exp(-attack_time * 35)
        kick_features = measure(kick)
        self.assertGreater(kick_features[198:207, 1].max(), .9)
        self.assertEqual(np.count_nonzero(kick_features[190:220, 1]), 1)
        self.assertLess(np.asarray(pcm_info(path)["features"])[:, 1].mean(), .1)

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

    def test_incomplete_pcm_and_conversion_version_are_rebuilt(self):
        old = self.prepare.prepare(self.track_id)
        path = self.prepare.audio_path(old["artifact_id"])
        with path.open("r+b") as handle:
            handle.truncate(path.stat().st_size - 8)
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
