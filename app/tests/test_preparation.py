import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest.mock import patch
from preparation.service import make_collections_handler, library_storage, make_handler, quick_snapshot, scan_bin


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.music = self.root / "music"
        self.music.mkdir()
        self.generated = self.root / "generated"

    def tearDown(self):
        self.temp.cleanup()

    def audio(self, filename, tags=(), codec=None):
        cmd = ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2"]
        for key, value in tags:
            cmd += ["-metadata", f"{key}={value}"]
        if codec:
            cmd += ["-c:a", codec]
        subprocess.run(cmd + [str(self.music / filename)], check=True)

    def audio_with_artwork(self, filename):
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
            "-f", "lavfi", "-i", "color=c=red:s=32x32:d=2", "-map", "0:a", "-map", "1:v",
            "-c:a", "libmp3lame", "-c:v", "mjpeg", "-frames:v", "1", "-disposition:v", "attached_pic", "-shortest",
            str(self.music / filename)
        ], check=True)

    def scan(self):
        return scan_bin(self.music, self.generated)["tracks"]

    def test_tags_fallbacks_and_bad_file_isolation(self):
        self.audio("tagged.mp3", [("title", "Embedded title"), ("artist", "Embedded artist")])
        self.audio("Artist - Plain.wav")
        (self.music / "broken.mp3").write_text("broken audio")
        (self.music / "notes.txt").write_text("unsupported")
        rows = {r["filename"]: r for r in self.scan()}
        self.assertEqual(rows["tagged.mp3"]["title"], "Embedded title")
        self.assertEqual(rows["tagged.mp3"]["artist"], "Embedded artist")
        self.assertAlmostEqual(rows["tagged.mp3"]["duration_seconds"], 2, delta=.1)
        self.assertEqual(rows["Artist - Plain.wav"]["title"], "Artist - Plain")
        self.assertEqual(rows["Artist - Plain.wav"]["artist"], "Unknown artist")
        self.assertEqual(rows["broken.mp3"]["status"], "unreadable")
        self.assertEqual(rows["notes.txt"]["status"], "unsupported")
        index = json.loads((self.generated / "library-v1.json").read_text())
        self.assertEqual(index["tracks"], list(rows.values()))

    def test_embedded_artwork_is_detected_and_served_by_opaque_id(self):
        self.audio_with_artwork("covered.mp3")
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.music, self.generated))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f"http://127.0.0.1:{server.server_port}"
        try:
            request = urllib.request.Request(url + "/v1/library/scan", method="POST")
            track = json.load(urllib.request.urlopen(request))["tracks"][0]
            self.assertTrue(track["artwork_available"])
            response = urllib.request.urlopen(url + "/v1/artwork/" + track["id"])
            self.assertEqual(response.headers.get_content_type(), "image/jpeg")
            self.assertGreater(len(response.read()), 100)
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(url + "/v1/artwork/../covered.mp3")
            self.assertEqual(rejected.exception.code, 404)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
            server.RequestHandlerClass.jobs.close()

    def test_collections_have_unique_rows_but_identical_content_shares_timing(self):
        import shutil
        self.audio("same.wav")
        other = self.root / "Music é"
        other.mkdir()
        shutil.copy2(self.music / "same.wav", other / "same.wav")
        handler = make_collections_handler([
            {"path": "/Music", "mount": str(self.music)},
            {"path": "/Other/Music é", "mount": str(other)},
        ], self.generated)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f"http://127.0.0.1:{server.server_port}"
        def post(endpoint, body=None):
            raw = json.dumps(body).encode() if body is not None else None
            return json.load(urllib.request.urlopen(urllib.request.Request(url + endpoint, data=raw, method="POST")))
        try:
            health = json.load(urllib.request.urlopen(url + "/health"))
            self.assertEqual(health["music_folders"], ["/Music", "/Other/Music é"])
            library = post("/v1/library/scan")
            tracks = library["tracks"]
            self.assertEqual(len(tracks), 2)
            self.assertNotEqual(tracks[0]["id"], tracks[1]["id"])
            self.assertEqual([row["collection"] for row in tracks], health["music_folders"])
            grid = {"bpm": 120, "downbeat_seconds": .1, "reviewed": True}
            post("/v1/timing/save", {"track_id": tracks[1]["id"], "grid": grid})
            self.assertEqual(post("/v1/timing/get", {"track_id": tracks[1]["id"]})["grid"], grid)
            self.assertEqual(post("/v1/timing/get", {"track_id": tracks[0]["id"]})["grid"], grid)
            audition = post("/v1/prepare", {"track_id": tracks[1]["id"], "audition": True})
            self.assertEqual(audition["track_id"], tracks[1]["id"])
            self.assertNotIn("peaks", audition)
            self.assertNotIn("fine_features", audition)
            prepared = post("/v1/prepare", {"track_id": tracks[1]["id"]})
            self.assertEqual(prepared["track_id"], tracks[1]["id"])
            pcm = urllib.request.urlopen(url + "/v1/prepared/" + prepared["artifact_id"] + "/pcm").read()
            self.assertGreater(len(pcm), 100)
            refreshed = post("/v1/library/scan")
            self.assertEqual([row["id"] for row in refreshed["tracks"]], [row["id"] for row in tracks])
            with self.assertRaises(urllib.error.HTTPError):
                post("/v1/prepare", {"track_id": "a" * 64})
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
            for _, single in handler.collection_handlers:
                single.jobs.close()

    def test_collection_namespace_preserves_existing_analysis_cache_and_saved_rows(self):
        from preparation.jobs import LibraryJobs, blank
        self.audio("same.wav")
        cache = library_storage(self.generated, "/Custom/Music")
        legacy = LibraryJobs(self.music, cache)
        try:
            old = legacy.reconcile(scan_bin(self.music, cache)["tracks"])["tracks"][0]
            old["analysis"] = blank("failed", "Saved failure")
            legacy.persist(old)
        finally:
            legacy.close()
        current = LibraryJobs(self.music, cache, namespace="/Custom/Music")
        try:
            new = current.reconcile(scan_bin(self.music, cache)["tracks"])["tracks"][0]
            self.assertNotEqual(new["id"], old["id"])
            self.assertEqual(new["analysis"], old["analysis"])
            # Saved namespaced rows remain stable through a warm startup.
            from preparation.jobs import atomic_json
            atomic_json(cache / "library-v2.json", current.state())
            restored = LibraryJobs(self.music, cache, namespace="/Custom/Music")
            try:
                saved = restored.seed(quick_snapshot(self.music, cache))["tracks"][0]
                self.assertEqual(saved["id"], new["id"])
            finally:
                restored.close()
        finally:
            current.close()

    def test_empty_collections_have_a_valid_empty_library(self):
        handler = make_collections_handler([], self.generated)
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            url = f"http://127.0.0.1:{server.server_port}/v1/library/open"
            library = json.load(urllib.request.urlopen(urllib.request.Request(url, method="POST")))
            self.assertEqual(library["collections"], [])
            self.assertEqual(library["tracks"], [])
            self.assertFalse(library["scan_pending"])
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_refresh_reconciles_and_changes_revision(self):
        self.audio("one.wav")
        first = self.scan()[0]
        path = self.music / "one.wav"
        import os
        os.utime(path, ns=(path.stat().st_atime_ns, path.stat().st_mtime_ns + 1000000000))
        self.assertNotEqual(first["id"], self.scan()[0]["id"])
        self.audio("two.wav")
        path.unlink()
        self.assertEqual([r["filename"] for r in self.scan()], ["two.wav"])

    def test_open_and_refresh_never_hash_audio(self):
        self.audio("one.wav")
        first_handler = make_handler(self.music, self.generated)
        first_server = ThreadingHTTPServer(("127.0.0.1", 0), first_handler)
        first_worker = threading.Thread(target=first_server.serve_forever, daemon=True)
        first_worker.start()
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{first_server.server_port}/v1/library/scan", method="POST")
            original = json.load(urllib.request.urlopen(request))["tracks"][0]
        finally:
            first_server.shutdown()
            first_server.server_close()
            first_worker.join()
            first_handler.jobs.close()
        self.assertEqual(quick_snapshot(self.music, self.generated)[0]["id"], original["id"])
        path = self.music / "one.wav"
        contents = path.read_bytes()
        path.write_bytes(contents[:-1] + bytes([contents[-1] ^ 1]))
        import os
        stat = path.stat()
        os.utime(path, ns=(stat.st_atime_ns, int(original["modified_ns"])))
        self.assertEqual(quick_snapshot(self.music, self.generated)[0]["id"], original["id"])
        with patch("preparation.jobs.source_hash", side_effect=AssertionError("Collection scans must not hash audio")):
            handler = make_handler(self.music, self.generated)
            server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            url = f"http://127.0.0.1:{server.server_port}"
            try:
                opened = json.load(urllib.request.urlopen(urllib.request.Request(url + "/v1/library/open", method="POST")))
                self.assertEqual(opened["tracks"][0]["id"], original["id"])
                import time
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    verified = json.load(urllib.request.urlopen(url + "/v1/library/state"))
                    if not verified["scan_pending"]:
                        break
                    time.sleep(.02)
                self.assertFalse(verified["scan_pending"])
                self.assertEqual(verified["tracks"][0]["id"], original["id"])
                self.assertIsNone(verified["tracks"][0]["source_hash"])
                refreshed = json.load(urllib.request.urlopen(urllib.request.Request(url + "/v1/library/scan", method="POST")))
                self.assertIsNone(refreshed["tracks"][0]["source_hash"])
            finally:
                server.shutdown()
                server.server_close()
                worker.join()
                handler.jobs.close()

    def test_pcm_only_and_direct_children_and_symlinks(self):
        self.audio("compressed.wav", codec="adpcm_ima_wav")
        (self.music / "subfolder").mkdir()
        (self.music / "subfolder" / "nested.mp3").write_text("ignored")
        (self.music / "link.mp3").symlink_to(self.root / "outside.mp3")
        rows = {r["filename"]: r for r in self.scan()}
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows["compressed.wav"]["status"], "unsupported")
        self.assertEqual(rows["link.mp3"]["status"], "unreadable")

    def test_timeout_and_file_changes_remain_local(self):
        self.audio("one.wav")
        with patch("preparation.service.subprocess.run", side_effect=subprocess.TimeoutExpired("ffprobe", 15)):
            self.assertIn("timed out", self.scan()[0]["error"])
        real_run = subprocess.run
        def changing(*args, **kwargs):
            result = real_run(*args, **kwargs)
            with (self.music / "one.wav").open("ab") as handle:
                handle.write(b"changed")
            return result
        with patch("preparation.service.subprocess.run", side_effect=changing):
            self.assertIn("changed", self.scan()[0]["error"])

    def test_music_folders_have_distinct_persistent_caches(self):
        self.assertEqual(library_storage(self.generated, "/Users/pauloricca/Desktop/projects/vira/music"), self.generated)
        first = library_storage(self.generated, "/Music one")
        second = library_storage(self.generated, "/Music two")
        self.assertNotEqual(first, second)
        self.assertEqual(first, library_storage(self.generated, "/Music one"))
        self.assertTrue(first.is_relative_to(self.generated / "libraries"))

    def test_missing_bin_and_empty_bin(self):
        self.assertEqual(self.scan(), [])
        self.music.rmdir()
        with self.assertRaisesRegex(ValueError, "unavailable"):
            self.scan()

    def test_http_scan_health_and_rejected_input(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.music, self.generated))
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        url = f"http://127.0.0.1:{server.server_port}"
        try:
            health = json.load(urllib.request.urlopen(url + "/health"))
            self.assertEqual(health["schema_version"], 2)
            self.assertEqual(health["music_bin"], str(self.music))
            with patch.dict("os.environ", {"VIRA_HOST_MUSIC_DIR": "/My Music é"}):
                self.assertEqual(json.load(urllib.request.urlopen(url + "/health"))["music_bin"], "/My Music é")
            request = urllib.request.Request(url + "/v1/library/scan", method="POST")
            self.assertEqual(json.load(urllib.request.urlopen(request))["tracks"], [])
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(urllib.request.Request(url + "/v1/library/scan", data=b'{"path":"/etc"}'))
            self.assertEqual(caught.exception.code, 400)
            self.assertEqual(json.load(urllib.request.urlopen(url + "/v1/library/state"))["tracks"], [])
            for payload in ({"track_id": "../music/test.wav"}, {"track_id": "a" * 64}, {"path": "/music"}):
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    urllib.request.urlopen(urllib.request.Request(url + "/v1/analysis", data=json.dumps(payload).encode()))
                self.assertEqual(rejected.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
            server.RequestHandlerClass.jobs.close()


if __name__ == "__main__":
    unittest.main()
