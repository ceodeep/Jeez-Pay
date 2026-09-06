#!/usr/bin/env bash
set -Eeuo pipefail

MODE="deploy"

if [ "${1:-}" = "--validate-only" ]; then
  MODE="validate"
  shift
fi

TARGET_SHA="${1:-}"

PROD_BRANCH="hardening/production-v1"

REPO="$HOME/Jeez-Pay"
RELEASES="$HOME/releases"

ADMIN_ROOT="/var/www/jeezpay-admin"
ADMIN_HELPER="/usr/local/sbin/jeezpay-admin-webroot"

LOCK_FILE="/tmp/jeezpay-production-deploy.lock"

TMP_RELEASE=""
ADMIN_STAGE=""
ADMIN_PREVIOUS=""

SMOKE_PID=""

BACKEND_CHANGED=0
ADMIN_CHANGED=0

OLD_EXEC=""
OLD_RELEASE=""
OLD_SHA=""

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

abort() {
  echo "ABORT: $*" >&2
  exit 1
}

get_backend_exec() {
  pm2 jlist | node -e '
    let s="";
    process.stdin.on("data",d=>s+=d);

    process.stdin.on("end",()=>{
      const p=JSON.parse(s).find(
        x =>
          x.name === "backend" &&
          x.pm2_env?.status === "online"
      );

      if (!p?.pm2_env?.pm_exec_path) {
        process.exit(2);
      }

      process.stdout.write(
        p.pm2_env.pm_exec_path
      );
    });
  '
}

local_health() {
  curl \
    --silent \
    --show-error \
    --fail \
    --connect-timeout 3 \
    --max-time 8 \
    http://127.0.0.1:3000/health \
    >/dev/null
}

public_api_health() {
  curl \
    --silent \
    --show-error \
    --fail \
    --connect-timeout 3 \
    --max-time 10 \
    https://api.jeezpay.co/health \
    >/dev/null
}

public_admin_health() {
  curl \
    --silent \
    --show-error \
    --fail \
    --connect-timeout 3 \
    --max-time 10 \
    https://admin.jeezpay.co/ \
    >/dev/null
}

wait_backend() {
  local attempt

  for attempt in $(seq 1 20); do
    if local_health &&
       public_api_health; then
      return 0
    fi

    sleep 1
  done

  return 1
}

rollback_admin() {
  [ "$ADMIN_CHANGED" -eq 1 ] || return 0

  echo
  echo "=== ROLLBACK ADMIN ==="

  sudo -n \
    "$ADMIN_HELPER" \
    rollback \
    "$TARGET_SHA" \
    "$OLD_SHA" \
    "$STAMP" \
    || true

  public_admin_health || true

  ADMIN_CHANGED=0

  echo "ADMIN ROLLBACK: ATTEMPTED"
}

rollback_backend() {
  [ "$BACKEND_CHANGED" -eq 1 ] || return 0

  echo
  echo "=== ROLLBACK BACKEND ==="

  pm2 delete backend \
    >/dev/null 2>&1 || true

  (
    cd "$OLD_RELEASE/backend"

    PORT=3000 \
    NODE_ENV=production \
      pm2 start \
      "$OLD_EXEC" \
      --name backend \
      --cwd "$OLD_RELEASE/backend"
  ) >/dev/null

  pm2 save >/dev/null

  wait_backend || true

  BACKEND_CHANGED=0

  echo "BACKEND ROLLBACK: ATTEMPTED"
}

cleanup() {
  if [ -n "$SMOKE_PID" ]; then
    kill "$SMOKE_PID" \
      >/dev/null 2>&1 || true
  fi

  if [ -n "$TMP_RELEASE" ] &&
     [ -d "$TMP_RELEASE" ]; then
    rm -rf "$TMP_RELEASE" || true
  fi

  if [ -n "$TARGET_SHA" ] &&
     [ -x "$ADMIN_HELPER" ]; then
    sudo -n \
      "$ADMIN_HELPER" \
      cleanup-stage \
      "$TARGET_SHA" \
      >/dev/null 2>&1 || true
  fi
}

fail_handler() {
  RC=$?

  trap - ERR

  rollback_admin || true
  rollback_backend || true
  cleanup

  echo
  echo "================================================"
  echo "PRODUCTION DEPLOY FAILED SAFELY"
  echo "Exit code: $RC"
  echo "================================================"

  exit "$RC"
}

trap fail_handler ERR
trap cleanup EXIT

echo "================================================"
echo "JEEZPAY CONTROLLED PRODUCTION DEPLOY"
echo "MODE: $MODE"
echo "================================================"

