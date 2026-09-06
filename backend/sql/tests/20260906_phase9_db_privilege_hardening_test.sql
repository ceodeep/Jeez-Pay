\pset pager off
\echo '=== PHASE 9 DB PRIVILEGE HARDENING TEST ==='
\echo 'READ-ONLY / ROLLBACK-ONLY: proves Supabase client roles cannot execute internal privileged RPCs or directly access legacy merchant tables.'

BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
  v_sig regprocedure;
  v_table text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.apply_single_wallet_mutation_ledger_v2(text,text,text,uuid,text,numeric,text,text,text,text,boolean,jsonb)'::regprocedure,
    'public.credit_usdt_bep20_deposit(uuid,text,text,text,numeric,jsonb)'::regprocedure,
    'public.credit_usdt_trc20_deposit(uuid,text,text,text,numeric,jsonb)'::regprocedure,
    'public.prepare_usdt_withdrawal(uuid,text,numeric,numeric,text,text)'::regprocedure,
    'public.evaluate_ledger_compliance_v1()'::regprocedure,
    'public.initialize_kyc_retention_v3()'::regprocedure,
    'public.kyc_purge_candidates_v3(integer)'::regprocedure,
    'public.mark_kyc_periodic_reviews_due_v3(integer)'::regprocedure,
    'public.mirror_legacy_balance_change_v2()'::regprocedure,
    'public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text)'::regprocedure
  ]
  LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'PHASE9_ANON_EXECUTE_STILL_ALLOWED: %', v_sig USING ERRCODE='P0001';
    END IF;
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'PHASE9_AUTHENTICATED_EXECUTE_STILL_ALLOWED: %', v_sig USING ERRCODE='P0001';
    END IF;
    IF NOT has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'PHASE9_SERVICE_ROLE_EXECUTE_MISSING: %', v_sig USING ERRCODE='P0001';
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'public.merchants',
    'public.merchant_api_keys',
    'public.merchant_balances',
    'public.merchant_payments',
    'public.merchant_webhook_events'
  ]
  LOOP
    IF has_table_privilege('anon', v_table, 'SELECT')
       OR has_table_privilege('anon', v_table, 'INSERT')
       OR has_table_privilege('anon', v_table, 'UPDATE')
       OR has_table_privilege('anon', v_table, 'DELETE')
       OR has_table_privilege('authenticated', v_table, 'SELECT')
       OR has_table_privilege('authenticated', v_table, 'INSERT')
       OR has_table_privilege('authenticated', v_table, 'UPDATE')
       OR has_table_privilege('authenticated', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'PHASE9_CLIENT_TABLE_PRIVILEGE_STILL_ALLOWED: %', v_table USING ERRCODE='P0001';
    END IF;

    IF NOT has_table_privilege('service_role', v_table, 'SELECT')
       OR NOT has_table_privilege('service_role', v_table, 'INSERT')
       OR NOT has_table_privilege('service_role', v_table, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'PHASE9_SERVICE_ROLE_TABLE_PRIVILEGE_MISSING: %', v_table USING ERRCODE='P0001';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public'
      AND c.relname IN ('merchants','merchant_api_keys','merchant_balances','merchant_payments','merchant_webhook_events')
      AND c.relrowsecurity IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'PHASE9_MERCHANT_RLS_DISABLED' USING ERRCODE='P0001';
  END IF;

  IF has_function_privilege('anon', 'public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text)'::regprocedure, 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text)'::regprocedure, 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'PHASE9_EXISTING_LEDGER_RPC_BOUNDARY_REGRESSED' USING ERRCODE='P0001';
  END IF;

  RAISE NOTICE 'PHASE 9 DB PRIVILEGE HARDENING TEST: OK';
END;
$$;

ROLLBACK;
