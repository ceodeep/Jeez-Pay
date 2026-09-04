\set ON_ERROR_STOP on
\pset pager off

\echo '=== MERCHANT API V1 TESTS ==='
\echo 'ROLLBACK-ONLY: SSP payment creation/replay/conflict, USDT fail-closed, webhook claim ownership, privileges, no ledger movement.'

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$
DECLARE
  v_merchant_id uuid;
  v_created jsonb;
  v_replay jsonb;
  v_conflict jsonb;
  v_usdt jsonb;
  v_bad_callback jsonb;
  v_payout_usdt jsonb;
  v_payment_id uuid;
  v_usdt_payment_id uuid;
  v_confirm_usdt jsonb;
  v_event_id uuid;
  v_lock_1 uuid := gen_random_uuid();
  v_lock_2 uuid := gen_random_uuid();
  v_claimed_1 uuid;
  v_claimed_2 uuid;
  v_before_journals bigint;
  v_after_journals bigint;
  v_bad integer;
BEGIN
  IF to_regprocedure('public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.claim_merchant_webhook_events_v1(integer,uuid)') IS NULL
     OR to_regprocedure('public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)') IS NULL
     OR to_regprocedure('public.execute_merchant_payout_ledger_v2_pre_launch_v1(uuid,text,text,numeric,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_REQUIRED_FUNCTION_MISSING';
  END IF;

  SELECT id
  INTO v_merchant_id
  FROM public.merchants
  WHERE status = 'active'
  ORDER BY id
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_ACTIVE_MERCHANT_REQUIRED';
  END IF;

  SELECT count(*) INTO v_before_journals
  FROM public.ledger_journals_v2;

  v_created := public.create_merchant_payment_v1(
    v_merchant_id,
    'phase7-payment-' || txid_current()::text,
    1,
    'SSP',
    'Phase 7 rollback payment',
    'https://example.com/jeezpay-webhook',
    'jeezpay-test://success',
    'jeezpay-test://cancel',
    jsonb_build_object('phase', 7, 'rollbackOnly', true)
  );

  IF COALESCE((v_created->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_created->>'created')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_CREATE_FAILED: %', v_created;
  END IF;

  v_payment_id := NULLIF(v_created->'payment'->>'id', '')::uuid;
  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_PAYMENT_ID_MISSING';
  END IF;

  v_replay := public.create_merchant_payment_v1(
    v_merchant_id,
    'phase7-payment-' || txid_current()::text,
    1,
    'SSP',
    'Phase 7 rollback payment',
    'https://example.com/jeezpay-webhook',
    'jeezpay-test://success',
    'jeezpay-test://cancel',
    jsonb_build_object('phase', 7, 'rollbackOnly', true)
  );

  IF COALESCE((v_replay->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_replay->>'created')::boolean, true) IS TRUE
     OR NULLIF(v_replay->'payment'->>'id', '')::uuid IS DISTINCT FROM v_payment_id THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_REPLAY_INVALID: %', v_replay;
  END IF;

  v_conflict := public.create_merchant_payment_v1(
    v_merchant_id,
    'phase7-payment-' || txid_current()::text,
    2,
    'SSP',
    'Phase 7 rollback payment',
    'https://example.com/jeezpay-webhook',
    'jeezpay-test://success',
    'jeezpay-test://cancel',
    jsonb_build_object('phase', 7, 'rollbackOnly', true)
  );

  IF COALESCE((v_conflict->>'ok')::boolean, true) IS NOT FALSE
     OR v_conflict->>'code' <> 'IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_CONFLICT_NOT_BLOCKED: %', v_conflict;
  END IF;

  v_usdt := public.create_merchant_payment_v1(
    v_merchant_id,
    'phase7-usdt-create-' || txid_current()::text,
    1,
    'USDT',
    NULL, NULL, NULL, NULL, '{}'::jsonb
  );

  IF COALESCE((v_usdt->>'ok')::boolean, true) IS NOT FALSE
     OR v_usdt->>'code' <> 'UNSUPPORTED_CURRENCY' THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_USDT_CREATE_NOT_BLOCKED: %', v_usdt;
  END IF;

  v_bad_callback := public.create_merchant_payment_v1(
    v_merchant_id,
    'phase7-http-callback-' || txid_current()::text,
    1,
    'SSP',
    NULL,
    'http://127.0.0.1/internal',
    NULL,
    NULL,
    '{}'::jsonb
  );

  IF COALESCE((v_bad_callback->>'ok')::boolean, true) IS NOT FALSE
     OR v_bad_callback->>'code' <> 'INVALID_CALLBACK_URL' THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_HTTP_CALLBACK_NOT_BLOCKED: %', v_bad_callback;
  END IF;

  v_payout_usdt := public.execute_merchant_payout_ledger_v2(
    v_merchant_id,
    'phase7-usdt-payout-' || txid_current()::text,
    '1',
    1,
    'USDT',
    NULL,
    '{}'::jsonb
  );

  IF COALESCE((v_payout_usdt->>'ok')::boolean, true) IS NOT FALSE
     OR v_payout_usdt->>'code' <> 'UNSUPPORTED_CURRENCY' THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_USDT_PAYOUT_NOT_BLOCKED: %', v_payout_usdt;
  END IF;

  INSERT INTO public.merchant_payments (
    merchant_id, merchant_order_id, amount, currency, status, expires_at
  ) VALUES (
    v_merchant_id,
    'phase7-usdt-confirm-' || txid_current()::text,
    1,
    'USDT',
    'pending',
    now() + interval '15 minutes'
  ) RETURNING id INTO v_usdt_payment_id;

  v_confirm_usdt := public.confirm_merchant_payment_ledger_v2(
    gen_random_uuid(),
    v_usdt_payment_id
  );

  IF COALESCE((v_confirm_usdt->>'ok')::boolean, true) IS NOT FALSE
     OR v_confirm_usdt->>'code' <> 'UNSUPPORTED_CURRENCY' THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_USDT_CONFIRM_NOT_BLOCKED: %', v_confirm_usdt;
  END IF;

  INSERT INTO public.merchant_webhook_events (
    merchant_id,
    merchant_payment_id,
    event_type,
    payload,
    status,
    attempts,
    next_attempt_at
  ) VALUES (
    v_merchant_id,
    v_payment_id,
    'merchant_payment.paid',
    jsonb_build_object('phase', 7, 'rollbackOnly', true),
    'pending',
    0,
    now() - interval '1 second'
  ) RETURNING id INTO v_event_id;

  SELECT event_id INTO v_claimed_1
  FROM public.claim_merchant_webhook_events_v1(1, v_lock_1)
  WHERE event_id = v_event_id;

  IF v_claimed_1 IS DISTINCT FROM v_event_id THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_WEBHOOK_NOT_CLAIMED';
  END IF;

  SELECT event_id INTO v_claimed_2
  FROM public.claim_merchant_webhook_events_v1(100, v_lock_2)
  WHERE event_id = v_event_id;

  IF v_claimed_2 IS NOT NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_WEBHOOK_DOUBLE_CLAIMED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_webhook_events
    WHERE id = v_event_id
      AND lock_token = v_lock_1
      AND locked_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_WEBHOOK_LOCK_STATE_INVALID';
  END IF;

  IF has_function_privilege('anon', 'public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_CREATE_PRIVILEGES_INVALID';
  END IF;

  IF has_function_privilege('service_role', 'public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.execute_merchant_payout_ledger_v2_pre_launch_v1(uuid,text,text,numeric,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.confirm_merchant_payment(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.execute_merchant_payout(uuid,text,text,numeric,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_BYPASS_PRIVILEGE_PRESENT';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.confirm_merchant_payment_ledger_v2(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_merchant_webhook_events_v1(integer,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_LAUNCH_PRIVILEGE_MISSING';
  END IF;

  SELECT count(*) INTO v_after_journals
  FROM public.ledger_journals_v2;

  IF v_after_journals <> v_before_journals THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_UNEXPECTED_LEDGER_MOVEMENT: before %, after %', v_before_journals, v_after_journals;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad <> 0 OR EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_TEST_LEDGER_INTEGRITY_FAILED';
  END IF;

  RAISE NOTICE 'MERCHANT API V1 TESTS: OK';
END;
$$;

ROLLBACK;
