#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(
  cd "$(
    dirname "${BASH_SOURCE[0]}"
  )/.." &&
  pwd
)"

if [ "${JEEZPAY_HISTORICAL_TEST_ACK:-}" != "SCRATCH_OR_PRE_CUTOVER" ]; then
  echo "ABORT: historical Ledger tests are not a production gate."
  echo
  echo "They model bootstrap/opening-cutover state and may"
  echo "legitimately fail against the live post-cutover Ledger."
  echo
  echo "To run them intentionally on a scratch or pre-cutover DB:"
  echo
  echo "  JEEZPAY_HISTORICAL_TEST_ACK=SCRATCH_OR_PRE_CUTOVER \\"
  echo "  SUPABASE_DB_URI=... npm run test:launch:historical"
  exit 2
fi

if [ -z "${SUPABASE_DB_URI:-}" ]; then
  echo "ABORT: SUPABASE_DB_URI is required"
  exit 1
fi

PSQL_BIN="$(
  command -v psql || true
)"

if [ -z "$PSQL_BIN" ]; then
  echo "ABORT: psql not found"
  exit 1
fi

TESTS=(
  20260903_ledger_v2_legacy_mapping_test.sql
  20260903_ledger_v2_opening_snapshot_test.sql
  20260903_ledger_v2_opening_cutover_test.sql
)

for name in "${TESTS[@]}"; do
  file="$ROOT/sql/tests/$name"

  echo
  echo "=== HISTORICAL SQL TEST: $name ==="

  test -s "$file"

  grep -Eq \
    '^[[:space:]]*BEGIN[[:space:]]*;' \
    "$file"

  grep -Eq \
    '^[[:space:]]*ROLLBACK[[:space:]]*;' \
    "$file"

  "$PSQL_BIN" \
    "$SUPABASE_DB_URI" \
    -v ON_ERROR_STOP=1 \
    -f "$file"
done

echo
echo "============================================"
echo "HISTORICAL LEDGER REGRESSION GREEN"
echo "SCRATCH / PRE-CUTOVER SEMANTICS"
echo "============================================"
