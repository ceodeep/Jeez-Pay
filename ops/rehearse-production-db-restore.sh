#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH="/usr/local/bin:/usr/bin:/bin"

KEY_FILE="${JEEZPAY_BACKUP_KEY_FILE:-$HOME/.config/jeezpay/backup-encryption.key}"
BACKUP_ROOT="${JEEZPAY_BACKUP_ROOT:-$HOME/backups/database}"
LOCK_FILE="${JEEZPAY_RESTORE_REHEARSAL_LOCK:-/tmp/jeezpay-db-restore-rehearsal.lock}"

abort() {
  echo "RESTORE REHEARSAL FAILED: $*" >&2
  exit 1
}

for cmd in openssl pg_restore sha256sum stat mktemp find sort flock; do
  command -v "$cmd" >/dev/null || abort "missing command: $cmd"
done

test -f "$KEY_FILE" || abort "missing encryption key"
test "$(stat -c '%a' "$KEY_FILE")" = "600" ||
  abort "encryption key must be mode 600"

exec 9>"$LOCK_FILE"
flock -n 9 || abort "another restore rehearsal is already running"

if [ -n "${1:-}" ]; then
  BACKUP="$1"
else
  BACKUP="$(
    find "$BACKUP_ROOT/daily" -maxdepth 1 -type f -name 'jeezpay-*.dump.enc' \
      -printf '%T@ %p\n' |
    sort -nr |
    head -n1 |
    cut -d' ' -f2-
  )"
fi

[ -n "$BACKUP" ] || abort "no encrypted backup found"
test -f "$BACKUP" || abort "backup not found: $BACKUP"
test "$(stat -c '%a' "$BACKUP")" = "600" ||
  abort "backup archive must be mode 600"

CHECKSUM="${BACKUP}.sha256"
test -f "$CHECKSUM" || abort "checksum sidecar missing"

(
  cd "$(dirname "$BACKUP")"
  sha256sum -c "$(basename "$CHECKSUM")" >/dev/null
)

echo "CHECKSUM: GREEN"

TMP_DIR="$(mktemp -d /tmp/jeezpay-restore-rehearsal.XXXXXX)"
chmod 700 "$TMP_DIR"

PLAIN="$TMP_DIR/backup.dump"
TOC="$TMP_DIR/toc.txt"
SCHEMA="$TMP_DIR/schema.sql"

cleanup() {
  if [ -f "$PLAIN" ]; then
    if command -v shred >/dev/null 2>&1; then
      shred -u "$PLAIN" >/dev/null 2>&1 || rm -f "$PLAIN"
    else
      rm -f "$PLAIN"
    fi
  fi

  rm -f "$TOC" "$SCHEMA"
  rmdir "$TMP_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

openssl enc \
  -d \
  -aes-256-cbc \
  -pbkdf2 \
  -iter 200000 \
  -pass "file:$KEY_FILE" \
  -in "$BACKUP" \
  -out "$PLAIN"

chmod 600 "$PLAIN"
test -s "$PLAIN" || abort "decrypted archive is empty"

echo "DECRYPTION: GREEN"

pg_restore --list "$PLAIN" > "$TOC"
chmod 600 "$TOC"

ENTRY_COUNT="$(grep -Ec '^[0-9]+;' "$TOC" || true)"
[ "$ENTRY_COUNT" -gt 0 ] || abort "archive contains no restore entries"

echo "ARCHIVE TOC: GREEN ($ENTRY_COUNT entries)"

pg_restore \
  --no-owner \
  --no-privileges \
  --file=/dev/null \
  "$PLAIN"

echo "FULL ARCHIVE PARSE: GREEN"

pg_restore \
  --schema-only \
  --no-owner \
  --no-privileges \
  --file="$SCHEMA" \
  "$PLAIN"

chmod 600 "$SCHEMA"
test -s "$SCHEMA" || abort "schema restore output is empty"

echo "SCHEMA RESTORE GENERATION: GREEN"

echo "backup=$BACKUP"
echo "bytes=$(stat -c '%s' "$BACKUP")"
echo "restore_entries=$ENTRY_COUNT"
echo "database_writes=NONE"
echo "plaintext_cleanup=ENABLED"
echo "================================================"
echo "PRODUCTION DATABASE RESTORE REHEARSAL: GREEN"
echo "================================================"
