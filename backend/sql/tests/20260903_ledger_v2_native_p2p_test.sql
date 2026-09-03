\pset pager off
\echo '=== LEDGER V2 P2P NATIVE PRIMITIVE TESTS ==='
\echo 'ROLLBACK-ONLY: moves a tiny SSP amount through the Phase 4.2 wrapper, verifies native Ledger posting/idempotency, then rolls everything back.'

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_sender_user_id uuid;
  v_sender_wallet_id uuid;
  v_receiver_user_id uuid;
  v_receiver_wallet_id uuid;
  v_receiver_phone text;
  v_amount numeric := 1;
  v_idempotency_key text := 'phase4-2-native-p2p-test-v1';
  v_description text := 'Phase 4.2 rollback-only native P2P test';
  v_before_sender_balance numeric;
  v_before_receiver_balance numeric;
  v_after_sender_balance numeric;
  v_after_receiver_balance numeric;
  v_replay_sender_balance numeric;
  v_replay_receiver_balance numeric;
  v_before_p2p_journals integer;
  v_before_mirror_journals integer;
  v_before_total_journals integer;
  v_before_total_entries integer;
  v_after_p2p_journals integer;
  v_after_mirror_journals integer;
  v_after_total_journals integer;
  v_after_total_entries integer;
  v_replay_total_journals integer;
  v_replay_total_entries integer;
  v_first_result jsonb;
  v_replay_result jsonb;
  v_reference text;
  v_journal_id uuid;
  v_replay_journal_id uuid;
  v_reference_tx_count integer;
  v_replay_reference_tx_count integer;
  v_bad_count integer;
  v_bridge_hash_before text;
  v_bridge_hash_after text;
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_EXPECTED_ACTIVE_LEGACY_BALANCE_MIRROR';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_EXPECTED_EXACT_PRE_RECONCILIATION: % bad rows', v_bad_count;
  END IF;

  SELECT
    w.user_id,
    w.id,
    w.balance
  INTO
    v_sender_user_id,
    v_sender_wallet_id,
    v_before_sender_balance
  FROM public.wallets AS w
  JOIN public.users AS u
    ON u.id = w.user_id
  WHERE upper(w.currency) = 'SSP'
    AND w.balance > 100
    AND u.phone IS NOT NULL
    AND btrim(u.phone) <> ''
    AND COALESCE(u.is_system, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM public.system_accounts AS sa
      WHERE sa.user_id = w.user_id
    )
  ORDER BY w.balance DESC, w.id
  LIMIT 1;

  IF v_sender_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_NO_SUITABLE_SSP_SENDER';
  END IF;

  SELECT
    w.user_id,
    w.id,
    u.phone,
    w.balance
  INTO
    v_receiver_user_id,
    v_receiver_wallet_id,
    v_receiver_phone,
    v_before_receiver_balance
  FROM public.wallets AS w
  JOIN public.users AS u
    ON u.id = w.user_id
  WHERE upper(w.currency) = 'SSP'
    AND w.user_id <> v_sender_user_id
    AND u.phone IS NOT NULL
    AND btrim(u.phone) <> ''
    AND COALESCE(u.is_system, false) IS FALSE
    AND NOT EXISTS (
      SELECT 1
      FROM public.system_accounts AS sa
      WHERE sa.user_id = w.user_id
    )
  ORDER BY w.id
  LIMIT 1;

  IF v_receiver_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_NO_SUITABLE_SSP_RECEIVER';
  END IF;

  SELECT count(*) INTO v_before_p2p_journals
  FROM public.ledger_journals_v2
  WHERE source_type = 'P2P_TRANSFER_V2';

  SELECT count(*) INTO v_before_mirror_journals
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  SELECT count(*) INTO v_before_total_journals
  FROM public.ledger_journals_v2;

  SELECT count(*) INTO v_before_total_entries
  FROM public.ledger_entries_v2;

  SELECT md5(
    COALESCE(
      string_agg(
        a.currency || ':' || b.balance::text,
        '|' ORDER BY a.currency
      ),
      ''
    )
  )
  INTO v_bridge_hash_before
  FROM public.ledger_accounts_v2 AS a
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE';

  v_first_result := public.wallet_transfer_ledger_v2(
    v_sender_user_id,
    v_receiver_phone,
    'SSP',
    v_amount,
    v_description,
    v_idempotency_key
  );

  IF COALESCE((v_first_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FIRST_RESULT_NOT_OK: %', v_first_result;
  END IF;

  IF COALESCE((v_first_result->>'idempotentReplay')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'TEST_FIRST_RESULT_MARKED_REPLAY';
  END IF;

  v_reference := NULLIF(btrim(COALESCE(v_first_result->>'reference', '')), '');
  v_journal_id := NULLIF(v_first_result->>'ledgerJournalId', '')::uuid;

  IF v_reference IS NULL OR v_journal_id IS NULL THEN
    RAISE EXCEPTION 'TEST_FIRST_RESULT_IDENTIFIERS_MISSING: %', v_first_result;
  END IF;

  SELECT balance INTO v_after_sender_balance
  FROM public.wallets
  WHERE id = v_sender_wallet_id;

  SELECT balance INTO v_after_receiver_balance
  FROM public.wallets
  WHERE id = v_receiver_wallet_id;

  IF v_after_sender_balance >= v_before_sender_balance THEN
    RAISE EXCEPTION 'TEST_SENDER_WAS_NOT_DEBITED';
  END IF;

  IF v_after_receiver_balance <> v_before_receiver_balance + v_amount THEN
    RAISE EXCEPTION 'TEST_RECEIVER_CREDIT_MISMATCH: before %, after %',
      v_before_receiver_balance, v_after_receiver_balance;
  END IF;

  SELECT count(*) INTO v_reference_tx_count
  FROM public.transactions
  WHERE reference = v_reference
    AND created_at >= transaction_timestamp();

  IF v_reference_tx_count < 2 OR v_reference_tx_count > 4 THEN
    RAISE EXCEPTION 'TEST_REFERENCE_TRANSACTION_COUNT_INVALID: %',
      v_reference_tx_count;
  END IF;

  SELECT count(*) INTO v_after_p2p_journals
  FROM public.ledger_journals_v2
  WHERE source_type = 'P2P_TRANSFER_V2';

  SELECT count(*) INTO v_after_mirror_journals
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  SELECT count(*) INTO v_after_total_journals
  FROM public.ledger_journals_v2;

  SELECT count(*) INTO v_after_total_entries
  FROM public.ledger_entries_v2;

  IF v_after_p2p_journals <> v_before_p2p_journals + 1 THEN
    RAISE EXCEPTION 'TEST_NATIVE_P2P_JOURNAL_COUNT_MISMATCH';
  END IF;

  IF v_after_mirror_journals <> v_before_mirror_journals THEN
    RAISE EXCEPTION 'TEST_GENERIC_MIRROR_DOUBLE_POSTED';
  END IF;

  IF v_after_total_journals <> v_before_total_journals + 1 THEN
    RAISE EXCEPTION 'TEST_TOTAL_JOURNAL_COUNT_MISMATCH';
  END IF;

  IF v_after_total_entries <= v_before_total_entries THEN
    RAISE EXCEPTION 'TEST_NATIVE_P2P_ENTRIES_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ledger_journals_v2
    WHERE id = v_journal_id
      AND source_type = 'P2P_TRANSFER_V2'
      AND source_ref = v_reference
      AND idempotency_key = v_idempotency_key
  ) THEN
    RAISE EXCEPTION 'TEST_NATIVE_P2P_JOURNAL_METADATA_MISMATCH';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_POST_RECONCILIATION_FAILED: % bad rows', v_bad_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_unbalanced_journals
    WHERE journal_id = v_journal_id
  ) THEN
    RAISE EXCEPTION 'TEST_NATIVE_P2P_UNBALANCED';
  END IF;

  SELECT md5(
    COALESCE(
      string_agg(
        a.currency || ':' || b.balance::text,
        '|' ORDER BY a.currency
      ),
      ''
    )
  )
  INTO v_bridge_hash_after
  FROM public.ledger_accounts_v2 AS a
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE';

  IF v_bridge_hash_after IS DISTINCT FROM v_bridge_hash_before THEN
    RAISE EXCEPTION 'TEST_NATIVE_P2P_CHANGED_MIRROR_BRIDGES';
  END IF;

  -- Exact replay: no second legacy transfer and no second journal.
  v_replay_result := public.wallet_transfer_ledger_v2(
    v_sender_user_id,
    v_receiver_phone,
    'SSP',
    v_amount,
    v_description,
    v_idempotency_key
  );

  IF COALESCE((v_replay_result->>'idempotentReplay')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_REPLAY_NOT_IDEMPOTENT: %', v_replay_result;
  END IF;

  v_replay_journal_id := NULLIF(v_replay_result->>'ledgerJournalId', '')::uuid;

  IF v_replay_journal_id IS DISTINCT FROM v_journal_id THEN
    RAISE EXCEPTION 'TEST_REPLAY_JOURNAL_ID_CHANGED';
  END IF;

  SELECT balance INTO v_replay_sender_balance
  FROM public.wallets
  WHERE id = v_sender_wallet_id;

  SELECT balance INTO v_replay_receiver_balance
  FROM public.wallets
  WHERE id = v_receiver_wallet_id;

  IF v_replay_sender_balance IS DISTINCT FROM v_after_sender_balance
     OR v_replay_receiver_balance IS DISTINCT FROM v_after_receiver_balance THEN
    RAISE EXCEPTION 'TEST_REPLAY_MOVED_MONEY_AGAIN';
  END IF;

  SELECT count(*) INTO v_replay_reference_tx_count
  FROM public.transactions
  WHERE reference = v_reference
    AND created_at >= transaction_timestamp();

  IF v_replay_reference_tx_count <> v_reference_tx_count THEN
    RAISE EXCEPTION 'TEST_REPLAY_CREATED_LEGACY_TRANSACTIONS';
  END IF;

  SELECT count(*) INTO v_replay_total_journals
  FROM public.ledger_journals_v2;

  SELECT count(*) INTO v_replay_total_entries
  FROM public.ledger_entries_v2;

  IF v_replay_total_journals <> v_after_total_journals
     OR v_replay_total_entries <> v_after_total_entries THEN
    RAISE EXCEPTION 'TEST_REPLAY_CREATED_LEDGER_RECORDS';
  END IF;

  -- Same key + different request must fail before any money movement.
  BEGIN
    PERFORM public.wallet_transfer_ledger_v2(
      v_sender_user_id,
      v_receiver_phone,
      'SSP',
      v_amount + 1,
      v_description,
      v_idempotency_key
    );
    RAISE EXCEPTION 'TEST_IDEMPOTENCY_CONFLICT_SHOULD_HAVE_FAILED';
  EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM <> 'LEDGER_P2P_IDEMPOTENCY_CONFLICT' THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FINAL_RECONCILIATION_FAILED: % bad rows', v_bad_count;
  END IF;

  RAISE NOTICE 'LEDGER V2 NATIVE P2P TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY NATIVE P2P JOURNAL ==='
SELECT
  id,
  source_type,
  source_ref,
  idempotency_key,
  metadata->>'currency' AS currency,
  metadata->>'amount' AS amount
FROM public.ledger_journals_v2
WHERE source_type = 'P2P_TRANSFER_V2'
ORDER BY posted_at DESC;

\echo ''
\echo '=== TEMPORARY LEDGER / MIRROR COUNTS ==='
SELECT count(*) AS ledger_accounts FROM public.ledger_accounts_v2;
SELECT count(*) AS ledger_journals FROM public.ledger_journals_v2;
SELECT count(*) AS ledger_entries FROM public.ledger_entries_v2;
SELECT count(*) AS native_p2p_journals
FROM public.ledger_journals_v2
WHERE source_type = 'P2P_TRANSFER_V2';
SELECT count(*) AS generic_mirror_journals
FROM public.ledger_journals_v2
WHERE source_type = 'LEGACY_BALANCE_MIRROR';
SELECT count(*) AS bad_live_reconciliation
FROM public.ledger_v2_legacy_live_reconciliation
WHERE reconciliation_status <> 'MATCHED'
   OR difference IS DISTINCT FROM 0::numeric;

ROLLBACK;
