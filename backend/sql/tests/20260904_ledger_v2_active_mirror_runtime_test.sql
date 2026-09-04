\pset pager off
\echo '=== LEDGER V2 ACTIVE MIRROR RUNTIME TEST ==='
\echo 'ROLLBACK-ONLY / READ-ONLY: proves the live post-cutover mirror, reconciliation, triggers, and operator-only control boundary.'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_bad_reconciliation integer;
  v_cutovers integer;
  v_enabled_triggers integer;
BEGIN
  IF to_regclass('public.ledger_v2_runtime_controls') IS NULL
     OR to_regclass('public.ledger_v2_legacy_live_reconciliation') IS NULL
     OR to_regprocedure('public.ledger_v2_legacy_balance_mirror_enabled()') IS NULL
     OR to_regprocedure('public.set_legacy_balance_mirror_v2(boolean,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_FOUNDATION_MISSING';
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_EXPECTED_ENABLED';
  END IF;

  SELECT count(*)
  INTO v_cutovers
  FROM public.ledger_legacy_opening_cutovers_v2;

  IF v_cutovers <> 1 THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_EXPECTED_ONE_OPENING_CUTOVER: %', v_cutovers;
  END IF;

  SELECT count(*)
  INTO v_bad_reconciliation
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_reconciliation <> 0 THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_RECONCILIATION_FAILED: % bad rows', v_bad_reconciliation;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ledger_v2_runtime_controls
    WHERE control_key = 'LEGACY_BALANCE_MIRROR'
      AND enabled = true
      AND jsonb_typeof(metadata) = 'object'
  ) THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_CONTROL_ROW_INVALID';
  END IF;

  SELECT count(*)
  INTO v_enabled_triggers
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('wallets', 'merchant_balances')
    AND t.tgname IN (
      'ledger_v2_mirror_wallet_insert',
      'ledger_v2_mirror_wallet_balance_update',
      'ledger_v2_guard_wallet_identity_update',
      'ledger_v2_guard_wallet_delete',
      'ledger_v2_mirror_merchant_balance_insert',
      'ledger_v2_mirror_merchant_balance_update',
      'ledger_v2_guard_merchant_balance_identity_update',
      'ledger_v2_guard_merchant_balance_delete'
    )
    AND NOT t.tgisinternal
    AND t.tgenabled <> 'D';

  IF v_enabled_triggers <> 8 THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_TRIGGER_COUNT_INVALID: expected 8, got %', v_enabled_triggers;
  END IF;

  IF has_function_privilege(
       'service_role',
       'public.set_legacy_balance_mirror_v2(boolean,jsonb)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_SERVICE_ROLE_CONTROL_BYPASS';
  END IF;

  IF has_table_privilege(
       'service_role',
       'public.ledger_v2_runtime_controls',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'ACTIVE_MIRROR_TEST_SERVICE_ROLE_CONTROL_READ_BYPASS';
  END IF;

  RAISE NOTICE 'LEDGER V2 ACTIVE MIRROR RUNTIME TEST: OK';
END;
$$;

ROLLBACK;
