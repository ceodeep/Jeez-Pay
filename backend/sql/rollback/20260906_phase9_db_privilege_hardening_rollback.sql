BEGIN;

-- Emergency rollback only for 20260906_phase9_db_privilege_hardening.sql.
-- This intentionally restores the pre-Phase-9 client privileges observed in
-- production on 2026-09-06. Use only if the privilege hardening causes an
-- unexpected production compatibility failure.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    GRANT EXECUTE ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb) TO anon;
    GRANT EXECUTE ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb) TO anon;
    GRANT EXECUTE ON FUNCTION public.evaluate_ledger_compliance_v1() TO anon;
    GRANT EXECUTE ON FUNCTION public.initialize_kyc_retention_v3() TO anon;
    GRANT EXECUTE ON FUNCTION public.kyc_purge_candidates_v3(integer) TO anon;
    GRANT EXECUTE ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) TO anon;
    GRANT EXECUTE ON FUNCTION public.mirror_legacy_balance_change_v2() TO anon;
    GRANT EXECUTE ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) TO anon;

    GRANT ALL PRIVILEGES ON TABLE
      public.merchants,
      public.merchant_api_keys,
      public.merchant_balances,
      public.merchant_payments,
      public.merchant_webhook_events
    TO anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.evaluate_ledger_compliance_v1() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.initialize_kyc_retention_v3() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.kyc_purge_candidates_v3(integer) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.mirror_legacy_balance_change_v2() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) TO authenticated;

    GRANT ALL PRIVILEGES ON TABLE
      public.merchants,
      public.merchant_api_keys,
      public.merchant_balances,
      public.merchant_payments,
      public.merchant_webhook_events
    TO authenticated;
  END IF;
END;
$$;

-- These two functions inherited EXECUTE from PUBLIC rather than explicit
-- anon/authenticated grants in the observed pre-hardening ACL.
GRANT EXECUTE ON FUNCTION public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text) TO PUBLIC;

-- The following functions also had PUBLIC execute in addition to explicit
-- client-role grants.
GRANT EXECUTE ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.evaluate_ledger_compliance_v1() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.initialize_kyc_retention_v3() TO PUBLIC;

COMMIT;
