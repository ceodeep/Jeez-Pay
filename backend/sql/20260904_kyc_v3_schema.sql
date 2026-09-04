BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Versioned policy. Regulatory/provider changes should normally be data changes,
-- not schema changes.
CREATE TABLE IF NOT EXISTS public.kyc_policy_versions_v3 (
  policy_version integer PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version >= 3),
  policy_code text NOT NULL UNIQUE,
  privacy_notice_version text NOT NULL,
  biometric_notice_version text NOT NULL,
  minimum_age integer NOT NULL DEFAULT 18 CHECK (minimum_age BETWEEN 13 AND 120),
  max_upload_bytes bigint NOT NULL DEFAULT 10485760 CHECK (max_upload_bytes BETWEEN 1024 AND 52428800),
  require_document_verification boolean NOT NULL DEFAULT true,
  require_liveness boolean NOT NULL DEFAULT true,
  require_sanctions_screening boolean NOT NULL DEFAULT true,
  require_pep_screening boolean NOT NULL DEFAULT true,
  require_adverse_media_screening boolean NOT NULL DEFAULT false,
  low_risk_review_months integer NOT NULL DEFAULT 36 CHECK (low_risk_review_months > 0),
  medium_risk_review_months integer NOT NULL DEFAULT 24 CHECK (medium_risk_review_months > 0),
  high_risk_review_months integer NOT NULL DEFAULT 12 CHECK (high_risk_review_months > 0),
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(requirements)='object'),
  active boolean NOT NULL DEFAULT false,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_policy_versions_v3_one_active_idx
  ON public.kyc_policy_versions_v3 ((active)) WHERE active=true;

INSERT INTO public.kyc_policy_versions_v3(
  policy_version,schema_version,policy_code,privacy_notice_version,biometric_notice_version,
  minimum_age,max_upload_bytes,require_document_verification,require_liveness,
  require_sanctions_screening,require_pep_screening,require_adverse_media_screening,
  low_risk_review_months,medium_risk_review_months,high_risk_review_months,requirements,active
)
VALUES (
  1,3,'JEEZPAY-KYC-V3-2026','2026-09-v1','2026-09-v1',18,10485760,
  true,true,true,true,false,36,24,12,
  jsonb_build_object(
    'documentTypes',jsonb_build_array('passport','national_id','driver_license','residence_permit','refugee_id','other_government_id'),
    'identityContentTypes',jsonb_build_array('image/jpeg','image/png'),
    'supportingContentTypes',jsonb_build_array('image/jpeg','image/png','application/pdf'),
    'taxResidenciesRequired',true,
    'sourceOfWealthForEnhancedDueDiligence',true,
    'providerAgnostic',true,
    'manualReviewFallback',true
  ),true
)
ON CONFLICT (policy_version) DO NOTHING;

