#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATIC_ONLY=0
FULL=0
API_BASE_URL="${API_BASE_URL:-}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --static-only)
      STATIC_ONLY=1
      ;;
    --full)
      FULL=1
      ;;
    --api-base)
      shift
      API_BASE_URL="${1:-}"
      if [ -z "$API_BASE_URL" ]; then
        echo "ABORT: --api-base requires a URL"
        exit 2
      fi
      ;;
    *)
      echo "ABORT: unknown argument: $1"
      exit 2
      ;;
  esac
  shift
done

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
PSQL_BIN="${PSQL_BIN:-$(command -v psql || true)}"
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"
CURL_BIN="${CURL_BIN:-$(command -v curl || true)}"

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "ABORT: node executable not found"
  exit 1
fi

static_checks() {
  echo "=== STATIC REGRESSION ==="

  "$NODE_BIN" --check "$ROOT/server.js"
  "$NODE_BIN" --check "$ROOT/app.js"

  while IFS= read -r -d '' file; do
    "$NODE_BIN" --check "$file"
  done < <(find "$ROOT/src" "$ROOT/scripts" -type f -name '*.js' -print0 | sort -z)

  while IFS= read -r -d '' file; do
    bash -n "$file"
  done < <(find "$ROOT/scripts" -type f -name '*.sh' -print0 | sort -z)

  if [ -n "$PYTHON_BIN" ] && [ -x "$PYTHON_BIN" ]; then
    "$PYTHON_BIN" -m py_compile \
      "$ROOT/scripts/sync-sanctions.py" \
      "$ROOT/scripts/sync-sanctions-runner.py"

    "$PYTHON_BIN" \
      "$ROOT/scripts/sync-sanctions-runner.py" \
      --self-test
  fi

  "$NODE_BIN" \
    "$ROOT/scripts/self-test-auth-session.js"

  "$NODE_BIN" \
    "$ROOT/scripts/self-test-auth-active-status.js"

  "$NODE_BIN" \
    "$ROOT/scripts/self-test-admin-mfa.js"

  "$NODE_BIN" \
    "$ROOT/scripts/self-test-admin-mfa-enrollment.js"

  "$NODE_BIN" \
    "$ROOT/scripts/self-test-admin-mfa-auth.js"

  if [ -f "$ROOT/.env" ]; then
    "$NODE_BIN" \
      "$ROOT/scripts/process-merchant-webhooks.js" \
      --env "$ROOT/.env" \
      --self-test
  else
    echo "merchant webhook runtime self-test: SKIPPED (.env absent)"
  fi

  echo "STATIC REGRESSION: OK"
}

query_scalar() {
  "$PSQL_BIN" "$SUPABASE_DB_URI" -v ON_ERROR_STOP=1 -Atqc "$1"
}

