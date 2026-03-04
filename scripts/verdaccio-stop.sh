#!/usr/bin/env bash
# Stop Verdaccio and clean up storage.
# Usage: ./verdaccio-stop.sh

set -euo pipefail

PID_FILE="/tmp/verdaccio.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping Verdaccio (PID: ${PID})..."
    kill "$PID"
    rm -f "$PID_FILE"
  else
    echo "Verdaccio not running (stale PID file)"
    rm -f "$PID_FILE"
  fi
else
  echo "No Verdaccio PID file found"
fi

# Optionally clean storage
if [ "${1:-}" = "--clean" ]; then
  echo "Cleaning Verdaccio storage..."
  rm -rf /tmp/verdaccio-storage
fi
