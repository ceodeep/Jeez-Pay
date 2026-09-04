#!/usr/bin/env bash
set -euo pipefail

BACKEND_DIR="$(
  pm2 jlist | node -e '
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

if [ -z "$BACKEND_DIR" ] || [ ! -f "$BACKEND_DIR/scripts/sync-sanctions.py" ] || [ ! -f "$BACKEND_DIR/.env" ]; then
  echo "Sanctions sync: active backend release not found" >&2
  exit 2
fi

exec /usr/bin/python3 "$BACKEND_DIR/scripts/sync-sanctions.py" --env "$BACKEND_DIR/.env"
