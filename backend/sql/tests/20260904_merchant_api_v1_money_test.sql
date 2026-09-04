\set ON_ERROR_STOP on
\pset pager off

\echo '=== MERCHANT API V1 MONEY TEST ==='
\echo 'ROLLBACK-ONLY: one tiny SSP payment + payout through launch wrappers, replay/webhook proof, balanced Ledger, no generic mirror double-post.'

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

DO $$
DECLARE
  v_merchant_id uuid;
  v_user_id uuid;
  v_account_number text;
  v_payment_create jsonb;
  v_payment_id uuid;
  v_payment jsonb;
  v_payment_replay jsonb;
  v_payout jsonb;
  v_payout_replay jsonb;
  v_payout_key text;
  v_payment_journal uuid;
  v_payout_journal uuid;
  v_before_payment integer;
  v_before_payout integer;
  v_before_mirror integer;
  v_count integer;
  v_net numeric(38,12);
  v_bad integer;
BEGIN
  SELECT mb.merchant_id
  INTO v_merchant_id
  FROM public.merchant_balances mb
  JOIN public.merchants m ON m.id = mb.merchant_id
  WHERE upper(mb.currency) = 'SSP'
    AND mb.balance >= 2
    AND m.status = 'active'
  ORDER BY mb.balance DESC, mb.merchant_id
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_ACTIVE_SSP_MERCHANT_REQUIRED';
  END IF;

  SELECT u.id, u.wallet_account_number::text
  INTO v_user_id, v_account_number
  FROM public.users u
  JOIN public.wallets w
    ON w.user_id = u.id
   AND upper(w.currency) = 'SSP'
  JOIN public.kyc_profiles k
    ON k.user_id = u.id
   AND k.status = 'approved'
  WHERE u.role = 'user'
    AND COALESCE(u.is_active,true) IS TRUE
    AND COALESCE(u.is_system,false) IS FALSE
    AND u.wallet_account_number IS NOT NULL
    AND w.balance >= 2
    AND NOT EXISTS (
      SELECT 1
      FROM public.compliance_entity_controls c
      WHERE c.entity_type = 'USER'
        AND c.entity_ref = u.id::text
        AND c.status IN ('review','frozen')
    )
  ORDER BY w.balance DESC, u.id
  LIMIT 1;

  IF v_user_id IS NULL OR v_account_number IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_ELIGIBLE_USER_REQUIRED';
  END IF;

  SELECT count(*) INTO v_before_payment
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYMENT_V2';

  SELECT count(*) INTO v_before_payout
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYOUT_V2';

  SELECT count(*) INTO v_before_mirror
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  v_payment_create := public.create_merchant_payment_v1(
    v_merchant_id,
    'phase7-money-payment-' || txid_current()::text,
    1,
    'SSP',
    'Phase 7 native money rollback test',
    NULL,
    NULL,
    NULL,
    jsonb_build_object('phase', 7, 'rollbackOnly', true)
  );

  IF COALESCE((v_payment_create->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_payment_create->>'created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_CREATE_FAILED: %', v_payment_create;
  END IF;

  v_payment_id := NULLIF(v_payment_create->'payment'->>'id','')::uuid;

  v_payment := public.confirm_merchant_payment_ledger_v2(v_user_id, v_payment_id);

  IF COALESCE((v_payment->>'ok')::boolean, false) IS NOT TRUE
     OR v_payment->>'code' <> 'PAID'
     OR COALESCE((v_payment->>'idempotentReplay')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYMENT_FAILED: %', v_payment;
  END IF;

  v_payment_journal := NULLIF(v_payment->>'ledgerJournalId','')::uuid;
  IF v_payment_journal IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYMENT_JOURNAL_MISSING';
  END IF;

  v_payment_replay := public.confirm_merchant_payment_ledger_v2(v_user_id, v_payment_id);
  IF COALESCE((v_payment_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR NULLIF(v_payment_replay->>'ledgerJournalId','')::uuid IS DISTINCT FROM v_payment_journal THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYMENT_REPLAY_FAILED: %', v_payment_replay;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.merchant_webhook_events
  WHERE merchant_payment_id = v_payment_id
    AND event_type = 'merchant_payment.paid';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_WEBHOOK_EVENT_COUNT: %', v_count;
  END IF;

  v_payout_key := 'phase7-money-payout-' || txid_current()::text;

  v_payout := public.execute_merchant_payout_ledger_v2(
    v_merchant_id,
    v_payout_key,
    v_account_number,
    1,
    'SSP',
    'Phase 7 native payout rollback test',
    jsonb_build_object('phase', 7, 'rollbackOnly', true)
  );

  IF COALESCE((v_payout->>'ok')::boolean, false) IS NOT TRUE
     OR v_payout->>'code' <> 'PAID'
     OR COALESCE((v_payout->>'idempotentReplay')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYOUT_FAILED: %', v_payout;
  END IF;

  v_payout_journal := NULLIF(v_payout->>'ledgerJournalId','')::uuid;
  IF v_payout_journal IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYOUT_JOURNAL_MISSING';
  END IF;

  v_payout_replay := public.execute_merchant_payout_ledger_v2(
    v_merchant_id,
    v_payout_key,
    v_account_number,
    1,
    'SSP',
    'Replay description may differ',
    jsonb_build_object('replay', true)
  );

  IF COALESCE((v_payout_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR NULLIF(v_payout_replay->>'ledgerJournalId','')::uuid IS DISTINCT FROM v_payout_journal THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYOUT_REPLAY_FAILED: %', v_payout_replay;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYMENT_V2';
  IF v_count <> v_before_payment + 1 THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYMENT_JOURNAL_COUNT: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYOUT_V2';
  IF v_count <> v_before_payout + 1 THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYOUT_JOURNAL_COUNT: %', v_count;
  END IF;

  SELECT count(*), COALESCE(sum(amount_delta),0)::numeric(38,12)
  INTO v_count, v_net
  FROM public.ledger_entries_v2
  WHERE journal_id = v_payment_journal;
  IF v_count <> 2 OR v_net <> 0 THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYMENT_ENTRIES_INVALID';
  END IF;

  SELECT count(*), COALESCE(sum(amount_delta),0)::numeric(38,12)
  INTO v_count, v_net
  FROM public.ledger_entries_v2
  WHERE journal_id = v_payout_journal;
  IF v_count <> 2 OR v_net <> 0 THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_PAYOUT_ENTRIES_INVALID';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';
  IF v_count <> v_before_mirror THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_GENERIC_MIRROR_CHANGED';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad <> 0
     OR EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals)
     OR EXISTS (SELECT 1 FROM public.ledger_v2_balance_reconciliation WHERE difference <> 0) THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_MONEY_TEST_LEDGER_INTEGRITY_FAILED';
  END IF;

  RAISE NOTICE 'MERCHANT API V1 MONEY TEST: OK';
END;
$$;

ROLLBACK;
