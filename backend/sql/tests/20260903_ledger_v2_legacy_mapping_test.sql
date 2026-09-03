\pset pager off
\echo '=== LEDGER V2 LEGACY MAPPING TESTS ==='
\echo 'ROLLBACK-ONLY: this test materializes mappings inside a transaction and rolls everything back.'

BEGIN;

DO $$
DECLARE
  v_expected_sources integer;
  v_expected_currencies integer;
  v_mapped_sources integer;
  v_offset_accounts integer;
  v_result jsonb;
  v_before_accounts integer;
  v_before_journals integer;
  v_before_entries integer;
  v_after_accounts integer;
  v_after_journals integer;
  v_after_entries integer;
  v_bad_count integer;
BEGIN
  SELECT count(*) INTO v_expected_sources
  FROM public.ledger_v2_legacy_source_candidates;

  SELECT count(DISTINCT currency) INTO v_expected_currencies
  FROM public.ledger_v2_legacy_source_candidates;

  IF v_expected_sources = 0 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_LEGACY_SOURCES';
  END IF;

  SELECT count(*) INTO v_before_accounts FROM public.ledger_accounts_v2;
  SELECT count(*) INTO v_before_journals FROM public.ledger_journals_v2;
  SELECT count(*) INTO v_before_entries FROM public.ledger_entries_v2;

  v_result := public.materialize_legacy_account_mappings_v2();

  v_mapped_sources := (v_result->>'mappedSources')::integer;
  v_offset_accounts := (v_result->>'openingOffsetAccounts')::integer;

  IF v_mapped_sources <> v_expected_sources THEN
    RAISE EXCEPTION 'TEST_MAPPING_SOURCE_COUNT_MISMATCH: expected %, got %',
      v_expected_sources, v_mapped_sources;
  END IF;

  IF v_offset_accounts <> v_expected_currencies THEN
    RAISE EXCEPTION 'TEST_OFFSET_COUNT_MISMATCH: expected %, got %',
      v_expected_currencies, v_offset_accounts;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_mapping_status
  WHERE mapping_status <> 'MAPPED';

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_MAPPING_STATUS_INVALID: % bad rows', v_bad_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_mapping_status
  WHERE ledger_balance IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_MAPPING_CREATED_NONZERO_BALANCE: % rows', v_bad_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_opening_entries_plan
  WHERE ledger_account_id IS NULL;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_OPENING_PLAN_MISSING_ACCOUNT: % rows', v_bad_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_opening_summary
  WHERE missing_ledger_accounts <> 0
     OR offset_entries <> 1
     OR net_delta <> 0;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_OPENING_PLAN_NOT_BALANCED: % currencies', v_bad_count;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT currency, sum(legacy_balance)::numeric(38, 12) AS source_total
    FROM public.ledger_v2_legacy_source_candidates
    GROUP BY currency
  ) AS source_totals
  JOIN (
    SELECT
      currency,
      sum(amount_delta) FILTER (WHERE entry_role = 'SOURCE')::numeric(38, 12) AS planned_source_total
    FROM public.ledger_v2_legacy_opening_entries_plan
    GROUP BY currency
  ) AS plan_totals USING (currency)
  WHERE source_totals.source_total IS DISTINCT FROM plan_totals.planned_source_total;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_OPENING_PLAN_SOURCE_TOTAL_MISMATCH: % currencies', v_bad_count;
  END IF;

  SELECT count(*) INTO v_after_accounts FROM public.ledger_accounts_v2;
  SELECT count(*) INTO v_after_journals FROM public.ledger_journals_v2;
  SELECT count(*) INTO v_after_entries FROM public.ledger_entries_v2;

  IF v_after_accounts <> v_before_accounts + v_expected_sources + v_expected_currencies THEN
    RAISE EXCEPTION 'TEST_ACCOUNT_COUNT_MISMATCH: before %, after %, expected delta %',
      v_before_accounts, v_after_accounts, v_expected_sources + v_expected_currencies;
  END IF;

  IF v_after_journals <> v_before_journals THEN
    RAISE EXCEPTION 'TEST_MAPPING_CREATED_JOURNALS';
  END IF;

  IF v_after_entries <> v_before_entries THEN
    RAISE EXCEPTION 'TEST_MAPPING_CREATED_ENTRIES';
  END IF;

  -- Idempotent rerun must not create additional accounts or mappings.
  PERFORM public.materialize_legacy_account_mappings_v2();

  IF (SELECT count(*) FROM public.ledger_accounts_v2) <> v_after_accounts THEN
    RAISE EXCEPTION 'TEST_MAPPING_RERUN_CREATED_ACCOUNTS';
  END IF;

  IF (SELECT count(*) FROM public.ledger_legacy_account_map_v2) <> v_expected_sources THEN
    RAISE EXCEPTION 'TEST_MAPPING_RERUN_COUNT_MISMATCH';
  END IF;

  -- Mapping rows are immutable.
  BEGIN
    UPDATE public.ledger_legacy_account_map_v2
    SET account_key = account_key || ':MUTATED'
    WHERE (source_kind, source_id) = (
      SELECT source_kind, source_id
      FROM public.ledger_legacy_account_map_v2
      ORDER BY source_kind, source_id
      LIMIT 1
    );

    RAISE EXCEPTION 'TEST_MAPPING_UPDATE_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_MAPPING_IMMUTABLE' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'LEDGER V2 LEGACY MAPPING TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY MAPPING SUMMARY ==='
SELECT
  source_kind,
  currency,
  count(*) AS mapped_sources
FROM public.ledger_legacy_account_map_v2
GROUP BY source_kind, currency
ORDER BY source_kind, currency;

\echo ''
\echo '=== TEMPORARY OPENING PLAN SUMMARY ==='
SELECT *
FROM public.ledger_v2_legacy_opening_summary
ORDER BY currency;

ROLLBACK;
