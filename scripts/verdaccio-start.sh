#!/usr/bin/env bash
# Start Verdaccio if not already running.
# Usage: ./verdaccio-start.sh [port]

set -euo pipefail

PORT="${1:-4873}"
STORAGE="/tmp/verdaccio-storage"

if curl -sf "http://localhost:${PORT}/-/ping" > /dev/null 2>&1; then
  echo "Verdaccio already running on port ${PORT}"
  exit 0
fi

mkdir -p "$STORAGE"

CONFIG_FILE="${STORAGE}/config.yaml"
cat > "$CONFIG_FILE" <<YAML
storage: ${STORAGE}
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  "@*/*":
    access: \$all
    publish: \$all
    unpublish: \$all
    proxy: npmjs
  "**":
    access: \$all
    publish: \$all
    proxy: npmjs
listen: 0.0.0.0:${PORT}
log: { type: stdout, format: pretty, level: warn }
YAML

echo "Starting Verdaccio on port ${PORT}..."
nohup verdaccio --config "$CONFIG_FILE" > /tmp/verdaccio.log 2>&1 &
VERDACCIO_PID=$!
echo "$VERDACCIO_PID" > /tmp/verdaccio.pid

# Wait for ready
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${PORT}/-/ping" > /dev/null 2>&1; then
    echo "Verdaccio ready (PID: ${VERDACCIO_PID})"
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: Verdaccio failed to start"
exit 1
