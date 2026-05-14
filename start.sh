#!/bin/sh
set -eu

echo "[Xiakeman] Starting BFF on port ${BFF_PORT:-8030}..."
cd /opt/xiakeman-bff
if [ -f server.cjs ]; then
  node server.cjs &
else
  node server.js &
fi
BFF_PID=$!

echo "[Xiakeman] Starting nginx on port 8022..."
nginx -g 'daemon off;' &
NGINX_PID=$!

shutdown() {
  echo "[Xiakeman] Stopping services..."
  kill "$BFF_PID" "$NGINX_PID" 2>/dev/null || true
}

trap shutdown INT TERM

wait -n "$BFF_PID" "$NGINX_PID" 2>/dev/null || true
shutdown
wait 2>/dev/null || true
