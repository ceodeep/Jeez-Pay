BEGIN;

-- Phase 9: close direct Supabase client access to internal SECURITY DEFINER
-- primitives and legacy merchant tables. The trusted Node backend uses the
-- service_role client; anon/authenticated callers must not bypass API policy.

DO $$
DECLARE
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF to_regprocedure('public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb)') IS NULL THEN
    v_missing := array_append(v_missing, 'apply_single_wallet_mutation_ledger_v2');
  END IF;
  IF to_regprocedure('public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb)') IS NULL THEN
    v_missing := array_append(v_missing, 'credit_usdt_bep20_deposit');
  END IF;
  IF to_regprocedure('public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb)') IS NULL THEN
    v_missing := array_append(v_missing, 'credit_usdt_trc20_deposit');
  END IF;
  IF to_regprocedure('public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'prepare_usdt_withdrawal');
  END IF;
  IF to_regprocedure('public.evaluate_ledger_compliance_v1()') IS NULL THEN
    v_missing := array_append(v_missing, 'evaluate_ledger_compliance_v1');
  END IF;
  IF to_regprocedure('public.initialize_kyc_retention_v3()') IS NULL THEN
    v_missing := array_append(v_missing, 'initialize_kyc_retention_v3');
  END IF;
  IF to_regprocedure('public.kyc_purge_candidates_v3(integer)') IS NULL THEN
    v_missing := array_append(v_missing, 'kyc_purge_candidates_v3');
  END IF;
  IF to_regprocedure('public.mark_kyc_periodic_reviews_due_v3(integer)') IS NULL THEN
    v_missing := array_append(v_missing, 'mark_kyc_periodic_reviews_due_v3');
  END IF;
  IF to_regprocedure('public.mirror_legacy_balance_change_v2()') IS NULL THEN
    v_missing := array_append(v_missing, 'mirror_legacy_balance_change_v2');
  END IF;
  IF to_regprocedure('public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text)') IS NULL THEN
    v_missing := array_append(v_missing, 'set_kyc_legal_hold_v3');
  END IF;

  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'PHASE9_DB_PRIVILEGE_REQUIRED_FUNCTIONS_MISSING: %', array_to_string(v_missing, ',')
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.merchants') IS NULL
     OR to_regclass('public.merchant_api_keys') IS NULL
     OR to_regclass('public.merchant_balances') IS NULL
     OR to_regclass('public.merchant_payments') IS NULL
     OR to_regclass('public.merchant_webhook_events') IS NULL THEN
    RAISE EXCEPTION 'PHASE9_DB_PRIVILEGE_REQUIRED_MERCHANT_TABLE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Internal Ledger / crypto / compliance / KYC primitives.
REVOKE ALL ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.evaluate_ledger_compliance_v1()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.initialize_kyc_retention_v3()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kyc_purge_candidates_v3(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mirror_legacy_balance_change_v2()
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb) FROM anon;
    REVOKE ALL ON FUNCTION public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text) FROM anon;
    REVOKE ALL ON FUNCTION public.evaluate_ledger_compliance_v1() FROM anon;
    REVOKE ALL ON FUNCTION public.initialize_kyc_retention_v3() FROM anon;
    REVOKE ALL ON FUNCTION public.kyc_purge_candidates_v3(integer) FROM anon;
    REVOKE ALL ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) FROM anon;
    REVOKE ALL ON FUNCTION public.mirror_legacy_balance_change_v2() FROM anon;
    REVOKE ALL ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) FROM anon;

    REVOKE ALL PRIVILEGES ON TABLE
      public.merchants,
      public.merchant_api_keys,
      public.merchant_balances,
      public.merchant_payments,
      public.merchant_webhook_events
    FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb) FROM authenticated;
    REVOKE ALL ON FUNCTION public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text) FROM authenticated;
    REVOKE ALL ON FUNCTION public.evaluate_ledger_compliance_v1() FROM authenticated;
    REVOKE ALL ON FUNCTION public.initialize_kyc_retention_v3() FROM authenticated;
    REVOKE ALL ON FUNCTION public.kyc_purge_candidates_v3(integer) FROM authenticated;
    REVOKE ALL ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) FROM authenticated;
    REVOKE ALL ON FUNCTION public.mirror_legacy_balance_change_v2() FROM authenticated;
    REVOKE ALL ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) FROM authenticated;

    REVOKE ALL PRIVILEGES ON TABLE
      public.merchants,
      public.merchant_api_keys,
      public.merchant_balances,
      public.merchant_payments,
      public.merchant_webhook_events
    FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.evaluate_ledger_compliance_v1() TO service_role;
    GRANT EXECUTE ON FUNCTION public.initialize_kyc_retention_v3() TO service_role;
    GRANT EXECUTE ON FUNCTION public.kyc_purge_candidates_v3(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.mirror_legacy_balance_change_v2() TO service_role;
    GRANT EXECUTE ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) TO service_role;

    -- Preserve the backend's existing table capability while removing client roles.
    GRANT ALL PRIVILEGES ON TABLE
      public.merchants,
      public.merchant_api_keys,
      public.merchant_balances,
      public.merchant_payments,
      public.merchant_webhook_events
    TO service_role;
  END IF;
END;
$$;

-- PUBLIC can inherit default table privileges on older Supabase-created objects.
REVOKE ALL PRIVILEGES ON TABLE
  public.merchants,
  public.merchant_api_keys,
  public.merchant_balances,
  public.merchant_payments,
  public.merchant_webhook_events
FROM PUBLIC;

COMMIT;
