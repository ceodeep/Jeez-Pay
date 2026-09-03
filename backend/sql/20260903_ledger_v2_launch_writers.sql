BEGIN;

-- Phase 4.5B
-- Consolidated native Ledger v2 primitives for the remaining SSP-launch money
-- writers that can still execute while FX, service payments and USDT are
-- capability-disabled:
--   * admin wallet credit/debit adjustments,
--   * referral reward credits,
--   * legacy fiat withdrawal approval debits.
--
-- All wallet mutations happen with the Phase 4.1 generic mirror suppressed
-- transaction-locally, then an explicit balanced native Ledger v2 journal is
-- posted in the SAME PostgreSQL transaction.

DO $$
BEGIN
  IF to_regprocedure('public.post_ledger_journal_v2(text,text,text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_POSTING_PRIMITIVE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.ensure_ledger_account_v2(text,text,text,text,text,boolean,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_ACCOUNT_PRIMITIVE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.materialize_legacy_account_mappings_v2()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_MAPPING_PRIMITIVE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.ledger_v2_legacy_balance_mirror_enabled()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_MIRROR_CONTROL_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.referral_rewards') IS NULL
     OR to_regclass('public.referral_reward_settings') IS NULL
     OR to_regclass('public.withdraw_requests') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_REQUIRED_TABLE_MISSING' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_single_wallet_mutation_ledger_v2(
  p_source_type text,
  p_source_ref text,
  p_idempotency_key text,
  p_user_id uuid,
  p_currency text,
  p_amount_delta numeric,
  p_transaction_type text,
  p_transaction_description text,
  p_offset_account_key text,
  p_offset_account_type text,
  p_offset_allow_negative boolean,
  p_operation_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_source_type text := upper(btrim(COALESCE(p_source_type, '')));
  v_source_ref text := NULLIF(btrim(COALESCE(p_source_ref, '')), '');
  v_idempotency_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_tx_type text := lower(btrim(COALESCE(p_transaction_type, '')));
  v_tx_description text := NULLIF(btrim(COALESCE(p_transaction_description, '')), '');
  v_offset_key text := btrim(COALESCE(p_offset_account_key, ''));
  v_offset_type text := upper(btrim(COALESCE(p_offset_account_type, '')));
  v_metadata jsonb := COALESCE(p_operation_metadata, '{}'::jsonb);
  v_fingerprint text;
  v_existing_journal_id uuid;
  v_existing_metadata jsonb;
  v_wallet public.wallets%ROWTYPE;
  v_wallet_account_id uuid;
  v_offset_account_id uuid;
  v_before numeric(38,12);
  v_after numeric(38,12);
  v_tx_id uuid;
  v_reference text;
  v_entries jsonb;
  v_result jsonb;
  v_post_result jsonb;
  v_journal_id uuid;
  v_bad_count integer;
