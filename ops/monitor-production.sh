#!/usr/bin/env bash
set -Eeuo pipefail

PATH="/usr/local/bin:/usr/bin:/bin"

BACKUP_ROOT="${JEEZPAY_BACKUP_ROOT:-$HOME/backups/database}"
STATE_DIR="${JEEZPAY_MONITOR_STATE_DIR:-$HOME/.local/state/jeezpay}"
MAX_BACKUP_AGE_SECONDS="${JEEZPAY_MAX_BACKUP_AGE_SECONDS:-97200}"
MAX_DISK_PERCENT="${JEEZPAY_MAX_DISK_PERCENT:-85}"
MAX_INODE_PERCENT="${JEEZPAY_MAX_INODE_PERCENT:-85}"
MIN_TLS_DAYS="${JEEZPAY_MIN_TLS_DAYS:-14}"

mkdir -p "$STATE_DIR"
chmod 700 "$STATE_DIR"

FAIL=0
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

fail() {
  echo "[$STAMP] MONITOR FAIL: $*" >&2
  FAIL=1
}

for cmd in curl pm2 node ss find stat df openssl timeout date; do
  command -v "$cmd" >/dev/null || fail "missing command: $cmd"
done

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

curl -fsS --connect-timeout 3 --max-time 8 \
  http://127.0.0.1:3000/health >/dev/null ||
  fail "local backend health failed"

curl -fsS --connect-timeout 5 --max-time 10 \
  https://api.jeezpay.co/health >/dev/null ||
  fail "public API health failed"

curl -fsS --connect-timeout 5 --max-time 10 \
  https://admin.jeezpay.co/ >/dev/null ||
  fail "public admin health failed"

PM2_INFO="$(
  pm2 jlist 2>/dev/null |
  node -e '
    let s="";
    process.stdin.on("data",d=>s+=d);
    process.stdin.on("end",()=>{
      const p=JSON.parse(s).find(x=>x.name==="backend");
      if (!p) process.exit(2);
      console.log(JSON.stringify({
        status:p.pm2_env?.status||"",
        script:p.pm2_env?.pm_exec_path||""
      }));
    });
  ' 2>/dev/null
)" || fail "cannot inspect PM2 backend"

if [ -n "${PM2_INFO:-}" ]; then
  PM2_STATUS="$(printf '%s' "$PM2_INFO" | node -e '
    let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).status||""));
  ')"
  PM2_SCRIPT="$(printf '%s' "$PM2_INFO" | node -e '
    let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).script||""));
  ')"

  [ "$PM2_STATUS" = "online" ] || fail "PM2 backend is not online"

  case "$PM2_SCRIPT" in
    "$HOME"/releases/jeezpay-*/backend/server.js) ;;
    *) fail "PM2 backend is not running from immutable releases" ;;
  esac
fi

if ss -lnt | awk '$4 ~ /(^|:)3000$/ {print $4}' | grep -Eq '^(0\.0\.0\.0|\[::\]|\*):3000$'; then
  fail "backend port 3000 is publicly bound"
fi

ss -lnt | awk '$4 ~ /(^|:)3000$/ {print $4}' | grep -q '127.0.0.1:3000' ||
  fail "backend port 3000 is not bound to localhost"

LATEST_BACKUP="$(
  find "$BACKUP_ROOT/daily" -maxdepth 1 -type f -name 'jeezpay-*.dump.enc' \
    -printf '%T@ %p\n' 2>/dev/null |
  sort -nr |
  head -n1 |
  cut -d' ' -f2-
)"

if [ -z "$LATEST_BACKUP" ]; then
  fail "no daily encrypted backup found"
else
  [ "$(stat -c '%a' "$LATEST_BACKUP")" = "600" ] ||
    fail "latest backup permissions are not 600"

  [ -f "${LATEST_BACKUP}.sha256" ] ||
    fail "latest backup checksum sidecar missing"

  NOW="$(date +%s)"
  MTIME="$(stat -c '%Y' "$LATEST_BACKUP")"
  AGE=$((NOW - MTIME))

  [ "$AGE" -le "$MAX_BACKUP_AGE_SECONDS" ] ||
    fail "latest backup is stale (${AGE}s old)"
fi

DISK_USED="$(df -P "$HOME" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
[ "$DISK_USED" -lt "$MAX_DISK_PERCENT" ] ||
  fail "disk usage is ${DISK_USED}%"

INODE_USED="$(df -Pi "$HOME" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
[ "$INODE_USED" -lt "$MAX_INODE_PERCENT" ] ||
  fail "inode usage is ${INODE_USED}%"

for HOST in api.jeezpay.co admin.jeezpay.co; do
  END_DATE="$(
    timeout 10 openssl s_client -connect "${HOST}:443" -servername "$HOST" </dev/null 2>/dev/null |
    openssl x509 -noout -enddate 2>/dev/null |
    sed 's/^notAfter=//'
  )" || true

  if [ -z "$END_DATE" ]; then
    fail "cannot read TLS expiry for $HOST"
    continue
  fi

  END_EPOCH="$(date -d "$END_DATE" +%s 2>/dev/null || true)"
  NOW="$(date +%s)"

  if [ -z "$END_EPOCH" ]; then
    fail "cannot parse TLS expiry for $HOST"
    continue
  fi

  DAYS_LEFT=$(((END_EPOCH - NOW) / 86400))
  [ "$DAYS_LEFT" -ge "$MIN_TLS_DAYS" ] ||
    fail "$HOST TLS expires in ${DAYS_LEFT} days"
done

if [ "$FAIL" -eq 0 ]; then
  printf '%s\n' "$STAMP" > "$STATE_DIR/monitor.last-ok"
  chmod 600 "$STATE_DIR/monitor.last-ok"
  echo "PRODUCTION MONITOR: GREEN"
  exit 0
fi

printf '%s\n' "$STAMP" > "$STATE_DIR/monitor.last-failure"
chmod 600 "$STATE_DIR/monitor.last-failure"
exit 1
