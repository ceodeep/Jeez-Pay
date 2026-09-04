BEGIN;

-- Phase 7: Merchant API launch hardening.
-- Preserve the proven native Ledger v2 money functions underneath launch-policy
-- wrappers. Public/service callers must use the SSP-only wrappers.

DO $$
BEGIN
  IF to_regclass('public.merchants') IS NULL
     OR to_regclass('public.merchant_payments') IS NULL
     OR to_regclass('public.merchant_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_REQUIRED_TABLE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.confirm_merchant_payment_ledger_v2(uuid,uuid)') IS NULL
     OR to_regprocedure('public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_NATIVE_MONEY_RPC_MISSING'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)') IS NULL THEN
    ALTER FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
      RENAME TO confirm_merchant_payment_ledger_v2_pre_launch_v1;
  END IF;

  IF to_regprocedure('public.execute_merchant_payout_ledger_v2_pre_launch_v1(uuid,text,text,numeric,text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)
      RENAME TO execute_merchant_payout_ledger_v2_pre_launch_v1;
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
  v_currency text;
BEGIN
  IF p_user_id IS NULL OR p_payment_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_MERCHANT_PAYMENT_INVALID_ARGUMENTS'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT upper(btrim(currency))
  INTO v_currency
  FROM public.merchant_payments
  WHERE id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'PAYMENT_NOT_FOUND',
      'message', 'Payment not found'
    );
  END IF;

  IF v_currency <> 'SSP' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNSUPPORTED_CURRENCY',
      'message', 'Only SSP merchant payments are enabled for launch'
    );
  END IF;

  RETURN public.confirm_merchant_payment_ledger_v2_pre_launch_v1(
    p_user_id,
    p_payment_id
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
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
BEGIN
  IF v_currency <> 'SSP' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'UNSUPPORTED_CURRENCY',
      'message', 'Only SSP merchant payouts are enabled for launch'
    );
  END IF;

  RETURN public.execute_merchant_payout_ledger_v2_pre_launch_v1(
    p_merchant_id,
    p_idempotency_key,
    p_account_number,
    p_amount,
    v_currency,
    p_description,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_merchant_payment_v1(
  p_merchant_id uuid,
  p_merchant_order_id text,
  p_amount numeric,
  p_currency text,
  p_description text DEFAULT NULL,
  p_callback_url text DEFAULT NULL,
  p_success_url text DEFAULT NULL,
  p_cancel_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_order_id text := btrim(COALESCE(p_merchant_order_id, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_callback_url text := NULLIF(btrim(COALESCE(p_callback_url, '')), '');
  v_success_url text := NULLIF(btrim(COALESCE(p_success_url, '')), '');
  v_cancel_url text := NULLIF(btrim(COALESCE(p_cancel_url, '')), '');
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_payment public.merchant_payments%ROWTYPE;
  v_merchant_status text;
BEGIN
  IF p_merchant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MERCHANT_NOT_FOUND', 'message', 'Merchant not found');
  END IF;

  IF char_length(v_order_id) < 1 OR char_length(v_order_id) > 120 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MERCHANT_ORDER_ID', 'message', 'A valid merchant_order_id is required');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000::numeric THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT', 'message', 'A valid payment amount is required');
  END IF;

  IF scale(p_amount) > 6 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_AMOUNT', 'message', 'Payment amount may have at most 6 decimal places');
  END IF;

  IF v_currency <> 'SSP' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNSUPPORTED_CURRENCY', 'message', 'Only SSP merchant payments are enabled for launch');
  END IF;

  IF v_description IS NOT NULL AND char_length(v_description) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_DESCRIPTION', 'message', 'Description is too long');
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' OR octet_length(v_metadata::text) > 8192 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_METADATA', 'message', 'metadata must be a JSON object no larger than 8KB');
  END IF;

  IF v_callback_url IS NOT NULL AND (
       char_length(v_callback_url) > 1000
       OR v_callback_url !~* '^https://'
     ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CALLBACK_URL', 'message', 'callback_url must use HTTPS');
  END IF;

  IF v_success_url IS NOT NULL AND char_length(v_success_url) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SUCCESS_URL', 'message', 'success_url is too long');
  END IF;

  IF v_cancel_url IS NOT NULL AND char_length(v_cancel_url) > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CANCEL_URL', 'message', 'cancel_url is too long');
  END IF;

  SELECT status
  INTO v_merchant_status
  FROM public.merchants
  WHERE id = p_merchant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MERCHANT_NOT_FOUND', 'message', 'Merchant not found');
  END IF;

  IF v_merchant_status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MERCHANT_DISABLED', 'message', 'Merchant is not active');
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('create_merchant_payment_v1:' || p_merchant_id::text || ':' || v_order_id, 0)
  );

  SELECT *
  INTO v_payment
  FROM public.merchant_payments
  WHERE merchant_id = p_merchant_id
    AND merchant_order_id = v_order_id
  LIMIT 1;

  IF FOUND THEN
    IF v_payment.amount::numeric IS DISTINCT FROM p_amount
       OR upper(btrim(v_payment.currency)) IS DISTINCT FROM v_currency
       OR NULLIF(btrim(COALESCE(v_payment.description, '')), '') IS DISTINCT FROM v_description
       OR NULLIF(btrim(COALESCE(v_payment.callback_url, '')), '') IS DISTINCT FROM v_callback_url
       OR NULLIF(btrim(COALESCE(v_payment.success_url, '')), '') IS DISTINCT FROM v_success_url
       OR NULLIF(btrim(COALESCE(v_payment.cancel_url, '')), '') IS DISTINCT FROM v_cancel_url
       OR COALESCE(v_payment.metadata, '{}'::jsonb) IS DISTINCT FROM v_metadata THEN
      RETURN jsonb_build_object(
        'ok', false,
        'code', 'IDEMPOTENCY_CONFLICT',
        'message', 'merchant_order_id was already used with different payment details'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'created', false,
      'payment', to_jsonb(v_payment)
    );
  END IF;

  INSERT INTO public.merchant_payments (
    merchant_id,
    merchant_order_id,
    amount,
    currency,
    description,
    callback_url,
    success_url,
    cancel_url,
    metadata,
    status,
    expires_at
  ) VALUES (
    p_merchant_id,
    v_order_id,
    p_amount,
    v_currency,
    v_description,
    v_callback_url,
    v_success_url,
    v_cancel_url,
    v_metadata,
    'pending',
    now() + interval '15 minutes'
  )
  RETURNING * INTO v_payment;

  RETURN jsonb_build_object(
    'ok', true,
    'created', true,
    'payment', to_jsonb(v_payment)
  );
END;
$$;

ALTER TABLE public.merchant_webhook_events
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
ALTER TABLE public.merchant_webhook_events
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.merchant_webhook_events
  ADD COLUMN IF NOT EXISTS lock_token uuid;

UPDATE public.merchant_webhook_events
SET next_attempt_at = COALESCE(next_attempt_at, created_at, now())
WHERE next_attempt_at IS NULL;

ALTER TABLE public.merchant_webhook_events
  ALTER COLUMN next_attempt_at SET DEFAULT now();
ALTER TABLE public.merchant_webhook_events
  ALTER COLUMN next_attempt_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_webhook_events_delivery_v1
  ON public.merchant_webhook_events (status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_merchant_webhook_events_lock_v1
  ON public.merchant_webhook_events (locked_at)
  WHERE locked_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_merchant_webhook_events_v1(
  p_limit integer,
  p_lock_token uuid
)
RETURNS TABLE(event_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF p_lock_token IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_WEBHOOK_LOCK_TOKEN_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100);

  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM public.merchant_webhook_events e
    WHERE e.status IN ('pending', 'failed')
      AND COALESCE(e.attempts, 0) < 5
      AND e.next_attempt_at <= now()
      AND (
        e.locked_at IS NULL
        OR e.locked_at < now() - interval '10 minutes'
      )
    ORDER BY e.next_attempt_at, e.created_at, e.id
    FOR UPDATE SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    UPDATE public.merchant_webhook_events e
    SET locked_at = now(),
        lock_token = p_lock_token
    FROM candidates c
    WHERE e.id = c.id
    RETURNING e.id
  )
  SELECT c.id
  FROM claimed c;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_merchant_payout_ledger_v2_pre_launch_v1(uuid,text,text,numeric,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Legacy money RPCs remain available to wrapper owners only during launch.
REVOKE ALL ON FUNCTION public.confirm_merchant_payment(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.execute_merchant_payout(uuid,text,text,numeric,text,text,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_merchant_webhook_events_v1(integer,uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,text,jsonb)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_merchant_webhook_events_v1(integer,uuid)
  TO service_role;

COMMENT ON FUNCTION public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb)
  IS 'Phase 7 atomic merchant payment request creation with merchant-scoped idempotency and SSP-only launch policy.';
COMMENT ON FUNCTION public.claim_merchant_webhook_events_v1(integer,uuid)
  IS 'Phase 7 concurrent-safe claim primitive for merchant webhook delivery workers.';

COMMIT;
