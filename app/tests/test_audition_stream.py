import contextlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from preparation.service import inspect_file, make_collections_handler, make_handler


class AuditionStreamTests(unittest.TestCase):
    @contextlib.contextmanager
    def server(self, collections=False, duration=2, filename="tone.wav", codec=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            music = root / "music"
            music.mkdir()
            path = music / filename
            command = ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"sine=frequency=440:sample_rate=48000:duration={duration}"]
            if codec:
                command += ["-c:a", codec]
            subprocess.run(command + [str(path)], check=True)
            handler = (make_collections_handler([{"path": str(music), "mount": str(music)}], root / "generated")
                       if collections else make_handler(music, root / "generated"))
            child = handler.collection_handlers[0][1] if collections else handler
            child.jobs.reconcile([inspect_file(path)])
            track = child.jobs.state()["tracks"][0]["id"]
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            def request(position=0, **overrides):
                body = {"track_id": track, "sample_rate": 48000, "position_seconds": position, **overrides}
                return urllib.request.urlopen(urllib.request.Request(
                    f"http://127.0.0.1:{server.server_port}/v1/audition/stream", data=json.dumps(body).encode(),
                    headers={"Content-Type": "application/json"}), timeout=5)
            try:
                yield request, child, path
            finally:
                server.shutdown()
                server.server_close()
                worker.join()
                child.jobs.close()

    def test_stream_and_seek_bypass_hashing_preparation_and_load_priority(self):
        for collections in (False, True):
            with self.subTest(collections=collections), self.server(collections) as (request, child, path):
                # Even a pending deck load must not hold up an audition.
                with patch("preparation.priority.LoadPriority.background", side_effect=AssertionError("Stream must bypass background waits")), \
                     patch("preparation.jobs.source_hash", side_effect=AssertionError("Stream must not hash the file")), \
                     patch.object(child.preparation, "prepare", side_effect=AssertionError("Stream must not prepare the whole track")):
                    with request() as response:
                        self.assertEqual(response.headers["Transfer-Encoding"], "chunked")
                        self.assertEqual(float(response.headers["X-Vira-Duration-Seconds"]), 2)
                        audio = response.read()
                    with request(1) as response:
                        seek = response.read()
                    self.assertEqual(len(audio), 48000 * 2 * 8)
                    self.assertEqual(seek, audio[48000 * 8:])
                    self.assertFalse(child.preparation.root.exists())

    def test_supported_compressed_sources_and_invalid_requests(self):
        for filename, codec in (("tone.mp3", "libmp3lame"), ("tone.ogg", "libvorbis"), ("tone.opus.ogg", "libopus")):
            with self.subTest(filename=filename), self.server(filename=filename, codec=codec) as (request, child, path):
                with request(.5) as response:
                    audio = response.read()
                self.assertAlmostEqual(len(audio) / (48000 * 8), 1.5, delta=.05)
                for invalid in ({"position_seconds": -1}, {"position_seconds": 100}, {"sample_rate": True}, {"track_id": "../tone.mp3"}):
                    with self.assertRaises(urllib.error.HTTPError) as rejected:
                        request(**invalid)
                    self.assertEqual(rejected.exception.code, 400)
                path.touch()
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    request()
                self.assertEqual(rejected.exception.code, 400)

    def test_first_audio_is_sent_before_the_decoder_finishes(self):
        with self.server() as (request, child, path):
            finish = threading.Event()
            class Output:
                first = True
                def read(self, size):
                    if self.first:
                        self.first = False
                        return b"\0" * 16384
                    if not finish.wait(5):
                        raise AssertionError("Client waited for full decoding before reading audio")
                    return b""
            class Decoder:
                stdout = Output()
                def __enter__(self): return self
                def __exit__(self, *args): pass
                def poll(self): return 0 if finish.is_set() else None
                def wait(self): return 0
                def kill(self): finish.set()
            with patch("preparation.audition.subprocess.Popen", return_value=Decoder()):
                try:
                    with request() as response:
                        self.assertEqual(len(response.read(16384)), 16384)
                        self.assertFalse(finish.is_set())
                        finish.set()
                        self.assertEqual(response.read(), b"")
                finally:
                    finish.set()

    def test_closing_stream_reaps_decoder(self):
        with self.server(duration=120) as (request, child, path):
            processes = []
            real_popen = subprocess.Popen
            def start(*args, **kwargs):
                process = real_popen(*args, **kwargs)
                processes.append(process)
                return process
            with patch("preparation.audition.subprocess.Popen", side_effect=start):
                response = request()
                self.assertEqual(len(response.read(16384)), 16384)
                response.close()
                deadline = time.monotonic() + 3
                while processes[0].poll() is None and time.monotonic() < deadline:
                    time.sleep(.01)
                self.assertIsNotNone(processes[0].poll())
