import concurrent.futures
import json
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from preparation.priority import LoadPriority
from preparation.service import make_collections_handler, make_handler


class PriorityTests(unittest.TestCase):
    def test_overlapping_loads_and_abandoned_lease(self):
        priority = LoadPriority()
        priority.update({"token": "a", "active": True})
        priority.update({"token": "b", "active": True})
        with concurrent.futures.ThreadPoolExecutor() as pool:
            pending = pool.submit(priority.background)
            priority.update({"token": "a", "active": False})
            self.assertFalse(pending.done())
            priority.update({"token": "b", "active": False})
            pending.result(timeout=2)
        priority.leases["abandoned"] = 0
        priority.background()
        self.assertEqual(priority.leases, {})

    def test_library_state_deck_and_pcm_bypass_background_wait_in_both_server_modes(self):
        for collections in (False, True):
            with self.subTest(collections=collections), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                music = root / "music"
                music.mkdir()
                handler = (make_collections_handler([{"path": str(music), "mount": str(music)}], root / "generated")
                           if collections else make_handler(music, root / "generated"))
                child = handler.collection_handlers[0][1] if collections else handler
                track = "a" * 64
                child.jobs.rows[track] = {"id": track, "status": "ready", "filename": "test.mp3", "artwork_available": False}
                pcm = root / "audio.f32"
                pcm.write_bytes(b"\0" * 8)
                server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                base = f"http://127.0.0.1:{server.server_port}"

                def request(path, body=None):
                    req = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None,
                                                 headers={"Content-Type": "application/json"})
                    with urllib.request.urlopen(req, timeout=5) as response:
                        return response.read()

                try:
                    request("/v1/load-priority", {"token": "a", "active": True})
                    # Polling must stay responsive even when a load lease is held.
                    self.assertEqual(json.loads(request("/v1/library/state"))["tracks"][0]["id"], track)
                    with concurrent.futures.ThreadPoolExecutor() as pool:
                        backgrounds = [pool.submit(request, "/v1/artwork/" + track)]
                        try:
                            with patch.object(child.preparation, "prepare", return_value={"prepared": True}), patch.object(child.preparation, "audio_path", return_value=pcm):
                                self.assertEqual(json.loads(request("/v1/prepare", {"track_id": track, "deck": 0, "generation": 1})), {"prepared": True})
                                self.assertEqual(request("/v1/prepared/" + track + "/pcm"), pcm.read_bytes())
                            self.assertTrue(all(not pending.done() for pending in backgrounds))
                        finally:
                            request("/v1/load-priority", {"token": "a", "active": False})
                        for pending in backgrounds:
                            pending.result(timeout=2)
                finally:
                    server.shutdown()
                    server.server_close()
                    worker.join()
                    child.jobs.close()
