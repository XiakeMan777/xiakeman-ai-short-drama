#!/bin/sh
set -eu

echo "[Xiakeman] Starting BFF on port ${BFF_PORT:-8030}..."
export CLOUD_STORAGE_DIR="${CLOUD_STORAGE_DIR:-/data/xiakeman-cloud-store}"
export AUTH_STORAGE_DIR="${AUTH_STORAGE_DIR:-/data/xiakeman-auth-store}"
export OBJECT_STORAGE_LOCAL_DIR="${OBJECT_STORAGE_LOCAL_DIR:-/data/xiakeman-object-store}"
mkdir -p "$CLOUD_STORAGE_DIR"
mkdir -p "$AUTH_STORAGE_DIR"
mkdir -p "$OBJECT_STORAGE_LOCAL_DIR"
cd /opt/xiakeman-bff
node server.js &
BFF_PID=$!

echo "[Xiakeman] Starting nginx on port 80..."
nginx -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
  echo "[Xiakeman] Stopping services..."
  kill "$BFF_PID" "$NGINX_PID" 2>/dev/null || true
}

trap shutdown INT TERM

while true; do
  if ! kill -0 "$BFF_PID" 2>/dev/null; then
    echo "[Xiakeman] BFF process stopped unexpectedly."
    shutdown
    wait 2>/dev/null || true
    exit 1
  fi

  if ! kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "[Xiakeman] nginx process stopped unexpectedly."
    shutdown
    wait 2>/dev/null || true
    exit 1
  fi

  sleep 2
done
