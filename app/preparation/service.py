"""Local development metadata service. Source music is always read-only."""
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
try:
    from .jobs import LibraryJobs, LIBRARY_SCHEMA, atomic_json
    from .prepare import Preparation
except ImportError:
    from jobs import LibraryJobs, LIBRARY_SCHEMA, atomic_json
    from prepare import Preparation

SCHEMA_VERSION = 1
PROBE_TIMEOUT = 15


def inspect_file(path: Path) -> dict:
    row = dict(id="", filename=path.name, title=path.stem, artist="Unknown artist",
               duration_seconds=None, size_bytes=0, modified_ns="0", status="unreadable", error=None,
               artwork_available=False)
    try:
        # Do not follow symlinks, even to files outside the mounted bin.
        if path.is_symlink():
            raise ValueError("Symbolic links are not supported; place the source file in the music bin.")
        if not path.is_file():
            raise ValueError("Only regular files are supported.")
        stat = path.stat()
        row.update(size_bytes=stat.st_size, modified_ns=str(stat.st_mtime_ns))
        if path.suffix.lower() not in (".mp3", ".wav"):
            row.update(status="unsupported", error="Only MP3 and PCM WAV files are supported.")
            return row
        probe = subprocess.run([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file", "-show_format", "-show_streams", "-of", "json", str(path)
        ], capture_output=True, text=True, timeout=PROBE_TIMEOUT, check=True)
        info = json.loads(probe.stdout)
        audio = next((s for s in info.get("streams", []) if s.get("codec_type") == "audio"), None)
        if audio is None:
            raise ValueError("No audio stream found.")
        codec = audio.get("codec_name", "")
        container = info.get("format", {}).get("format_name", "").split(",")
        supported = (path.suffix.lower() == ".mp3" and codec == "mp3" and "mp3" in container) or (
            path.suffix.lower() == ".wav" and codec.startswith("pcm_") and "wav" in container)
        if not supported:
            row.update(status="unsupported", error="File content is not MP3 or PCM WAV audio.")
            return row
        tags = {k.lower(): v for k, v in audio.get("tags", {}).items()}
        tags.update({k.lower(): v for k, v in info.get("format", {}).get("tags", {}).items()})
        row["artwork_available"] = any(
            stream.get("codec_type") == "video" and stream.get("disposition", {}).get("attached_pic") == 1
            for stream in info.get("streams", []))
        for key in ("title", "artist"):
            if isinstance(tags.get(key), str) and tags[key].strip():
                row[key] = tags[key].strip()
        duration = float(info.get("format", {}).get("duration", audio.get("duration", "nan")))
        if not math.isfinite(duration) or duration <= 0:
            raise ValueError("Audio duration is missing or invalid.")
        after = path.stat()
        if (stat.st_size, stat.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("File changed during scanning. Refresh to retry.")
        row.update(duration_seconds=duration, status="ready")
    except subprocess.TimeoutExpired:
        row["error"] = "Metadata inspection timed out. Refresh to retry."
    except subprocess.CalledProcessError:
        row["error"] = "Cannot read audio metadata. The file may be damaged or unreadable."
    except (OSError, ValueError, KeyError, TypeError) as exc:
        row["error"] = str(exc)
    return row


def scan_bin(music: Path, generated: Path) -> dict:
    # A failed directory scan is a service-level error; failed files remain individual rows.
    if not music.is_dir():
        raise ValueError("Music bin is unavailable. Check the read-only music mount, then Refresh.")
    tracks = []
    for path in sorted(music.iterdir(), key=lambda p: (p.name.casefold(), p.name)):
        if path.is_dir() and not path.is_symlink():
            continue  # Direct files only; recursive scanning is intentionally deferred.
        row = inspect_file(path)
        # Identity is bin-relative filename plus cheap revision. Content hashes are added
        # alongside preparation/analysis in later steps, not claimed by this metadata index.
        identity = json.dumps([path.name, row["size_bytes"], row["modified_ns"]], ensure_ascii=False)
        row["id"] = hashlib.sha256(identity.encode()).hexdigest()
        tracks.append(row)
    result = dict(schema_version=SCHEMA_VERSION, tracks=tracks)
    generated.mkdir(parents=True, exist_ok=True)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=generated, delete=False, encoding="utf-8") as handle:
            name = handle.name
            json.dump(result, handle, ensure_ascii=False, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, generated / "library-v1.json")
    finally:
        if name and os.path.exists(name):
            os.unlink(name)
    return result


