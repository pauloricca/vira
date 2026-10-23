import hashlib
import json
import time
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch
import test_audition_stream as audition


class ProgressiveDeckTests(unittest.TestCase):
    def request(self, base, endpoint, body):
        return urllib.request.urlopen(urllib.request.Request(base + endpoint, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}), timeout=10)

    def test_deck_bootstrap_and_first_chunk_precede_hashing_and_completed_pcm_is_reused(self):
        for collections in (False, True):
            with self.subTest(collections=collections), audition.AuditionStreamTests().server(collections, duration=65) as (preview, child, path):
                track = child.jobs.state()["tracks"][0]["id"]
                body = {"track_id": track, "deck": 0, "generation": 1, "sample_rate": 48000}
                with patch("preparation.jobs.source_hash", side_effect=AssertionError("Deck bootstrap must not hash the whole file")):
                    with self.request(preview.base_url, "/v1/deck/open", body) as response:
                        descriptor = json.load(response)
                    self.assertTrue(descriptor["progressive"])
                    self.assertEqual(descriptor["frames"], 65 * 48000)
                    stream = self.request(preview.base_url, "/v1/deck/stream", {"track_id": track, "sample_rate": 48000, "position_seconds": 0})
                    prefix = stream.read(30 * 48000 * 8)
                    self.assertEqual(len(prefix), 30 * 48000 * 8)
                with stream:
                    pcm = prefix + stream.read()
                self.assertEqual(len(pcm), 65 * 48000 * 8)
                with patch("preparation.prepare.subprocess.run", side_effect=AssertionError("The streamed PCM must be reused")), patch("preparation.prepare.subprocess.Popen", side_effect=AssertionError("Deck loading must not decode twice")):
                    prepared = child.preparation.prepare(track, deck=0, generation=1, audition=True)
                self.assertEqual(prepared["pcm_hash"], hashlib.sha256(pcm).hexdigest())
                with patch("preparation.audition.subprocess.Popen", side_effect=AssertionError("Cached deck loads must not decode again")), patch("preparation.jobs.source_hash", side_effect=AssertionError("Cached chunks must not wait for whole-file verification")):
                    with self.request(preview.base_url, "/v1/deck/stream", {"track_id": track, "sample_rate": 48000, "position_seconds": 0}) as response:
                        self.assertEqual(response.read(), pcm)

    def test_deck_bootstrap_rejects_changed_files_and_superseded_generations(self):
        with audition.AuditionStreamTests().server() as (preview, child, path):
            track = child.jobs.state()["tracks"][0]["id"]
            body = {"track_id": track, "deck": 0, "generation": 2, "sample_rate": 48000}
            with self.request(preview.base_url, "/v1/deck/open", body): pass
            with self.assertRaises(urllib.error.HTTPError):
                self.request(preview.base_url, "/v1/deck/open", {**body, "generation": 1})
            path.touch()
            with self.assertRaises(urllib.error.HTTPError):
                self.request(preview.base_url, "/v1/deck/open", {**body, "generation": 3})

    def test_stopping_a_deck_stream_does_not_retain_an_incomplete_artifact(self):
        with audition.AuditionStreamTests().server(duration=120) as (preview, child, path):
            track = child.jobs.state()["tracks"][0]["id"]
            with self.request(preview.base_url, "/v1/deck/stream", {"track_id": track, "sample_rate": 48000, "position_seconds": 0}) as response:
                self.assertEqual(len(response.read(16384)), 16384)
            deadline = time.monotonic() + 3
            while list(child.preparation.root.glob("stream-*")) and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertFalse(list(child.preparation.root.glob("*/manifest.json")))
            self.assertFalse(list(child.preparation.root.glob("stream-*")))
