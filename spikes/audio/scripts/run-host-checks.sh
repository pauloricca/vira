#!/bin/sh
# Native execution only. Build/test containers must have finished first.
set -eu
bin=output/native/vira-host-spike
out=results/host
mkdir -p "$out"
shasum -a 256 "$bin" > "$out/binary.sha256"
"$bin" devices > "$out/devices.json"
# Alternate order to avoid always giving one configuration a warmed-up machine.
for repeat in 1 2 3; do
  case "$repeat" in
    1) modes='headless idle busy';;
    2) modes='busy headless idle';;
    3) modes='idle busy headless';;
  esac
  for mode in $modes; do
    manifest="$out/manifests/six-steady.json"
    report="$out/steady-$mode-$repeat.json"
    if [ "$mode" = headless ]; then
      "$bin" play "$manifest" "$report" realtime
    else
      VIRA_HOST_AUTO_EXIT=1 "$bin" host "$manifest" "$report" "$mode"
    fi
  done
done
for mode in headless idle busy; do
  manifest="$out/manifests/six-stress.json"
  report="$out/stress-$mode.json"
  if [ "$mode" = headless ]; then
    "$bin" play "$manifest" "$report" realtime
  else
    VIRA_HOST_AUTO_EXIT=1 "$bin" host "$manifest" "$report" "$mode"
  fi
done
VIRA_HOST_AUTO_EXIT=1 VIRA_HOST_RESTART_AFTER_MS=2500 "$bin" host "$out/manifests/six-steady.json" "$out/reopen-busy.json" busy
