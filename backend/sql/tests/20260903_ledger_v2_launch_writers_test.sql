\pset pager off

\echo '=== LEDGER V2 LAUNCH WRITER TESTS ==='
\echo 'ROLLBACK-ONLY: admin adjustment + referral reward + fiat withdrawal approval.'

BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE phase45_baseline (
  key text PRIMARY KEY,
  value bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO phase45_baseline(key,value)
VALUES
  ('admin_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='ADMIN_BALANCE_ADJUSTMENT_V2')),
  ('referral_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='REFERRAL_REWARD_V2')),
  ('withdraw_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='FIAT_WITHDRAWAL_V2')),
  ('mirror_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='LEGACY_BALANCE_MIRROR')),
  ('referral_rewards', (SELECT count(*) FROM public.referral_rewards)),
  ('withdraw_requests', (SELECT count(*) FROM public.withdraw_requests));

DO $$
DECLARE
  v_admin_id uuid;
  v_target_user_id uuid;
  v_target_wallet_id uuid;
  v_referrer_id uuid;
  v_referee_id uuid;
  v_withdraw_id text;
  v_result jsonb;
  v_replay jsonb;
  v_conflict_seen boolean := false;
  v_before numeric(38,12);
  v_after numeric(38,12);
  v_count bigint;
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_REQUIRES_LEGACY_MIRROR_ENABLED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status <> 'MATCHED'
       OR difference IS DISTINCT FROM 0::numeric
  ) THEN
    RAISE EXCEPTION 'TEST_PRE_RECONCILIATION_NOT_CLEAN';
  END IF;

  SELECT id INTO v_admin_id
  FROM public.users
  WHERE role='admin'
    AND COALESCE(is_system,false)=false
    AND COALESCE(is_active,true)=true
  ORDER BY id
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'TEST_ADMIN_USER_MISSING';
  END IF;

  SELECT u.id, w.id, w.balance::numeric(38,12)
  INTO v_target_user_id, v_target_wallet_id, v_before
  FROM public.users u
  JOIN public.wallets w ON w.user_id=u.id AND w.currency='SSP'
  WHERE u.role='user'
    AND COALESCE(u.is_system,false)=false
    AND COALESCE(u.is_active,true)=true
    AND w.balance >= 10
  ORDER BY w.balance DESC, u.id
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_SSP_USER_WITH_BALANCE_MISSING';
  END IF;

  -- Admin credit: first execution, replay and conflict proof.
  v_result := public.admin_wallet_adjust_ledger_v2(
    v_admin_id,
    v_target_user_id,
    'SSP',
    1,
    'credit',
    'Phase 4.5B rollback admin credit',
    'phase45-admin-credit-v1'
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR COALESCE((v_result->>'idempotentReplay')::boolean,true) IS TRUE
     OR (v_result->>'newBalance')::numeric <> v_before + 1 THEN
    RAISE EXCEPTION 'TEST_ADMIN_CREDIT_RESULT_INVALID: %', v_result;
  END IF;

  v_replay := public.admin_wallet_adjust_ledger_v2(
    v_admin_id,
    v_target_user_id,
    'SSP',
    1,
    'credit',
    'Phase 4.5B rollback admin credit',
    'phase45-admin-credit-v1'
  );

  IF COALESCE((v_replay->>'idempotentReplay')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_ADMIN_REPLAY_FAILED: %', v_replay;
  END IF;

  BEGIN
    PERFORM public.admin_wallet_adjust_ledger_v2(
      v_admin_id,
      v_target_user_id,
      'SSP',
      2,
      'credit',
      'Phase 4.5B rollback admin credit',
      'phase45-admin-credit-v1'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%IDEMPOTENCY_CONFLICT%' THEN
      v_conflict_seen := true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_conflict_seen IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_ADMIN_IDEMPOTENCY_CONFLICT_NOT_BLOCKED';
  END IF;

  -- Opposite adjustment restores the target wallet to its initial balance.
  v_result := public.admin_wallet_adjust_ledger_v2(
    v_admin_id,
    v_target_user_id,
    'SSP',
    1,
    'debit',
    'Phase 4.5B rollback admin debit',
    'phase45-admin-debit-v1'
  );

  SELECT balance::numeric(38,12) INTO v_after
  FROM public.wallets WHERE id=v_target_wallet_id;

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'TEST_ADMIN_NET_BALANCE_NOT_RESTORED: before %, after %', v_before, v_after;
  END IF;

  -- Pick a clean referral pair and temporarily configure a 1 SSP KYC reward.
  SELECT r.id, e.id
  INTO v_referrer_id, v_referee_id
  FROM public.users r
  CROSS JOIN public.users e
  WHERE r.id <> e.id
    AND r.role='user'
    AND e.role='user'
    AND COALESCE(r.is_system,false)=false
    AND COALESCE(e.is_system,false)=false
    AND COALESCE(r.is_active,true)=true
    AND COALESCE(e.is_active,true)=true
    AND NOT EXISTS (
      SELECT 1 FROM public.referral_rewards rr
      WHERE rr.referrer_user_id=r.id
        AND rr.referee_user_id=e.id
        AND rr.trigger_event='kyc_approved'
    )
  ORDER BY r.id,e.id
  LIMIT 1;

  IF v_referrer_id IS NULL OR v_referee_id IS NULL THEN
    RAISE EXCEPTION 'TEST_CLEAN_REFERRAL_PAIR_MISSING';
  END IF;

  UPDATE public.users
  SET referred_by_user_id=v_referrer_id
  WHERE id=v_referee_id;

  IF EXISTS (SELECT 1 FROM public.referral_reward_settings) THEN
    UPDATE public.referral_reward_settings
    SET enabled=true,
        reward_amount=1,
        currency='SSP',
        trigger_event='kyc_approved',
        max_rewards_per_user=100000,
        updated_at=now()
    WHERE id=(
      SELECT id FROM public.referral_reward_settings
      ORDER BY updated_at DESC
      LIMIT 1
    );
  ELSE
    INSERT INTO public.referral_reward_settings(
      enabled,reward_amount,currency,trigger_event,max_rewards_per_user
    ) VALUES (true,1,'SSP','kyc_approved',100000);
  END IF;

  v_result := public.grant_referral_reward_ledger_v2(v_referee_id,'kyc_approved');

  IF v_result->>'status' <> 'rewarded'
     OR v_result->>'currency' <> 'SSP'
     OR (v_result->>'amount')::numeric <> 1 THEN
    RAISE EXCEPTION 'TEST_REFERRAL_REWARD_FAILED: %', v_result;
  END IF;

  v_replay := public.grant_referral_reward_ledger_v2(v_referee_id,'kyc_approved');
  IF v_replay->>'status' <> 'skipped'
     OR v_replay->>'reason' <> 'reward already exists' THEN
    RAISE EXCEPTION 'TEST_REFERRAL_DUPLICATE_NOT_BLOCKED: %', v_replay;
  END IF;

  -- Create one temporary pending fiat withdrawal and approve it atomically.
  INSERT INTO public.withdraw_requests(
    user_id,wallet_id,amount,currency,method,destination,status
  ) VALUES (
    v_target_user_id,
    v_target_wallet_id,
    1,
    'SSP',
    'phase45_test',
    'ROLLBACK-ONLY',
    'pending'
  )
  RETURNING id::text INTO v_withdraw_id;

  v_result := public.approve_fiat_withdrawal_ledger_v2(v_admin_id,v_withdraw_id);

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'status' <> 'approved'
     OR COALESCE((v_result->>'idempotentReplay')::boolean,true) IS TRUE THEN
    RAISE EXCEPTION 'TEST_WITHDRAWAL_APPROVAL_FAILED: %', v_result;
  END IF;

  v_replay := public.approve_fiat_withdrawal_ledger_v2(v_admin_id,v_withdraw_id);
  IF COALESCE((v_replay->>'ok')::boolean,false) IS NOT TRUE
     OR COALESCE((v_replay->>'idempotentReplay')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_WITHDRAWAL_REPLAY_FAILED: %', v_replay;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='ADMIN_BALANCE_ADJUSTMENT_V2';
  IF v_count <> (SELECT value+2 FROM phase45_baseline WHERE key='admin_journals') THEN
    RAISE EXCEPTION 'TEST_ADMIN_JOURNAL_COUNT_INVALID: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='REFERRAL_REWARD_V2';
  IF v_count <> (SELECT value+1 FROM phase45_baseline WHERE key='referral_journals') THEN
    RAISE EXCEPTION 'TEST_REFERRAL_JOURNAL_COUNT_INVALID: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='FIAT_WITHDRAWAL_V2';
  IF v_count <> (SELECT value+1 FROM phase45_baseline WHERE key='withdraw_journals') THEN
    RAISE EXCEPTION 'TEST_WITHDRAWAL_JOURNAL_COUNT_INVALID: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='LEGACY_BALANCE_MIRROR';
  IF v_count <> (SELECT value FROM phase45_baseline WHERE key='mirror_journals') THEN
    RAISE EXCEPTION 'TEST_GENERIC_MIRROR_DOUBLE_POST_DETECTED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status <> 'MATCHED'
       OR difference IS DISTINCT FROM 0::numeric
  ) THEN
    RAISE EXCEPTION 'TEST_POST_RECONCILIATION_NOT_CLEAN';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'TEST_UNBALANCED_LEDGER_JOURNAL';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0
  ) THEN
    RAISE EXCEPTION 'TEST_LEDGER_BALANCE_RECONCILIATION_DIFF';
  END IF;

  RAISE NOTICE 'LEDGER V2 LAUNCH WRITER TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY NATIVE JOURNALS ==='
SELECT source_type,count(*) AS journal_count
FROM public.ledger_journals_v2
WHERE source_type IN (
  'ADMIN_BALANCE_ADJUSTMENT_V2',
  'REFERRAL_REWARD_V2',
  'FIAT_WITHDRAWAL_V2'
)
GROUP BY source_type
ORDER BY source_type;

\echo ''
\echo '=== TEMPORARY INTEGRITY ==='
SELECT count(*) AS generic_mirror_journals
FROM public.ledger_journals_v2
WHERE source_type='LEGACY_BALANCE_MIRROR';

SELECT count(*) AS bad_live_reconciliation
FROM public.ledger_v2_legacy_live_reconciliation
WHERE reconciliation_status <> 'MATCHED'
   OR difference IS DISTINCT FROM 0::numeric;

SELECT count(*) AS unbalanced_journals
FROM public.ledger_v2_unbalanced_journals;

SELECT count(*) AS ledger_reconciliation_differences
FROM public.ledger_v2_balance_reconciliation
WHERE difference <> 0;

ROLLBACK;