def make_handler(music: Path, generated: Path):
    scan_lock = threading.Lock()
    jobs = LibraryJobs(music, generated)
    preparation = Preparation(jobs)
    try:
        from .timing import Timing
    except ImportError:
        from timing import Timing
    timing = Timing(jobs)

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/v1/artwork/"):
                try:
                    track_id = self.path[len("/v1/artwork/"):]
                    if len(track_id) != 64 or any(c not in "0123456789abcdef" for c in track_id):
                        raise ValueError("Artwork requires a valid library track ID.")
                    row, source = jobs.source(track_id)
                    if not row.get("artwork_available"):
                        self.send_response(204)
                        self.end_headers()
                        return
                    artwork = generated / "artwork" / (row["source_hash"] + ".jpg")
                    if not artwork.exists():
                        artwork.parent.mkdir(parents=True, exist_ok=True)
                        result = subprocess.run([
                            "ffmpeg", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(source),
                            "-map", "0:v:0", "-frames:v", "1", "-vf",
                            "scale=512:512:force_original_aspect_ratio=decrease", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"
                        ], capture_output=True, timeout=PROBE_TIMEOUT, check=True)
                        if not result.stdout or len(result.stdout) > 5 * 1024 * 1024:
                            raise ValueError("Embedded artwork is empty or too large.")
                        before = source.stat()
                        if (before.st_size, str(before.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
                            raise ValueError("Source changed while reading artwork. Refresh the library.")
                        artwork.write_bytes(result.stdout)
                    body = artwork.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(body)))
                    self.send_header("Cache-Control", "private, max-age=31536000, immutable")
                    self.end_headers()
                    self.wfile.write(body)
                except (ValueError, OSError, subprocess.SubprocessError) as exc:
                    self.respond(404, {"error": str(exc)})
                return
            if self.path.startswith("/v1/prepared/") and self.path.endswith("/pcm"):
                try:
                    path = preparation.audio_path(self.path[len("/v1/prepared/"):-len("/pcm")])
                    with path.open("rb") as handle:
                        self.send_response(200)
                        self.send_header("Content-Type", "application/octet-stream")
                        self.send_header("Content-Length", str(path.stat().st_size))
                        self.end_headers()
                        while block := handle.read(65536):
                            self.wfile.write(block)
                except (ValueError, OSError, KeyError) as exc:
                    if not isinstance(exc, BrokenPipeError):
                        self.respond(404, {"error": str(exc)})
                return
            if self.path == "/health":
                self.respond(200, {"schema_version": LIBRARY_SCHEMA})
            elif self.path == "/v1/library/state":
                self.respond(200, jobs.state())
            else:
                self.respond(404, {"error": "Unknown endpoint."})

        def do_POST(self):
            if self.path in ("/v1/timing/get", "/v1/timing/save"):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 1024 or self.headers.get("Transfer-Encoding"):
                        raise ValueError("Invalid timing request.")
                    body = json.loads(self.rfile.read(length))
                    keys = set(body) if isinstance(body, dict) else set()
                    allowed = ({"track_id", "grid"}, {"track_id", "grid", "reference_beats"}) if self.path.endswith("save") else ({"track_id"},)
                    if keys not in allowed:
                        raise ValueError("Invalid timing request.")
                    track_id = body["track_id"]
                    if not isinstance(track_id, str) or len(track_id) != 64 or any(c not in "0123456789abcdef" for c in track_id):
                        raise ValueError("Timing requires a library track ID.")
                    self.respond(200, timing.save(track_id, body["grid"], body.get("reference_beats")) if "grid" in body else timing.get(track_id))
                except (ValueError, OSError) as exc:
                    self.respond(400, {"error": str(exc)})
                return
            # Accept only an opaque track ID, never a path or shell command.
            if self.path in ("/v1/analysis", "/v1/analysis/approve", "/v1/prepare"):
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 1024 or self.headers.get("Transfer-Encoding"):
                        raise ValueError("Invalid analysis request.")
                    body = json.loads(self.rfile.read(length))
                    track_id = body.get("track_id") if isinstance(body, dict) else None
                    keys = set(body) if isinstance(body, dict) else set()
                    allowed = ({"track_id"}, {"track_id", "deck", "generation"}) if self.path == "/v1/prepare" else ({"track_id"},)
                    if not isinstance(track_id, str) or len(track_id) != 64 or any(c not in "0123456789abcdef" for c in track_id) or keys not in allowed:
                        raise ValueError("Analysis requires a valid library track ID.")
                    if self.path == "/v1/prepare":
                        deck, generation = body.get("deck"), body.get("generation")
                        if deck is not None and (type(deck) is not int or deck not in (0, 1) or type(generation) is not int or generation < 1):
                            raise ValueError("Invalid deck load request.")
                        try:
                            result = preparation.prepare(track_id, deck, generation)
                        finally:
                            if deck is not None:
                                preparation.complete(deck, generation)
                        self.respond(200, result)
                    elif self.path == "/v1/analysis/approve":
                        self.respond(200, jobs.approve(track_id))
                    else:
                        self.respond(202, jobs.request(track_id))
                except (ValueError, OSError) as exc:
                    self.respond(400, {"error": str(exc)})
                return
            if self.path != "/v1/library/scan":
                self.respond(404, {"error": "Unknown endpoint."})
                return
            if self.headers.get("Content-Length", "0") != "0" or self.headers.get("Transfer-Encoding"):
                self.respond(400, {"error": "Scan does not accept a request body."})
                return
            if not scan_lock.acquire(blocking=False):
                self.respond(409, {"error": "A library scan is already running. Try Refresh shortly."})
                return
            try:
                result = jobs.reconcile(scan_bin(music, generated)["tracks"])
                atomic_json(generated / "library-v2.json", result)
                self.respond(200, result)
            except (OSError, ValueError) as exc:
                self.respond(503, {"error": str(exc)})
            finally:
                scan_lock.release()

        def respond(self, status, value):
            body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    Handler.jobs = jobs
    return Handler


if __name__ == "__main__":
    # Bind to the container interface; Compose publishes it on host loopback only.
    ThreadingHTTPServer(("0.0.0.0", 47831), make_handler(Path("/music"), Path("/generated"))).serve_forever()
