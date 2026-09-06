\pset pager off

\echo '=== ADMIN MFA VERIFICATION V1 TEST ==='
\echo 'ROLLBACK-ONLY / DEFINITION + PRIVILEGE TEST.'

BEGIN;

SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='30s';

DO $$
DECLARE
  v_oid oid;
  v_secdef boolean;
  v_source text;
BEGIN
  SELECT
    p.oid,
    p.prosecdef,
    p.prosrc
  INTO
    v_oid,
    v_secdef,
    v_source
  FROM pg_proc p
  JOIN pg_namespace n
    ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.oid =
      to_regprocedure(
        'public.complete_admin_mfa_verification_v1(uuid,uuid,text,boolean)'
      );

  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'TEST_MFA_VERIFY_RPC_MISSING';
  END IF;

  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION
      'TEST_MFA_VERIFY_NOT_SECURITY_DEFINER';
  END IF;

  IF has_function_privilege(
    'anon',
    v_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'TEST_MFA_VERIFY_ANON_EXECUTE';
  END IF;

  IF has_function_privilege(
    'authenticated',
    v_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'TEST_MFA_VERIFY_AUTH_EXECUTE';
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    v_oid,
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION
      'TEST_MFA_VERIFY_SERVICE_EXECUTE_MISSING';
  END IF;

  IF position(
    'admin_mfa_recovery_codes_v1'
    IN v_source
  )=0
     OR position(
       'admin_mfa_verified_at'
       IN v_source
     )=0
     OR position(
       'MFA_CHALLENGE_ALREADY_USED'
       IN v_source
     )=0
     OR position(
       'FOR UPDATE'
       IN upper(v_source)
     )=0
  THEN
    RAISE EXCEPTION
      'TEST_MFA_VERIFY_ATOMICITY_MISSING';
  END IF;

  RAISE NOTICE
    'ADMIN MFA VERIFICATION V1 TEST: OK';
END;
$$;

ROLLBACK;
