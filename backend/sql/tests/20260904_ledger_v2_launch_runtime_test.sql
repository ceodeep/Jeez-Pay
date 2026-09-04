\pset pager off
\echo '=== LEDGER V2 CURRENT LAUNCH WRITER TEST ==='
\echo 'ROLLBACK-ONLY: admin adjustment + fiat withdrawal + referral defer guard, with exact reconciliation.'

BEGIN;
SET LOCAL statement_timeout = '90s';
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE phase8_launch_baseline (
  key text PRIMARY KEY,
  value bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO phase8_launch_baseline(key,value)
VALUES
  ('admin_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='ADMIN_BALANCE_ADJUSTMENT_V2')),
  ('referral_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='REFERRAL_REWARD_V2')),
  ('withdraw_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='FIAT_WITHDRAWAL_V2')),
  ('mirror_journals', (SELECT count(*) FROM public.ledger_journals_v2 WHERE source_type='LEGACY_BALANCE_MIRROR'));

DO $$
DECLARE
  v_admin_id uuid;
  v_target_user_id uuid;
  v_target_wallet_id uuid;
  v_withdraw_id text;
  v_setting_id uuid;
  v_result jsonb;
  v_replay jsonb;
  v_conflict_seen boolean := false;
  v_referral_block_seen boolean := false;
  v_before numeric(38,12);
  v_after numeric(38,12);
  v_count bigint;
BEGIN
  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_REQUIRES_LEGACY_MIRROR_ENABLED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status <> 'MATCHED'
       OR difference IS DISTINCT FROM 0::numeric
  ) THEN
    RAISE EXCEPTION 'TEST_PRE_RECONCILIATION_NOT_CLEAN';
  END IF;

  IF to_regprocedure('public.guard_referral_rewards_deferred_v2()') IS NULL THEN
    RAISE EXCEPTION 'TEST_REFERRAL_DEFER_GUARD_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.referral_reward_settings
    WHERE enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'TEST_REFERRAL_REWARDS_MUST_REMAIN_DISABLED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname='referral_reward_settings'
      AND t.tgname='referral_rewards_deferred_v2_guard'
      AND t.tgenabled <> 'D'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'TEST_REFERRAL_DEFER_TRIGGER_MISSING_OR_DISABLED';
  END IF;

  SELECT id
  INTO v_setting_id
  FROM public.referral_reward_settings
  ORDER BY updated_at DESC NULLS LAST, id
  LIMIT 1;

  IF v_setting_id IS NOT NULL THEN
    BEGIN
      UPDATE public.referral_reward_settings
      SET enabled=true
      WHERE id=v_setting_id;

      RAISE EXCEPTION 'TEST_REFERRAL_REENABLE_SHOULD_HAVE_FAILED';
    EXCEPTION
      WHEN SQLSTATE 'P0001' THEN
        IF SQLERRM = 'REFERRAL_REWARDS_TEMPORARILY_DISABLED' THEN
          v_referral_block_seen := true;
        ELSE
          RAISE;
        END IF;
    END;

    IF v_referral_block_seen IS NOT TRUE THEN
      RAISE EXCEPTION 'TEST_REFERRAL_DEFER_GUARD_NOT_ENFORCED';
    END IF;
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
  JOIN public.wallets w
    ON w.user_id=u.id
   AND upper(w.currency)='SSP'
  WHERE u.role='user'
    AND COALESCE(u.is_system,false)=false
    AND COALESCE(u.is_active,true)=true
    AND w.balance >= 10
  ORDER BY w.balance DESC, u.id
  LIMIT 1;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_SSP_USER_WITH_BALANCE_MISSING';
  END IF;

  v_result := public.admin_wallet_adjust_ledger_v2(
    v_admin_id,
    v_target_user_id,
    'SSP',
    1,
    'credit',
    'Phase 8 rollback admin credit',
    'phase8-admin-credit-v1'
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
    'Phase 8 rollback admin credit',
    'phase8-admin-credit-v1'
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
      'Phase 8 rollback admin credit',
      'phase8-admin-credit-v1'
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

  v_result := public.admin_wallet_adjust_ledger_v2(
    v_admin_id,
    v_target_user_id,
    'SSP',
    1,
    'debit',
    'Phase 8 rollback admin debit',
    'phase8-admin-debit-v1'
  );

  SELECT balance::numeric(38,12)
  INTO v_after
  FROM public.wallets
  WHERE id=v_target_wallet_id;

  IF v_after <> v_before THEN
    RAISE EXCEPTION 'TEST_ADMIN_NET_BALANCE_NOT_RESTORED: before %, after %', v_before, v_after;
  END IF;

  INSERT INTO public.withdraw_requests(
    user_id,wallet_id,amount,currency,method,destination,status
  ) VALUES (
    v_target_user_id,
    v_target_wallet_id,
    1,
    'SSP',
    'phase8_test',
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

  IF v_count <> (SELECT value+2 FROM phase8_launch_baseline WHERE key='admin_journals') THEN
    RAISE EXCEPTION 'TEST_ADMIN_JOURNAL_COUNT_INVALID: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='REFERRAL_REWARD_V2';

  IF v_count <> (SELECT value FROM phase8_launch_baseline WHERE key='referral_journals') THEN
    RAISE EXCEPTION 'TEST_REFERRAL_JOURNAL_SHOULD_NOT_CHANGE_WHILE_DEFERRED: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='FIAT_WITHDRAWAL_V2';

  IF v_count <> (SELECT value+1 FROM phase8_launch_baseline WHERE key='withdraw_journals') THEN
    RAISE EXCEPTION 'TEST_WITHDRAWAL_JOURNAL_COUNT_INVALID: %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.ledger_journals_v2
  WHERE source_type='LEGACY_BALANCE_MIRROR';

  IF v_count <> (SELECT value FROM phase8_launch_baseline WHERE key='mirror_journals') THEN
    RAISE EXCEPTION 'TEST_GENERIC_MIRROR_DOUBLE_POST_DETECTED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status <> 'MATCHED'
       OR difference IS DISTINCT FROM 0::numeric
  ) THEN
    RAISE EXCEPTION 'TEST_POST_RECONCILIATION_NOT_CLEAN';
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'TEST_UNBALANCED_LEDGER_JOURNAL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0
  ) THEN
    RAISE EXCEPTION 'TEST_LEDGER_BALANCE_RECONCILIATION_DIFF';
  END IF;

  RAISE NOTICE 'LEDGER V2 CURRENT LAUNCH WRITER TEST: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY CURRENT-LAUNCH JOURNALS ==='
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
\echo '=== REFERRAL LAUNCH GATE ==='
SELECT count(*) AS enabled_referral_settings
FROM public.referral_reward_settings
WHERE enabled IS TRUE;

SELECT count(*) AS active_referral_defer_triggers
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname='referral_reward_settings'
  AND t.tgname='referral_rewards_deferred_v2_guard'
  AND t.tgenabled <> 'D'
  AND NOT t.tgisinternal;

\echo ''
\echo '=== TEMPORARY INTEGRITY ==='
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
