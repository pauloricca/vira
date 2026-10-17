"""One immutable input snapshot in, one draft estimate out. No batch/previews."""
import argparse
import json
from pathlib import Path
import subprocess
import time

from baseline import SR, estimate
import numpy as np

ANALYZER_VERSION = "librosa-0.11.0-poc-v5-genre-tempo"
ANALYSIS_SCHEMA = 1


def analyze(source: Path) -> dict:
    started = time.monotonic()
    genre = None
    try:
        probed = subprocess.run([
            "ffprobe", "-v", "error", "-protocol_whitelist", "file",
            "-show_format", "-show_streams", "-of", "json", str(source)
        ], check=True, capture_output=True, timeout=15)
        metadata = json.loads(probed.stdout)
        audio = next((stream for stream in metadata.get("streams", [])
                      if stream.get("codec_type") == "audio"), {})
        genre = "; ".join(value for section in [audio, metadata.get("format", {})]
                          for key, value in section.get("tags", {}).items()
                          if key.casefold() == "genre" and isinstance(value, str))
    except (subprocess.SubprocessError, ValueError, OSError):
        pass  # Missing/unreadable tags must not prevent audio analysis.
    decoded = subprocess.run([
        "ffmpeg", "-v", "error", "-protocol_whitelist", "file", "-i", str(source),
        "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"
    ], check=True, capture_output=True, timeout=120)
    result = estimate(np.frombuffer(decoded.stdout, dtype="<f4"), genre=genre)
    result.update(duration_seconds=len(decoded.stdout) / 4 / SR,
                  analysis_seconds=time.monotonic() - started)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(analyze(args.input), allow_nan=False), encoding="utf-8")
