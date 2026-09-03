\pset pager off
\echo '=== LEDGER V2 OPENING SNAPSHOT TESTS ==='
\echo 'ROLLBACK-ONLY: captures a temporary snapshot and never changes a legacy balance.'

BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_snapshot_key text := 'phase3-opening-snapshot-test-' || replace(gen_random_uuid()::text, '-', '');
  v_fake_key text := 'phase3-opening-snapshot-drift-test-' || replace(gen_random_uuid()::text, '-', '');
  v_expected_sources integer;
  v_expected_currencies integer;
  v_before_mapping integer;
  v_before_accounts integer;
  v_before_journals integer;
  v_before_entries integer;
  v_snapshot_result jsonb;
  v_replay_result jsonb;
  v_snapshot_id uuid;
  v_fake_snapshot_id uuid;
  v_report jsonb;
  v_bad_count integer;
BEGIN
  SELECT count(*), count(DISTINCT currency)
  INTO v_expected_sources, v_expected_currencies
  FROM public.ledger_v2_legacy_source_candidates;

  IF v_expected_sources = 0 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_LEGACY_SOURCES';
  END IF;

  SELECT count(*) INTO v_before_mapping
  FROM public.ledger_legacy_account_map_v2;
  SELECT count(*) INTO v_before_accounts
  FROM public.ledger_accounts_v2;
  SELECT count(*) INTO v_before_journals
  FROM public.ledger_journals_v2;
  SELECT count(*) INTO v_before_entries
  FROM public.ledger_entries_v2;

  v_snapshot_result := public.capture_legacy_opening_snapshot_v2(
    v_snapshot_key,
    jsonb_build_object('purpose', 'rollback_only_phase3_test')
  );

  IF COALESCE((v_snapshot_result->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_snapshot_result->>'idempotentReplay')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CAPTURE_RESULT_INVALID: %', v_snapshot_result;
  END IF;

  v_snapshot_id := (v_snapshot_result->>'snapshotId')::uuid;

  IF (v_snapshot_result->>'sourceCount')::integer <> v_expected_sources THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_SOURCE_COUNT_MISMATCH';
  END IF;

  IF (v_snapshot_result->>'currencyCount')::integer <> v_expected_currencies THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CURRENCY_COUNT_MISMATCH';
  END IF;

  IF length(v_snapshot_result->>'sourceHash') <> 64 THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_HASH_INVALID';
  END IF;

  IF (
    SELECT count(*)
    FROM public.ledger_legacy_opening_snapshot_items_v2
    WHERE snapshot_id = v_snapshot_id
  ) <> v_expected_sources THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_ITEM_COUNT_MISMATCH';
  END IF;

  IF (
    SELECT source_hash
    FROM public.ledger_legacy_opening_snapshots_v2
    WHERE id = v_snapshot_id
  ) IS DISTINCT FROM public.ledger_legacy_opening_current_hash_v2() THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_HASH_NOT_CURRENT';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT
      c.currency,
      sum(c.legacy_balance)::numeric(38, 12) AS current_total,
      s.total_legacy_balance
    FROM public.ledger_v2_legacy_source_candidates AS c
    JOIN public.ledger_v2_legacy_opening_snapshot_currency_summary AS s
      ON s.snapshot_id = v_snapshot_id
     AND s.currency = c.currency
    GROUP BY c.currency, s.total_legacy_balance
  ) AS totals
  WHERE current_total IS DISTINCT FROM total_legacy_balance;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CURRENCY_TOTAL_MISMATCH: % currencies', v_bad_count;
  END IF;

  v_report := public.check_legacy_opening_snapshot_drift_v2(v_snapshot_key);

  IF COALESCE((v_report->>'driftFree')::boolean, false) IS NOT TRUE
     OR (v_report->>'missingCurrentSources')::integer <> 0
     OR (v_report->>'newCurrentSources')::integer <> 0
     OR (v_report->>'identityMismatches')::integer <> 0
     OR (v_report->>'balanceMismatches')::integer <> 0
     OR (v_report->>'fingerprintMismatches')::integer <> 0 THEN
    RAISE EXCEPTION 'TEST_FRESH_SNAPSHOT_REPORTED_DRIFT: %', v_report;
  END IF;

  PERFORM public.assert_legacy_opening_snapshot_unchanged_v2(v_snapshot_key);

  v_replay_result := public.capture_legacy_opening_snapshot_v2(
    v_snapshot_key,
    jsonb_build_object('purpose', 'ignored_on_idempotent_replay')
  );

  IF COALESCE((v_replay_result->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR (v_replay_result->>'snapshotId')::uuid IS DISTINCT FROM v_snapshot_id THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_IDEMPOTENCY_FAILED: %', v_replay_result;
  END IF;

  -- Snapshot headers and items are immutable once captured.
  BEGIN
    UPDATE public.ledger_legacy_opening_snapshots_v2
    SET metadata = metadata || '{"mutated":true}'::jsonb
    WHERE id = v_snapshot_id;

    RAISE EXCEPTION 'TEST_SNAPSHOT_HEADER_UPDATE_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_OPENING_SNAPSHOT_IMMUTABLE' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.ledger_legacy_opening_snapshot_items_v2
    SET legacy_balance = legacy_balance + 1
    WHERE snapshot_id = v_snapshot_id
      AND (source_kind, source_id) = (
        SELECT source_kind, source_id
        FROM public.ledger_legacy_opening_snapshot_items_v2
        WHERE snapshot_id = v_snapshot_id
        ORDER BY source_kind, source_id
        LIMIT 1
      );

    RAISE EXCEPTION 'TEST_SNAPSHOT_ITEM_UPDATE_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_OPENING_SNAPSHOT_IMMUTABLE' THEN
        RAISE;
      END IF;
  END;

  -- Synthetic snapshot data proves drift detection without changing a real
  -- wallet, merchant balance, user, or system-account row.
  INSERT INTO public.ledger_legacy_opening_snapshots_v2 (
    snapshot_key,
    source_count,
    currency_count,
    source_hash,
    metadata
  ) VALUES (
    v_fake_key,
    1,
    1,
    repeat('0', 64),
    '{"purpose":"synthetic_drift_test"}'::jsonb
  )
  RETURNING id INTO v_fake_snapshot_id;

  INSERT INTO public.ledger_legacy_opening_snapshot_items_v2 (
    snapshot_id,
    source_kind,
    source_id,
    source_owner_ref,
    currency,
    account_key,
    account_type,
    owner_type,
    legacy_balance,
    source_fingerprint
  ) VALUES (
    v_fake_snapshot_id,
    'USER_WALLET',
    gen_random_uuid(),
    'synthetic-owner',
    'SSP',
    'USER_WALLET:synthetic-owner:SSP',
    'USER_WALLET',
    'USER',
    1,
    repeat('1', 64)
  );

  v_report := public.check_legacy_opening_snapshot_drift_v2(v_fake_key);

  IF COALESCE((v_report->>'driftFree')::boolean, true) IS NOT FALSE
     OR (v_report->>'missingCurrentSources')::integer < 1
     OR (v_report->>'newCurrentSources')::integer < 1 THEN
    RAISE EXCEPTION 'TEST_SYNTHETIC_DRIFT_NOT_DETECTED: %', v_report;
  END IF;

  BEGIN
    PERFORM public.assert_legacy_opening_snapshot_unchanged_v2(v_fake_key);
    RAISE EXCEPTION 'TEST_DRIFT_ASSERTION_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_LEGACY_OPENING_SNAPSHOT_DRIFT' THEN
        RAISE;
      END IF;
  END;

  -- Snapshot infrastructure must not create mappings, accounts, journals, or entries.
  IF (SELECT count(*) FROM public.ledger_legacy_account_map_v2) <> v_before_mapping THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CREATED_LEGACY_MAPPINGS';
  END IF;

  IF (SELECT count(*) FROM public.ledger_accounts_v2) <> v_before_accounts THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CREATED_LEDGER_ACCOUNTS';
  END IF;

  IF (SELECT count(*) FROM public.ledger_journals_v2) <> v_before_journals THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CREATED_LEDGER_JOURNALS';
  END IF;

  IF (SELECT count(*) FROM public.ledger_entries_v2) <> v_before_entries THEN
    RAISE EXCEPTION 'TEST_SNAPSHOT_CREATED_LEDGER_ENTRIES';
  END IF;

  RAISE NOTICE 'LEDGER V2 OPENING SNAPSHOT TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY SNAPSHOT CURRENCY SUMMARY ==='
SELECT
  currency,
  source_count,
  nonzero_source_count,
  total_legacy_balance
FROM public.ledger_v2_legacy_opening_snapshot_currency_summary
WHERE snapshot_key LIKE 'phase3-opening-snapshot-test-%'
ORDER BY currency;

ROLLBACK;