BEGIN
  IF v_source_type = '' OR length(v_source_type) > 80 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INVALID_SOURCE_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF v_source_ref IS NULL OR length(v_source_ref) > 200 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INVALID_SOURCE_REF' USING ERRCODE = 'P0001';
  END IF;

  IF v_idempotency_key = '' OR length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INVALID_IDEMPOTENCY_KEY' USING ERRCODE = 'P0001';
  END IF;

  IF p_user_id IS NULL OR p_amount_delta IS NULL OR p_amount_delta = 0 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INVALID_MUTATION' USING ERRCODE = 'P0001';
  END IF;

  IF v_currency !~ '^[A-Z0-9]{3,10}$' THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INVALID_CURRENCY' USING ERRCODE = 'P0001';
  END IF;

  IF (p_amount_delta > 0 AND v_tx_type <> 'credit')
     OR (p_amount_delta < 0 AND v_tx_type <> 'debit') THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_TRANSACTION_DIRECTION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF v_offset_key = '' OR v_offset_type = '' OR jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INVALID_METADATA' USING ERRCODE = 'P0001';
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_LEGACY_MIRROR_NOT_ENABLED' USING ERRCODE = 'P0001';
  END IF;

  v_fingerprint := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'sourceType', v_source_type,
          'userId', p_user_id,
          'currency', v_currency,
          'amountDelta', p_amount_delta,
          'transactionType', v_tx_type,
          'description', v_tx_description,
          'offsetAccountKey', v_offset_key
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(v_source_type || ':' || v_idempotency_key, 0));

  SELECT id, metadata
  INTO v_existing_journal_id, v_existing_metadata
  FROM public.ledger_journals_v2
  WHERE source_type = v_source_type
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_metadata->>'requestFingerprint' IS DISTINCT FROM v_fingerprint THEN
      RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    IF v_existing_metadata->'result' IS NULL THEN
      RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_REPLAY_METADATA_MISSING' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_existing_metadata->'result'
      || jsonb_build_object(
        'ok', true,
        'ledgerJournalId', v_existing_journal_id,
        'idempotentReplay', true
      );
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_PRE_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  -- A zero-balance wallet may be created for a newly enabled product, but it
  -- must be mapped into Ledger v2 BEFORE the monetary mutation.
  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'on', true);
  INSERT INTO public.wallets(user_id, currency, balance)
  VALUES (p_user_id, v_currency, 0)
  ON CONFLICT (user_id, currency) DO NOTHING;
  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'off', true);

  PERFORM public.materialize_legacy_account_mappings_v2();

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE user_id = p_user_id
    AND currency = v_currency
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_WALLET_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.ledger_account_id
  INTO v_wallet_account_id
  FROM public.ledger_legacy_account_map_v2 AS m
  WHERE m.source_kind = 'USER_WALLET'
    AND m.source_id = v_wallet.id;

  IF v_wallet_account_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_MAPPING_MISSING' USING ERRCODE = 'P0001';
  END IF;

  v_offset_account_id := public.ensure_ledger_account_v2(
    v_offset_key,
    v_offset_type,
    'SYSTEM',
    v_offset_type,
    v_currency,
    COALESCE(p_offset_allow_negative, false),
    jsonb_build_object('phase', '4.5B', 'purpose', lower(v_offset_type))
  );

  SELECT balance::numeric(38,12) INTO v_before
  FROM public.wallets
  WHERE id = v_wallet.id
  FOR UPDATE;

  v_after := v_before + p_amount_delta;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'on', true);

  UPDATE public.wallets
  SET balance = v_after
  WHERE id = v_wallet.id;

  INSERT INTO public.transactions(
    wallet_id, type, amount, description, reference
  )
  VALUES (
    v_wallet.id,
    v_tx_type,
    abs(p_amount_delta),
    v_tx_description,
    v_source_ref
  )
  RETURNING id INTO v_tx_id;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'off', true);

  v_reference := v_source_ref;

  v_result := jsonb_build_object(
    'userId', p_user_id,
    'walletId', v_wallet.id,
    'currency', v_currency,
    'amount', abs(p_amount_delta),
    'transactionType', v_tx_type,
    'transactionId', v_tx_id,
    'reference', v_reference,
    'previousBalance', v_before,
    'newBalance', v_after
  );

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_wallet_account_id,
      'currency', v_currency,
      'amountDelta', p_amount_delta,
      'description', v_tx_description,
      'metadata', jsonb_build_object('legacyWalletId', v_wallet.id)
    ),
    jsonb_build_object(
      'accountId', v_offset_account_id,
      'currency', v_currency,
      'amountDelta', -p_amount_delta,
      'description', v_tx_description,
      'metadata', jsonb_build_object('offset', true)
    )
  );

  v_post_result := public.post_ledger_journal_v2(
    v_source_type,
    v_source_ref,
    v_idempotency_key,
    v_tx_description,
    v_metadata || jsonb_build_object(
      'requestFingerprint', v_fingerprint,
      'mirrorBypass', true,
      'result', v_result
    ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_POST_FAILED' USING ERRCODE = 'P0001';
  END IF;

  v_journal_id := NULLIF(v_post_result->>'journalId', '')::uuid;
  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_JOURNAL_ID_MISSING' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.wallets AS w
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = 'USER_WALLET' AND m.source_id = w.id
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  WHERE w.id = v_wallet.id
    AND b.balance IS DISTINCT FROM w.balance::numeric(38,12);

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_POST_BALANCE_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_POST_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001', DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_v2_unbalanced_journals WHERE journal_id = v_journal_id
  ) THEN
    RAISE EXCEPTION 'LEDGER_LAUNCH_WRITER_UNBALANCED_JOURNAL' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_result || jsonb_build_object(
    'ok', true,
    'ledgerJournalId', v_journal_id,
    'idempotentReplay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_wallet_adjust_ledger_v2(
  p_admin_user_id uuid,
  p_target_user_id uuid,
  p_currency text,
  p_amount numeric,
  p_type text,
  p_description text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_type text := lower(btrim(COALESCE(p_type, '')));
  v_description text := COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), 'Admin balance adjustment');
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_target public.users%ROWTYPE;
  v_reference text;
  v_delta numeric(38,12);
  v_result jsonb;
