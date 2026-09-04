BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- JeezPay KYC v3
-- International-grade, versioned, provider-agnostic KYC model.
-- Keeps public.kyc_profiles as the current-state compatibility row while
-- storing immutable/versioned application evidence in dedicated tables.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.kyc_policy_versions_v3 (
  policy_version integer PRIMARY KEY,
  schema_version integer NOT NULL,
  policy_code text NOT NULL UNIQUE,
  privacy_notice_version text NOT NULL,
  biometric_notice_version text NOT NULL,
  minimum_age integer NOT NULL DEFAULT 18,
  max_upload_bytes bigint NOT NULL DEFAULT 10485760,
  require_document_verification boolean NOT NULL DEFAULT true,
  require_liveness boolean NOT NULL DEFAULT true,
  require_sanctions_screening boolean NOT NULL DEFAULT true,
  require_pep_screening boolean NOT NULL DEFAULT true,
  require_adverse_media_screening boolean NOT NULL DEFAULT false,
  low_risk_review_months integer NOT NULL DEFAULT 36,
  medium_risk_review_months integer NOT NULL DEFAULT 24,
  high_risk_review_months integer NOT NULL DEFAULT 12,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT false,
  effective_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_policy_v3_schema_positive CHECK (schema_version > 0),
  CONSTRAINT kyc_policy_v3_age_check CHECK (minimum_age BETWEEN 13 AND 120),
  CONSTRAINT kyc_policy_v3_upload_check CHECK (max_upload_bytes BETWEEN 1024 AND 52428800),
  CONSTRAINT kyc_policy_v3_review_check CHECK (
    low_risk_review_months > 0 AND medium_risk_review_months > 0 AND high_risk_review_months > 0
  ),
  CONSTRAINT kyc_policy_v3_requirements_object CHECK (jsonb_typeof(requirements) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS kyc_policy_versions_v3_one_active_idx
  ON public.kyc_policy_versions_v3 ((active))
  WHERE active = true;

INSERT INTO public.kyc_policy_versions_v3 (
  policy_version,
  schema_version,
  policy_code,
  privacy_notice_version,
  biometric_notice_version,
  minimum_age,
  max_upload_bytes,
  require_document_verification,
  require_liveness,
  require_sanctions_screening,
  require_pep_screening,
  require_adverse_media_screening,
  low_risk_review_months,
  medium_risk_review_months,
  high_risk_review_months,
  requirements,
  active
)
VALUES (
  1,
  3,
  'JEEZPAY-KYC-V3-2026',
  '2026-09-v1',
  '2026-09-v1',
  18,
  10485760,
  true,
  true,
  true,
  true,
  false,
  36,
  24,
  12,
  jsonb_build_object(
    'documentTypes', jsonb_build_array(
      'passport','national_id','driver_license','residence_permit','refugee_id','other_government_id'
    ),
    'acceptedIdentityContentTypes', jsonb_build_array('image/jpeg','image/png'),
    'acceptedSupportingContentTypes', jsonb_build_array('image/jpeg','image/png','application/pdf'),
    'taxResidenciesSupported', true,
    'sourceOfWealthSupported', true,
    'manualReviewFallback', true,
    'providerAgnostic', true
  ),
  true
)
ON CONFLICT (policy_version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kyc_country_risk_v3 (
  country_code text PRIMARY KEY,
  classification text NOT NULL DEFAULT 'standard',
  risk_weight integer NOT NULL DEFAULT 0,
  source text,
  source_reference text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_country_risk_v3_country CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT kyc_country_risk_v3_classification CHECK (
    classification IN ('low','standard','elevated','high','prohibited')
  ),
  CONSTRAINT kyc_country_risk_v3_weight CHECK (risk_weight BETWEEN 0 AND 100)
);

-- Current-state compatibility profile. Existing columns are preserved.
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

CREATE INDEX IF NOT EXISTS kyc_profiles_v3_workflow_idx
  ON public.kyc_profiles (workflow_status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS kyc_profiles_v3_risk_idx
  ON public.kyc_profiles (risk_rating, submitted_at DESC);
CREATE INDEX IF NOT EXISTS kyc_profiles_v3_next_review_idx
  ON public.kyc_profiles (next_review_at)
  WHERE status = 'approved';

CREATE TABLE IF NOT EXISTS public.kyc_applications_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  application_version integer NOT NULL,
  schema_version integer NOT NULL,
  policy_version integer NOT NULL REFERENCES public.kyc_policy_versions_v3(policy_version) ON DELETE RESTRICT,
  full_name text NOT NULL,
  dob date NOT NULL,
  nationality text NOT NULL,
  country_of_birth text NOT NULL,
  residence_country text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  region text,
  postal_code text,
  employment_status text NOT NULL,
  occupation text NOT NULL,
  employer_name text,
  source_of_funds text[] NOT NULL,
  source_of_wealth text,
  account_purpose text NOT NULL,
  expected_monthly_volume_band text NOT NULL,
  expected_monthly_tx_count_band text,
  pep_self_declared boolean NOT NULL DEFAULT false,
  pep_related_declared boolean NOT NULL DEFAULT false,
  tax_residencies text[] NOT NULL,
  workflow_status text NOT NULL DEFAULT 'submitted',
  risk_score integer NOT NULL DEFAULT 0,
  risk_rating text NOT NULL DEFAULT 'low',
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
  CONSTRAINT kyc_applications_v3_version_unique UNIQUE (user_id, application_version),
  CONSTRAINT kyc_applications_v3_schema_check CHECK (schema_version >= 3),
  CONSTRAINT kyc_applications_v3_country_checks CHECK (
    nationality ~ '^[A-Z]{2}$' AND
    country_of_birth ~ '^[A-Z]{2}$' AND
    residence_country ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT kyc_applications_v3_workflow_check CHECK (
    workflow_status IN ('submitted','in_review','needs_more_info','approved','rejected','expired','cancelled')
  ),
  CONSTRAINT kyc_applications_v3_risk_score_check CHECK (risk_score BETWEEN 0 AND 100),
  CONSTRAINT kyc_applications_v3_risk_rating_check CHECK (risk_rating IN ('low','medium','high')),
  CONSTRAINT kyc_applications_v3_sources_check CHECK (cardinality(source_of_funds) > 0),
  CONSTRAINT kyc_applications_v3_tax_check CHECK (cardinality(tax_residencies) > 0)
);

CREATE INDEX IF NOT EXISTS kyc_applications_v3_review_queue_idx
  ON public.kyc_applications_v3 (workflow_status, risk_rating, submitted_at ASC);
CREATE INDEX IF NOT EXISTS kyc_applications_v3_user_created_idx
  ON public.kyc_applications_v3 (user_id, application_version DESC);
CREATE INDEX IF NOT EXISTS kyc_applications_v3_residence_idx
  ON public.kyc_applications_v3 (residence_country, submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_documents_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  issuing_country text NOT NULL,
  document_number_hash text NOT NULL,
  document_number_last4 text,
  issue_date date,
  expiry_date date,
  no_expiry boolean NOT NULL DEFAULT false,
  front_path text NOT NULL,
  back_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_documents_v3_one_primary UNIQUE (application_id),
  CONSTRAINT kyc_documents_v3_type_check CHECK (
    document_type IN ('passport','national_id','driver_license','residence_permit','refugee_id','other_government_id')
  ),
  CONSTRAINT kyc_documents_v3_country_check CHECK (issuing_country ~ '^[A-Z]{2}$'),
  CONSTRAINT kyc_documents_v3_hash_check CHECK (document_number_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT kyc_documents_v3_expiry_check CHECK (
    (no_expiry = true AND expiry_date IS NULL) OR
    (no_expiry = false AND expiry_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS kyc_documents_v3_hash_idx
  ON public.kyc_documents_v3 (document_number_hash);
CREATE INDEX IF NOT EXISTS kyc_documents_v3_user_idx
  ON public.kyc_documents_v3 (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_evidence_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL,
  object_path text NOT NULL,
  content_type text,
  content_length bigint,
  sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_evidence_v3_type_check CHECK (
    evidence_type IN ('id_front','id_back','selfie','proof_of_address','supporting_document')
  ),
  CONSTRAINT kyc_evidence_v3_sha_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS kyc_evidence_v3_application_idx
  ON public.kyc_evidence_v3 (application_id, evidence_type);

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
  CONSTRAINT kyc_consents_v3_all_required CHECK (
    privacy_accepted AND identity_verification_accepted AND biometric_accepted AND ongoing_screening_accepted
  )
);
CREATE INDEX IF NOT EXISTS kyc_consents_v3_user_idx
  ON public.kyc_consents_v3 (user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_checks_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  check_type text NOT NULL,
  status text NOT NULL,
  provider text,
  provider_reference text,
  performed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_checks_v3_type_check CHECK (
    check_type IN ('document_verification','liveness','sanctions','pep','adverse_media','proof_of_address')
  ),
  CONSTRAINT kyc_checks_v3_status_check CHECK (
    status IN (
      'pending','verified','manual_verified','clear','manual_clear','potential_match',
      'confirmed_match','confirmed_pep','failed','inconclusive','not_applicable'
    )
  ),
  CONSTRAINT kyc_checks_v3_details_object CHECK (jsonb_typeof(details) = 'object')
);
CREATE INDEX IF NOT EXISTS kyc_checks_v3_application_type_idx
  ON public.kyc_checks_v3 (application_id, check_type, created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_checks_v3_user_type_idx
  ON public.kyc_checks_v3 (user_id, check_type, created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_checks_v3_matches_idx
  ON public.kyc_checks_v3 (check_type, status, created_at DESC)
  WHERE status IN ('potential_match','confirmed_match','confirmed_pep');

CREATE TABLE IF NOT EXISTS public.kyc_risk_assessments_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  assessment_type text NOT NULL DEFAULT 'onboarding',
  score integer NOT NULL,
  rating text NOT NULL,
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  assessed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_risk_v3_score_check CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT kyc_risk_v3_rating_check CHECK (rating IN ('low','medium','high')),
  CONSTRAINT kyc_risk_v3_type_check CHECK (assessment_type IN ('onboarding','manual','periodic','event_driven')),
  CONSTRAINT kyc_risk_v3_factors_object CHECK (jsonb_typeof(factors) = 'object')
);
CREATE INDEX IF NOT EXISTS kyc_risk_assessments_v3_user_idx
  ON public.kyc_risk_assessments_v3 (user_id, created_at DESC);

-- Provider-neutral async queue. A future verification/screening vendor can be
-- changed through worker configuration without changing the KYC schema/API.
CREATE TABLE IF NOT EXISTS public.kyc_provider_jobs_v3 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  job_type text NOT NULL,
  provider text,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  provider_reference text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_provider_jobs_v3_type_check CHECK (
    job_type IN ('document_verification','liveness','sanctions','pep','adverse_media')
  ),
  CONSTRAINT kyc_provider_jobs_v3_status_check CHECK (
    status IN ('queued','processing','completed','failed','cancelled')
  ),
  CONSTRAINT kyc_provider_jobs_v3_attempts_check CHECK (
    attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts
  ),
  CONSTRAINT kyc_provider_jobs_v3_payload_object CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT kyc_provider_jobs_v3_result_object CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
CREATE INDEX IF NOT EXISTS kyc_provider_jobs_v3_queue_idx
  ON public.kyc_provider_jobs_v3 (status, available_at, created_at)
  WHERE status IN ('queued','failed');
CREATE INDEX IF NOT EXISTS kyc_provider_jobs_v3_application_idx
  ON public.kyc_provider_jobs_v3 (application_id, job_type, created_at DESC);

-- Expand the immutable KYC lifecycle evidence vocabulary without deleting old evidence.
ALTER TABLE public.kyc_review_events
  DROP CONSTRAINT IF EXISTS kyc_review_events_event_type_check;
ALTER TABLE public.kyc_review_events
  ADD CONSTRAINT kyc_review_events_event_type_check
  CHECK (event_type IN (
    'submitted','resubmitted','in_review','needs_more_info','approved','rejected',
    'check_recorded','risk_changed','periodic_review_due','expired'
  ));
ALTER TABLE public.kyc_review_events
  DROP CONSTRAINT IF EXISTS kyc_review_events_status_check;
ALTER TABLE public.kyc_review_events
  ADD CONSTRAINT kyc_review_events_status_check
  CHECK (to_status IN (
    'pending','submitted','in_review','needs_more_info','approved','rejected','expired'
  ));

CREATE OR REPLACE FUNCTION public.reject_kyc_v3_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'KYC_V3_IMMUTABLE_RECORD' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS kyc_applications_v3_immutable ON public.kyc_applications_v3;
CREATE TRIGGER kyc_applications_v3_immutable
BEFORE DELETE ON public.kyc_applications_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

DROP TRIGGER IF EXISTS kyc_documents_v3_immutable ON public.kyc_documents_v3;
CREATE TRIGGER kyc_documents_v3_immutable
BEFORE UPDATE OR DELETE ON public.kyc_documents_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

DROP TRIGGER IF EXISTS kyc_evidence_v3_immutable ON public.kyc_evidence_v3;
CREATE TRIGGER kyc_evidence_v3_immutable
BEFORE UPDATE OR DELETE ON public.kyc_evidence_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

DROP TRIGGER IF EXISTS kyc_consents_v3_immutable ON public.kyc_consents_v3;
CREATE TRIGGER kyc_consents_v3_immutable
BEFORE UPDATE OR DELETE ON public.kyc_consents_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

DROP TRIGGER IF EXISTS kyc_checks_v3_immutable ON public.kyc_checks_v3;
CREATE TRIGGER kyc_checks_v3_immutable
BEFORE UPDATE OR DELETE ON public.kyc_checks_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

DROP TRIGGER IF EXISTS kyc_risk_assessments_v3_immutable ON public.kyc_risk_assessments_v3;
CREATE TRIGGER kyc_risk_assessments_v3_immutable
BEFORE UPDATE OR DELETE ON public.kyc_risk_assessments_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

CREATE OR REPLACE FUNCTION public.guard_kyc_profile_v3_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('jeezpay.kyc_lifecycle_v3', true) IS DISTINCT FROM 'on'
     AND (
       NEW.current_application_id IS DISTINCT FROM OLD.current_application_id OR
       NEW.schema_version IS DISTINCT FROM OLD.schema_version OR
       NEW.policy_version IS DISTINCT FROM OLD.policy_version OR
       NEW.workflow_status IS DISTINCT FROM OLD.workflow_status OR
       NEW.assurance_level IS DISTINCT FROM OLD.assurance_level OR
       NEW.verification_mode IS DISTINCT FROM OLD.verification_mode OR
       NEW.submitted_at IS DISTINCT FROM OLD.submitted_at OR
       NEW.next_review_at IS DISTINCT FROM OLD.next_review_at OR
       NEW.required_action IS DISTINCT FROM OLD.required_action OR
       NEW.risk_score IS DISTINCT FROM OLD.risk_score OR
       NEW.risk_rating IS DISTINCT FROM OLD.risk_rating OR
       NEW.identity_verification_status IS DISTINCT FROM OLD.identity_verification_status OR
       NEW.liveness_status IS DISTINCT FROM OLD.liveness_status OR
       NEW.sanctions_status IS DISTINCT FROM OLD.sanctions_status OR
       NEW.pep_screening_status IS DISTINCT FROM OLD.pep_screening_status OR
       NEW.adverse_media_status IS DISTINCT FROM OLD.adverse_media_status
     )
  THEN
    RAISE EXCEPTION 'KYC_V3_PROFILE_DIRECT_MUTATION_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kyc_profile_v3_guard ON public.kyc_profiles;
CREATE TRIGGER kyc_profile_v3_guard
BEFORE UPDATE ON public.kyc_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_profile_v3_mutation();

CREATE OR REPLACE FUNCTION public.kyc_active_policy_v3()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT jsonb_build_object(
    'schemaVersion', schema_version,
    'policyVersion', policy_version,
    'policyCode', policy_code,
    'privacyNoticeVersion', privacy_notice_version,
    'biometricNoticeVersion', biometric_notice_version,
    'minimumAge', minimum_age,
    'maxUploadBytes', max_upload_bytes,
    'requireDocumentVerification', require_document_verification,
    'requireLiveness', require_liveness,
    'requireSanctionsScreening', require_sanctions_screening,
    'requirePepScreening', require_pep_screening,
    'requireAdverseMediaScreening', require_adverse_media_screening,
    'reviewMonths', jsonb_build_object(
      'low', low_risk_review_months,
      'medium', medium_risk_review_months,
      'high', high_risk_review_months
    ),
    'requirements', requirements
  )
  FROM public.kyc_policy_versions_v3
  WHERE active = true
  ORDER BY policy_version DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_kyc_v3(
  p_user_id uuid,
  p_payload jsonb,
  p_client_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_policy public.kyc_policy_versions_v3%ROWTYPE;
  v_existing public.kyc_profiles%ROWTYPE;
  v_application_id uuid;
  v_application_version integer;
  v_full_name text;
  v_dob date;
  v_nationality text;
  v_country_of_birth text;
  v_residence_country text;
  v_address_line1 text;
  v_address_line2 text;
  v_city text;
  v_region text;
  v_postal_code text;
  v_employment_status text;
  v_occupation text;
  v_employer_name text;
  v_source_of_funds text[];
  v_source_of_wealth text;
  v_account_purpose text;
  v_volume_band text;
  v_tx_band text;
  v_pep_self boolean;
  v_pep_related boolean;
  v_tax_residencies text[];
  v_document jsonb;
  v_consents jsonb;
  v_document_type text;
  v_issuing_country text;
  v_document_number text;
  v_document_hash text;
  v_document_last4 text;
  v_issue_date date;
  v_expiry_date date;
  v_no_expiry boolean;
  v_front_path text;
  v_back_path text;
  v_selfie_path text;
  v_risk_score integer := 0;
  v_country_weight integer := 0;
  v_risk_rating text;
  v_risk_factors jsonb := '{}'::jsonb;
  v_event text;
  v_age integer;
BEGIN
  IF p_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_policy
  FROM public.kyc_policy_versions_v3
  WHERE active = true
  ORDER BY policy_version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KYC_V3_POLICY_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(NULLIF(p_payload->>'schemaVersion','')::integer, 0) <> v_policy.schema_version THEN
    RAISE EXCEPTION 'KYC_V3_SCHEMA_VERSION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_user_id
      AND COALESCE(is_system,false) = false
      AND COALESCE(is_active,true) = true
  ) THEN
    RAISE EXCEPTION 'KYC_V3_USER_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  v_full_name := btrim(COALESCE(p_payload->>'fullName',''));
  v_nationality := upper(btrim(COALESCE(p_payload->>'nationality','')));
  v_country_of_birth := upper(btrim(COALESCE(p_payload->>'countryOfBirth','')));
  v_residence_country := upper(btrim(COALESCE(p_payload->>'residenceCountry','')));
  v_address_line1 := btrim(COALESCE(p_payload->>'addressLine1',''));
  v_address_line2 := NULLIF(btrim(COALESCE(p_payload->>'addressLine2','')), '');
  v_city := btrim(COALESCE(p_payload->>'city',''));
  v_region := NULLIF(btrim(COALESCE(p_payload->>'region','')), '');
  v_postal_code := NULLIF(btrim(COALESCE(p_payload->>'postalCode','')), '');
  v_employment_status := lower(btrim(COALESCE(p_payload->>'employmentStatus','')));
  v_occupation := btrim(COALESCE(p_payload->>'occupation',''));
  v_employer_name := NULLIF(btrim(COALESCE(p_payload->>'employerName','')), '');
  v_source_of_wealth := NULLIF(btrim(COALESCE(p_payload->>'sourceOfWealth','')), '');
  v_account_purpose := lower(btrim(COALESCE(p_payload->>'accountPurpose','')));
  v_volume_band := lower(btrim(COALESCE(p_payload->>'expectedMonthlyVolumeBand','')));
  v_tx_band := NULLIF(lower(btrim(COALESCE(p_payload->>'expectedMonthlyTxCountBand',''))), '');
  v_pep_self := COALESCE((p_payload->>'pepSelfDeclared')::boolean, false);
  v_pep_related := COALESCE((p_payload->>'pepRelatedDeclared')::boolean, false);
  v_document := COALESCE(p_payload->'document', '{}'::jsonb);
  v_consents := COALESCE(p_payload->'consents', '{}'::jsonb);

  BEGIN
    v_dob := (p_payload->>'dob')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_DOB' USING ERRCODE = 'P0001';
  END;

  v_age := date_part('year', age(current_date, v_dob))::integer;

  IF v_full_name = '' OR length(v_full_name) > 200 OR
     v_address_line1 = '' OR length(v_address_line1) > 500 OR
     v_city = '' OR length(v_city) > 150 OR
     v_occupation = '' OR length(v_occupation) > 200 OR
     v_age < v_policy.minimum_age OR v_dob > current_date OR v_dob < DATE '1900-01-01' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_PERSONAL_DETAILS' USING ERRCODE = 'P0001';
  END IF;

  IF v_nationality !~ '^[A-Z]{2}$' OR
     v_country_of_birth !~ '^[A-Z]{2}$' OR
     v_residence_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_COUNTRY' USING ERRCODE = 'P0001';
  END IF;

  IF v_employment_status NOT IN ('employed','self_employed','student','unemployed','retired','homemaker','other') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_EMPLOYMENT' USING ERRCODE = 'P0001';
  END IF;

  IF v_account_purpose NOT IN ('personal_payments','family_support','income_receiving','business_payments','savings','other') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_PURPOSE' USING ERRCODE = 'P0001';
  END IF;

  IF v_volume_band NOT IN ('low','standard','high','very_high') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_VOLUME_BAND' USING ERRCODE = 'P0001';
  END IF;

  IF v_tx_band IS NOT NULL AND v_tx_band NOT IN ('1_20','21_100','101_500','500_plus') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_TX_BAND' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_payload->'sourceOfFunds') <> 'array' THEN
    RAISE EXCEPTION 'KYC_V3_SOURCE_OF_FUNDS_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(lower(btrim(value))) INTO v_source_of_funds
  FROM jsonb_array_elements_text(p_payload->'sourceOfFunds');
  IF COALESCE(cardinality(v_source_of_funds),0) = 0 OR
     EXISTS (
       SELECT 1 FROM unnest(v_source_of_funds) s
       WHERE s NOT IN ('salary','business','savings','investments','family_support','other')
     ) THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_SOURCE_OF_FUNDS' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(p_payload->'taxResidencies') <> 'array' THEN
    RAISE EXCEPTION 'KYC_V3_TAX_RESIDENCY_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  SELECT array_agg(DISTINCT upper(btrim(value))) INTO v_tax_residencies
  FROM jsonb_array_elements_text(p_payload->'taxResidencies');
  IF COALESCE(cardinality(v_tax_residencies),0) = 0 OR
     EXISTS (SELECT 1 FROM unnest(v_tax_residencies) c WHERE c !~ '^[A-Z]{2}$') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_TAX_RESIDENCY' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_document) <> 'object' OR jsonb_typeof(v_consents) <> 'object' THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_AND_CONSENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_document_type := lower(btrim(COALESCE(v_document->>'documentType','')));
  v_issuing_country := upper(btrim(COALESCE(v_document->>'issuingCountry','')));
  v_document_number := upper(regexp_replace(btrim(COALESCE(v_document->>'documentNumber','')), '\\s+', '', 'g'));
  v_no_expiry := COALESCE((v_document->>'noExpiry')::boolean, false);
  v_front_path := btrim(COALESCE(v_document->>'frontPath',''));
  v_back_path := NULLIF(btrim(COALESCE(v_document->>'backPath','')), '');
  v_selfie_path := btrim(COALESCE(v_document->>'selfiePath',''));

  IF v_document_type NOT IN ('passport','national_id','driver_license','residence_permit','refugee_id','other_government_id') OR
     v_issuing_country !~ '^[A-Z]{2}$' OR
     v_document_number = '' OR length(v_document_number) > 100 THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(v_document->>'issueDate','') IS NOT NULL THEN
    BEGIN v_issue_date := (v_document->>'issueDate')::date;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_DATES' USING ERRCODE = 'P0001'; END;
    IF v_issue_date > current_date THEN
      RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_DATES' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_no_expiry IS NOT TRUE THEN
    BEGIN v_expiry_date := (v_document->>'expiryDate')::date;
    EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_DATES' USING ERRCODE = 'P0001'; END;
    IF v_expiry_date < current_date OR (v_issue_date IS NOT NULL AND v_expiry_date <= v_issue_date) THEN
      RAISE EXCEPTION 'KYC_V3_DOCUMENT_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_front_path = '' OR v_selfie_path = '' OR
     left(v_front_path, length(p_user_id::text) + 1) <> p_user_id::text || '/' OR
     left(v_selfie_path, length(p_user_id::text) + 1) <> p_user_id::text || '/' OR
     position('..' in v_front_path) > 0 OR position('..' in v_selfie_path) > 0 OR
     v_front_path ~* '^https?://' OR v_selfie_path ~* '^https?://' THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_PATH_OWNERSHIP_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF v_document_type <> 'passport' THEN
    IF v_back_path IS NULL OR
       left(v_back_path, length(p_user_id::text) + 1) <> p_user_id::text || '/' OR
       position('..' in v_back_path) > 0 OR v_back_path ~* '^https?://' THEN
      RAISE EXCEPTION 'KYC_V3_DOCUMENT_BACK_REQUIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF COALESCE((v_consents->>'privacyAccepted')::boolean,false) IS NOT TRUE OR
     COALESCE((v_consents->>'identityVerificationAccepted')::boolean,false) IS NOT TRUE OR
     COALESCE((v_consents->>'biometricAccepted')::boolean,false) IS NOT TRUE OR
     COALESCE((v_consents->>'ongoingScreeningAccepted')::boolean,false) IS NOT TRUE OR
     btrim(COALESCE(v_consents->>'privacyNoticeVersion','')) <> v_policy.privacy_notice_version OR
     btrim(COALESCE(v_consents->>'biometricNoticeVersion','')) <> v_policy.biometric_notice_version THEN
    RAISE EXCEPTION 'KYC_V3_REQUIRED_CONSENT_MISSING' USING ERRCODE = 'P0001';
  END IF;

  -- Declarative onboarding risk. Country weights are configurable and can be
  -- updated without application/schema changes as jurisdiction lists evolve.
  SELECT COALESCE(max(risk_weight),0) INTO v_country_weight
  FROM public.kyc_country_risk_v3
  WHERE active = true
    AND (expires_at IS NULL OR expires_at > now())
    AND country_code IN (v_nationality, v_country_of_birth, v_residence_country, v_issuing_country);

  v_risk_score := LEAST(100,
    v_country_weight +
    CASE WHEN v_pep_self THEN 45 ELSE 0 END +
    CASE WHEN v_pep_related THEN 25 ELSE 0 END +
    CASE v_volume_band WHEN 'very_high' THEN 20 WHEN 'high' THEN 10 ELSE 0 END +
    CASE WHEN v_tx_band = '500_plus' THEN 10 WHEN v_tx_band = '101_500' THEN 5 ELSE 0 END
  );

  v_risk_rating := CASE
    WHEN v_pep_self OR v_risk_score >= 50 THEN 'high'
    WHEN v_risk_score >= 20 THEN 'medium'
    ELSE 'low'
  END;

  IF (v_pep_self OR v_pep_related OR v_risk_rating = 'high') AND v_source_of_wealth IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_SOURCE_OF_WEALTH_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_risk_factors := jsonb_build_object(
    'countryWeight', v_country_weight,
    'pepSelfDeclared', v_pep_self,
    'pepRelatedDeclared', v_pep_related,
    'volumeBand', v_volume_band,
    'txBand', v_tx_band
  );

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC-V3:' || p_user_id::text, 0));

  SELECT * INTO v_existing
  FROM public.kyc_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'approved'
     AND (v_existing.next_review_at IS NULL OR v_existing.next_review_at > now()) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'KYC_ALREADY_APPROVED',
      'message', 'KYC is already approved',
      'status', 'approved'
    );
  END IF;

  IF FOUND AND COALESCE(v_existing.workflow_status, v_existing.status) IN ('submitted','in_review') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'KYC_ALREADY_PENDING',
      'message', 'KYC is already pending review',
      'status', 'pending'
    );
  END IF;

  SELECT COALESCE(max(application_version),0) + 1
  INTO v_application_version
  FROM public.kyc_applications_v3
  WHERE user_id = p_user_id;

  INSERT INTO public.kyc_applications_v3 (
    user_id, application_version, schema_version, policy_version,
    full_name, dob, nationality, country_of_birth, residence_country,
    address_line1, address_line2, city, region, postal_code,
    employment_status, occupation, employer_name,
    source_of_funds, source_of_wealth, account_purpose,
    expected_monthly_volume_band, expected_monthly_tx_count_band,
    pep_self_declared, pep_related_declared, tax_residencies,
    workflow_status, risk_score, risk_rating, assurance_level, verification_mode,
    submitted_at
  ) VALUES (
    p_user_id, v_application_version, v_policy.schema_version, v_policy.policy_version,
    v_full_name, v_dob, v_nationality, v_country_of_birth, v_residence_country,
    v_address_line1, v_address_line2, v_city, v_region, v_postal_code,
    v_employment_status, v_occupation, v_employer_name,
    v_source_of_funds, v_source_of_wealth, v_account_purpose,
    v_volume_band, v_tx_band,
    v_pep_self, v_pep_related, v_tax_residencies,
    'submitted', v_risk_score, v_risk_rating, 'pending', 'hybrid',
    now()
  )
  RETURNING id INTO v_application_id;

  v_document_hash := encode(digest(convert_to(v_issuing_country || ':' || v_document_type || ':' || v_document_number, 'UTF8'), 'sha256'), 'hex');
  v_document_last4 := right(v_document_number, LEAST(4,length(v_document_number)));

  INSERT INTO public.kyc_documents_v3 (
    application_id, user_id, document_type, issuing_country,
    document_number_hash, document_number_last4,
    issue_date, expiry_date, no_expiry, front_path, back_path
  ) VALUES (
    v_application_id, p_user_id, v_document_type, v_issuing_country,
    v_document_hash, v_document_last4,
    v_issue_date, v_expiry_date, v_no_expiry, v_front_path, v_back_path
  );

  INSERT INTO public.kyc_evidence_v3(application_id,user_id,evidence_type,object_path)
  VALUES (v_application_id,p_user_id,'id_front',v_front_path),
         (v_application_id,p_user_id,'selfie',v_selfie_path);
  IF v_back_path IS NOT NULL THEN
    INSERT INTO public.kyc_evidence_v3(application_id,user_id,evidence_type,object_path)
    VALUES (v_application_id,p_user_id,'id_back',v_back_path);
  END IF;

  INSERT INTO public.kyc_consents_v3 (
    application_id, user_id,
    privacy_accepted, identity_verification_accepted, biometric_accepted, ongoing_screening_accepted,
    privacy_notice_version, biometric_notice_version, client_ip, user_agent
  ) VALUES (
    v_application_id, p_user_id,
    true, true, true, true,
    v_policy.privacy_notice_version, v_policy.biometric_notice_version,
    NULLIF(btrim(COALESCE(p_client_ip,'')),''),
    NULLIF(left(btrim(COALESCE(p_user_agent,'')),1000),'')
  );

  INSERT INTO public.kyc_risk_assessments_v3 (
    application_id,user_id,assessment_type,score,rating,factors
  ) VALUES (
    v_application_id,p_user_id,'onboarding',v_risk_score,v_risk_rating,v_risk_factors
  );

  INSERT INTO public.kyc_provider_jobs_v3(application_id,user_id,job_type,payload)
  SELECT v_application_id, p_user_id, job_type,
         jsonb_build_object('applicationId',v_application_id,'userId',p_user_id)
  FROM (VALUES
    ('document_verification'),('liveness'),('sanctions'),('pep'),('adverse_media')
  ) AS jobs(job_type)
  WHERE CASE jobs.job_type
    WHEN 'document_verification' THEN v_policy.require_document_verification
    WHEN 'liveness' THEN v_policy.require_liveness
    WHEN 'sanctions' THEN v_policy.require_sanctions_screening
    WHEN 'pep' THEN v_policy.require_pep_screening
    WHEN 'adverse_media' THEN v_policy.require_adverse_media_screening
    ELSE false
  END;

  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);

  IF NOT FOUND THEN
    INSERT INTO public.kyc_profiles (
      user_id, "fullName", dob, address, id_path, selfie_path,
      status, reviewed_by, reviewed_at, rejection_reason, updated_at,
      current_application_id, schema_version, policy_version, workflow_status,
      assurance_level, verification_mode, submitted_at, next_review_at, required_action,
      risk_score, risk_rating,
      identity_verification_status,liveness_status,sanctions_status,pep_screening_status,adverse_media_status,
      nationality,country_of_birth,residence_country,address_line1,address_line2,city,region,postal_code,
      employment_status,occupation,employer_name,source_of_funds,source_of_wealth,account_purpose,
      expected_monthly_volume_band,expected_monthly_tx_count_band,pep_self_declared,pep_related_declared,tax_residencies
    ) VALUES (
      p_user_id,v_full_name,v_dob,v_address_line1,v_front_path,v_selfie_path,
      'pending',NULL,NULL,NULL,now(),
      v_application_id,v_policy.schema_version,v_policy.policy_version,'submitted',
      'pending','hybrid',now(),NULL,NULL,
      v_risk_score,v_risk_rating,
      'pending','pending','pending','pending','pending',
      v_nationality,v_country_of_birth,v_residence_country,v_address_line1,v_address_line2,v_city,v_region,v_postal_code,
      v_employment_status,v_occupation,v_employer_name,v_source_of_funds,v_source_of_wealth,v_account_purpose,
      v_volume_band,v_tx_band,v_pep_self,v_pep_related,v_tax_residencies
    );
    v_event := 'submitted';
  ELSE
    UPDATE public.kyc_profiles
    SET "fullName" = v_full_name,
        dob = v_dob,
        address = v_address_line1,
        id_path = v_front_path,
        selfie_path = v_selfie_path,
        status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL,
        rejection_reason = NULL,
        updated_at = now(),
        current_application_id = v_application_id,
        schema_version = v_policy.schema_version,
        policy_version = v_policy.policy_version,
        workflow_status = 'submitted',
        assurance_level = 'pending',
        verification_mode = 'hybrid',
        submitted_at = now(),
        next_review_at = NULL,
        required_action = NULL,
        risk_score = v_risk_score,
        risk_rating = v_risk_rating,
        identity_verification_status = 'pending',
        liveness_status = 'pending',
        sanctions_status = 'pending',
        pep_screening_status = 'pending',
        adverse_media_status = 'pending',
        nationality = v_nationality,
        country_of_birth = v_country_of_birth,
        residence_country = v_residence_country,
        address_line1 = v_address_line1,
        address_line2 = v_address_line2,
        city = v_city,
        region = v_region,
        postal_code = v_postal_code,
        employment_status = v_employment_status,
        occupation = v_occupation,
        employer_name = v_employer_name,
        source_of_funds = v_source_of_funds,
        source_of_wealth = v_source_of_wealth,
        account_purpose = v_account_purpose,
        expected_monthly_volume_band = v_volume_band,
        expected_monthly_tx_count_band = v_tx_band,
        pep_self_declared = v_pep_self,
        pep_related_declared = v_pep_related,
        tax_residencies = v_tax_residencies
    WHERE user_id = p_user_id;
    v_event := 'resubmitted';
  END IF;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

  INSERT INTO public.kyc_review_events (
    user_id, actor_user_id, event_type, from_status, to_status, reason, snapshot
  ) VALUES (
    p_user_id,p_user_id,v_event,
    CASE WHEN v_event='resubmitted' THEN COALESCE(v_existing.workflow_status,v_existing.status) ELSE NULL END,
    'submitted',NULL,
    jsonb_build_object(
      'applicationId',v_application_id,
      'applicationVersion',v_application_version,
      'schemaVersion',v_policy.schema_version,
      'policyVersion',v_policy.policy_version,
      'riskScore',v_risk_score,
      'riskRating',v_risk_rating,
      'documentType',v_document_type,
      'issuingCountry',v_issuing_country,
      'documentLast4',v_document_last4
    )
  );

  RETURN jsonb_build_object(
    'ok',true,
    'status','pending',
    'workflowStatus','submitted',
    'applicationId',v_application_id,
    'applicationVersion',v_application_version,
    'schemaVersion',v_policy.schema_version,
    'policyVersion',v_policy.policy_version,
    'riskRating',v_risk_rating,
    'event',v_event
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_kyc_check_v3(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_check_type text,
  p_status text,
  p_provider text DEFAULT NULL,
  p_provider_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
  v_profile public.kyc_profiles%ROWTYPE;
  v_check_type text := lower(btrim(COALESCE(p_check_type,'')));
  v_status text := lower(btrim(COALESCE(p_status,'')));
  v_check_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_CHECK_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  IF v_check_type NOT IN ('document_verification','liveness','sanctions','pep','adverse_media','proof_of_address') OR
     v_status NOT IN ('pending','verified','manual_verified','clear','manual_clear','potential_match','confirmed_match','confirmed_pep','failed','inconclusive','not_applicable') OR
     jsonb_typeof(COALESCE(p_details,'{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_CHECK' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_profile FROM public.kyc_profiles WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.current_application_id IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_APPLICATION_NOT_FOUND' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.kyc_checks_v3(
    application_id,user_id,check_type,status,provider,provider_reference,performed_by,notes,details
  ) VALUES (
    v_profile.current_application_id,p_user_id,v_check_type,v_status,
    NULLIF(btrim(COALESCE(p_provider,'')),''),NULLIF(btrim(COALESCE(p_provider_reference,'')),''),
    p_admin_user_id,NULLIF(left(btrim(COALESCE(p_notes,'')),1000),''),COALESCE(p_details,'{}'::jsonb)
  ) RETURNING id INTO v_check_id;

  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  UPDATE public.kyc_profiles
  SET identity_verification_status = CASE WHEN v_check_type='document_verification' THEN v_status ELSE identity_verification_status END,
      liveness_status = CASE WHEN v_check_type='liveness' THEN v_status ELSE liveness_status END,
      sanctions_status = CASE WHEN v_check_type='sanctions' THEN v_status ELSE sanctions_status END,
      pep_screening_status = CASE WHEN v_check_type='pep' THEN v_status ELSE pep_screening_status END,
      adverse_media_status = CASE WHEN v_check_type='adverse_media' THEN v_status ELSE adverse_media_status END,
      workflow_status = CASE WHEN workflow_status='submitted' THEN 'in_review' ELSE workflow_status END,
      required_action = CASE
        WHEN v_check_type='sanctions' AND v_status IN ('potential_match','confirmed_match') THEN 'sanctions_review'
        WHEN v_check_type='pep' AND v_status IN ('potential_match','confirmed_pep') THEN 'pep_review'
        ELSE required_action
      END,
      updated_at=now()
  WHERE user_id=p_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

  UPDATE public.kyc_applications_v3
  SET workflow_status = CASE WHEN workflow_status='submitted' THEN 'in_review' ELSE workflow_status END,
      updated_at=now()
  WHERE id=v_profile.current_application_id;

  IF to_regprocedure('public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz)') IS NOT NULL THEN
    IF v_check_type='sanctions' AND v_status='confirmed_match' THEN
      PERFORM public.set_compliance_entity_control_v1(
        p_admin_user_id,'USER',p_user_id::text,'frozen','Confirmed sanctions match during KYC',NULL
      );
    ELSIF (v_check_type='sanctions' AND v_status='potential_match') OR
          (v_check_type='pep' AND v_status IN ('potential_match','confirmed_pep')) THEN
      PERFORM public.set_compliance_entity_control_v1(
        p_admin_user_id,'USER',p_user_id::text,'review','KYC screening requires compliance review',NULL
      );
    END IF;
  END IF;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES (
    p_user_id,p_admin_user_id,'check_recorded',COALESCE(v_profile.workflow_status,v_profile.status),
    CASE WHEN COALESCE(v_profile.workflow_status,v_profile.status)='submitted' THEN 'in_review' ELSE COALESCE(v_profile.workflow_status,v_profile.status) END,
    NULLIF(left(btrim(COALESCE(p_notes,'')),500),''),
    jsonb_build_object('applicationId',v_profile.current_application_id,'checkId',v_check_id,'checkType',v_check_type,'status',v_status,'provider',p_provider)
  );

  RETURN jsonb_build_object('ok',true,'checkId',v_check_id,'checkType',v_check_type,'status',v_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_kyc_v3(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL,
  p_required_action text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
  v_profile public.kyc_profiles%ROWTYPE;
  v_application public.kyc_applications_v3%ROWTYPE;
  v_policy public.kyc_policy_versions_v3%ROWTYPE;
  v_decision text := lower(btrim(COALESCE(p_decision,'')));
  v_reason text := NULLIF(btrim(COALESCE(p_reason,'')),'');
  v_required_action text := NULLIF(btrim(COALESCE(p_required_action,'')),'');
  v_next_review timestamptz;
  v_months integer;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_REVIEW_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF v_decision NOT IN ('approved','rejected','needs_more_info') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_REVIEW_DECISION' USING ERRCODE='P0001';
  END IF;
  IF v_decision IN ('rejected','needs_more_info') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_REVIEW_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;
  IF v_reason IS NOT NULL AND length(v_reason)>500 THEN
    RAISE EXCEPTION 'KYC_V3_REVIEW_REASON_TOO_LONG' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC-V3:' || p_user_id::text,0));
  SELECT * INTO v_profile FROM public.kyc_profiles WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.current_application_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_NOT_FOUND','message','KYC application not found');
  END IF;
  SELECT * INTO v_application FROM public.kyc_applications_v3 WHERE id=v_profile.current_application_id FOR UPDATE;
  SELECT * INTO v_policy FROM public.kyc_policy_versions_v3 WHERE policy_version=v_application.policy_version;

  IF v_application.workflow_status=v_decision OR (v_decision='approved' AND v_profile.status='approved') THEN
    RETURN jsonb_build_object('ok',true,'status',v_profile.status,'workflowStatus',v_application.workflow_status,'idempotentReplay',true,'reviewedAt',v_profile.reviewed_at);
  END IF;
  IF v_application.workflow_status NOT IN ('submitted','in_review','needs_more_info') THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_REVIEW_TERMINAL','message','KYC application is not reviewable','workflowStatus',v_application.workflow_status);
  END IF;

  IF v_decision='approved' THEN
    IF v_policy.require_document_verification AND COALESCE(v_profile.identity_verification_status,'pending') NOT IN ('verified','manual_verified') THEN
      RETURN jsonb_build_object('ok',false,'code','DOCUMENT_VERIFICATION_REQUIRED','message','Document verification must be completed before approval');
    END IF;
    IF v_policy.require_liveness AND COALESCE(v_profile.liveness_status,'pending') NOT IN ('verified','manual_verified') THEN
      RETURN jsonb_build_object('ok',false,'code','LIVENESS_REQUIRED','message','Liveness verification must be completed before approval');
    END IF;
    IF v_policy.require_sanctions_screening AND COALESCE(v_profile.sanctions_status,'pending') NOT IN ('clear','manual_clear') THEN
      RETURN jsonb_build_object('ok',false,'code','SANCTIONS_SCREENING_REQUIRED','message','Sanctions screening must be clear before approval');
    END IF;
    IF v_policy.require_pep_screening AND COALESCE(v_profile.pep_screening_status,'pending') NOT IN ('clear','manual_clear','confirmed_pep') THEN
      RETURN jsonb_build_object('ok',false,'code','PEP_SCREENING_REQUIRED','message','PEP screening must be completed before approval');
    END IF;
    IF v_policy.require_adverse_media_screening AND COALESCE(v_profile.adverse_media_status,'pending') NOT IN ('clear','manual_clear','not_applicable') THEN
      RETURN jsonb_build_object('ok',false,'code','ADVERSE_MEDIA_SCREENING_REQUIRED','message','Adverse-media screening must be completed before approval');
    END IF;

    IF (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high')
       AND v_role NOT IN ('admin','super_admin') THEN
      RETURN jsonb_build_object('ok',false,'code','SENIOR_APPROVAL_REQUIRED','message','High-risk or PEP KYC requires senior approval');
    END IF;
    IF (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high')
       AND NULLIF(btrim(COALESCE(v_application.source_of_wealth,'')),'') IS NULL THEN
      RETURN jsonb_build_object('ok',false,'code','SOURCE_OF_WEALTH_REQUIRED','message','Source of wealth is required for enhanced due diligence');
    END IF;

    v_months := CASE v_application.risk_rating
      WHEN 'high' THEN v_policy.high_risk_review_months
      WHEN 'medium' THEN v_policy.medium_risk_review_months
      ELSE v_policy.low_risk_review_months
    END;
    IF v_application.pep_self_declared OR v_application.pep_related_declared THEN
      v_months := LEAST(v_months,v_policy.high_risk_review_months);
    END IF;
    v_next_review := now() + make_interval(months => v_months);
  END IF;

  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);

  UPDATE public.kyc_profiles
  SET status = CASE WHEN v_decision='approved' THEN 'approved' ELSE 'rejected' END,
      workflow_status = v_decision,
      assurance_level = CASE
        WHEN v_decision='approved' AND (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high') THEN 'enhanced'
        WHEN v_decision='approved' THEN 'standard'
        ELSE assurance_level
      END,
      reviewed_by=p_admin_user_id,
      reviewed_at=now(),
      rejection_reason=CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
      required_action=CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END,
      next_review_at=CASE WHEN v_decision='approved' THEN v_next_review ELSE NULL END,
      updated_at=now()
  WHERE user_id=p_user_id;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

  UPDATE public.kyc_applications_v3
  SET workflow_status=v_decision,
      reviewed_by=p_admin_user_id,
      reviewed_at=now(),
      rejection_reason=CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
      required_action=CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END,
      next_review_at=CASE WHEN v_decision='approved' THEN v_next_review ELSE NULL END,
      assurance_level=CASE
        WHEN v_decision='approved' AND (pep_self_declared OR pep_related_declared OR risk_rating='high') THEN 'enhanced'
        WHEN v_decision='approved' THEN 'standard'
        ELSE assurance_level
      END,
      updated_at=now()
  WHERE id=v_application.id;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES (
    p_user_id,p_admin_user_id,v_decision,v_application.workflow_status,v_decision,
    CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
    jsonb_build_object(
      'applicationId',v_application.id,
      'riskRating',v_application.risk_rating,
      'assuranceLevel',CASE WHEN v_decision='approved' AND (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high') THEN 'enhanced' WHEN v_decision='approved' THEN 'standard' ELSE v_application.assurance_level END,
      'nextReviewAt',v_next_review,
      'requiredAction',CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END
    )
  );

  RETURN jsonb_build_object(
    'ok',true,
    'status',CASE WHEN v_decision='approved' THEN 'approved' ELSE 'rejected' END,
    'workflowStatus',v_decision,
    'idempotentReplay',false,
    'reviewedBy',p_admin_user_id,
    'reviewedAt',now(),
    'rejectionReason',CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
    'requiredAction',CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END,
    'nextReviewAt',v_next_review
  );
END;
$$;

-- Existing approved production KYC remains valid but is explicitly marked as
-- legacy/manual and scheduled for refresh. No current user is de-approved.
PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
UPDATE public.kyc_profiles
SET workflow_status = COALESCE(workflow_status, CASE status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'submitted' END),
    assurance_level = COALESCE(assurance_level, CASE WHEN status='approved' THEN 'legacy_manual' ELSE 'pending' END),
    verification_mode = COALESCE(verification_mode, CASE WHEN status='approved' THEN 'legacy_manual' ELSE 'hybrid' END),
    submitted_at = COALESCE(submitted_at, created_at, updated_at),
    risk_score = COALESCE(risk_score,0),
    risk_rating = COALESCE(risk_rating,'low'),
    identity_verification_status = COALESCE(identity_verification_status, CASE WHEN status='approved' THEN 'manual_verified' ELSE 'pending' END),
    liveness_status = COALESCE(liveness_status, CASE WHEN status='approved' THEN 'manual_verified' ELSE 'pending' END),
    sanctions_status = COALESCE(sanctions_status, CASE WHEN status='approved' THEN 'manual_clear' ELSE 'pending' END),
    pep_screening_status = COALESCE(pep_screening_status, CASE WHEN status='approved' THEN 'manual_clear' ELSE 'pending' END),
    adverse_media_status = COALESCE(adverse_media_status, 'not_applicable'),
    next_review_at = CASE WHEN status='approved' THEN COALESCE(next_review_at, now() + interval '12 months') ELSE next_review_at END,
    address_line1 = COALESCE(address_line1,address)
WHERE current_application_id IS NULL;
PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

ALTER TABLE public.kyc_policy_versions_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_country_risk_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_applications_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_evidence_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_consents_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_checks_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_risk_assessments_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_provider_jobs_v3 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kyc_policy_versions_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_country_risk_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_applications_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_documents_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_evidence_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_consents_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_checks_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_risk_assessments_v3 FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_provider_jobs_v3 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_policy_versions_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_country_risk_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_applications_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_documents_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_evidence_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_consents_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_checks_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_risk_assessments_v3 FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_provider_jobs_v3 FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb) FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) FROM %I',r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON TABLE public.kyc_policy_versions_v3 TO service_role;
    GRANT SELECT,INSERT,UPDATE ON TABLE public.kyc_country_risk_v3 TO service_role;
    GRANT SELECT,INSERT,UPDATE ON TABLE public.kyc_applications_v3 TO service_role;
    GRANT SELECT,INSERT ON TABLE public.kyc_documents_v3 TO service_role;
    GRANT SELECT,INSERT ON TABLE public.kyc_evidence_v3 TO service_role;
    GRANT SELECT,INSERT ON TABLE public.kyc_consents_v3 TO service_role;
    GRANT SELECT,INSERT ON TABLE public.kyc_checks_v3 TO service_role;
    GRANT SELECT,INSERT ON TABLE public.kyc_risk_assessments_v3 TO service_role;
    GRANT SELECT,INSERT,UPDATE ON TABLE public.kyc_provider_jobs_v3 TO service_role;
    GRANT EXECUTE ON FUNCTION public.kyc_active_policy_v3() TO service_role;
    GRANT EXECUTE ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE public.kyc_applications_v3 IS 'Versioned KYC applications. Current state is mirrored in kyc_profiles for backward compatibility.';
COMMENT ON TABLE public.kyc_documents_v3 IS 'KYC document metadata. Raw document numbers are not retained; only SHA-256 fingerprint and last four are stored.';
COMMENT ON TABLE public.kyc_checks_v3 IS 'Append-only document/liveness/sanctions/PEP/adverse-media verification evidence.';
COMMENT ON TABLE public.kyc_provider_jobs_v3 IS 'Provider-neutral async verification/screening queue; provider can be changed without KYC schema changes.';
COMMENT ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) IS 'KYC v3 application submission with CDD profile, document metadata, consent evidence, risk scoring and provider job creation.';
COMMENT ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) IS 'KYC v3 controlled review with mandatory checks and senior approval for high-risk/PEP cases.';

COMMIT;