echo
echo "=== A. VALIDATE INPUT / LOCK ==="

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  abort "target must be a full 40-character SHA"

for cmd in \
  git \
  node \
  npm \
  pm2 \
  curl \
  tar \
  flock \
  python3; do

  command -v "$cmd" >/dev/null ||
    abort "missing required command: $cmd"
done

exec 9>"$LOCK_FILE"

flock -n 9 ||
  abort "another production deployment is running"

echo "INPUT / LOCK: GREEN"

echo
echo "=== B. VERIFY PROTECTED PRODUCTION SHA ==="

git -C "$REPO" \
  fetch origin "$PROD_BRANCH"

REMOTE_SHA="$(
  git -C "$REPO" \
    rev-parse "origin/$PROD_BRANCH"
)"

echo "target_sha=$TARGET_SHA"
echo "production_sha=$REMOTE_SHA"

test "$REMOTE_SHA" = "$TARGET_SHA"

git -C "$REPO" \
  cat-file -e \
  "${TARGET_SHA}^{commit}"

echo "PRODUCTION SHA: GREEN"

echo
echo "=== C. VERIFY CURRENT LIVE BACKEND ==="

OLD_EXEC="$(
  readlink -f "$(get_backend_exec)"
)"

case "$OLD_EXEC" in
  "$HOME"/releases/jeezpay-*/backend/server.js)
    ;;
  *)
    abort "unexpected live backend executable: $OLD_EXEC"
    ;;
esac

OLD_RELEASE="$(
  dirname "$(dirname "$OLD_EXEC")"
)"

OLD_SHA="${OLD_RELEASE##*/jeezpay-}"

[[ "$OLD_SHA" =~ ^[0-9a-f]{40}$ ]] ||
  abort "cannot derive current live SHA"

test -f "$OLD_RELEASE/backend/.env"

test "$(
  stat -c '%a' \
  "$OLD_RELEASE/backend/.env"
)" = "600"

local_health
public_api_health
public_admin_health

echo "current_live_sha=$OLD_SHA"
echo "CURRENT PRODUCTION: GREEN"

echo
echo "=== D. VERIFY HISTORY / DATABASE MIGRATION BOUNDARY ==="

git -C "$REPO" \
  merge-base --is-ancestor \
  "$OLD_SHA" \
  "$TARGET_SHA"

MIGRATION_DIFF="$(
  git -C "$REPO" \
    diff \
    --name-only \
    "$OLD_SHA" \
    "$TARGET_SHA" \
    -- backend/sql |
  grep -E \
    '^backend/sql/[0-9].*\.sql$' \
    || true
)"

if [ -n "$MIGRATION_DIFF" ]; then
  echo "Production migration files differ:"
  printf '%s\n' "$MIGRATION_DIFF"

  if [ "${MIGRATIONS_CONFIRMED:-NO}" != "YES" ]; then
    abort \
      "database migrations changed; confirm they are already applied before deployment"
  fi

  echo "DATABASE MIGRATION ACKNOWLEDGEMENT: PRESENT"
else
  echo "DATABASE MIGRATION DIFF: NONE"
fi

echo "HISTORY / DB BOUNDARY: GREEN"

if [ "$MODE" = "validate" ]; then
  echo
  echo "================================================"
  echo "PRODUCTION DEPLOY PREFLIGHT: GREEN"
  echo "NO CHANGES MADE"
  echo "================================================"
  exit 0
fi

echo
echo "=== E0. VERIFY SCOPED SUDO HELPER ==="

test -x "$ADMIN_HELPER" ||
  abort "admin helper not installed"

test "$(
  stat -c '%U:%G:%a' "$ADMIN_HELPER"
)" = "root:root:755" ||
  abort "admin helper ownership/mode invalid"

sudo -n \
  "$ADMIN_HELPER" \
  check

echo "SCOPED SUDO HELPER: GREEN"

if [ "$OLD_SHA" = "$TARGET_SHA" ]; then
  echo
  echo "TARGET IS ALREADY THE LIVE BACKEND SHA"
  echo "NO DEPLOYMENT REQUIRED"
  exit 0
fi

NEW_RELEASE="$RELEASES/jeezpay-${TARGET_SHA}"

test ! -e "$NEW_RELEASE" ||
  abort "immutable target release already exists"

TMP_RELEASE="$RELEASES/.jeezpay-${TARGET_SHA}.tmp.$$"

mkdir -p "$TMP_RELEASE"

echo
echo "=== E. BUILD IMMUTABLE RELEASE ==="

git -C "$REPO" \
  archive "$TARGET_SHA" |
tar -x -C "$TMP_RELEASE"

