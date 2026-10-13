#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APP_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$APP_DIR"

echo "Starting the VIRA preparation service..."
docker compose up -d --build --wait preparation

echo "Building VIRA.app..."
docker compose run --rm --build builder

APP_PATH="$APP_DIR/output/VIRA.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Build completed, but $APP_PATH was not created." >&2
  exit 1
fi

echo "Built: $APP_PATH"
open "$APP_PATH"