BEGIN
  IF p_admin_user_id IS NULL OR p_target_user_id IS NULL OR v_key = '' OR length(v_key) > 120 THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR v_type NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_INVALID_AMOUNT_OR_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF length(v_description) > 500 THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_DESCRIPTION_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_user_id) THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_ADMIN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_target
  FROM public.users
  WHERE id = p_target_user_id;

  IF NOT FOUND OR COALESCE(v_target.is_system,false) IS TRUE OR COALESCE(v_target.is_active,true) IS FALSE THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_TARGET_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_target.role = 'admin' THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_ADMIN_TARGET_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    JOIN public.product_capabilities pc
      ON pc.country_code = cp.country_code AND pc.currency = cp.currency
    WHERE cp.currency = v_currency
      AND cp.enabled IS TRUE
      AND pc.capability = 'FIAT_HOLD'
      AND pc.enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'LEDGER_ADMIN_ADJUST_PRODUCT_DISABLED' USING ERRCODE = 'P0001';
  END IF;

  v_reference := 'ADM-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
  v_delta := CASE WHEN v_type = 'credit' THEN p_amount ELSE -p_amount END;

  v_result := public.apply_single_wallet_mutation_ledger_v2(
    'ADMIN_BALANCE_ADJUSTMENT_V2',
    v_reference,
    p_admin_user_id::text || ':' || v_key,
    p_target_user_id,
    v_currency,
    v_delta,
    v_type,
    v_description,
    'ADMIN_ADJUSTMENT_OFFSET:' || v_currency,
    'ADMIN_ADJUSTMENT_OFFSET',
    true,
    jsonb_build_object(
      'adminUserId', p_admin_user_id,
      'targetUserId', p_target_user_id,
      'adjustmentType', v_type,
      'amount', p_amount,
      'currency', v_currency
    )
  );

  RETURN v_result || jsonb_build_object(
    'adjustmentType', v_type,
    'description', v_description
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.grant_referral_reward_ledger_v2(
  p_referee_user_id uuid,
  p_trigger_event text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_trigger text := lower(btrim(COALESCE(p_trigger_event, '')));
  v_settings public.referral_reward_settings%ROWTYPE;
  v_referee public.users%ROWTYPE;
  v_referrer public.users%ROWTYPE;
  v_existing public.referral_rewards%ROWTYPE;
  v_reward public.referral_rewards%ROWTYPE;
  v_reward_amount numeric(38,12);
  v_currency text;
  v_max integer;
  v_count integer;
  v_result jsonb;
BEGIN
  IF p_referee_user_id IS NULL OR v_trigger = '' OR length(v_trigger) > 80 THEN
    RAISE EXCEPTION 'LEDGER_REFERRAL_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_settings
  FROM public.referral_reward_settings
  ORDER BY updated_at DESC
  LIMIT 1;

  IF NOT FOUND OR v_settings.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('status','skipped','reason','referral rewards disabled');
  END IF;

  IF lower(btrim(COALESCE(v_settings.trigger_event,''))) <> v_trigger THEN
    RETURN jsonb_build_object('status','skipped','reason','trigger mismatch');
  END IF;

  v_reward_amount := COALESCE(v_settings.reward_amount,0)::numeric(38,12);
  v_currency := upper(btrim(COALESCE(v_settings.currency,'')));
  v_max := COALESCE(v_settings.max_rewards_per_user,0);

  IF v_reward_amount <= 0 THEN
    RETURN jsonb_build_object('status','skipped','reason','invalid reward amount');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    JOIN public.product_capabilities pc
      ON pc.country_code = cp.country_code AND pc.currency = cp.currency
    WHERE cp.currency = v_currency
      AND cp.enabled IS TRUE
      AND pc.capability = CASE WHEN v_currency = 'USDT' THEN 'USDT_HOLD' ELSE 'FIAT_HOLD' END
      AND pc.enabled IS TRUE
  ) THEN
    RETURN jsonb_build_object('status','skipped','reason','reward product disabled');
  END IF;

  SELECT * INTO v_referee FROM public.users WHERE id = p_referee_user_id;
  IF NOT FOUND OR v_referee.referred_by_user_id IS NULL THEN
    RETURN jsonb_build_object('status','skipped','reason','user was not referred');
  END IF;

  SELECT * INTO v_referrer FROM public.users WHERE id = v_referee.referred_by_user_id;
  IF NOT FOUND OR COALESCE(v_referrer.is_system,false) IS TRUE THEN
    RETURN jsonb_build_object('status','skipped','reason','referrer not eligible');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('REFERRAL:' || v_referrer.id::text || ':' || v_referee.id::text || ':' || v_trigger, 0)
  );

  SELECT * INTO v_existing
  FROM public.referral_rewards
  WHERE referrer_user_id = v_referrer.id
    AND referee_user_id = v_referee.id
    AND trigger_event = v_trigger
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status','skipped',
      'reason','reward already exists',
      'rewardId',v_existing.id,
      'existingStatus',v_existing.status
    );
  END IF;

  IF v_max > 0 THEN
    SELECT count(*) INTO v_count
    FROM public.referral_rewards
    WHERE referrer_user_id = v_referrer.id
      AND status = 'rewarded';

    IF v_count >= v_max THEN
      RETURN jsonb_build_object('status','skipped','reason','max rewards reached');
    END IF;
  END IF;

  INSERT INTO public.referral_rewards(
    referrer_user_id, referee_user_id, reward_amount,
    currency, trigger_event, status
  )
  VALUES (
    v_referrer.id, v_referee.id, v_reward_amount,
    v_currency, v_trigger, 'pending'
  )
  RETURNING * INTO v_reward;

  v_result := public.apply_single_wallet_mutation_ledger_v2(
    'REFERRAL_REWARD_V2',
    v_reward.id::text,
    v_referrer.id::text || ':' || v_referee.id::text || ':' || v_trigger,
    v_referrer.id,
    v_currency,
    v_reward_amount,
    'credit',
    'Referral reward',
    'REFERRAL_REWARD_EXPENSE:' || v_currency,
    'REFERRAL_REWARD_EXPENSE',
    true,
    jsonb_build_object(
      'rewardId', v_reward.id,
      'referrerUserId', v_referrer.id,
      'refereeUserId', v_referee.id,
      'triggerEvent', v_trigger,
      'amount', v_reward_amount,
      'currency', v_currency
    )
  );

  UPDATE public.referral_rewards
  SET status = 'rewarded', rewarded_at = now()
  WHERE id = v_reward.id
  RETURNING * INTO v_reward;

  RETURN jsonb_build_object(
    'status','rewarded',
    'rewardId',v_reward.id,
    'referrerUserId',v_referrer.id,
    'refereeUserId',v_referee.id,
    'amount',v_reward_amount,
    'currency',v_currency,
    'transactionId',v_result->>'transactionId',
    'reference',v_result->>'reference',
    'ledgerJournalId',v_result->>'ledgerJournalId'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_fiat_withdrawal_ledger_v2(
  p_admin_user_id uuid,
  p_request_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_request public.withdraw_requests%ROWTYPE;
  v_currency text;
  v_result jsonb;
  v_existing_journal_id uuid;
  v_existing_metadata jsonb;
BEGIN
  IF p_admin_user_id IS NULL OR btrim(COALESCE(p_request_id,'')) = '' THEN
    RAISE EXCEPTION 'LEDGER_WITHDRAWAL_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_admin_user_id) THEN
    RAISE EXCEPTION 'LEDGER_WITHDRAWAL_ADMIN_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('FIAT_WITHDRAWAL:' || p_request_id,0));

  SELECT * INTO v_request
  FROM public.withdraw_requests
  WHERE id::text = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST','message','Invalid request');
  END IF;

  IF v_request.status = 'approved' THEN
    SELECT id, metadata INTO v_existing_journal_id, v_existing_metadata
    FROM public.ledger_journals_v2
    WHERE source_type = 'FIAT_WITHDRAWAL_V2'
      AND idempotency_key = p_request_id;

    IF FOUND AND v_existing_metadata->'result' IS NOT NULL THEN
      RETURN v_existing_metadata->'result'
        || jsonb_build_object('ok',true,'ledgerJournalId',v_existing_journal_id,'idempotentReplay',true);
    END IF;

    RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST','message','Invalid request');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_REQUEST','message','Invalid request');
  END IF;

  v_currency := upper(btrim(COALESCE(v_request.currency,'')));

  IF NOT EXISTS (
    SELECT 1
    FROM public.country_products cp
    JOIN public.product_capabilities pc
      ON pc.country_code = cp.country_code AND pc.currency = cp.currency
    WHERE cp.currency = v_currency
      AND cp.enabled IS TRUE
      AND pc.capability = 'CASH_OUT'
      AND pc.enabled IS TRUE
  ) THEN
    RETURN jsonb_build_object('ok',false,'code','CAPABILITY_DISABLED','message','Cash-out is disabled for this currency');
  END IF;

  IF v_request.amount IS NULL OR v_request.amount <= 0 OR v_request.wallet_id IS NULL OR v_request.user_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_WITHDRAWAL_INVALID_REQUEST_STATE' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.wallets w
    WHERE w.id = v_request.wallet_id
      AND w.user_id = v_request.user_id
      AND w.currency = v_currency
  ) THEN
    RAISE EXCEPTION 'LEDGER_WITHDRAWAL_WALLET_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  v_result := public.apply_single_wallet_mutation_ledger_v2(
    'FIAT_WITHDRAWAL_V2',
    p_request_id,
    p_request_id,
    v_request.user_id,
    v_currency,
    -v_request.amount,
    'debit',
    'Withdrawal approved',
    'FIAT_WITHDRAWAL_CLEARING:' || v_currency,
    'FIAT_WITHDRAWAL_CLEARING',
    false,
    jsonb_build_object(
      'withdrawalRequestId', p_request_id,
      'adminUserId', p_admin_user_id,
      'userId', v_request.user_id,
      'walletId', v_request.wallet_id,
      'amount', v_request.amount,
      'currency', v_currency
    )
  );

  UPDATE public.withdraw_requests
  SET status = 'approved', admin_id = p_admin_user_id, processed_at = now()
  WHERE id::text = p_request_id;

  RETURN v_result || jsonb_build_object(
    'ok',true,
    'withdrawalRequestId',p_request_id,
    'status','approved'
  );