assert_runtime_invariants() {
  echo
  echo "=== RUNTIME INVARIANTS ==="

  local bad_reconciliation
  local unbalanced
  local reconciliation_diff
  local bad_sanctions
  local phase6_ready
  local phase7_ready
  local stale_webhook_locks
  local malformed_webhook_locks

  bad_reconciliation="$(query_scalar "
    SELECT count(*)
    FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status <> 'MATCHED'
       OR difference IS DISTINCT FROM 0;
  ")"

  unbalanced="$(query_scalar "
    SELECT count(*) FROM public.ledger_v2_unbalanced_journals;
  ")"

  reconciliation_diff="$(query_scalar "
    SELECT count(*)
    FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0;
  ")"

  bad_sanctions="$(query_scalar "
    WITH required(source_code) AS (
      VALUES ('OFAC_SDN'),('OFAC_NON_SDN'),('UN_SC'),('UK')
    )
    SELECT count(*)
    FROM required r
    LEFT JOIN public.sanctions_sources_v1 s
      ON s.source_code=r.source_code
    WHERE s.source_code IS NULL
       OR s.status <> 'fresh'
       OR s.last_success_at IS NULL
       OR s.last_success_at < now() - interval '36 hours'
       OR s.record_count <= 0;
  ")"

  phase6_ready="$(query_scalar "
    SELECT
      to_regclass('public.agent_desks_v1') IS NOT NULL
      AND to_regclass('public.agent_desk_capabilities_v1') IS NOT NULL;
  ")"

  phase7_ready="$(query_scalar "
    SELECT
      to_regprocedure(
        'public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.claim_merchant_webhook_events_v1(integer,uuid)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.confirm_merchant_payment_ledger_v2(uuid,uuid)'
      ) IS NOT NULL
      AND to_regprocedure(
        'public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)'
      ) IS NOT NULL;
  ")"

  stale_webhook_locks="$(query_scalar "
    SELECT count(*)
    FROM public.merchant_webhook_events
    WHERE locked_at IS NOT NULL
      AND locked_at < now() - interval '10 minutes';
  ")"

  malformed_webhook_locks="$(query_scalar "
    SELECT count(*)
    FROM public.merchant_webhook_events
    WHERE (locked_at IS NULL) <> (lock_token IS NULL);
  ")"

  echo "bad_reconciliation=$bad_reconciliation"
  echo "unbalanced_journals=$unbalanced"
  echo "reconciliation_differences=$reconciliation_diff"
  echo "bad_sanctions_sources=$bad_sanctions"
  echo "phase6_ready=$phase6_ready"
  echo "phase7_ready=$phase7_ready"
  echo "stale_webhook_locks=$stale_webhook_locks"
  echo "malformed_webhook_locks=$malformed_webhook_locks"

  test "$bad_reconciliation" = "0"
  test "$unbalanced" = "0"
  test "$reconciliation_diff" = "0"
  test "$bad_sanctions" = "0"
  test "$phase6_ready" = "t"
  test "$phase7_ready" = "t"
  test "$stale_webhook_locks" = "0"
  test "$malformed_webhook_locks" = "0"

  echo "RUNTIME INVARIANTS: OK"
}

assert_rollback_only_test() {
  local file="$1"

  test -s "$file"
  grep -Eq '^[[:space:]]*BEGIN[[:space:]]*;' "$file"
  grep -Eq '^[[:space:]]*ROLLBACK[[:space:]]*;' "$file"
}

run_sql_test() {
  local name="$1"
  local file="$ROOT/sql/tests/$name"

  echo
  echo "=== SQL TEST: $name ==="

  assert_rollback_only_test "$file"
  "$PSQL_BIN" "$SUPABASE_DB_URI" -v ON_ERROR_STOP=1 -f "$file"
}

api_smoke() {
  if [ -z "$API_BASE_URL" ]; then
    echo
    echo "API smoke: SKIPPED (set API_BASE_URL or use --api-base)"
    return
  fi

  if [ -z "$CURL_BIN" ] || [ ! -x "$CURL_BIN" ]; then
    echo "ABORT: curl required for API smoke"
    exit 1
  fi

  API_BASE_URL="${API_BASE_URL%/}"

  echo
  echo "=== API SMOKE: $API_BASE_URL ==="

  local health
  local merchant_payment
  local merchant_payout
  local agent_admin
  local sanctions_admin

  health="$($CURL_BIN -sS --connect-timeout 5 --max-time 10 -o /tmp/jeezpay-reg-health -w '%{http_code}' "$API_BASE_URL/health")"
  merchant_payment="$($CURL_BIN -sS --connect-timeout 5 --max-time 10 -o /tmp/jeezpay-reg-merchant-payment -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"merchant_order_id":"phase8-unauth","amount":"1","currency":"SSP"}' "$API_BASE_URL/merchant/payments")"
  merchant_payout="$($CURL_BIN -sS --connect-timeout 5 --max-time 10 -o /tmp/jeezpay-reg-merchant-payout -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"idempotency_key":"phase8-unauth","account_number":"1","amount":"1","currency":"SSP"}' "$API_BASE_URL/merchant/payouts")"
  agent_admin="$($CURL_BIN -sS --connect-timeout 5 --max-time 10 -o /tmp/jeezpay-reg-agent-admin -w '%{http_code}' "$API_BASE_URL/admin/agents/v1")"
  sanctions_admin="$($CURL_BIN -sS --connect-timeout 5 --max-time 10 -o /tmp/jeezpay-reg-sanctions-admin -w '%{http_code}' "$API_BASE_URL/admin/sanctions/v1/sources")"

  echo "health_http=$health"
  echo "merchant_payment_unauth_http=$merchant_payment"
  echo "merchant_payout_unauth_http=$merchant_payout"
  echo "agent_admin_unauth_http=$agent_admin"
  echo "sanctions_admin_unauth_http=$sanctions_admin"

  test "$health" = "200"
  test "$merchant_payment" = "401"
  test "$merchant_payout" = "401"
  case "$agent_admin" in 401|403) ;; *) return 1 ;; esac
  case "$sanctions_admin" in 401|403) ;; *) return 1 ;; esac

  grep -q '"ok":true' /tmp/jeezpay-reg-health

  rm -f \
    /tmp/jeezpay-reg-health \
    /tmp/jeezpay-reg-merchant-payment \
    /tmp/jeezpay-reg-merchant-payout \
    /tmp/jeezpay-reg-agent-admin \
    /tmp/jeezpay-reg-sanctions-admin

  echo "API SMOKE: OK"
}

