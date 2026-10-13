"""One immutable input snapshot in, one draft estimate out. No batch/previews."""
import argparse
import json
from pathlib import Path
import subprocess
import time

from baseline import SR, estimate
import numpy as np

ANALYZER_VERSION = "librosa-0.11.0-poc-v4-opening-beats"
ANALYSIS_SCHEMA = 1


def analyze(source: Path) -> dict:
    started = time.monotonic()
    decoded = subprocess.run([
        "ffmpeg", "-v", "error", "-protocol_whitelist", "file", "-i", str(source),
        "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"
    ], check=True, capture_output=True, timeout=120)
    result = estimate(np.frombuffer(decoded.stdout, dtype="<f4"))
    result.update(duration_seconds=len(decoded.stdout) / 4 / SR,
                  analysis_seconds=time.monotonic() - started)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.write_text(json.dumps(analyze(args.input), allow_nan=False), encoding="utf-8")