END;
$$;

-- Internal helper is owner-only.
REVOKE ALL ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(
  text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.admin_wallet_adjust_ledger_v2(
  uuid,uuid,text,numeric,text,text,text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_fiat_withdrawal_ledger_v2(uuid,text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_wallet_adjust_ledger_v2(uuid,uuid,text,numeric,text,text,text) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.approve_fiat_withdrawal_ledger_v2(uuid,text) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.admin_wallet_adjust_ledger_v2(uuid,uuid,text,numeric,text,text,text) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.approve_fiat_withdrawal_ledger_v2(uuid,text) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.admin_wallet_adjust_ledger_v2(uuid,uuid,text,numeric,text,text,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.approve_fiat_withdrawal_ledger_v2(uuid,text) TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.admin_wallet_adjust_ledger_v2(uuid,uuid,text,numeric,text,text,text)
IS 'Phase 4.5B service-role-only atomic admin wallet adjustment with explicit ADMIN_BALANCE_ADJUSTMENT_V2 Ledger posting.';

COMMENT ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text)
IS 'Phase 4.5B service-role-only atomic referral reward grant with product enforcement and REFERRAL_REWARD_V2 Ledger posting.';

COMMENT ON FUNCTION public.approve_fiat_withdrawal_ledger_v2(uuid,text)
IS 'Phase 4.5B service-role-only atomic fiat withdrawal approval with FIAT_WITHDRAWAL_V2 Ledger posting.';

COMMIT;
