#!/bin/sh
# Host launcher: only the Docker-built application performs work on the Mac.
set -eu
cd "$(dirname "$0")/.."
while read -r manifest report mode; do
  echo "$report"
  output/native/vira-audio-spike play "$manifest" "$report" "$mode"
done < results/worker-scheduling/plan.txt
