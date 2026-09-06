BEGIN;

ALTER TABLE public.kyc_profiles
  ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='anon'
  ) THEN
    REVOKE ALL PRIVILEGES
      ON TABLE
        public.kyc_profiles,
        public.kyc_retention_v3,
        public.kyc_evidence_access_log_v3
      FROM anon;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='authenticated'
  ) THEN
    REVOKE ALL PRIVILEGES
      ON TABLE
        public.kyc_profiles,
        public.kyc_retention_v3,
        public.kyc_evidence_access_log_v3
      FROM authenticated;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='service_role'
  ) THEN
    GRANT SELECT,INSERT,UPDATE,DELETE
      ON TABLE
        public.kyc_profiles,
        public.kyc_retention_v3,
        public.kyc_evidence_access_log_v3
      TO service_role;
  END IF;
END
$$;

DO $$
DECLARE
  v_limit bigint;
BEGIN
  SELECT max_upload_bytes
  INTO v_limit
  FROM public.kyc_policy_versions_v3
  WHERE active=true
  ORDER BY policy_version DESC
  LIMIT 1;

  IF v_limit IS NULL OR v_limit <= 0 THEN
    RAISE EXCEPTION
      'PHASE9_ACTIVE_KYC_UPLOAD_LIMIT_MISSING';
  END IF;

  UPDATE storage.buckets
  SET
    public=false,
    file_size_limit=v_limit,
    allowed_mime_types=ARRAY[
      'image/jpeg',
      'image/jpg',
      'image/png',
      'application/pdf'
    ]::text[]
  WHERE id='kyc-documents';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'PHASE9_KYC_BUCKET_MISSING';
  END IF;
END
$$;

DO $$
DECLARE
  v_rls boolean;
  v_client_grants integer;
  v_bucket_public boolean;
  v_limit bigint;
  v_bucket_limit bigint;
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
      'PHASE9_KYC_PROFILES_RLS_NOT_ENABLED';
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
      'PHASE9_SENSITIVE_CLIENT_GRANTS_REMAIN: %',
      v_client_grants;
  END IF;

  SELECT
    b.public,
    b.file_size_limit
  INTO
    v_bucket_public,
    v_bucket_limit
  FROM storage.buckets b
  WHERE b.id='kyc-documents';

  SELECT max_upload_bytes
  INTO v_limit
  FROM public.kyc_policy_versions_v3
  WHERE active=true
  ORDER BY policy_version DESC
  LIMIT 1;

  IF v_bucket_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'PHASE9_KYC_BUCKET_PUBLIC';
  END IF;

  IF v_bucket_limit IS DISTINCT FROM v_limit THEN
    RAISE EXCEPTION
      'PHASE9_KYC_BUCKET_LIMIT_MISMATCH';
  END IF;
END
$$;

COMMIT;