install \
  -m 600 \
  "$OLD_RELEASE/backend/.env" \
  "$TMP_RELEASE/backend/.env"

printf '%s\n' \
  "$TARGET_SHA" \
  > "$TMP_RELEASE/.source-sha"

cd "$TMP_RELEASE/backend"

npm ci

npm audit \
  --omit=dev \
  --audit-level=high

npm test

rm -rf scripts/__pycache__

cd "$TMP_RELEASE/admin-dashboard"

npm ci

npm audit \
  --audit-level=high

npm run lint
npm run build

echo "IMMUTABLE RELEASE BUILD: GREEN"

echo
echo "=== F. ISOLATED BACKEND SMOKE ==="

SMOKE_PORT="$(
  python3 - <<'PY'
import socket

s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"

SMOKE_LOG="$TMP_RELEASE/backend/.smoke.log"

(
  cd "$TMP_RELEASE/backend"

  PORT="$SMOKE_PORT" \
  NODE_ENV=production \
    node server.js \
    >"$SMOKE_LOG" \
    2>&1
) &

SMOKE_PID=$!

SMOKE_OK=0

for attempt in $(seq 1 20); do
  if curl \
    --silent \
    --fail \
    --connect-timeout 2 \
    --max-time 5 \
    "http://127.0.0.1:${SMOKE_PORT}/health" \
    >/dev/null; then

    SMOKE_OK=1
    break
  fi

  if ! kill -0 "$SMOKE_PID" \
    >/dev/null 2>&1; then
    break
  fi

  sleep 1
done

test "$SMOKE_OK" = "1"

kill "$SMOKE_PID" \
  >/dev/null 2>&1 || true

wait "$SMOKE_PID" \
  >/dev/null 2>&1 || true

SMOKE_PID=""

rm -f "$SMOKE_LOG"

touch "$TMP_RELEASE/.deploy-complete"

mv \
  "$TMP_RELEASE" \
  "$NEW_RELEASE"

TMP_RELEASE=""

echo "ISOLATED BACKEND SMOKE: GREEN"

echo
echo "=== G. PREPARE ADMIN WEBROOT ==="

ADMIN_STAGE="/var/www/.jeezpay-admin-${TARGET_SHA}.tmp"

ADMIN_PREVIOUS="/var/www/.jeezpay-admin-rollback-${OLD_SHA}-${STAMP}"

sudo -n \
  "$ADMIN_HELPER" \
  stage \
  "$TARGET_SHA"

echo "ADMIN STAGE: GREEN"

echo
echo "=== H. SWITCH BACKEND ==="

BACKEND_CHANGED=1

pm2 delete backend >/dev/null

(
  cd "$NEW_RELEASE/backend"

  PORT=3000 \
  NODE_ENV=production \
    pm2 start \
    "$NEW_RELEASE/backend/server.js" \
    --name backend \
    --cwd "$NEW_RELEASE/backend"
) >/dev/null

pm2 save >/dev/null

wait_backend

NEW_EXEC="$(
  readlink -f "$(get_backend_exec)"
)"

test "$NEW_EXEC" = \
  "$NEW_RELEASE/backend/server.js"

echo "BACKEND SWITCH: GREEN"

echo
echo "=== I. ATOMIC ADMIN WEBROOT SWITCH ==="

ADMIN_CHANGED=1

sudo -n \
  "$ADMIN_HELPER" \
  activate \
  "$TARGET_SHA" \
  "$OLD_SHA" \
  "$STAMP"

public_admin_health
public_api_health

echo "ADMIN SWITCH: GREEN"

echo
echo "=== J. FINAL PRODUCTION VERIFICATION ==="

local_health
public_api_health
public_admin_health

FINAL_EXEC="$(
  readlink -f "$(get_backend_exec)"
)"

test "$FINAL_EXEC" = \
  "$NEW_RELEASE/backend/server.js"

test -f \
  "$NEW_RELEASE/.deploy-complete"

pm2 save >/dev/null

BACKEND_CHANGED=0
ADMIN_CHANGED=0

echo
echo "================================================"
echo "CONTROLLED PRODUCTION DEPLOY: GREEN"
echo "================================================"
echo "TARGET SHA: $TARGET_SHA"
echo "PREVIOUS BACKEND SHA: $OLD_SHA"
echo "LIVE BACKEND: $FINAL_EXEC"
echo "NEW RELEASE: $NEW_RELEASE"
echo "ADMIN ROLLBACK WEBROOT: $ADMIN_PREVIOUS"
echo "API: GREEN"
echo "ADMIN: GREEN"
echo "PM2: GREEN"
echo "================================================"
