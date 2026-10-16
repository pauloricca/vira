import json
import os
import unittest
from pathlib import Path
import tempfile
from preparation.jobs import LibraryJobs
from preparation.timing import Timing, validate_grid

class TimingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.music = self.root / "music"
        self.music.mkdir()
        self.managers = []

    def tearDown(self):
        for manager in self.managers:
            manager.close()
        self.temp.cleanup()

    def manager(self):
        manager = LibraryJobs(self.music, self.root / "generated", lambda *_: {
            "grid": None, "beats_seconds": [], "keys": [], "window_keys": [], "flags": []})
        self.managers.append(manager)
        return manager

    def row(self, name="one.wav"):
        path = self.music / name
        if not path.exists():
            path.write_bytes(b"source bytes")
        stat = path.stat()
        return {"id": name, "filename": name, "title": name, "artist": "Unknown artist",
                "size_bytes": stat.st_size, "modified_ns": str(stat.st_mtime_ns),
                "duration_seconds": 2, "status": "ready", "error": None}

    def track(self, manager):
        return manager.state()["tracks"][0]

    def test_grid_restart_reanalysis_and_rename(self):
        manager = self.manager()
        manager.reconcile([self.row()])
        row = self.track(manager)
        grid = {"bpm": 123.45, "downbeat_seconds": .123, "reviewed": True}
        references = [.123, 1.623]
        self.assertEqual(Timing(manager).save(row["id"], grid, references)["state"], "reviewed")
        manager.request(row["id"])
        manager.pending.join()
        self.assertEqual(Timing(manager).get(row["id"])["grid"], grid)
        restarted = self.manager()
        restarted.reconcile([self.row()])
        self.assertEqual(Timing(restarted).get(self.track(restarted)["id"])["grid"], grid)
        self.assertEqual(Timing(restarted).get(self.track(restarted)["id"])["reference_beats"], references)
        (self.music / 'one.wav').rename(self.music / 'renamed.wav')
        restarted.reconcile([self.row('renamed.wav')])
        self.assertEqual(Timing(restarted).get(self.track(restarted)["id"])["grid"], grid)
        self.assertEqual(Timing(restarted).get(self.track(restarted)["id"])["reference_beats"], references)

    def test_changed_bytes_stale_even_preserved_timestamp(self):
        manager = self.manager()
        manager.reconcile([self.row()])
        row = self.track(manager)
        timing = Timing(manager)
        grid = {"bpm": 120, "downbeat_seconds": .1, "reviewed": True}
        timing.save(row["id"], grid)
        path = self.music / 'one.wav'
        stat = path.stat()
        path.write_bytes(b'SOURCE BYTES')
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
        with self.assertRaisesRegex(ValueError, 'Source changed'):
            timing.save(row["id"], grid)
        manager.reconcile([self.row()])
        current = self.track(manager)
        self.assertIsNone(timing.get(current["id"])["grid"])
        self.assertEqual(timing.get(current["id"])["state"], 'stale')
        grid['reviewed'] = False
        self.assertEqual(timing.save(current['id'], grid)['state'], 'draft')

    def test_invalid_grids_and_corrupt_envelope(self):
        manager = self.manager()
        manager.reconcile([self.row()])
        timing = Timing(manager)
        row = self.track(manager)
        for key, value in [('bpm', 0), ('bpm', float('nan')), ('bpm', 301), ('bpm', True), ('downbeat_seconds', -1), ('downbeat_seconds', 2), ('reviewed', 1)]:
            grid = {"bpm": 120, "downbeat_seconds": .1, "reviewed": False}
            grid[key] = value
            with self.assertRaises(ValueError):
                timing.save(row['id'], grid)
        grid = {"bpm": 120, "downbeat_seconds": .1, "reviewed": False}
        timing.save(row['id'], grid)
        for references in [[-1], [2], [.1, .2, .3], [float('nan')], [True], 'bad']:
            with self.assertRaises(ValueError):
                timing.save(row['id'], grid, references)
        digest = self.track(manager)['source_hash']
        (manager.content.root / 'timing' / (digest + '.json')).write_text('{}')
        self.assertEqual(timing.get(row['id'])['state'], 'stale')


    def test_http_timing_requires_opaque_id_and_strict_payload(self):
        from http.server import ThreadingHTTPServer
        from preparation.service import make_handler
        import threading
        import urllib.request
        import urllib.error
        handler = make_handler(self.music, self.root / 'http-generated')
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            base = f'http://127.0.0.1:{server.server_port}'
            for path, body in [('/v1/timing/get', {'track_id': '../one.wav'}),
                               ('/v1/timing/get', {'track_id': 'a' * 64, 'path': '/music/one.wav'}),
                               ('/v1/timing/save', {'track_id': 'a' * 64, 'grid': {}})]:
                request = urllib.request.Request(base + path, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as raised:
                    urllib.request.urlopen(request)
                self.assertEqual(raised.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()
            handler.jobs.close()
