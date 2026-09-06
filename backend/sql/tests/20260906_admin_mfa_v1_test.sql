\pset pager off

\echo '=== PHASE 9 ADMIN MFA FOUNDATION TEST ==='
\echo 'READ-ONLY / ROLLBACK-ONLY.'

BEGIN;

SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $$
DECLARE
  v_bad integer;
BEGIN
  IF to_regclass(
    'public.admin_mfa_factors_v1'
  ) IS NULL THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_FACTOR_TABLE_MISSING';
  END IF;

  IF to_regclass(
    'public.admin_mfa_recovery_codes_v1'
  ) IS NULL THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_RECOVERY_TABLE_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='user_sessions'
      AND column_name='admin_mfa_verified_at'
      AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_SESSION_COLUMN_MISSING';
  END IF;

  SELECT count(*)
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN (
      'admin_mfa_factors_v1',
      'admin_mfa_recovery_codes_v1'
    )
    AND c.relrowsecurity IS NOT TRUE;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_RLS_DISABLED: %',
      v_bad;
  END IF;

  IF has_table_privilege(
       'anon',
       'public.admin_mfa_factors_v1',
       'SELECT'
     )
     OR
     has_table_privilege(
       'anon',
       'public.admin_mfa_factors_v1',
       'INSERT'
     )
     OR
     has_table_privilege(
       'anon',
       'public.admin_mfa_factors_v1',
       'UPDATE'
     )
     OR
     has_table_privilege(
       'anon',
       'public.admin_mfa_factors_v1',
       'DELETE'
     )
  THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_ANON_FACTOR_ACCESS';
  END IF;

  IF has_table_privilege(
       'authenticated',
       'public.admin_mfa_factors_v1',
       'SELECT'
     )
     OR
     has_table_privilege(
       'authenticated',
       'public.admin_mfa_factors_v1',
       'INSERT'
     )
     OR
     has_table_privilege(
       'authenticated',
       'public.admin_mfa_factors_v1',
       'UPDATE'
     )
     OR
     has_table_privilege(
       'authenticated',
       'public.admin_mfa_factors_v1',
       'DELETE'
     )
  THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_AUTH_FACTOR_ACCESS';
  END IF;

  IF has_table_privilege(
       'anon',
       'public.admin_mfa_recovery_codes_v1',
       'SELECT'
     )
     OR
     has_table_privilege(
       'authenticated',
       'public.admin_mfa_recovery_codes_v1',
       'SELECT'
     )
  THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_RECOVERY_CODE_LEAK';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.admin_mfa_factors_v1',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_SERVICE_ROLE_FACTOR_ACCESS_MISSING';
  END IF;

  IF NOT has_table_privilege(
    'service_role',
    'public.admin_mfa_recovery_codes_v1',
    'SELECT'
  ) THEN
    RAISE EXCEPTION
      'TEST_ADMIN_MFA_SERVICE_ROLE_RECOVERY_ACCESS_MISSING';
  END IF;

  RAISE NOTICE
    'PHASE 9 ADMIN MFA FOUNDATION TEST: OK';
END;
$$;

ROLLBACK;
