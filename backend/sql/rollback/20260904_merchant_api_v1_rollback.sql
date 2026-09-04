BEGIN;

DROP FUNCTION IF EXISTS public.claim_merchant_webhook_events_v1(integer,uuid);
DROP FUNCTION IF EXISTS public.create_merchant_payment_v1(uuid,text,numeric,text,text,text,text,text,jsonb);

DROP FUNCTION IF EXISTS public.confirm_merchant_payment_ledger_v2(uuid,uuid);
DROP FUNCTION IF EXISTS public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb);

DO $$
BEGIN
  IF to_regprocedure('public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)') IS NOT NULL
     AND to_regprocedure('public.confirm_merchant_payment_ledger_v2(uuid,uuid)') IS NULL THEN
    ALTER FUNCTION public.confirm_merchant_payment_ledger_v2_pre_launch_v1(uuid,uuid)
      RENAME TO confirm_merchant_payment_ledger_v2;
  END IF;

  IF to_regprocedure('public.execute_merchant_payout_ledger_v2_pre_launch_v1(uuid,text,text,numeric,text,text,jsonb)') IS NOT NULL
     AND to_regprocedure('public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)') IS NULL THEN
    ALTER FUNCTION public.execute_merchant_payout_ledger_v2_pre_launch_v1(uuid,text,text,numeric,text,text,jsonb)
      RENAME TO execute_merchant_payout_ledger_v2;
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.idx_merchant_webhook_events_delivery_v1;
DROP INDEX IF EXISTS public.idx_merchant_webhook_events_lock_v1;

ALTER TABLE IF EXISTS public.merchant_webhook_events
  DROP COLUMN IF EXISTS lock_token;
ALTER TABLE IF EXISTS public.merchant_webhook_events
  DROP COLUMN IF EXISTS locked_at;
ALTER TABLE IF EXISTS public.merchant_webhook_events
  DROP COLUMN IF EXISTS next_attempt_at;

DO $$
BEGIN
  IF to_regprocedure('public.confirm_merchant_payment(uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.confirm_merchant_payment(uuid,uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.confirm_merchant_payment(uuid,uuid)
      TO service_role;
  END IF;

  IF to_regprocedure('public.execute_merchant_payout(uuid,text,text,numeric,text,text,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.execute_merchant_payout(uuid,text,text,numeric,text,text,jsonb)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.execute_merchant_payout(uuid,text,text,numeric,text,text,jsonb)
      TO service_role;
  END IF;

  IF to_regprocedure('public.confirm_merchant_payment_ledger_v2(uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.confirm_merchant_payment_ledger_v2(uuid,uuid)
      TO service_role;
  END IF;

  IF to_regprocedure('public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.execute_merchant_payout_ledger_v2(uuid,text,text,numeric,text,text,jsonb)
      TO service_role;
  END IF;
END;
$$;

COMMIT;
