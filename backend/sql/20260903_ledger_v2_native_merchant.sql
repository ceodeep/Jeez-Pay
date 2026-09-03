BEGIN;

-- Phase 4.3B: native Ledger v2 wrappers around the proven production
-- merchant payment and merchant payout RPCs. The legacy RPCs remain the
-- business-semantics authority during this transition; the wrappers suppress
-- only the generic Phase 4.1 mirror inside their own transaction and post the
-- exact two-sided movement as a native Ledger journal.

DO $$
BEGIN
  IF to_regprocedure('public.confirm_merchant_payment(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_LEGACY_RPC_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.execute_merchant_payout(uuid,text,text,numeric,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_LEGACY_RPC_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.post_ledger_journal_v2(text,text,text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_LEDGER_POSTING_PRIMITIVE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.materialize_legacy_account_mappings_v2()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_MAPPING_PRIMITIVE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.ledger_v2_legacy_balance_mirror_enabled()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_MIRROR_CONTROL_MISSING'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_merchant_payment_ledger_v2(
  p_user_id uuid,
  p_payment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_idempotency_key text;
  v_existing_journal_id uuid;
  v_existing_metadata jsonb;
  v_legacy_result jsonb;
  v_code text;
  v_payment public.merchant_payments%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_merchant_balance public.merchant_balances%ROWTYPE;
  v_wallet_mapping public.ledger_legacy_account_map_v2%ROWTYPE;
  v_merchant_mapping public.ledger_legacy_account_map_v2%ROWTYPE;
  v_wallet_ledger_before numeric(38, 12);
  v_merchant_ledger_before numeric(38, 12);
  v_wallet_ledger_after numeric(38, 12);
  v_merchant_ledger_after numeric(38, 12);
  v_amount numeric(38, 12);
  v_currency text;
  v_reference text;
  v_entries jsonb;
  v_post_result jsonb;
  v_journal_id uuid;
  v_bad_count integer;
BEGIN
  IF p_user_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_INVALID_ARGUMENTS'
      USING ERRCODE = 'P0001';
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_MIRROR_NOT_ENABLED'
      USING ERRCODE = 'P0001';
  END IF;

  v_idempotency_key := p_payment_id::text;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('confirm_merchant_payment_ledger_v2:' || v_idempotency_key, 0)
  );

  SELECT id, metadata
  INTO v_existing_journal_id, v_existing_metadata
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYMENT_V2'
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_metadata->'legacyResult' IS NULL THEN
      RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_REPLAY_METADATA_MISSING'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN v_existing_metadata->'legacyResult'
      || jsonb_build_object(
        'ledgerJournalId', v_existing_journal_id,
        'idempotentReplay', true
      );
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_PRE_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'on', true);

  v_legacy_result := public.confirm_merchant_payment(
    p_user_id,
    p_payment_id
  )::jsonb;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'off', true);

  IF COALESCE((v_legacy_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_legacy_result;
  END IF;

  v_code := COALESCE(v_legacy_result->>'code', '');

  -- A payment completed before this wrapper was introduced is already
  -- represented by the opening Ledger or by the Phase 4.1 generic mirror.
  -- Never retro-post it as a new native movement.
  IF v_code = 'ALREADY_PAID' THEN
    RETURN v_legacy_result
      || jsonb_build_object('idempotentReplay', true);
  END IF;

  IF v_code <> 'PAID' THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_UNEXPECTED_SUCCESS_CODE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('legacyResult', v_legacy_result)::text;
  END IF;

  SELECT * INTO v_payment
  FROM public.merchant_payments
  WHERE id = p_payment_id;

  IF NOT FOUND
     OR v_payment.status <> 'paid'
     OR v_payment.paid_by_user_id IS DISTINCT FROM p_user_id
     OR v_payment.paid_wallet_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_POST_STATE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = v_payment.paid_wallet_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_WALLET_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_merchant_balance
  FROM public.merchant_balances
  WHERE merchant_id = v_payment.merchant_id
    AND currency = upper(v_payment.currency);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_BALANCE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  v_amount := v_payment.amount::numeric(38, 12);
  v_currency := upper(v_payment.currency);
  v_reference := NULLIF(btrim(COALESCE(v_legacy_result->>'reference', '')), '');

  IF v_amount <= 0 OR v_reference IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_LEGACY_RESULT_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.materialize_legacy_account_mappings_v2();

  SELECT * INTO v_wallet_mapping
  FROM public.ledger_legacy_account_map_v2
  WHERE source_kind = 'USER_WALLET'
    AND source_id = v_wallet.id;

  SELECT * INTO v_merchant_mapping
  FROM public.ledger_legacy_account_map_v2
  WHERE source_kind = 'MERCHANT_BALANCE'
    AND source_id = v_merchant_balance.id;

  IF v_wallet_mapping.ledger_account_id IS NULL
     OR v_merchant_mapping.ledger_account_id IS NULL
     OR v_wallet_mapping.currency IS DISTINCT FROM v_currency
     OR v_merchant_mapping.currency IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_MAPPING_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_wallet_ledger_before
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_wallet_mapping.ledger_account_id;

  SELECT balance::numeric(38, 12)
  INTO v_merchant_ledger_before
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_merchant_mapping.ledger_account_id;

  IF v_wallet_ledger_before IS DISTINCT FROM
       (v_wallet.balance::numeric(38, 12) + v_amount)
     OR v_merchant_ledger_before IS DISTINCT FROM
       (v_merchant_balance.balance::numeric(38, 12) - v_amount) THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_PRE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_wallet_mapping.ledger_account_id,
      'currency', v_currency,
      'amountDelta', -v_amount,
      'description', 'Merchant payment user debit',
      'metadata', jsonb_build_object(
        'merchantPaymentId', v_payment.id,
        'legacyWalletId', v_wallet.id,
        'legacyTransactionId', v_payment.user_transaction_id,
        'legacyReference', v_reference,
        'ledgerRole', 'PAYER'
      )
    ),
    jsonb_build_object(
      'accountId', v_merchant_mapping.ledger_account_id,
      'currency', v_currency,
      'amountDelta', v_amount,
      'description', 'Merchant payment merchant credit',
      'metadata', jsonb_build_object(
        'merchantPaymentId', v_payment.id,
        'legacyMerchantBalanceId', v_merchant_balance.id,
        'legacyReference', v_reference,
        'ledgerRole', 'MERCHANT'
      )
    )
  );

  v_post_result := public.post_ledger_journal_v2(
    'MERCHANT_PAYMENT_V2',
    v_reference,
    v_idempotency_key,
    'Merchant payment ' || v_currency,
    jsonb_build_object(
      'legacyResult', v_legacy_result,
      'paymentId', v_payment.id,
      'merchantId', v_payment.merchant_id,
      'payerUserId', p_user_id,
      'currency', v_currency,
      'amount', v_amount,
      'mirrorBypass', true
    ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_POST_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  v_journal_id := NULLIF(v_post_result->>'journalId', '')::uuid;

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_JOURNAL_ID_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_wallet_ledger_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_wallet_mapping.ledger_account_id;

  SELECT balance::numeric(38, 12)
  INTO v_merchant_ledger_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_merchant_mapping.ledger_account_id;

  IF v_wallet_ledger_after IS DISTINCT FROM v_wallet.balance::numeric(38, 12)
     OR v_merchant_ledger_after IS DISTINCT FROM v_merchant_balance.balance::numeric(38, 12) THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_POST_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_POST_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_unbalanced_journals
    WHERE journal_id = v_journal_id
  ) THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_UNBALANCED_JOURNAL'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_legacy_result
    || jsonb_build_object(
      'ledgerJournalId', v_journal_id,
      'idempotentReplay', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_merchant_payout_ledger_v2(
  p_merchant_id uuid,
  p_idempotency_key text,
  p_account_number text,
  p_amount numeric,
  p_currency text,
  p_description text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_account_number text := btrim(COALESCE(p_account_number, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_ledger_idempotency_key text;
  v_request_fingerprint text;
  v_existing_journal_id uuid;
  v_existing_metadata jsonb;
  v_legacy_result jsonb;
  v_payout public.merchant_payouts%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_merchant_balance public.merchant_balances%ROWTYPE;
  v_wallet_mapping public.ledger_legacy_account_map_v2%ROWTYPE;
  v_merchant_mapping public.ledger_legacy_account_map_v2%ROWTYPE;
  v_wallet_ledger_before numeric(38, 12);
  v_merchant_ledger_before numeric(38, 12);
  v_wallet_ledger_after numeric(38, 12);
  v_merchant_ledger_after numeric(38, 12);
  v_entries jsonb;
  v_post_result jsonb;
  v_journal_id uuid;
  v_bad_count integer;
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'MERCHANT_NOT_FOUND',
      'message', 'Merchant not found'
    );
  END IF;

  IF char_length(v_key) < 1 OR char_length(v_key) > 120 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_IDEMPOTENCY_KEY',
      'message', 'A valid idempotency key is required'
    );
  END IF;

  IF v_account_number !~ '^[0-9]{1,19}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_ACCOUNT_NUMBER',
      'message', 'A valid JeezPay account number is required'
    );
  END IF;

  v_account_number := ltrim(v_account_number, '0');
  IF v_account_number = '' THEN
    v_account_number := '0';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'INVALID_AMOUNT',
      'message', 'Payout amount must be greater than zero'
    );
  END IF;

  IF v_currency NOT IN ('SSP', 'USDT') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNSUPPORTED_CURRENCY',
      'message', 'Only SSP and USDT merchant payouts are supported'
    );
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_MIRROR_NOT_ENABLED'
      USING ERRCODE = 'P0001';
  END IF;

  v_ledger_idempotency_key := p_merchant_id::text || ':' || v_key;

  v_request_fingerprint := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'merchantId', p_merchant_id,
          'accountNumber', v_account_number,
          'amount', p_amount,
          'currency', v_currency
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  PERFORM pg_advisory_xact_lock(
    hashtextextended('execute_merchant_payout_ledger_v2:' || v_ledger_idempotency_key, 0)
  );

  SELECT id, metadata
  INTO v_existing_journal_id, v_existing_metadata
  FROM public.ledger_journals_v2
  WHERE source_type = 'MERCHANT_PAYOUT_V2'
    AND idempotency_key = v_ledger_idempotency_key;

  IF FOUND THEN
    IF v_existing_metadata->>'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'Idempotency key was already used for a different payout'
      );
    END IF;

    IF v_existing_metadata->'legacyResult' IS NULL THEN
      RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_REPLAY_METADATA_MISSING'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN v_existing_metadata->'legacyResult'
      || jsonb_build_object(
        'code', 'ALREADY_PAID',
        'message', 'Payout already completed',
        'already_processed', true,
        'ledgerJournalId', v_existing_journal_id,
        'idempotentReplay', true
      );
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_PRE_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'on', true);

  v_legacy_result := public.execute_merchant_payout(
    p_merchant_id,
    v_key,
    v_account_number,
    p_amount,
    v_currency,
    p_description,
    p_metadata
  )::jsonb;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'off', true);

  IF COALESCE((v_legacy_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_legacy_result;
  END IF;

  -- Existing payouts pre-date this wrapper and are already represented by the
  -- opening Ledger or the Phase 4.1 generic mirror. Do not post them again.
  IF COALESCE((v_legacy_result->>'already_processed')::boolean, false) IS TRUE THEN
    RETURN v_legacy_result
      || jsonb_build_object('idempotentReplay', true);
  END IF;

  IF COALESCE(v_legacy_result->>'code', '') <> 'PAID' THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_UNEXPECTED_SUCCESS_CODE'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('legacyResult', v_legacy_result)::text;
  END IF;

  SELECT * INTO v_payout
  FROM public.merchant_payouts
  WHERE id = NULLIF(v_legacy_result->'payout'->>'id', '')::uuid;

  IF NOT FOUND
     OR v_payout.merchant_id IS DISTINCT FROM p_merchant_id
     OR v_payout.status <> 'paid'
     OR v_payout.idempotency_key IS DISTINCT FROM v_key THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_POST_STATE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_wallet
  FROM public.wallets
  WHERE id = v_payout.recipient_wallet_id;

  SELECT * INTO v_merchant_balance
  FROM public.merchant_balances
  WHERE merchant_id = v_payout.merchant_id
    AND currency = v_payout.currency;

  IF v_wallet.id IS NULL OR v_merchant_balance.id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_BALANCE_SOURCE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.materialize_legacy_account_mappings_v2();

  SELECT * INTO v_wallet_mapping
  FROM public.ledger_legacy_account_map_v2
  WHERE source_kind = 'USER_WALLET'
    AND source_id = v_wallet.id;

  SELECT * INTO v_merchant_mapping
  FROM public.ledger_legacy_account_map_v2
  WHERE source_kind = 'MERCHANT_BALANCE'
    AND source_id = v_merchant_balance.id;

  IF v_wallet_mapping.ledger_account_id IS NULL
     OR v_merchant_mapping.ledger_account_id IS NULL
     OR v_wallet_mapping.currency IS DISTINCT FROM v_payout.currency
     OR v_merchant_mapping.currency IS DISTINCT FROM v_payout.currency THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_MAPPING_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_wallet_ledger_before
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_wallet_mapping.ledger_account_id;

  SELECT balance::numeric(38, 12)
  INTO v_merchant_ledger_before
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_merchant_mapping.ledger_account_id;

  IF v_wallet_ledger_before IS DISTINCT FROM v_payout.recipient_balance_before::numeric(38, 12)
     OR v_merchant_ledger_before IS DISTINCT FROM v_payout.merchant_balance_before::numeric(38, 12) THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_PRE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_merchant_mapping.ledger_account_id,
      'currency', v_payout.currency,
      'amountDelta', -v_payout.amount,
      'description', 'Merchant payout merchant debit',
      'metadata', jsonb_build_object(
        'merchantPayoutId', v_payout.id,
        'legacyMerchantBalanceId', v_merchant_balance.id,
        'legacyReference', v_payout.reference,
        'ledgerRole', 'MERCHANT'
      )
    ),
    jsonb_build_object(
      'accountId', v_wallet_mapping.ledger_account_id,
      'currency', v_payout.currency,
      'amountDelta', v_payout.amount,
      'description', 'Merchant payout recipient credit',
      'metadata', jsonb_build_object(
        'merchantPayoutId', v_payout.id,
        'legacyWalletId', v_wallet.id,
        'legacyTransactionId', v_payout.transaction_id,
        'legacyReference', v_payout.reference,
        'ledgerRole', 'RECIPIENT'
      )
    )
  );

  v_post_result := public.post_ledger_journal_v2(
    'MERCHANT_PAYOUT_V2',
    v_payout.reference,
    v_ledger_idempotency_key,
    'Merchant payout ' || v_payout.currency,
    jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'legacyResult', v_legacy_result,
      'payoutId', v_payout.id,
      'merchantId', p_merchant_id,
      'recipientUserId', v_payout.recipient_user_id,
      'currency', v_payout.currency,
      'amount', v_payout.amount,
      'mirrorBypass', true
    ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_POST_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  v_journal_id := NULLIF(v_post_result->>'journalId', '')::uuid;

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_JOURNAL_ID_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_wallet_ledger_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_wallet_mapping.ledger_account_id;

  SELECT balance::numeric(38, 12)
  INTO v_merchant_ledger_after
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_merchant_mapping.ledger_account_id;

  IF v_wallet_ledger_after IS DISTINCT FROM v_payout.recipient_balance_after::numeric(38, 12)
     OR v_merchant_ledger_after IS DISTINCT FROM v_payout.merchant_balance_after::numeric(38, 12) THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_POST_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_POST_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_unbalanced_journals
    WHERE journal_id = v_journal_id
  ) THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYOUT_UNBALANCED_JOURNAL'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_legacy_result
    || jsonb_build_object(
      'ledgerJournalId', v_journal_id,
      'idempotentReplay', false
    );
END;
$$;

-- The legacy confirmation RPC was directly executable through PUBLIC/anon/
-- authenticated in production. The backend uses the service-role client, so
-- remove direct client execution now without breaking the current HTTP route.
REVOKE EXECUTE ON FUNCTION public.confirm_merchant_payment(uuid, uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_merchant_payment(uuid, uuid)
TO service_role;

REVOKE ALL ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid, uuid)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.execute_merchant_payout_ledger_v2(
  uuid, text, text, numeric, text, text, jsonb
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb) TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid, uuid) IS
  'Phase 4.3B service-role-only merchant payment primitive. Runs the proven legacy confirmation with generic mirroring locally bypassed, then posts the exact user-wallet to merchant-balance movement as MERCHANT_PAYMENT_V2.';

COMMENT ON FUNCTION public.execute_merchant_payout_ledger_v2(
  uuid, text, text, numeric, text, text, jsonb
) IS
  'Phase 4.3B service-role-only merchant payout primitive. Runs the proven legacy payout with generic mirroring locally bypassed, then posts the exact merchant-balance to recipient-wallet movement as MERCHANT_PAYOUT_V2.';

COMMIT;
