\pset pager off
\echo '=== PHASE 9 PRIVACY / STORAGE HARDENING TEST ==='
\echo 'READ-ONLY / ROLLBACK-ONLY.'

BEGIN;

SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

DO $$
DECLARE
  v_rls boolean;
  v_client_grants integer;
  v_limit bigint;
  v_bucket_limit bigint;
  v_bucket_public boolean;
  v_mimes text[];
  v_immutable integer;
BEGIN
  SELECT c.relrowsecurity
  INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n
    ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname='kyc_profiles';

  IF v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION
      'KYC_PROFILES_RLS_NOT_ENABLED';
  END IF;

  SELECT count(*)
  INTO v_client_grants
  FROM information_schema.role_table_grants
  WHERE table_schema='public'
    AND grantee IN ('anon','authenticated')
    AND table_name IN (
      'kyc_profiles',
      'kyc_retention_v3',
      'kyc_evidence_access_log_v3'
    );

  IF v_client_grants <> 0 THEN
    RAISE EXCEPTION
      'SENSITIVE_CLIENT_GRANTS_REMAIN: %',
      v_client_grants;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='service_role'
  ) THEN
    IF NOT has_table_privilege(
      'service_role',
      'public.kyc_profiles',
      'SELECT'
    ) THEN
      RAISE EXCEPTION
        'SERVICE_ROLE_KYC_PROFILE_SELECT_MISSING';
    END IF;
  END IF;

  SELECT max_upload_bytes
  INTO v_limit
  FROM public.kyc_policy_versions_v3
  WHERE active=true
  ORDER BY policy_version DESC
  LIMIT 1;

  SELECT
    public,
    file_size_limit,
    allowed_mime_types
  INTO
    v_bucket_public,
    v_bucket_limit,
    v_mimes
  FROM storage.buckets
  WHERE id='kyc-documents';

  IF v_bucket_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'KYC_BUCKET_PUBLIC';
  END IF;

  IF v_bucket_limit IS DISTINCT FROM v_limit THEN
    RAISE EXCEPTION
      'KYC_BUCKET_SIZE_LIMIT_MISMATCH';
  END IF;

  IF NOT (
    v_mimes @> ARRAY[
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf'
    ]::text[]
    AND cardinality(v_mimes)=4
  ) THEN
    RAISE EXCEPTION
      'KYC_BUCKET_MIME_POLICY_INVALID: %',
      v_mimes;
  END IF;

  SELECT count(*)
  INTO v_immutable
  FROM information_schema.triggers
  WHERE event_object_schema='public'
    AND event_object_table='kyc_evidence_access_log_v3'
    AND trigger_name='kyc_evidence_access_log_v3_immutable'
    AND event_manipulation IN ('UPDATE','DELETE');

  IF v_immutable <> 2 THEN
    RAISE EXCEPTION
      'KYC_ACCESS_LOG_IMMUTABILITY_MISSING';
  END IF;

  RAISE NOTICE
    'PHASE 9 PRIVACY / STORAGE HARDENING TEST: OK';
END
$$;

ROLLBACK;
