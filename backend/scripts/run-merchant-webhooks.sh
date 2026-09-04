#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/jeezpay-merchant-webhooks.lock"
exec 9>"$LOCK_FILE"

if ! flock -n 9; then
  echo "Merchant webhook worker already running; skipping overlap."
  exit 0
fi

resolve_bin() {
  local override="$1"
  local command_name="$2"

  if [ -n "$override" ]; then
    printf '%s' "$override"
    return
  fi

  command -v "$command_name" || true
}

PM2_BIN="$(resolve_bin "${PM2_BIN:-}" pm2)"
NODE_BIN="$(resolve_bin "${NODE_BIN:-}" node)"

if [ -z "$PM2_BIN" ] || [ ! -x "$PM2_BIN" ]; then
  echo "ABORT: PM2 executable not found"
  exit 1
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "ABORT: Node executable not found"
  exit 1
fi

BACKEND_DIR="$($PM2_BIN jlist | $NODE_BIN -e '
let s="";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  const rows = JSON.parse(s);
  const p = rows.find(x => x.name === "backend" && x.pm2_env?.status === "online");
  const cwd = p?.pm2_env?.pm_cwd;
  if (!cwd) process.exit(2);
  process.stdout.write(cwd);
});
')"

if [ -z "$BACKEND_DIR" ] || [ ! -d "$BACKEND_DIR" ]; then
  echo "ABORT: active backend directory not found"
  exit 1
fi

if [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "ABORT: active backend .env not found"
  exit 1
fi

if [ ! -f "$BACKEND_DIR/scripts/process-merchant-webhooks.js" ]; then
  echo "ABORT: merchant webhook worker missing from active backend"
  exit 1
fi

cd "$BACKEND_DIR"

exec "$NODE_BIN" \
  scripts/process-merchant-webhooks.js \
  --env .env \
  --limit "${MERCHANT_WEBHOOK_BATCH_LIMIT:-20}"
