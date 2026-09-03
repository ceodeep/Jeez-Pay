\pset pager off
\echo '=== LEDGER V2 OPENING CUTOVER TESTS ==='
\echo 'ROLLBACK-ONLY: exercises the real cutover primitive without changing any legacy balance or leaving Ledger v2 data.'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_snapshot_key text := 'phase3-test-opening-cutover-v2';
  v_other_snapshot_key text := 'phase3-test-opening-cutover-v2-other';
  v_before_legacy_hash text;
  v_after_legacy_hash text;
  v_expected_sources integer;
  v_expected_currencies integer;
  v_expected_nonzero_currencies integer;
  v_expected_nonzero_sources integer;
  v_before_wallet_count integer;
  v_before_wallet_total numeric;
  v_before_merchant_count integer;
  v_before_merchant_total numeric;
  v_after_wallet_count integer;
  v_after_wallet_total numeric;
  v_after_merchant_count integer;
  v_after_merchant_total numeric;
  v_result jsonb;
  v_replay jsonb;
  v_cutover public.ledger_legacy_opening_cutovers_v2%ROWTYPE;
  v_bad_count integer;
  v_journal_count integer;
  v_entry_count integer;
  v_account_count integer;
  v_mapping_count integer;
BEGIN
  SELECT count(*) INTO v_expected_sources
  FROM public.ledger_v2_legacy_source_candidates;

  SELECT count(DISTINCT currency) INTO v_expected_currencies
  FROM public.ledger_v2_legacy_source_candidates;

  SELECT count(*) INTO v_expected_nonzero_sources
  FROM public.ledger_v2_legacy_source_candidates
  WHERE legacy_balance <> 0;

  SELECT count(*) INTO v_expected_nonzero_currencies
  FROM (
    SELECT currency
    FROM public.ledger_v2_legacy_source_candidates
    GROUP BY currency
    HAVING sum(legacy_balance) <> 0
  ) AS nonzero_currencies;

  IF v_expected_sources = 0 OR v_expected_currencies = 0 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_LEGACY_OPENING_SOURCES';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_legacy_opening_cutovers_v2) THEN
    RAISE EXCEPTION 'TEST_EXPECTED_NO_EXISTING_OPENING_CUTOVER';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_journals_v2)
     OR EXISTS (SELECT 1 FROM public.ledger_entries_v2)
     OR EXISTS (
       SELECT 1 FROM public.ledger_account_balances_v2 WHERE balance <> 0
     ) THEN
    RAISE EXCEPTION 'TEST_EXPECTED_EMPTY_LEDGER_BEFORE_CUTOVER';
  END IF;

  v_before_legacy_hash := public.ledger_legacy_opening_current_hash_v2();

  SELECT count(*), COALESCE(sum(balance), 0)
  INTO v_before_wallet_count, v_before_wallet_total
  FROM public.wallets;

  SELECT count(*), COALESCE(sum(balance), 0)
  INTO v_before_merchant_count, v_before_merchant_total
  FROM public.merchant_balances;

  v_result := public.execute_legacy_opening_cutover_v2(
    v_snapshot_key,
    jsonb_build_object('test', true, 'phase', '3.5')
  );

  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_CUTOVER_RESULT_NOT_OK: %', v_result;
  END IF;

  IF COALESCE((v_result->>'idempotentReplay')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'TEST_FIRST_CUTOVER_MARKED_REPLAY';
  END IF;

  SELECT * INTO v_cutover
  FROM public.ledger_legacy_opening_cutovers_v2
  WHERE cutover_key = 'LEGACY_OPENING_V2';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST_CUTOVER_ROW_MISSING';
  END IF;

  IF v_cutover.snapshot_key <> v_snapshot_key THEN
    RAISE EXCEPTION 'TEST_CUTOVER_SNAPSHOT_KEY_MISMATCH';
  END IF;

  IF v_cutover.source_count <> v_expected_sources THEN
    RAISE EXCEPTION 'TEST_CUTOVER_SOURCE_COUNT_MISMATCH: expected %, got %',
      v_expected_sources, v_cutover.source_count;
  END IF;

  IF v_cutover.currency_count <> v_expected_currencies THEN
    RAISE EXCEPTION 'TEST_CUTOVER_CURRENCY_COUNT_MISMATCH: expected %, got %',
      v_expected_currencies, v_cutover.currency_count;
  END IF;

  IF v_cutover.journal_count <> v_expected_nonzero_currencies THEN
    RAISE EXCEPTION 'TEST_CUTOVER_JOURNAL_COUNT_MISMATCH: expected %, got %',
      v_expected_nonzero_currencies, v_cutover.journal_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM jsonb_object_keys(v_cutover.journal_ids);

  IF v_bad_count <> v_expected_nonzero_currencies THEN
    RAISE EXCEPTION 'TEST_CUTOVER_JOURNAL_MAP_COUNT_MISMATCH';
  END IF;

  SELECT count(*) INTO v_mapping_count
  FROM public.ledger_legacy_account_map_v2;

  IF v_mapping_count <> v_expected_sources THEN
    RAISE EXCEPTION 'TEST_CUTOVER_MAPPING_COUNT_MISMATCH: expected %, got %',
      v_expected_sources, v_mapping_count;
  END IF;

  SELECT count(*) INTO v_account_count
  FROM public.ledger_accounts_v2;

  IF v_account_count <> v_expected_sources + v_expected_currencies THEN
    RAISE EXCEPTION 'TEST_CUTOVER_ACCOUNT_COUNT_MISMATCH: expected %, got %',
      v_expected_sources + v_expected_currencies, v_account_count;
  END IF;

  SELECT count(*) INTO v_journal_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_OPENING_V2';

  IF v_journal_count <> v_expected_nonzero_currencies THEN
    RAISE EXCEPTION 'TEST_OPENING_JOURNAL_COUNT_MISMATCH: expected %, got %',
      v_expected_nonzero_currencies, v_journal_count;
  END IF;

  SELECT count(*) INTO v_entry_count
  FROM public.ledger_entries_v2 AS e
  JOIN public.ledger_journals_v2 AS j ON j.id = e.journal_id
  WHERE j.source_type = 'LEGACY_OPENING_V2';

  IF v_entry_count <> v_expected_nonzero_sources + v_expected_nonzero_currencies THEN
    RAISE EXCEPTION 'TEST_OPENING_ENTRY_COUNT_MISMATCH: expected %, got %',
      v_expected_nonzero_sources + v_expected_nonzero_currencies, v_entry_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_opening_cutover_currency_status
  WHERE status NOT IN ('OK', 'OK_ZERO')
     OR source_balance_difference <> 0
     OR currency_net <> 0;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_CUTOVER_CURRENCY_STATUS_INVALID: % bad currencies', v_bad_count;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'TEST_CUTOVER_CREATED_UNBALANCED_JOURNAL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0
  ) THEN
    RAISE EXCEPTION 'TEST_CUTOVER_RECONCILIATION_MISMATCH';
  END IF;

  -- Snapshot source balances must match mapped Ledger balances exactly.
  SELECT count(*) INTO v_bad_count
  FROM public.ledger_legacy_opening_snapshot_items_v2 AS s
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = s.source_kind
   AND m.source_id = s.source_id
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  WHERE s.snapshot_id = v_cutover.snapshot_id
    AND b.balance IS DISTINCT FROM s.legacy_balance;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_CUTOVER_SOURCE_BALANCES_NOT_EXACT: % bad rows', v_bad_count;
  END IF;

  -- Opening offset balances must exactly negate the immutable snapshot totals.
  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT currency, sum(legacy_balance)::numeric(38, 12) AS total_balance
    FROM public.ledger_legacy_opening_snapshot_items_v2
    WHERE snapshot_id = v_cutover.snapshot_id
    GROUP BY currency
  ) AS totals
  JOIN public.ledger_accounts_v2 AS a
    ON a.account_key = 'LEGACY_OPENING_OFFSET:' || totals.currency
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE b.balance IS DISTINCT FROM -totals.total_balance;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_CUTOVER_OFFSET_BALANCES_NOT_EXACT: % bad currencies', v_bad_count;
  END IF;

  v_after_legacy_hash := public.ledger_legacy_opening_current_hash_v2();

  IF v_after_legacy_hash <> v_before_legacy_hash THEN
    RAISE EXCEPTION 'TEST_CUTOVER_CHANGED_LEGACY_SOURCE_HASH';
  END IF;

  SELECT count(*), COALESCE(sum(balance), 0)
  INTO v_after_wallet_count, v_after_wallet_total
  FROM public.wallets;

  SELECT count(*), COALESCE(sum(balance), 0)
  INTO v_after_merchant_count, v_after_merchant_total
  FROM public.merchant_balances;

  IF v_after_wallet_count <> v_before_wallet_count
     OR v_after_wallet_total IS DISTINCT FROM v_before_wallet_total
     OR v_after_merchant_count <> v_before_merchant_count
     OR v_after_merchant_total IS DISTINCT FROM v_before_merchant_total THEN
    RAISE EXCEPTION 'TEST_CUTOVER_CHANGED_LEGACY_BALANCES';
  END IF;

  -- Same-key retry must be a pure idempotent replay with no new postings.
  v_replay := public.execute_legacy_opening_cutover_v2(
    v_snapshot_key,
    jsonb_build_object('test', true, 'phase', '3.5', 'retry', true)
  );

  IF COALESCE((v_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_CUTOVER_REPLAY_NOT_IDEMPOTENT';
  END IF;

  IF (SELECT count(*) FROM public.ledger_journals_v2) <> v_journal_count THEN
    RAISE EXCEPTION 'TEST_CUTOVER_REPLAY_CREATED_JOURNAL';
  END IF;

  IF (SELECT count(*) FROM public.ledger_legacy_opening_cutovers_v2) <> 1 THEN
    RAISE EXCEPTION 'TEST_CUTOVER_REPLAY_CREATED_CUTOVER_ROW';
  END IF;

  -- A different snapshot key after completed opening is forbidden globally.
  BEGIN
    PERFORM public.execute_legacy_opening_cutover_v2(
      v_other_snapshot_key,
      jsonb_build_object('test', true)
    );
    RAISE EXCEPTION 'TEST_DIFFERENT_SNAPSHOT_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_OPENING_ALREADY_COMPLETED' THEN
        RAISE;
      END IF;
  END;

  -- Completed cutover record is immutable.
  BEGIN
    UPDATE public.ledger_legacy_opening_cutovers_v2
    SET snapshot_key = snapshot_key || ':MUTATED'
    WHERE cutover_key = 'LEGACY_OPENING_V2';
    RAISE EXCEPTION 'TEST_CUTOVER_UPDATE_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_OPENING_CUTOVER_IMMUTABLE' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'LEDGER V2 OPENING CUTOVER TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY CUTOVER HEADER ==='
SELECT
  cutover_key,
  snapshot_key,
  source_count,
  currency_count,
  journal_count,
  journal_ids,
  completed_at
FROM public.ledger_legacy_opening_cutovers_v2;

\echo ''
\echo '=== TEMPORARY CUTOVER CURRENCY STATUS ==='
SELECT
  currency,
  source_count,
  nonzero_source_count,
  expected_source_balance,
  actual_source_balance,
  offset_balance,
  source_balance_difference,
  currency_net,
  status
FROM public.ledger_v2_legacy_opening_cutover_currency_status
ORDER BY currency;

\echo ''
\echo '=== TEMPORARY LEDGER COUNTS ==='
SELECT count(*) AS ledger_accounts FROM public.ledger_accounts_v2;
SELECT count(*) AS ledger_journals FROM public.ledger_journals_v2;
SELECT count(*) AS ledger_entries FROM public.ledger_entries_v2;
SELECT count(*) AS mappings FROM public.ledger_legacy_account_map_v2;
SELECT count(*) AS snapshot_headers FROM public.ledger_legacy_opening_snapshots_v2;
SELECT count(*) AS snapshot_items FROM public.ledger_legacy_opening_snapshot_items_v2;
SELECT count(*) AS cutover_rows FROM public.ledger_legacy_opening_cutovers_v2;

ROLLBACK;
