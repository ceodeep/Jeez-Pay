#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH="/usr/local/bin:/usr/bin:/bin"

CONFIG_FILE="${JEEZPAY_BACKUP_CONFIG:-$HOME/.config/jeezpay/db-backup.conf}"
KEY_FILE="${JEEZPAY_BACKUP_KEY_FILE:-$HOME/.config/jeezpay/backup-encryption.key}"
BACKUP_ROOT="${JEEZPAY_BACKUP_ROOT:-$HOME/backups/database}"
LOCK_FILE="${JEEZPAY_BACKUP_LOCK:-/tmp/jeezpay-db-backup.lock}"

abort() {
  echo "BACKUP FAILED: $*" >&2
  exit 1
}

require_mode_600() {
  local file="$1"
  test -f "$file" || abort "missing file: $file"
  test "$(stat -c '%a' "$file")" = "600" ||
    abort "file must be mode 600: $file"
}

for cmd in pg_dump pg_restore psql openssl sha256sum flock nice find ln stat; do
  command -v "$cmd" >/dev/null || abort "missing command: $cmd"
done

require_mode_600 "$CONFIG_FILE"
require_mode_600 "$KEY_FILE"

# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${PGHOST:?PGHOST missing from backup config}"
: "${PGPORT:?PGPORT missing from backup config}"
: "${PGDATABASE:?PGDATABASE missing from backup config}"
: "${PGUSER:?PGUSER missing from backup config}"

PGPASSFILE="${PGPASSFILE:-$HOME/.config/jeezpay/.pgpass}"
PGSSLMODE="${PGSSLMODE:-require}"
PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-10}"

require_mode_600 "$PGPASSFILE"

export PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE PGSSLMODE PGCONNECT_TIMEOUT

mkdir -p \
  "$BACKUP_ROOT/daily" \
  "$BACKUP_ROOT/weekly" \
  "$BACKUP_ROOT/monthly"

chmod 700 \
  "$BACKUP_ROOT" \
  "$BACKUP_ROOT/daily" \
  "$BACKUP_ROOT/weekly" \
  "$BACKUP_ROOT/monthly"

exec 9>"$LOCK_FILE"
flock -n 9 || abort "another database backup is already running"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WEEKDAY="$(date -u +%u)"
DAY_OF_MONTH="$(date -u +%d)"

NAME="jeezpay-${STAMP}.dump.enc"
TMP="$BACKUP_ROOT/.${NAME}.tmp.$$"
FINAL="$BACKUP_ROOT/daily/$NAME"
CHECKSUM="${FINAL}.sha256"

cleanup() {
  rm -f "$TMP"
}
trap cleanup EXIT

echo "================================================"
echo "JEEZPAY PRODUCTION DATABASE BACKUP"
echo "timestamp=$STAMP"
echo "================================================"

DB_OK="$(psql -X -v ON_ERROR_STOP=1 -Atqc 'select 1')"
test "$DB_OK" = "1" || abort "database connectivity check failed"
echo "DATABASE CONNECTIVITY: GREEN"

DUMP_CMD=(
  pg_dump
  --format=custom
  --compress=9
  --no-owner
  --no-privileges
  --dbname="$PGDATABASE"
)

if command -v ionice >/dev/null 2>&1; then
  nice -n 15 ionice -c2 -n7 "${DUMP_CMD[@]}" |
    openssl enc \
      -aes-256-cbc \
      -salt \
      -pbkdf2 \
      -iter 200000 \
      -pass "file:$KEY_FILE" \
      -out "$TMP"
else
  nice -n 15 "${DUMP_CMD[@]}" |
    openssl enc \
      -aes-256-cbc \
      -salt \
      -pbkdf2 \
      -iter 200000 \
      -pass "file:$KEY_FILE" \
      -out "$TMP"
fi

test -s "$TMP" || abort "encrypted dump is empty"

echo "ENCRYPTED DUMP: CREATED"

openssl enc \
  -d \
  -aes-256-cbc \
  -pbkdf2 \
  -iter 200000 \
  -pass "file:$KEY_FILE" \
  -in "$TMP" |
  pg_restore --list >/dev/null

echo "ARCHIVE STRUCTURE: GREEN"

mv "$TMP" "$FINAL"
chmod 600 "$FINAL"

(
  cd "$BACKUP_ROOT/daily"
  sha256sum "$NAME" > "${NAME}.sha256"
)

chmod 600 "$CHECKSUM"

if [ "$WEEKDAY" = "7" ]; then
  ln "$FINAL" "$BACKUP_ROOT/weekly/$NAME"
  ln "$CHECKSUM" "$BACKUP_ROOT/weekly/${NAME}.sha256"
  echo "WEEKLY RETENTION COPY: CREATED"
fi

if [ "$DAY_OF_MONTH" = "01" ]; then
  ln "$FINAL" "$BACKUP_ROOT/monthly/$NAME"
  ln "$CHECKSUM" "$BACKUP_ROOT/monthly/${NAME}.sha256"
  echo "MONTHLY RETENTION COPY: CREATED"
fi

find "$BACKUP_ROOT/daily" \
  -type f \
  -mtime +14 \
  \( -name 'jeezpay-*.dump.enc' -o -name 'jeezpay-*.dump.enc.sha256' \) \
  -delete

find "$BACKUP_ROOT/weekly" \
  -type f \
  -mtime +63 \
  \( -name 'jeezpay-*.dump.enc' -o -name 'jeezpay-*.dump.enc.sha256' \) \
  -delete

find "$BACKUP_ROOT/monthly" \
  -type f \
  -mtime +370 \
  \( -name 'jeezpay-*.dump.enc' -o -name 'jeezpay-*.dump.enc.sha256' \) \
  -delete

SIZE="$(stat -c '%s' "$FINAL")"
SHA256="$(sha256sum "$FINAL" | awk '{print $1}')"

echo "backup=$FINAL"
echo "bytes=$SIZE"
echo "sha256=$SHA256"
echo "retention=daily:14d weekly:63d monthly:370d"
echo "================================================"
echo "PRODUCTION DATABASE BACKUP: GREEN"
echo "================================================"