-- Jurisdiction risk is deliberately configuration, never a forever-hardcoded list.
CREATE TABLE IF NOT EXISTS public.kyc_country_risk_v3 (
  country_code text PRIMARY KEY CHECK (country_code ~ '^[A-Z]{2}$'),
  classification text NOT NULL DEFAULT 'standard'
    CHECK (classification IN ('low','standard','elevated','high','prohibited')),
  risk_weight integer NOT NULL DEFAULT 0 CHECK (risk_weight BETWEEN 0 AND 100),
  source text,
  source_reference text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Keep the existing kyc_profiles row as the backward-compatible current-state projection.
ALTER TABLE public.kyc_profiles
  ADD COLUMN IF NOT EXISTS current_application_id uuid,
  ADD COLUMN IF NOT EXISTS schema_version integer,
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS workflow_status text,
  ADD COLUMN IF NOT EXISTS assurance_level text,
  ADD COLUMN IF NOT EXISTS verification_mode text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS required_action text,
  ADD COLUMN IF NOT EXISTS risk_score integer,
  ADD COLUMN IF NOT EXISTS risk_rating text,
  ADD COLUMN IF NOT EXISTS identity_verification_status text,
  ADD COLUMN IF NOT EXISTS liveness_status text,
  ADD COLUMN IF NOT EXISTS sanctions_status text,
  ADD COLUMN IF NOT EXISTS pep_screening_status text,
  ADD COLUMN IF NOT EXISTS adverse_media_status text,
  ADD COLUMN IF NOT EXISTS nationality text,
  ADD COLUMN IF NOT EXISTS country_of_birth text,
  ADD COLUMN IF NOT EXISTS residence_country text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS employment_status text,
  ADD COLUMN IF NOT EXISTS occupation text,
  ADD COLUMN IF NOT EXISTS employer_name text,
  ADD COLUMN IF NOT EXISTS source_of_funds text[],
  ADD COLUMN IF NOT EXISTS source_of_wealth text,
  ADD COLUMN IF NOT EXISTS account_purpose text,
  ADD COLUMN IF NOT EXISTS expected_monthly_volume_band text,
  ADD COLUMN IF NOT EXISTS expected_monthly_tx_count_band text,
  ADD COLUMN IF NOT EXISTS pep_self_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pep_related_declared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tax_residencies text[] NOT NULL DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS kyc_profiles_v3_workflow_idx ON public.kyc_profiles(workflow_status,submitted_at DESC);
CREATE INDEX IF NOT EXISTS kyc_profiles_v3_risk_idx ON public.kyc_profiles(risk_rating,submitted_at DESC);
CREATE INDEX IF NOT EXISTS kyc_profiles_v3_review_due_idx ON public.kyc_profiles(next_review_at) WHERE status='approved';

CREATE TABLE IF NOT EXISTS public.kyc_applications_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  application_version integer NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version >= 3),
  policy_version integer NOT NULL REFERENCES public.kyc_policy_versions_v3(policy_version) ON DELETE RESTRICT,
  full_name text NOT NULL,
  dob date NOT NULL,
  nationality text NOT NULL CHECK (nationality ~ '^[A-Z]{2}$'),
  country_of_birth text NOT NULL CHECK (country_of_birth ~ '^[A-Z]{2}$'),
  residence_country text NOT NULL CHECK (residence_country ~ '^[A-Z]{2}$'),
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  region text,
  postal_code text,
  employment_status text NOT NULL,
  occupation text NOT NULL,
  employer_name text,
  source_of_funds text[] NOT NULL CHECK (cardinality(source_of_funds)>0),
  source_of_wealth text,
  account_purpose text NOT NULL,
  expected_monthly_volume_band text NOT NULL,
  expected_monthly_tx_count_band text,
  pep_self_declared boolean NOT NULL DEFAULT false,
  pep_related_declared boolean NOT NULL DEFAULT false,
  tax_residencies text[] NOT NULL CHECK (cardinality(tax_residencies)>0),
  workflow_status text NOT NULL DEFAULT 'submitted'
    CHECK (workflow_status IN ('submitted','in_review','needs_more_info','approved','rejected','expired','cancelled')),
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_rating text NOT NULL DEFAULT 'low' CHECK (risk_rating IN ('low','medium','high')),
  assurance_level text NOT NULL DEFAULT 'pending',
  verification_mode text NOT NULL DEFAULT 'hybrid',
  required_action text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  next_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id,application_version)
);
CREATE INDEX IF NOT EXISTS kyc_applications_v3_queue_idx ON public.kyc_applications_v3(workflow_status,risk_rating,submitted_at,id);
CREATE INDEX IF NOT EXISTS kyc_applications_v3_user_idx ON public.kyc_applications_v3(user_id,application_version DESC);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='kyc_profiles_current_application_v3_fk'
      AND conrelid='public.kyc_profiles'::regclass
  ) THEN
    ALTER TABLE public.kyc_profiles
      ADD CONSTRAINT kyc_profiles_current_application_v3_fk
      FOREIGN KEY(current_application_id) REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.kyc_documents_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('passport','national_id','driver_license','residence_permit','refugee_id','other_government_id')),
  issuing_country text NOT NULL CHECK (issuing_country ~ '^[A-Z]{2}$'),
  document_number_hash text NOT NULL CHECK (document_number_hash ~ '^[0-9a-f]{64}$'),
  document_number_last4 text,
  issue_date date,
  expiry_date date,
  no_expiry boolean NOT NULL DEFAULT false,
  front_path text NOT NULL,
  back_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((no_expiry=true AND expiry_date IS NULL) OR (no_expiry=false AND expiry_date IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS kyc_documents_v3_hash_idx ON public.kyc_documents_v3(document_number_hash);
CREATE INDEX IF NOT EXISTS kyc_documents_v3_user_idx ON public.kyc_documents_v3(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_evidence_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL CHECK (evidence_type IN ('id_front','id_back','selfie','proof_of_address','supporting_document')),
  object_path text NOT NULL,
  content_type text,
  content_length bigint,
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_evidence_v3_app_idx ON public.kyc_evidence_v3(application_id,evidence_type);

CREATE TABLE IF NOT EXISTS public.kyc_consents_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  privacy_accepted boolean NOT NULL,
  identity_verification_accepted boolean NOT NULL,
  biometric_accepted boolean NOT NULL,
  ongoing_screening_accepted boolean NOT NULL,
  privacy_notice_version text NOT NULL,
  biometric_notice_version text NOT NULL,
  client_ip text,
  user_agent text,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  CHECK (privacy_accepted AND identity_verification_accepted AND biometric_accepted AND ongoing_screening_accepted)
);

CREATE TABLE IF NOT EXISTS public.kyc_checks_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  check_type text NOT NULL CHECK (check_type IN ('document_verification','liveness','sanctions','pep','adverse_media','proof_of_address')),
  status text NOT NULL CHECK (status IN ('pending','verified','manual_verified','clear','manual_clear','potential_match','confirmed_match','confirmed_pep','failed','inconclusive','not_applicable')),
  provider text,
  provider_reference text,
  performed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_checks_v3_app_type_idx ON public.kyc_checks_v3(application_id,check_type,created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_checks_v3_match_idx ON public.kyc_checks_v3(check_type,status,created_at DESC)
  WHERE status IN ('potential_match','confirmed_match','confirmed_pep');

CREATE TABLE IF NOT EXISTS public.kyc_risk_assessments_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assessment_type text NOT NULL DEFAULT 'onboarding' CHECK (assessment_type IN ('onboarding','manual','periodic','event_driven')),
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  rating text NOT NULL CHECK (rating IN ('low','medium','high')),
  factors jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(factors)='object'),
  assessed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_risk_assessments_v3_user_idx ON public.kyc_risk_assessments_v3(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_provider_jobs_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  job_type text NOT NULL CHECK (job_type IN ('document_verification','liveness','sanctions','pep','adverse_media')),
  provider text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  provider_reference text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload)='object'),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempts>=0 AND max_attempts>0 AND attempts<=max_attempts)
);
CREATE INDEX IF NOT EXISTS kyc_provider_jobs_v3_queue_idx ON public.kyc_provider_jobs_v3(status,available_at,id)
  WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS kyc_provider_jobs_v3_app_idx ON public.kyc_provider_jobs_v3(application_id,job_type,created_at DESC);

