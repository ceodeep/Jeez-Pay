BEGIN;

ALTER TABLE public.kyc_profiles
  DISABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='anon'
  ) THEN
    GRANT ALL PRIVILEGES
      ON TABLE
        public.kyc_retention_v3,
        public.kyc_evidence_access_log_v3
      TO anon;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='authenticated'
  ) THEN
    GRANT ALL PRIVILEGES
      ON TABLE
        public.kyc_retention_v3,
        public.kyc_evidence_access_log_v3
      TO authenticated;
  END IF;
END
$$;

UPDATE storage.buckets
SET
  public=false,
  file_size_limit=NULL,
  allowed_mime_types=NULL
WHERE id='kyc-documents';

COMMIT;
