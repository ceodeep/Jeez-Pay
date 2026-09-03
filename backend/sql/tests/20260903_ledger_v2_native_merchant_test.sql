\set ON_ERROR_STOP on
\pset pager off

\echo '=== LEDGER V2 NATIVE MERCHANT TESTS ==='
\echo 'ROLLBACK-ONLY: executes one tiny SSP merchant payment and one tiny SSP payout through the Phase 4.3B wrappers, verifies native Ledger posting/idempotency/no mirror double-post, then rolls everything back.'

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_merchant_id uuid;
  v_user_id uuid;
  v_user_wallet_id uuid;
  v_account_number text;
  v_payment_id uuid;
  v_payment_result jsonb;
  v_payment_replay jsonb;
  v_payout_result jsonb;
  v_payout_replay jsonb;
  v_payout_conflict jsonb;
  v_payout_key text;
  v_payment_journal_id uuid;
  v_payout_journal_id uuid;
  v_native_payment_before integer;
  v_native_payout_before integer;
  v_mirror_before integer;
  v_bridge_before numeric(38,12);
  v_bridge_after numeric(38,12);
  v_bad integer;
  v_count integer;
  v_net numeric(38,12);
BEGIN
  IF to_regprocedure('public.confirm_merchant_payment_ledger_v2(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_RPC_MISSING';
  END IF;

  IF to_regprocedure('public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_RPC_MISSING';
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_LEGACY_MIRROR_NOT_ENABLED';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'TEST_PRE_RECONCILIATION_FAILED: %', v_bad;
  END IF;

  SELECT mb.merchant_id
  INTO v_merchant_id
  FROM public.merchant_balances AS mb
  JOIN public.merchants AS m
    ON m.id = mb.merchant_id
  WHERE upper(mb.currency) = 'SSP'
    AND mb.balance >= 2
    AND m.status = 'active'
  ORDER BY mb.balance DESC, mb.merchant_id
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'TEST_ACTIVE_SSP_MERCHANT_NOT_FOUND';
  END IF;

  SELECT u.id, w.id, u.wallet_account_number::text
  INTO v_user_id, v_user_wallet_id, v_account_number
  FROM public.users AS u
  JOIN public.wallets AS w
    ON w.user_id = u.id
   AND upper(w.currency) = 'SSP'
  JOIN public.kyc_profiles AS k
    ON k.user_id = u.id
  WHERE u.is_active IS TRUE
    AND u.role = 'user'
    AND k.status = 'approved'
    AND u.wallet_account_number IS NOT NULL
    AND w.balance >= 2
  ORDER BY w.balance DESC, u.id
  LIMIT 1;

  IF v_user_id IS NULL OR v_user_wallet_id IS NULL OR v_account_number IS NULL THEN
    RAISE EXCEPTION 'TEST_ELIGIBLE_SSP_USER_NOT_FOUND';
  END IF;

  SELECT count(*) INTO v_native_payment_before
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYMENT_V2';

  SELECT count(*) INTO v_native_payout_before
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYOUT_V2';

  SELECT count(*) INTO v_mirror_before
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  SELECT b.balance::numeric(38,12)
  INTO v_bridge_before
  FROM public.ledger_accounts_v2 AS a
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE'
    AND a.currency = 'SSP';

  INSERT INTO public.merchant_payments (
    merchant_id,
    merchant_order_id,
    amount,
    currency,
    description,
    metadata,
    status,
    expires_at
  )
  VALUES (
    v_merchant_id,
    'phase4-3-native-payment-test-' || txid_current()::text,
    1,
    'SSP',
    'Phase 4.3 native merchant payment rollback test',
    jsonb_build_object('phase', '4.3B', 'rollbackOnly', true),
    'pending',
    now() + interval '15 minutes'
  )
  RETURNING id INTO v_payment_id;

  v_payment_result := public.confirm_merchant_payment_ledger_v2(
    v_user_id,
    v_payment_id
  );

  IF COALESCE((v_payment_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_payment_result->>'code' <> 'PAID'
     OR COALESCE((v_payment_result->>'idempotentReplay')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_RESULT_INVALID: %', v_payment_result;
  END IF;

  v_payment_journal_id := NULLIF(v_payment_result->>'ledgerJournalId', '')::uuid;

  IF v_payment_journal_id IS NULL THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_JOURNAL_ID_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYMENT_V2';

  IF v_count <> v_native_payment_before + 1 THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_JOURNAL_COUNT: %', v_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount_delta), 0)::numeric(38,12)
  INTO v_count, v_net
  FROM public.ledger_entries_v2
  WHERE journal_id = v_payment_journal_id;

  IF v_count <> 2 OR v_net <> 0 THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_ENTRIES_INVALID: count %, net %', v_count, v_net;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_entries_v2
    WHERE journal_id = v_payment_journal_id
      AND amount_delta = -1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.ledger_entries_v2
    WHERE journal_id = v_payment_journal_id
      AND amount_delta = 1
  ) THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_DELTAS_INVALID';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  IF v_count <> v_mirror_before THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_DOUBLE_MIRRORED: before %, after %', v_mirror_before, v_count;
  END IF;

  v_payment_replay := public.confirm_merchant_payment_ledger_v2(
    v_user_id,
    v_payment_id
  );

  IF COALESCE((v_payment_replay->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_payment_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR NULLIF(v_payment_replay->>'ledgerJournalId', '')::uuid IS DISTINCT FROM v_payment_journal_id THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_REPLAY_INVALID: %', v_payment_replay;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYMENT_V2';

  IF v_count <> v_native_payment_before + 1 THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYMENT_REPLAY_CREATED_JOURNAL';
  END IF;

  v_payout_key := 'phase4-3-native-payout-test-' || txid_current()::text;

  v_payout_result := public.execute_merchant_payout_ledger_v2(
    v_merchant_id,
    v_payout_key,
    v_account_number,
    1,
    'SSP',
    'Phase 4.3 native merchant payout rollback test',
    jsonb_build_object('phase', '4.3B', 'rollbackOnly', true)
  );

  IF COALESCE((v_payout_result->>'ok')::boolean, false) IS NOT TRUE
     OR v_payout_result->>'code' <> 'PAID'
     OR COALESCE((v_payout_result->>'already_processed')::boolean, false) IS TRUE
     OR COALESCE((v_payout_result->>'idempotentReplay')::boolean, false) IS TRUE THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_RESULT_INVALID: %', v_payout_result;
  END IF;

  v_payout_journal_id := NULLIF(v_payout_result->>'ledgerJournalId', '')::uuid;

  IF v_payout_journal_id IS NULL THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_JOURNAL_ID_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYOUT_V2';

  IF v_count <> v_native_payout_before + 1 THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_JOURNAL_COUNT: %', v_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount_delta), 0)::numeric(38,12)
  INTO v_count, v_net
  FROM public.ledger_entries_v2
  WHERE journal_id = v_payout_journal_id;

  IF v_count <> 2 OR v_net <> 0 THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_ENTRIES_INVALID: count %, net %', v_count, v_net;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.ledger_entries_v2
    WHERE journal_id = v_payout_journal_id
      AND amount_delta = -1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.ledger_entries_v2
    WHERE journal_id = v_payout_journal_id
      AND amount_delta = 1
  ) THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_DELTAS_INVALID';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  IF v_count <> v_mirror_before THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_DOUBLE_MIRRORED: before %, after %', v_mirror_before, v_count;
  END IF;

  v_payout_replay := public.execute_merchant_payout_ledger_v2(
    v_merchant_id,
    v_payout_key,
    v_account_number,
    1,
    'SSP',
    'Different replay description is intentionally ignored by legacy idempotency',
    jsonb_build_object('differentMetadata', true)
  );

  IF COALESCE((v_payout_replay->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_payout_replay->>'already_processed')::boolean, false) IS NOT TRUE
     OR COALESCE((v_payout_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR NULLIF(v_payout_replay->>'ledgerJournalId', '')::uuid IS DISTINCT FROM v_payout_journal_id THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_REPLAY_INVALID: %', v_payout_replay;
  END IF;

  v_payout_conflict := public.execute_merchant_payout_ledger_v2(
    v_merchant_id,
    v_payout_key,
    v_account_number,
    2,
    'SSP',
    NULL,
    '{}'::jsonb
  );

  IF COALESCE((v_payout_conflict->>'ok')::boolean, true) IS NOT FALSE
     OR v_payout_conflict->>'code' <> 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_CONFLICT_INVALID: %', v_payout_conflict;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYOUT_V2';

  IF v_count <> v_native_payout_before + 1 THEN
    RAISE EXCEPTION 'TEST_NATIVE_MERCHANT_PAYOUT_REPLAY_CREATED_JOURNAL';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'TEST_POST_RECONCILIATION_FAILED: %', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'TEST_UNBALANCED_JOURNAL_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0
  ) THEN
    RAISE EXCEPTION 'TEST_LEDGER_BALANCE_RECONCILIATION_FAILED';
  END IF;

  SELECT b.balance::numeric(38,12)
  INTO v_bridge_after
  FROM public.ledger_accounts_v2 AS a
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE'
    AND a.currency = 'SSP';

  IF v_bridge_after IS DISTINCT FROM v_bridge_before THEN
    RAISE EXCEPTION 'TEST_SSP_MIRROR_BRIDGE_CHANGED: before %, after %', v_bridge_before, v_bridge_after;
  END IF;

  IF has_function_privilege('anon', 'public.confirm_merchant_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirm_merchant_payment(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.confirm_merchant_payment(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_LEGACY_CONFIRM_PRIVILEGES_INVALID';
  END IF;

  IF has_function_privilege('anon', 'public.confirm_merchant_payment_ledger_v2(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirm_merchant_payment_ledger_v2(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.confirm_merchant_payment_ledger_v2(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_NATIVE_PAYMENT_PRIVILEGES_INVALID';
  END IF;

  IF has_function_privilege('anon', 'public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST_NATIVE_PAYOUT_PRIVILEGES_INVALID';
  END IF;

  RAISE NOTICE 'LEDGER V2 NATIVE MERCHANT TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY NATIVE MERCHANT JOURNALS ==='
SELECT
  source_type,
  count(*) AS journal_count,
  count(*) FILTER (WHERE source_type = 'MERCHANT_PAYMENT_V2') AS payment_journals,
  count(*) FILTER (WHERE source_type = 'MERCHANT_PAYOUT_V2') AS payout_journals
FROM public.ledger_journals_v2
WHERE source_type IN ('MERCHANT_PAYMENT_V2', 'MERCHANT_PAYOUT_V2')
GROUP BY source_type
ORDER BY source_type;

\echo ''
\echo '=== TEMPORARY LEDGER / MIRROR STATE ==='
SELECT count(*) AS generic_mirror_journals
FROM public.ledger_journals_v2
WHERE source_type = 'LEGACY_BALANCE_MIRROR';

SELECT count(*) AS bad_live_reconciliation
FROM public.ledger_v2_legacy_live_reconciliation
WHERE reconciliation_status <> 'MATCHED'
   OR difference IS DISTINCT FROM 0::numeric;

SELECT count(*) AS unbalanced_journals
FROM public.ledger_v2_unbalanced_journals;

ROLLBACK;
