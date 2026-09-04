\set ON_ERROR_STOP on
\pset pager off

\echo '=== LEDGER V2 NATIVE AGENT TESTS ==='
\echo 'ROLLBACK-ONLY: temporarily provisions an eligible SSP user as an active test agent desk, executes tiny cash-in/cash-out through Phase 4.4B, verifies atomic agent_operations + native Ledger posting/idempotency/no mirror double-post, then rolls everything back.'

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '90s';

CREATE TEMP TABLE phase44_agent_test_state (
  key text PRIMARY KEY,
  value_text text
) ON COMMIT DROP;

CREATE TEMP TABLE phase44_bridge_before AS
SELECT a.id AS account_id, b.balance
FROM public.ledger_accounts_v2 a
JOIN public.ledger_account_balances_v2 b ON b.account_id = a.id
WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE';

DO $$
DECLARE
  v_agent_id uuid;
  v_agent_phone text;
  v_customer_id uuid;
  v_customer_phone text;
  v_expected_fee numeric(38,12);
  v_required numeric(38,12);
  v_cash_in jsonb;
  v_cash_in_replay jsonb;
  v_cash_out jsonb;
  v_cash_out_replay jsonb;
  v_operation_id uuid;
  v_desk_id uuid;
  v_count integer;
  v_before_operations integer;
  v_before_mirror integer;
  v_before_p2p integer;
  v_bad integer;
  v_conflict_seen boolean := false;
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'PHASE44_TEST_MIRROR_NOT_ENABLED';
  END IF;

  IF to_regclass('public.agent_desks_v1') IS NULL
     OR to_regclass('public.agent_desk_capabilities_v1') IS NULL THEN
    RAISE EXCEPTION 'PHASE44_TEST_AGENT_DESK_POLICY_MISSING';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'PHASE44_TEST_PRE_RECONCILIATION_FAILED: %', v_bad;
  END IF;

  SELECT
    COALESCE(flat_fee, 0) + ((1::numeric * COALESCE(fee_percent, 0)) / 100)
  INTO v_expected_fee
  FROM public.currency_settings
  WHERE currency = 'SSP'
    AND is_enabled = true;

  IF v_expected_fee IS NULL OR v_expected_fee < 0 THEN
    RAISE EXCEPTION 'PHASE44_TEST_SSP_FEE_MISSING';
  END IF;

  v_required := 1::numeric + v_expected_fee;

  SELECT u.id, u.phone
  INTO v_agent_id, v_agent_phone
  FROM public.users u
  JOIN public.wallets w
    ON w.user_id = u.id
   AND w.currency = 'SSP'
  JOIN public.kyc_profiles kp
    ON kp.user_id = u.id
   AND kp.status = 'approved'
  WHERE u.role = 'user'
    AND COALESCE(u.is_system, false) = false
    AND COALESCE(u.is_active, true) = true
    AND COALESCE(u.phone_verified, false) = true
    AND u.phone IS NOT NULL
    AND w.balance >= v_required
    AND NOT EXISTS (
      SELECT 1
      FROM public.compliance_entity_controls c
      WHERE c.entity_type = 'USER'
        AND c.entity_ref = u.id::text
        AND c.status IN ('review','frozen')
    )
  ORDER BY w.balance DESC, u.id
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'PHASE44_TEST_NO_ELIGIBLE_AGENT_CANDIDATE';
  END IF;

  SELECT u.id, u.phone
  INTO v_customer_id, v_customer_phone
  FROM public.users u
  JOIN public.wallets w
    ON w.user_id = u.id
   AND w.currency = 'SSP'
  WHERE u.role = 'user'
    AND u.id <> v_agent_id
    AND COALESCE(u.is_system, false) = false
    AND COALESCE(u.is_active, true) = true
    AND COALESCE(u.phone_verified, false) = true
    AND u.phone IS NOT NULL
    AND w.balance >= v_required
  ORDER BY w.balance DESC, u.id
  LIMIT 1;

  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'PHASE44_TEST_NO_CUSTOMER_CANDIDATE';
  END IF;

  PERFORM 1 FROM public.users WHERE id IN (v_agent_id, v_customer_id) FOR UPDATE;
  PERFORM 1 FROM public.wallets WHERE user_id IN (v_agent_id, v_customer_id) AND currency = 'SSP' FOR UPDATE;

  SELECT count(*) INTO v_before_operations FROM public.agent_operations;
  SELECT count(*) INTO v_before_mirror FROM public.ledger_journals_v2 WHERE source_type = 'LEGACY_BALANCE_MIRROR';
  SELECT count(*) INTO v_before_p2p FROM public.ledger_journals_v2 WHERE source_type = 'P2P_TRANSFER_V2';

  INSERT INTO phase44_agent_test_state(key, value_text) VALUES
    ('agent_id', v_agent_id::text),
    ('customer_id', v_customer_id::text),
    ('expected_fee', v_expected_fee::text),
    ('before_operations', v_before_operations::text),
    ('before_mirror', v_before_mirror::text),
    ('before_p2p', v_before_p2p::text);

  -- Test-only agent identity and desk controls live only inside this transaction.
  UPDATE public.users
  SET role = 'agent'
  WHERE id = v_agent_id;

  INSERT INTO public.agent_desks_v1(
    agent_user_id,desk_code,display_name,country_code,city,status,activated_at
  ) VALUES (
    v_agent_id,
    'AG-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
    'Phase 4.4B Rollback Desk','SS','Juba','active',now()
  ) RETURNING id INTO v_desk_id;

  INSERT INTO public.agent_desk_capabilities_v1(
    desk_id,currency,cash_in_enabled,cash_out_enabled,
    min_tx_amount,max_tx_amount,daily_cash_in_limit,daily_cash_out_limit
  ) VALUES (
    v_desk_id,'SSP',true,true,0.01,1000000,1000000,1000000
  );

  v_cash_in := public.agent_cash_in_ledger_v2(
    v_agent_id,
    v_customer_phone,
    'SSP',
    1,
    'Phase 4.4B rollback cash-in',
    'phase44-test-cash-in-v1'
  );

  IF COALESCE((v_cash_in->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_cash_in->>'idempotentReplay')::boolean, true) IS TRUE
     OR COALESCE(NULLIF(v_cash_in->>'fee', '')::numeric, -1) IS DISTINCT FROM v_expected_fee THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_IN_RESULT_INVALID: %', v_cash_in;
  END IF;

  v_operation_id := NULLIF(v_cash_in->>'agentOperationId', '')::uuid;

  IF v_operation_id IS NULL THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_IN_OPERATION_ID_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.agent_operations
  WHERE id = v_operation_id
    AND type = 'cash_in'
    AND agent_user_id = v_agent_id
    AND customer_user_id = v_customer_id
    AND currency = 'SSP'
    AND amount = 1
    AND fee = v_expected_fee
    AND status = 'completed';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_IN_OPERATION_INVALID';
  END IF;

  v_cash_in_replay := public.agent_cash_in_ledger_v2(
    v_agent_id,
    v_customer_phone,
    'SSP',
    1,
    'Phase 4.4B rollback cash-in',
    'phase44-test-cash-in-v1'
  );

  IF COALESCE((v_cash_in_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR NULLIF(v_cash_in_replay->>'agentOperationId', '')::uuid IS DISTINCT FROM v_operation_id THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_IN_REPLAY_INVALID: %', v_cash_in_replay;
  END IF;

  BEGIN
    PERFORM public.agent_cash_in_ledger_v2(
      v_agent_id,
      v_customer_phone,
      'SSP',
      2,
      'Phase 4.4B rollback cash-in',
      'phase44-test-cash-in-v1'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%LEDGER_AGENT_IDEMPOTENCY_CONFLICT%' THEN
      v_conflict_seen := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_conflict_seen IS NOT TRUE THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_IN_CONFLICT_NOT_BLOCKED';
  END IF;

  v_cash_out := public.agent_cash_out_ledger_v2(
    v_customer_id,
    v_agent_phone,
    'SSP',
    1,
    'Phase 4.4B rollback cash-out',
    'phase44-test-cash-out-v1'
  );

  IF COALESCE((v_cash_out->>'ok')::boolean, false) IS NOT TRUE
     OR COALESCE((v_cash_out->>'idempotentReplay')::boolean, true) IS TRUE
     OR COALESCE(NULLIF(v_cash_out->>'fee', '')::numeric, -1) IS DISTINCT FROM v_expected_fee THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_OUT_RESULT_INVALID: %', v_cash_out;
  END IF;

  v_operation_id := NULLIF(v_cash_out->>'agentOperationId', '')::uuid;

  IF v_operation_id IS NULL THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_OUT_OPERATION_ID_MISSING';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.agent_operations
  WHERE id = v_operation_id
    AND type = 'cash_out'
    AND agent_user_id = v_agent_id
    AND customer_user_id = v_customer_id
    AND currency = 'SSP'
    AND amount = 1
    AND fee = v_expected_fee
    AND status = 'completed';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_OUT_OPERATION_INVALID';
  END IF;

  v_cash_out_replay := public.agent_cash_out_ledger_v2(
    v_customer_id,
    v_agent_phone,
    'SSP',
    1,
    'Phase 4.4B rollback cash-out',
    'phase44-test-cash-out-v1'
  );

  IF COALESCE((v_cash_out_replay->>'idempotentReplay')::boolean, false) IS NOT TRUE
     OR NULLIF(v_cash_out_replay->>'agentOperationId', '')::uuid IS DISTINCT FROM v_operation_id THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_OUT_REPLAY_INVALID: %', v_cash_out_replay;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.agent_operations
  WHERE created_at >= transaction_timestamp()
    AND agent_user_id = v_agent_id
    AND customer_user_id = v_customer_id;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'PHASE44_TEST_OPERATION_COUNT: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'AGENT_CASH_IN_V2'
    AND metadata->>'agentUserId' = v_agent_id::text
    AND metadata->>'customerUserId' = v_customer_id::text
    AND posted_at >= transaction_timestamp();

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_IN_JOURNAL_COUNT: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'AGENT_CASH_OUT_V2'
    AND metadata->>'agentUserId' = v_agent_id::text
    AND metadata->>'customerUserId' = v_customer_id::text
    AND posted_at >= transaction_timestamp();

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PHASE44_TEST_CASH_OUT_JOURNAL_COUNT: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'LEGACY_BALANCE_MIRROR';

  IF v_count <> v_before_mirror THEN
    RAISE EXCEPTION 'PHASE44_TEST_GENERIC_MIRROR_CHANGED: before %, after %', v_before_mirror, v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type = 'P2P_TRANSFER_V2';

  IF v_count <> v_before_p2p THEN
    RAISE EXCEPTION 'PHASE44_TEST_P2P_JOURNAL_CHANGED: before %, after %', v_before_p2p, v_count;
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'PHASE44_TEST_POST_RECONCILIATION_FAILED: %', v_bad;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'PHASE44_TEST_UNBALANCED_JOURNAL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM phase44_bridge_before bb
    JOIN public.ledger_account_balances_v2 b ON b.account_id = bb.account_id
    WHERE b.balance IS DISTINCT FROM bb.balance
  ) THEN
    RAISE EXCEPTION 'PHASE44_TEST_MIRROR_BRIDGE_CHANGED';
  END IF;

  RAISE NOTICE 'LEDGER V2 NATIVE AGENT TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY AGENT JOURNALS ==='
SELECT
  source_type,
  count(*) AS journal_count,
  sum(CASE WHEN source_type = 'AGENT_CASH_IN_V2' THEN 1 ELSE 0 END) AS cash_in_journals,
  sum(CASE WHEN source_type = 'AGENT_CASH_OUT_V2' THEN 1 ELSE 0 END) AS cash_out_journals
FROM public.ledger_journals_v2
WHERE source_type IN ('AGENT_CASH_IN_V2', 'AGENT_CASH_OUT_V2')
  AND posted_at >= transaction_timestamp()
GROUP BY source_type
ORDER BY source_type;

\echo ''
\echo '=== TEMPORARY AGENT OPERATIONS ==='
SELECT type, currency, amount, fee, status
FROM public.agent_operations
WHERE created_at >= transaction_timestamp()
ORDER BY created_at, type;

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
