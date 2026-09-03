\pset pager off
\echo '=== LEDGER V2 LEGACY BALANCE MIRROR TESTS ==='
\echo 'ROLLBACK-ONLY: temporarily enables the mirror, mutates one SSP wallet, proves exact Ledger mirroring, then rolls everything back.'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_wallet_id uuid;
  v_ledger_account_id uuid;
  v_bridge_account_id uuid;
  v_currency text := 'SSP';
  v_legacy_before numeric(38, 12);
  v_ledger_before numeric(38, 12);
  v_bridge_before numeric(38, 12);
  v_legacy_after numeric(38, 12);
  v_ledger_after numeric(38, 12);
  v_bridge_after numeric(38, 12);
  v_journals_before integer;
  v_journals_after integer;
  v_bad_count integer;
  v_result jsonb;
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS TRUE THEN
    RAISE EXCEPTION 'TEST_EXPECTED_MIRROR_DISABLED_AT_START';
  END IF;

  IF (SELECT count(*) FROM public.ledger_legacy_opening_cutovers_v2) <> 1 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_COMPLETED_OPENING_CUTOVER';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_EXACT_RECONCILIATION_BEFORE_ENABLE: % bad rows', v_bad_count;
  END IF;

  SELECT
    c.source_id,
    m.ledger_account_id,
    c.legacy_balance
  INTO
    v_wallet_id,
    v_ledger_account_id,
    v_legacy_before
  FROM public.ledger_v2_legacy_source_candidates AS c
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = c.source_kind
   AND m.source_id = c.source_id
  WHERE c.source_kind = 'USER_WALLET'
    AND c.account_type = 'USER_WALLET'
    AND c.currency = v_currency
  ORDER BY c.source_id
  LIMIT 1;

  IF v_wallet_id IS NULL OR v_ledger_account_id IS NULL THEN
    RAISE EXCEPTION 'TEST_SSP_USER_WALLET_NOT_FOUND';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_before
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_ledger_account_id;

  IF v_ledger_before IS DISTINCT FROM v_legacy_before THEN
    RAISE EXCEPTION 'TEST_PRE_BALANCE_MISMATCH';
  END IF;

  SELECT count(*) INTO v_journals_before
  FROM public.ledger_journals_v2;

  v_result := public.set_legacy_balance_mirror_v2(
    true,
    jsonb_build_object('test', true, 'phase', '4.1')
  );

  IF COALESCE((v_result->>'enabled')::boolean, false) IS NOT TRUE
     OR public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_MIRROR_ENABLE_FAILED';
  END IF;

  SELECT a.id, b.balance::numeric(38, 12)
  INTO v_bridge_account_id, v_bridge_before
  FROM public.ledger_accounts_v2 AS a
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.account_key = 'LEGACY_MIRROR_BRIDGE:' || v_currency;

  IF v_bridge_account_id IS NULL OR v_bridge_before IS DISTINCT FROM 0::numeric THEN
    RAISE EXCEPTION 'TEST_SSP_BRIDGE_NOT_ZERO_AT_START';
  END IF;

  UPDATE public.wallets
  SET balance = balance + 1
  WHERE id = v_wallet_id;

  SELECT balance::numeric(38, 12)
  INTO v_legacy_after
  FROM public.wallets
  WHERE id = v_wallet_id;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_ledger_account_id;

  SELECT balance::numeric(38, 12)
  INTO v_bridge_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_bridge_account_id;

  IF v_legacy_after IS DISTINCT FROM v_legacy_before + 1
     OR v_ledger_after IS DISTINCT FROM v_legacy_before + 1
     OR v_bridge_after IS DISTINCT FROM v_bridge_before - 1 THEN
    RAISE EXCEPTION 'TEST_POSITIVE_DELTA_NOT_MIRRORED';
  END IF;

  UPDATE public.wallets
  SET balance = balance - 1
  WHERE id = v_wallet_id;

  SELECT balance::numeric(38, 12)
  INTO v_legacy_after
  FROM public.wallets
  WHERE id = v_wallet_id;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_ledger_account_id;

  SELECT balance::numeric(38, 12)
  INTO v_bridge_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_bridge_account_id;

  IF v_legacy_after IS DISTINCT FROM v_legacy_before
     OR v_ledger_after IS DISTINCT FROM v_ledger_before
     OR v_bridge_after IS DISTINCT FROM v_bridge_before THEN
    RAISE EXCEPTION 'TEST_ROUNDTRIP_DID_NOT_RECONCILE';
  END IF;

  SELECT count(*) INTO v_journals_after
  FROM public.ledger_journals_v2;

  IF v_journals_after <> v_journals_before + 2 THEN
    RAISE EXCEPTION 'TEST_MIRROR_JOURNAL_COUNT_MISMATCH: before %, after %',
      v_journals_before, v_journals_after;
  END IF;

  IF (
    SELECT count(*)
    FROM public.ledger_journals_v2
    WHERE source_type = 'LEGACY_BALANCE_MIRROR'
  ) <> 2 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_TWO_TEMPORARY_MIRROR_JOURNALS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_unbalanced_journals
  ) THEN
    RAISE EXCEPTION 'TEST_MIRROR_CREATED_UNBALANCED_JOURNAL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0
  ) THEN
    RAISE EXCEPTION 'TEST_MIRROR_LEDGER_RECONCILIATION_FAILED';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_LIVE_RECONCILIATION_FAILED_AFTER_ROUNDTRIP';
  END IF;

  -- Disabled mirror intentionally allows a legacy-only change; re-enabling
  -- must fail closed until the mismatch is repaired.
  PERFORM public.set_legacy_balance_mirror_v2(
    false,
    jsonb_build_object('test', true, 'reason', 'drift-gate-test')
  );

  UPDATE public.wallets
  SET balance = balance + 1
  WHERE id = v_wallet_id;

  IF (
    SELECT balance::numeric(38, 12)
    FROM public.ledger_account_balances_v2
    WHERE account_id = v_ledger_account_id
  ) IS DISTINCT FROM v_ledger_before THEN
    RAISE EXCEPTION 'TEST_DISABLED_MIRROR_SHOULD_NOT_POST';
  END IF;

  BEGIN
    PERFORM public.set_legacy_balance_mirror_v2(
      true,
      jsonb_build_object('test', true, 'shouldFail', true)
    );
    RAISE EXCEPTION 'TEST_ENABLE_WITH_DRIFT_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_MIRROR_RECONCILIATION_FAILED' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.wallets
  SET balance = balance - 1
  WHERE id = v_wallet_id;

  PERFORM public.set_legacy_balance_mirror_v2(
    true,
    jsonb_build_object('test', true, 'reEnabled', true)
  );

  -- Identity mutation must be blocked while mirroring is active.
  BEGIN
    UPDATE public.wallets
    SET currency = lower(currency)
    WHERE id = v_wallet_id;
    RAISE EXCEPTION 'TEST_IDENTITY_MUTATION_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_MIRROR_SOURCE_IDENTITY_IMMUTABLE' THEN
        RAISE;
      END IF;
  END;

  -- Deleting a mapped financial source is also forbidden while active.
  BEGIN
    DELETE FROM public.wallets
    WHERE id = v_wallet_id;
    RAISE EXCEPTION 'TEST_SOURCE_DELETE_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_MIRROR_SOURCE_DELETE_FORBIDDEN' THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FINAL_LIVE_RECONCILIATION_FAILED';
  END IF;

  RAISE NOTICE 'LEDGER V2 LEGACY BALANCE MIRROR TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY MIRROR CONTROL ==='
SELECT control_key, enabled, metadata
FROM public.ledger_v2_runtime_controls;

\echo ''
\echo '=== TEMPORARY MIRROR BRIDGES ==='
SELECT
  a.currency,
  a.account_key,
  b.balance
FROM public.ledger_accounts_v2 AS a
JOIN public.ledger_account_balances_v2 AS b
  ON b.account_id = a.id
WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE'
ORDER BY a.currency;

\echo ''
\echo '=== TEMPORARY MIRROR JOURNAL COUNT ==='
SELECT count(*) AS mirror_journals
FROM public.ledger_journals_v2
WHERE source_type = 'LEGACY_BALANCE_MIRROR';

ROLLBACK;
