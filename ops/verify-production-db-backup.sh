#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
PATH="/usr/local/bin:/usr/bin:/bin"

KEY_FILE="${JEEZPAY_BACKUP_KEY_FILE:-$HOME/.config/jeezpay/backup-encryption.key}"
BACKUP_ROOT="${JEEZPAY_BACKUP_ROOT:-$HOME/backups/database}"

abort() {
  echo "BACKUP VERIFY FAILED: $*" >&2
  exit 1
}

for cmd in openssl pg_restore sha256sum stat mktemp find sort head cut grep; do
  command -v "$cmd" >/dev/null || abort "missing command: $cmd"
done

test -f "$KEY_FILE" || abort "missing encryption key"
test "$(stat -c '%a' "$KEY_FILE")" = "600" ||
  abort "encryption key must be mode 600"

if [ -n "${1:-}" ]; then
  BACKUP="$1"
else
  BACKUP="$(
    find "$BACKUP_ROOT/daily" \
      -maxdepth 1 \
      -type f \
      -name 'jeezpay-*.dump.enc' \
      -printf '%T@ %p\n' |
    sort -nr |
    head -n1 |
    cut -d' ' -f2-
  )"
fi

[ -n "$BACKUP" ] || abort "no backup archive found"
test -f "$BACKUP" || abort "backup not found: $BACKUP"
test "$(stat -c '%a' "$BACKUP")" = "600" ||
  abort "backup archive must be mode 600"

CHECKSUM="${BACKUP}.sha256"
test -f "$CHECKSUM" || abort "checksum sidecar missing"

(
  cd "$(dirname "$BACKUP")"
  sha256sum -c "$(basename "$CHECKSUM")"
)

echo "CHECKSUM: GREEN"

PLAIN_TMP="$(mktemp "$BACKUP_ROOT/.verify.XXXXXX.dump")"
TOC="$(mktemp "$BACKUP_ROOT/.verify-toc.XXXXXX")"
chmod 600 "$PLAIN_TMP" "$TOC"

cleanup() {
  rm -f "$PLAIN_TMP" "$TOC"
}
trap cleanup EXIT

openssl enc \
  -d \
  -aes-256-cbc \
  -pbkdf2 \
  -iter 200000 \
  -pass "file:$KEY_FILE" \
  -in "$BACKUP" \
  -out "$PLAIN_TMP"

test -s "$PLAIN_TMP" || abort "decrypted archive is empty"

pg_restore --list "$PLAIN_TMP" > "$TOC"

ENTRY_COUNT="$(grep -Ec '^[0-9]+;' "$TOC" || true)"

[ "$ENTRY_COUNT" -gt 0 ] || abort "archive contains no restore entries"

printf 'backup=%s\n' "$BACKUP"
printf 'bytes=%s\n' "$(stat -c '%s' "$BACKUP")"
printf 'restore_entries=%s\n' "$ENTRY_COUNT"

echo "================================================"
echo "PRODUCTION BACKUP VERIFICATION: GREEN"
echo "CHECKSUM: GREEN"
echo "DECRYPTION: GREEN"
echo "PG_RESTORE ARCHIVE: GREEN"
echo "================================================"