-- Expand the v2 immutable audit vocabulary while preserving all old rows.
ALTER TABLE public.kyc_review_events DROP CONSTRAINT IF EXISTS kyc_review_events_event_type_check;
ALTER TABLE public.kyc_review_events ADD CONSTRAINT kyc_review_events_event_type_check
  CHECK (event_type IN ('submitted','resubmitted','in_review','needs_more_info','approved','rejected','check_recorded','risk_changed','periodic_review_due','expired'));
ALTER TABLE public.kyc_review_events DROP CONSTRAINT IF EXISTS kyc_review_events_status_check;
ALTER TABLE public.kyc_review_events ADD CONSTRAINT kyc_review_events_status_check
  CHECK (to_status IN ('pending','submitted','in_review','needs_more_info','approved','rejected','expired'));

-- Evidence is append-only. Applications may only be status-updated by controlled functions.
CREATE OR REPLACE FUNCTION public.reject_kyc_v3_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'KYC_V3_IMMUTABLE_RECORD' USING ERRCODE='P0001';
END $$;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['kyc_documents_v3','kyc_evidence_v3','kyc_consents_v3','kyc_checks_v3','kyc_risk_assessments_v3'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_immutable', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation()', t || '_immutable', t);
  END LOOP;
END $$;

-- Private-by-default tables.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['kyc_policy_versions_v3','kyc_country_risk_v3','kyc_applications_v3','kyc_documents_v3','kyc_evidence_v3','kyc_consents_v3','kyc_checks_v3','kyc_risk_assessments_v3','kyc_provider_jobs_v3'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon',t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated',t); END IF;
  END LOOP;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON public.kyc_policy_versions_v3 TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_country_risk_v3 TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_applications_v3 TO service_role;
    GRANT SELECT,INSERT ON public.kyc_documents_v3 TO service_role;
    GRANT SELECT,INSERT ON public.kyc_evidence_v3 TO service_role;
    GRANT SELECT,INSERT ON public.kyc_consents_v3 TO service_role;
    GRANT SELECT,INSERT ON public.kyc_checks_v3 TO service_role;
    GRANT SELECT,INSERT ON public.kyc_risk_assessments_v3 TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_provider_jobs_v3 TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.kyc_applications_v3 IS 'Versioned customer KYC applications; kyc_profiles remains the current-state compatibility projection.';
COMMENT ON TABLE public.kyc_documents_v3 IS 'Identity document metadata. Raw document numbers are never persisted: SHA-256 fingerprint plus last four only.';
COMMENT ON TABLE public.kyc_provider_jobs_v3 IS 'Provider-neutral async verification/screening queue for document, liveness, sanctions, PEP and adverse-media jobs.';

COMMIT;
