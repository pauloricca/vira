"""Bounded, seekable audition decoding; no full-file hashing or PCM artifact."""
import math
import os
import subprocess


def stream_audition(handler, jobs, body):
    if (not isinstance(body, dict) or set(body) != {"track_id", "sample_rate", "position_seconds"}
            or not isinstance(body["track_id"], str) or len(body["track_id"]) != 64
            or any(c not in "0123456789abcdef" for c in body["track_id"])
            or type(body["sample_rate"]) is not int or not 44100 <= body["sample_rate"] <= 192000
            or type(body["position_seconds"]) not in (int, float)
            or not math.isfinite(body["position_seconds"]) or body["position_seconds"] < 0):
        raise ValueError("Invalid audition stream request.")
    row, path = jobs.source(body["track_id"])
    duration = row["duration_seconds"]
    if not duration or body["position_seconds"] > duration:
        raise ValueError("Audition position is outside the track.")
    # Pin the checked revision for this decoder, including across rename/replace.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        stat = os.fstat(descriptor)
        if (stat.st_size, str(stat.st_mtime_ns)) != (row["size_bytes"], row["modified_ns"]):
            raise ValueError("Source changed. Refresh the library before auditioning.")
        command = ["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                   "-ss", str(body["position_seconds"]), "-i", f"/proc/self/fd/{descriptor}",
                   "-map", "0:a:0", "-vn", "-f", "f32le", "-ac", "2", "-ar", str(body["sample_rate"]), "pipe:1"]
        with subprocess.Popen(command, pass_fds=(descriptor,), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as process:
            try:
                first = process.stdout.read(16384)
                if not first and process.wait() != 0:
                    raise ValueError("Cannot decode this source for audition.")
                handler.protocol_version = "HTTP/1.1"
                handler.send_response(200)
                handler.send_header("Content-Type", "application/octet-stream")
                handler.send_header("X-Vira-Duration-Seconds", str(duration))
                handler.send_header("Transfer-Encoding", "chunked")
                handler.send_header("Connection", "close")
                handler.end_headers()
                handler.close_connection = True
                block = first
                while block:
                    handler.wfile.write(f"{len(block):x}\r\n".encode() + block + b"\r\n")
                    handler.wfile.flush()
                    block = process.stdout.read(16384)
                # An incomplete chunked response reports decoder failures to native
                # playback, instead of silently treating a truncated song as EOF.
                if process.wait() == 0:
                    handler.wfile.write(b"0\r\n\r\n")
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait()
    finally:
        os.close(descriptor)
