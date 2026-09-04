#!/usr/bin/env bash
set -euo pipefail

LOCK_FILE="${XDG_RUNTIME_DIR:-/tmp}/jeezpay-sanctions-sync.lock"
exec 9>"$LOCK_FILE"
if ! /usr/bin/flock -n 9; then
  echo "Sanctions sync: another sync is already running"
  exit 0
fi

PM2_BIN="${PM2_BIN:-$(command -v pm2 || true)}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$PM2_BIN" ] || [ ! -x "$PM2_BIN" ] || [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "Sanctions sync: pm2/node executable not available" >&2
  exit 2
fi

BACKEND_DIR="$(
  "$PM2_BIN" jlist | "$NODE_BIN" -e '
    let s="";
    process.stdin.on("data",d=>s+=d);
    process.stdin.on("end",()=>{
      const rows=JSON.parse(s);
      const p=rows.find(x=>x.name==="backend" && x.pm2_env?.status==="online");
      if(!p?.pm2_env?.pm_cwd) process.exit(2);
      process.stdout.write(p.pm2_env.pm_cwd);
    });
  '
)"

if [ -z "$BACKEND_DIR" ] || [ ! -f "$BACKEND_DIR/scripts/sync-sanctions-runner.py" ] || [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "Sanctions sync: active backend release not found" >&2
  exit 2
fi

exec /usr/bin/python3 "$BACKEND_DIR/scripts/sync-sanctions-runner.py" --env "$BACKEND_DIR/.env"
