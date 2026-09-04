BEGIN;

-- Phase 7 follow-up: enqueue the payment.paid webhook in the SAME PostgreSQL
-- transaction as native merchant payment confirmation. This closes the gap left
-- by the HTTP route cutover, where the old JavaScript enqueue code was shadowed.

DO $$
BEGIN
  IF to_regprocedure('public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)') IS NULL
     OR to_regprocedure('public.confirm_merchant_payment_ledger_v2(uuid,uuid)') IS NULL
     OR to_regclass('public.merchant_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_WEBHOOK_ENQUEUE_FOUNDATION_MISSING'
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
  v_currency text;
  v_result jsonb;
  v_payment public.merchant_payments%ROWTYPE;
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

  v_result := public.confirm_merchant_payment_ledger_v2_pre_launch_v1(
    p_user_id,
    p_payment_id
  );

  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_result;
  END IF;

  SELECT *
  INTO v_payment
  FROM public.merchant_payments
  WHERE id = p_payment_id;

  IF NOT FOUND
     OR v_payment.status <> 'paid'
     OR upper(btrim(v_payment.currency)) <> 'SSP' THEN
    RAISE EXCEPTION 'MERCHANT_API_V1_WEBHOOK_PAYMENT_STATE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('merchant_payment.paid:' || p_payment_id::text, 0)
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.merchant_webhook_events e
    WHERE e.merchant_payment_id = p_payment_id
      AND e.event_type = 'merchant_payment.paid'
  ) THEN
    INSERT INTO public.merchant_webhook_events (
      merchant_id,
      merchant_payment_id,
      event_type,
      payload,
      status,
      attempts,
      next_attempt_at
    ) VALUES (
      v_payment.merchant_id,
      v_payment.id,
      'merchant_payment.paid',
      jsonb_build_object(
        'event', 'merchant_payment.paid',
        'status', 'paid',
        'payment_id', v_payment.id,
        'merchant_id', v_payment.merchant_id,
        'merchant_order_id', v_payment.merchant_order_id,
        'paid_at', COALESCE(v_payment.paid_at, now()),
        'amount', v_payment.amount,
        'currency', upper(v_payment.currency),
        'reference', NULLIF(btrim(COALESCE(v_result->>'reference', '')), '')
      ),
      'pending',
      0,
      now()
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
  TO service_role;

COMMIT;
