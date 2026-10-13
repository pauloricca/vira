"""Source-time and grid regression tests; run in the preparation container."""
import unittest
import librosa
import numpy as np
from preparation.baseline import SR, HOP, grid_diagnostics, align_grid_to_attacks, checks


class BeatTests(unittest.TestCase):
    def test_pcm_attack_calibration_preserves_tempo_and_leading_silence(self):
        for silence in [0, .137, 2, 10]:
            with self.subTest(silence=silence):
                expected = silence + .5 + np.arange(40) * .5
                y = librosa.clicks(times=expected, sr=SR, length=int((silence + 21) * SR))
                delayed = expected + .028
                before = grid_diagnostics(delayed)
                grid = align_grid_to_attacks(y, before, delayed)
                self.assertAlmostEqual(grid['offset_seconds'], expected[0], delta=.003)
                self.assertEqual(grid['bpm'], before['bpm'])
                self.assertAlmostEqual(grid['attack_phase_correction_seconds'], -.028, delta=.003)
                self.assertGreaterEqual(grid['attack_phase_support'], 8)

    def test_pcm_calibration_does_not_move_grid_without_attacks(self):
        beats = .5 + np.arange(40) * .5
        grid = grid_diagnostics(beats)
        for y in [np.zeros(21 * SR), np.full(21 * SR, .1)]:
            self.assertEqual(align_grid_to_attacks(y, grid, beats), grid)

    def test_tracker_phase_slips_do_not_bias_grid(self):
        expected = .32 + np.arange(600) * 60 / 123
        detected = expected.copy()
        detected[210:310] += 30 / 123
        detected = np.delete(detected, [140, 141, 410])
        detected += .004 * np.sin(np.arange(len(detected)))
        grid = grid_diagnostics(detected)
        self.assertAlmostEqual(grid['bpm'], 123, delta=.01)
        self.assertAlmostEqual(grid['offset_seconds'], .32, delta=.005)
        self.assertGreater(grid['residual_p95_ms'], 200)
        self.assertLess(grid['supported_beats_fraction'], .9)

    def test_later_majority_offbeats_preserve_opening_phase(self):
        detected = .36 + np.arange(600) * 60 / 122
        detected[200:] += 30 / 122
        grid = grid_diagnostics(detected)
        self.assertAlmostEqual(grid['bpm'], 122, delta=.01)
        self.assertAlmostEqual(grid['offset_seconds'], .36, delta=.005)
        self.assertLess(grid['supported_beats_fraction'], .4)

    def test_leading_silence_keeps_source_timestamps(self):
        for silence in [0, .137, 2, 10]:
            with self.subTest(silence=silence):
                expected = np.arange(.5, 30, .5) + silence
                y = librosa.clicks(times=expected, sr=SR, length=int((30 + silence) * SR))
                onset = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
                _, frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR, hop_length=HOP)
                grid = grid_diagnostics(librosa.frames_to_time(frames, sr=SR, hop_length=HOP))
                self.assertAlmostEqual(grid['bpm'], 120, delta=.1)
                self.assertAlmostEqual(grid['offset_seconds'], silence + .5, delta=.025)

    def test_original_silence_constant_and_changing_tempo_checks(self):
        checks()

    def test_short_grids_and_missing_beats(self):
        self.assertIsNone(grid_diagnostics(np.arange(7) * .5))
        for length in [8, 9, 16]:
            grid = grid_diagnostics(10 + np.delete(np.arange(length + 2), [3, 4]) * .5)
            self.assertAlmostEqual(grid['bpm'], 120)
            self.assertAlmostEqual(grid['offset_seconds'], 10)