static_checks

if [ "$STATIC_ONLY" -eq 1 ]; then
  echo
  echo "================================================"
  echo "JEEZPAY STATIC REGRESSION GREEN"
  echo "================================================"
  exit 0
fi

if [ -z "${SUPABASE_DB_URI:-}" ]; then
  echo "ABORT: SUPABASE_DB_URI is required for launch regression"
  exit 1
fi

if [ -z "$PSQL_BIN" ] || [ ! -x "$PSQL_BIN" ]; then
  echo "ABORT: psql executable not found"
  exit 1
fi

"$PSQL_BIN" "$SUPABASE_DB_URI" -v ON_ERROR_STOP=1 -Atqc 'SELECT 1;' | grep -qx 1

assert_runtime_invariants

CORE_TESTS=(
  20260903_ledger_v2_foundation_test.sql
  20260904_ledger_v2_active_mirror_runtime_test.sql
  20260903_ledger_v2_native_p2p_test.sql
  20260903_ledger_v2_launch_writers_test.sql
  20260904_kyc_v3_test.sql
  20260904_kyc_v3_manual_launch_policy_test.sql
  20260904_compliance_monitoring_v1_test.sql
  20260904_public_sanctions_screening_v1_test.sql
  20260904_agent_desks_v1_test.sql
  20260903_ledger_v2_native_agent_test.sql
  20260904_merchant_api_v1_test.sql
  20260904_merchant_api_v1_money_test.sql
  20260906_phase9_db_privilege_hardening_test.sql
  20260906_admin_mfa_v1_test.sql
  20260906_admin_mfa_enrollment_finalize_v1_test.sql
  20260906_admin_mfa_verification_v1_test.sql
  20260906_phase9_privacy_storage_hardening_test.sql
)

# --full means the complete CURRENT production-safe
# post-cutover regression. Historical Ledger bootstrap
# tests live in run-historical-ledger-tests.sh instead.
FULL_EXTRA_TESTS=(
  20260903_kyc_lifecycle_v2_test.sql
)

# 20260904_kyc_international_v3_test.sql targets the retired
# pre-versioned KYC v3 schema (kyc_policy_versions, kyc_applications,
# kyc_documents, etc.). The live/current v3 model is covered by
# 20260904_kyc_v3_test.sql in CORE_TESTS.

for test_file in "${CORE_TESTS[@]}"; do
  run_sql_test "$test_file"
done

if [ "$FULL" -eq 1 ]; then
  for test_file in "${FULL_EXTRA_TESTS[@]}"; do
    run_sql_test "$test_file"
  done
fi

assert_runtime_invariants
api_smoke

MODE="compressed"
if [ "$FULL" -eq 1 ]; then
  MODE="full"
fi

echo
echo "================================================"
echo "JEEZPAY LAUNCH REGRESSION GREEN"
echo "MODE: $MODE"
echo "LEDGER: GREEN"
echo "KYC/COMPLIANCE: GREEN"
echo "SANCTIONS: GREEN"
echo "AGENTS: GREEN"
echo "MERCHANT API: GREEN"
echo "DB PRIVILEGES: GREEN"
echo "ADMIN MFA FOUNDATION: GREEN"
echo "================================================"
