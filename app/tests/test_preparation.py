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
from preparation.service import make_handler, scan_bin


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
            self.assertEqual(json.load(urllib.request.urlopen(url + "/health"))["schema_version"], 2)
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
