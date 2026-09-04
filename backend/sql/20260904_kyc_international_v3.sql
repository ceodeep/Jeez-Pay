BEGIN;

-- Phase 5.3: International-grade, versioned KYC foundation.
-- Additive by design: kyc_profiles remains the fast current-status summary used
-- by existing money routes, while evidence and policy decisions are versioned.

DO $$
BEGIN
  IF to_regclass('public.kyc_profiles') IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_KYC_PROFILES_MISSING' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public.kyc_review_events') IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_REVIEW_EVENTS_MISSING' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.review_kyc_v2(uuid,uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_V2_REVIEW_PRIMITIVE_MISSING' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.kyc_policy_versions (
  version integer PRIMARY KEY,
  policy_code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft',
  schema_version integer NOT NULL DEFAULT 3,
  requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
  privacy_notice_version text NOT NULL,
  biometric_notice_version text NOT NULL,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_policy_versions_status_check
    CHECK (status IN ('draft','active','retired')),
  CONSTRAINT kyc_policy_versions_schema_positive CHECK (schema_version > 0),
  CONSTRAINT kyc_policy_versions_requirements_object
    CHECK (jsonb_typeof(requirements) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS kyc_policy_versions_one_active_uidx
  ON public.kyc_policy_versions ((status))
  WHERE status = 'active';

INSERT INTO public.kyc_policy_versions(
  version, policy_code, status, schema_version, requirements,
  privacy_notice_version, biometric_notice_version, activated_at
)
VALUES (
  3,
  'JEEZPAY-KYC-V3',
  'active',
  3,
  jsonb_build_object(
    'acceptedDocumentTypes', jsonb_build_array(
      'passport','national_id','driver_license','residence_permit','refugee_id','other_government_id'
    ),
    'requiredCoreAttributes', jsonb_build_array(
      'fullName','dob','nationality','countryOfBirth','residenceCountry',
      'residentialAddress','documentType','documentNumber','issuingCountry',
      'occupation','employmentStatus','sourceOfFunds','accountPurpose',
      'expectedMonthlyVolumeBand','pepDeclaration'
    ),
    'requiresGovernmentIdentifier', true,
    'requiresLiveCaptureEvidence', true,
    'requiresPepScreening', true,
    'requiresSanctionsScreening', true,
    'requiresDocumentVerification', true,
    'requiresFaceMatch', true,
    'manualVerificationFallbackAllowed', true,
    'periodicReviewMonthsLow', 36,
    'periodicReviewMonthsMedium', 24,
    'periodicReviewMonthsHigh', 12
  ),
  'privacy-2026-09-v1',
  'biometric-2026-09-v1',
  now()
)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kyc_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  application_version integer NOT NULL,
  schema_version integer NOT NULL DEFAULT 3,
  policy_version integer NOT NULL REFERENCES public.kyc_policy_versions(version) ON DELETE RESTRICT,
  workflow_status text NOT NULL DEFAULT 'submitted',
  assurance_level text NOT NULL DEFAULT 'standard',
  verification_mode text NOT NULL DEFAULT 'manual',

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
  source_of_funds jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_of_wealth text,
  account_purpose text NOT NULL,
  expected_monthly_volume_band text NOT NULL,
  expected_monthly_tx_count_band text,

  pep_self_declared boolean NOT NULL DEFAULT false,
  pep_related_declared boolean NOT NULL DEFAULT false,
  tax_residencies jsonb NOT NULL DEFAULT '[]'::jsonb,

  risk_score numeric(8,2),
  risk_tier text NOT NULL DEFAULT 'unassessed',
  edd_required boolean NOT NULL DEFAULT false,
  screening_status text NOT NULL DEFAULT 'pending',
  provider_status text NOT NULL DEFAULT 'pending',

  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  decision_reason text,
  next_review_at timestamptz,
  supersedes_application_id uuid REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT kyc_applications_version_positive CHECK (application_version > 0),
  CONSTRAINT kyc_applications_schema_positive CHECK (schema_version > 0),
  CONSTRAINT kyc_applications_workflow_check CHECK (
    workflow_status IN (
      'submitted','in_review','needs_more_info','approved','rejected','expired','cancelled'
    )
  ),
  CONSTRAINT kyc_applications_assurance_check CHECK (
    assurance_level IN ('legacy','standard','enhanced')
  ),
  CONSTRAINT kyc_applications_verification_mode_check CHECK (
    verification_mode IN ('manual','provider','hybrid')
  ),
  CONSTRAINT kyc_applications_risk_tier_check CHECK (
    risk_tier IN ('unassessed','low','medium','high')
  ),
  CONSTRAINT kyc_applications_screening_check CHECK (
    screening_status IN ('pending','clear','review','blocked','unavailable')
  ),
  CONSTRAINT kyc_applications_provider_check CHECK (
    provider_status IN ('pending','in_progress','verified','manual_verified','failed','unavailable')
  ),
  CONSTRAINT kyc_applications_country_codes CHECK (
    nationality ~ '^[A-Z]{2}$'
    AND country_of_birth ~ '^[A-Z]{2}$'
    AND residence_country ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT kyc_applications_sources_array CHECK (jsonb_typeof(source_of_funds) = 'array'),
  CONSTRAINT kyc_applications_tax_array CHECK (jsonb_typeof(tax_residencies) = 'array'),
  CONSTRAINT kyc_applications_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(user_id, application_version)
);

CREATE INDEX IF NOT EXISTS kyc_applications_user_created_idx
  ON public.kyc_applications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_applications_queue_idx
  ON public.kyc_applications(workflow_status, risk_tier, submitted_at, id)
  WHERE workflow_status IN ('submitted','in_review','needs_more_info');
CREATE INDEX IF NOT EXISTS kyc_applications_assignee_idx
  ON public.kyc_applications(assigned_to, workflow_status, submitted_at)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS kyc_applications_next_review_idx
  ON public.kyc_applications(next_review_at)
  WHERE workflow_status = 'approved' AND next_review_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kyc_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  object_path text NOT NULL UNIQUE,
  file_type text NOT NULL,
  content_type text NOT NULL,
  schema_version integer NOT NULL DEFAULT 3,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_upload_sessions_file_type_check CHECK (
    file_type IN ('id_front','id_back','selfie','proof_of_address','supporting_document')
  ),
  CONSTRAINT kyc_upload_sessions_content_type_check CHECK (
    content_type IN ('image/jpeg','image/jpg','image/png')
  )
);
CREATE INDEX IF NOT EXISTS kyc_upload_sessions_user_active_idx
  ON public.kyc_upload_sessions(user_id, created_at DESC)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  document_type text NOT NULL,
  issuing_country text NOT NULL,
  document_number_ciphertext text NOT NULL,
  document_number_fingerprint text NOT NULL,
  document_number_last4 text,
  issue_date date,
  expiry_date date,
  no_expiry boolean NOT NULL DEFAULT false,
  front_path text NOT NULL,
  back_path text,
  capture_method text NOT NULL DEFAULT 'camera',
  evidence_strength text NOT NULL DEFAULT 'unrated',
  verification_status text NOT NULL DEFAULT 'pending',
  verification_provider text,
  provider_reference text,
  front_sha256 text,
  back_sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_documents_type_check CHECK (
    document_type IN (
      'passport','national_id','driver_license','residence_permit','refugee_id','other_government_id'
    )
  ),
  CONSTRAINT kyc_documents_country_check CHECK (issuing_country ~ '^[A-Z]{2}$'),
  CONSTRAINT kyc_documents_capture_check CHECK (
    capture_method IN ('camera','provider_sdk','attended','manual_import')
  ),
  CONSTRAINT kyc_documents_evidence_strength_check CHECK (
    evidence_strength IN ('unrated','fair','strong','superior')
  ),
  CONSTRAINT kyc_documents_verification_check CHECK (
    verification_status IN ('pending','verified','manual_verified','failed','expired','unavailable')
  ),
  CONSTRAINT kyc_documents_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(application_id)
);
CREATE INDEX IF NOT EXISTS kyc_documents_fingerprint_idx
  ON public.kyc_documents(document_number_fingerprint);
CREATE INDEX IF NOT EXISTS kyc_documents_provider_ref_idx
  ON public.kyc_documents(verification_provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kyc_provider_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  check_type text NOT NULL,
  status text NOT NULL DEFAULT 'not_run',
  provider text NOT NULL DEFAULT 'manual',
  provider_reference text,
  score numeric(10,4),
  result_code text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_provider_checks_type_check CHECK (
    check_type IN ('document_authenticity','document_presence','face_match','liveness','address','database_identity')
  ),
  CONSTRAINT kyc_provider_checks_status_check CHECK (
    status IN ('not_run','pending','passed','manual_passed','review','failed','unavailable')
  ),
  CONSTRAINT kyc_provider_checks_evidence_object CHECK (jsonb_typeof(evidence) = 'object'),
  UNIQUE(application_id, check_type)
);
CREATE INDEX IF NOT EXISTS kyc_provider_checks_queue_idx
  ON public.kyc_provider_checks(status, check_type, created_at);

CREATE TABLE IF NOT EXISTS public.kyc_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  screening_type text NOT NULL,
  status text NOT NULL DEFAULT 'not_run',
  provider text NOT NULL DEFAULT 'manual',
  provider_reference text,
  list_version text,
  match_score numeric(10,4),
  match_count integer NOT NULL DEFAULT 0,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  screened_at timestamptz,
  next_screen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_screenings_type_check CHECK (
    screening_type IN ('sanctions','pep','adverse_media')
  ),
  CONSTRAINT kyc_screenings_status_check CHECK (
    status IN ('not_run','pending','clear','potential_match','reviewed','confirmed_match','unavailable')
  ),
  CONSTRAINT kyc_screenings_match_count_nonnegative CHECK (match_count >= 0),
  CONSTRAINT kyc_screenings_summary_object CHECK (jsonb_typeof(result_summary) = 'object'),
  UNIQUE(application_id, screening_type)
);
CREATE INDEX IF NOT EXISTS kyc_screenings_status_idx
  ON public.kyc_screenings(screening_type, status, created_at);
CREATE INDEX IF NOT EXISTS kyc_screenings_rescreen_idx
  ON public.kyc_screenings(next_screen_at)
  WHERE next_screen_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.kyc_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  model_version text NOT NULL,
  score numeric(8,2) NOT NULL,
  risk_tier text NOT NULL,
  edd_required boolean NOT NULL DEFAULT false,
  factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_risk_assessments_tier_check CHECK (risk_tier IN ('low','medium','high')),
  CONSTRAINT kyc_risk_assessments_factors_array CHECK (jsonb_typeof(factors) = 'array')
);
CREATE INDEX IF NOT EXISTS kyc_risk_assessments_app_created_idx
  ON public.kyc_risk_assessments(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.kyc_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  consent_type text NOT NULL,
  policy_version text NOT NULL,
  accepted boolean NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT kyc_consents_type_check CHECK (
    consent_type IN ('privacy_notice','identity_verification','biometric_processing','ongoing_screening')
  ),
  CONSTRAINT kyc_consents_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(application_id, consent_type)
);

CREATE TABLE IF NOT EXISTS public.kyc_provider_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  payload_sha256 text NOT NULL,
  application_id uuid REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  processing_status text NOT NULL DEFAULT 'received',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT kyc_provider_webhook_status_check CHECK (
    processing_status IN ('received','processed','ignored','failed')
  ),
  CONSTRAINT kyc_provider_webhook_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  UNIQUE(provider, provider_event_id)
);
CREATE INDEX IF NOT EXISTS kyc_provider_webhook_processing_idx
  ON public.kyc_provider_webhook_events(processing_status, received_at);

-- Expand the Phase 5.1 immutable event vocabulary while retaining old values.
ALTER TABLE public.kyc_review_events
  DROP CONSTRAINT IF EXISTS kyc_review_events_event_type_check;
ALTER TABLE public.kyc_review_events
  ADD CONSTRAINT kyc_review_events_event_type_check CHECK (
    event_type IN (
      'submitted','resubmitted','approved','rejected','in_review',
      'needs_more_info','screening_updated','provider_check_updated','risk_assessed'
    )
  );

ALTER TABLE public.kyc_review_events
  DROP CONSTRAINT IF EXISTS kyc_review_events_status_check;
ALTER TABLE public.kyc_review_events
  ADD CONSTRAINT kyc_review_events_status_check CHECK (
    to_status IN ('pending','approved','rejected','in_review','needs_more_info')
  );

CREATE OR REPLACE FUNCTION public.calculate_kyc_initial_risk_v3(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_score numeric(8,2) := 0;
  v_factors jsonb := '[]'::jsonb;
  v_pep boolean := COALESCE((p_payload->>'pepSelfDeclared')::boolean, false);
  v_related boolean := COALESCE((p_payload->>'pepRelatedDeclared')::boolean, false);
  v_volume text := lower(COALESCE(p_payload->>'expectedMonthlyVolumeBand',''));
  v_sources jsonb := COALESCE(p_payload->'sourceOfFunds','[]'::jsonb);
  v_tier text;
BEGIN
  IF v_pep THEN
    v_score := v_score + 60;
    v_factors := v_factors || jsonb_build_array(jsonb_build_object('code','PEP_SELF_DECLARED','score',60));
  END IF;

  IF v_related THEN
    v_score := v_score + 35;
    v_factors := v_factors || jsonb_build_array(jsonb_build_object('code','PEP_RELATED_DECLARED','score',35));
  END IF;

  IF v_volume IN ('very_high','10m_plus','highest') THEN
    v_score := v_score + 15;
    v_factors := v_factors || jsonb_build_array(jsonb_build_object('code','HIGH_EXPECTED_VOLUME','score',15));
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_sources) AS s(value)
    WHERE lower(value) IN ('other','cash_intensive','unknown')
  ) THEN
    v_score := v_score + 10;
    v_factors := v_factors || jsonb_build_array(jsonb_build_object('code','SOURCE_OF_FUNDS_REVIEW','score',10));
  END IF;

  v_tier := CASE
    WHEN v_score >= 50 THEN 'high'
    WHEN v_score >= 20 THEN 'medium'
    ELSE 'low'
  END;

  RETURN jsonb_build_object(
    'score', v_score,
    'riskTier', v_tier,
    'eddRequired', (v_score >= 50 OR v_pep),
    'factors', v_factors,
    'modelVersion', 'KYC-RISK-V1'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_kyc_v3(
  p_user_id uuid,
  p_payload jsonb,
  p_document jsonb,
  p_consents jsonb,
  p_request_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_policy public.kyc_policy_versions%ROWTYPE;
  v_profile public.kyc_profiles%ROWTYPE;
  v_prev_app public.kyc_applications%ROWTYPE;
  v_app public.kyc_applications%ROWTYPE;
  v_app_version integer;
  v_risk jsonb;
  v_front text := btrim(COALESCE(p_document->>'frontPath',''));
  v_back text := NULLIF(btrim(COALESCE(p_document->>'backPath','')), '');
  v_selfie text := btrim(COALESCE(p_document->>'selfiePath',''));
  v_prefix text;
  v_full_name text := btrim(COALESCE(p_payload->>'fullName',''));
  v_dob date;
  v_document_type text := lower(btrim(COALESCE(p_document->>'documentType','')));
  v_issuing_country text := upper(btrim(COALESCE(p_document->>'issuingCountry','')));
  v_expiry date;
  v_no_expiry boolean := COALESCE((p_document->>'noExpiry')::boolean,false);
  v_privacy_version text;
  v_biometric_version text;
BEGIN
  IF p_user_id IS NULL OR jsonb_typeof(p_payload) <> 'object'
     OR jsonb_typeof(p_document) <> 'object'
     OR jsonb_typeof(p_consents) <> 'object'
     OR jsonb_typeof(COALESCE(p_request_metadata,'{}'::jsonb)) <> 'object'
  THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_policy
  FROM public.kyc_policy_versions
  WHERE status = 'active'
  ORDER BY version DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'KYC_V3_ACTIVE_POLICY_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id=p_user_id AND COALESCE(is_system,false)=false AND COALESCE(is_active,true)=true
  ) THEN
    RAISE EXCEPTION 'KYC_V3_USER_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_full_name = ''
     OR btrim(COALESCE(p_payload->>'dob','')) = ''
     OR upper(btrim(COALESCE(p_payload->>'nationality',''))) !~ '^[A-Z]{2}$'
     OR upper(btrim(COALESCE(p_payload->>'countryOfBirth',''))) !~ '^[A-Z]{2}$'
     OR upper(btrim(COALESCE(p_payload->>'residenceCountry',''))) !~ '^[A-Z]{2}$'
     OR btrim(COALESCE(p_payload->>'addressLine1','')) = ''
     OR btrim(COALESCE(p_payload->>'city','')) = ''
     OR btrim(COALESCE(p_payload->>'employmentStatus','')) = ''
     OR btrim(COALESCE(p_payload->>'occupation','')) = ''
     OR jsonb_typeof(COALESCE(p_payload->'sourceOfFunds','null'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_payload->'sourceOfFunds','[]'::jsonb)) = 0
     OR btrim(COALESCE(p_payload->>'accountPurpose','')) = ''
     OR btrim(COALESCE(p_payload->>'expectedMonthlyVolumeBand','')) = ''
  THEN
    RAISE EXCEPTION 'KYC_V3_REQUIRED_CORE_ATTRIBUTES' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_dob := (p_payload->>'dob')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_DOB' USING ERRCODE = 'P0001';
  END;
  IF v_dob > current_date OR v_dob < DATE '1900-01-01' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_DOB' USING ERRCODE = 'P0001';
  END IF;

  IF v_document_type NOT IN (
    'passport','national_id','driver_license','residence_permit','refugee_id','other_government_id'
  ) OR v_issuing_country !~ '^[A-Z]{2}$'
     OR btrim(COALESCE(p_document->>'documentNumberCiphertext','')) = ''
     OR btrim(COALESCE(p_document->>'documentNumberFingerprint','')) = ''
     OR v_front = '' OR v_selfie = ''
  THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT' USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_no_expiry AND NULLIF(btrim(COALESCE(p_document->>'expiryDate','')), '') IS NOT NULL THEN
    BEGIN
      v_expiry := (p_document->>'expiryDate')::date;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_EXPIRY' USING ERRCODE = 'P0001';
    END;
    IF v_expiry < current_date THEN
      RAISE EXCEPTION 'KYC_V3_DOCUMENT_EXPIRED' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_privacy_version := COALESCE(p_consents->>'privacyNoticeVersion','');
  v_biometric_version := COALESCE(p_consents->>'biometricNoticeVersion','');
  IF COALESCE((p_consents->>'privacyAccepted')::boolean,false) IS NOT TRUE
     OR COALESCE((p_consents->>'identityVerificationAccepted')::boolean,false) IS NOT TRUE
     OR COALESCE((p_consents->>'biometricAccepted')::boolean,false) IS NOT TRUE
     OR COALESCE((p_consents->>'ongoingScreeningAccepted')::boolean,false) IS NOT TRUE
     OR v_privacy_version <> v_policy.privacy_notice_version
     OR v_biometric_version <> v_policy.biometric_notice_version
  THEN
    RAISE EXCEPTION 'KYC_V3_REQUIRED_CONSENT_MISSING' USING ERRCODE = 'P0001';
  END IF;

  v_prefix := p_user_id::text || '/';
  IF left(v_front, length(v_prefix)+3) <> v_prefix || 'id_'
     OR left(v_selfie, length(v_prefix)+7) <> v_prefix || 'selfie_'
     OR (v_back IS NOT NULL AND left(v_back, length(v_prefix)+8) <> v_prefix || 'id_back_')
     OR v_front LIKE '%..%' OR v_selfie LIKE '%..%' OR COALESCE(v_back,'') LIKE '%..%'
  THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_PATH_OWNERSHIP_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_upload_sessions
    WHERE user_id=p_user_id AND object_path=v_front AND file_type='id_front'
      AND used_at IS NULL AND expires_at > now()
  ) OR NOT EXISTS (
    SELECT 1 FROM public.kyc_upload_sessions
    WHERE user_id=p_user_id AND object_path=v_selfie AND file_type='selfie'
      AND used_at IS NULL AND expires_at > now()
  ) OR (v_back IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kyc_upload_sessions
    WHERE user_id=p_user_id AND object_path=v_back AND file_type='id_back'
      AND used_at IS NULL AND expires_at > now()
  )) THEN
    RAISE EXCEPTION 'KYC_V3_UPLOAD_SESSION_INVALID' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC:' || p_user_id::text,0));

  SELECT * INTO v_profile FROM public.kyc_profiles WHERE user_id=p_user_id FOR UPDATE;
  IF FOUND AND v_profile.status='approved' THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_ALREADY_APPROVED','status','approved');
  END IF;

  SELECT * INTO v_prev_app
  FROM public.kyc_applications
  WHERE user_id=p_user_id
  ORDER BY application_version DESC
  LIMIT 1;

  IF FOUND AND v_prev_app.workflow_status IN ('submitted','in_review') THEN
    RETURN jsonb_build_object(
      'ok',false,'code','KYC_ALREADY_PENDING','status','pending',
      'workflowStatus',v_prev_app.workflow_status,'applicationId',v_prev_app.id
    );
  END IF;

  SELECT COALESCE(max(application_version),0)+1 INTO v_app_version
  FROM public.kyc_applications WHERE user_id=p_user_id;

  v_risk := public.calculate_kyc_initial_risk_v3(p_payload);

  INSERT INTO public.kyc_applications(
    user_id,application_version,schema_version,policy_version,workflow_status,
    assurance_level,verification_mode,full_name,dob,nationality,country_of_birth,
    residence_country,address_line1,address_line2,city,region,postal_code,
    employment_status,occupation,employer_name,source_of_funds,source_of_wealth,
    account_purpose,expected_monthly_volume_band,expected_monthly_tx_count_band,
    pep_self_declared,pep_related_declared,tax_residencies,risk_score,risk_tier,
    edd_required,screening_status,provider_status,supersedes_application_id,metadata
  ) VALUES (
    p_user_id,v_app_version,3,v_policy.version,'submitted','standard','manual',
    v_full_name,v_dob,upper(p_payload->>'nationality'),upper(p_payload->>'countryOfBirth'),
    upper(p_payload->>'residenceCountry'),btrim(p_payload->>'addressLine1'),
    NULLIF(btrim(COALESCE(p_payload->>'addressLine2','')),''),btrim(p_payload->>'city'),
    NULLIF(btrim(COALESCE(p_payload->>'region','')),''),
    NULLIF(btrim(COALESCE(p_payload->>'postalCode','')),''),
    btrim(p_payload->>'employmentStatus'),btrim(p_payload->>'occupation'),
    NULLIF(btrim(COALESCE(p_payload->>'employerName','')),''),p_payload->'sourceOfFunds',
    NULLIF(btrim(COALESCE(p_payload->>'sourceOfWealth','')),''),
    btrim(p_payload->>'accountPurpose'),btrim(p_payload->>'expectedMonthlyVolumeBand'),
    NULLIF(btrim(COALESCE(p_payload->>'expectedMonthlyTxCountBand','')),''),
    COALESCE((p_payload->>'pepSelfDeclared')::boolean,false),
    COALESCE((p_payload->>'pepRelatedDeclared')::boolean,false),
    COALESCE(p_payload->'taxResidencies','[]'::jsonb),
    (v_risk->>'score')::numeric,v_risk->>'riskTier',
    COALESCE((v_risk->>'eddRequired')::boolean,false),'pending','pending',
    CASE WHEN v_prev_app.id IS NOT NULL THEN v_prev_app.id ELSE NULL END,
    COALESCE(p_request_metadata,'{}'::jsonb)
  ) RETURNING * INTO v_app;

  INSERT INTO public.kyc_documents(
    application_id,document_type,issuing_country,document_number_ciphertext,
    document_number_fingerprint,document_number_last4,issue_date,expiry_date,no_expiry,
    front_path,back_path,capture_method,evidence_strength,verification_status,metadata
  ) VALUES (
    v_app.id,v_document_type,v_issuing_country,p_document->>'documentNumberCiphertext',
    p_document->>'documentNumberFingerprint',NULLIF(p_document->>'documentNumberLast4',''),
    NULLIF(p_document->>'issueDate','')::date,v_expiry,v_no_expiry,v_front,v_back,
    COALESCE(NULLIF(p_document->>'captureMethod',''),'camera'),'unrated','pending',
    jsonb_build_object('selfiePath',v_selfie)
  );

  INSERT INTO public.kyc_provider_checks(application_id,check_type,status,provider)
  SELECT v_app.id, t.check_type, 'not_run', 'manual'
  FROM (VALUES
    ('document_authenticity'),('document_presence'),('face_match'),('liveness'),('database_identity')
  ) AS t(check_type)
  ON CONFLICT (application_id,check_type) DO NOTHING;

  INSERT INTO public.kyc_screenings(application_id,screening_type,status,provider)
  SELECT v_app.id, t.screening_type, 'not_run', 'manual'
  FROM (VALUES ('sanctions'),('pep'),('adverse_media')) AS t(screening_type)
  ON CONFLICT (application_id,screening_type) DO NOTHING;

  INSERT INTO public.kyc_risk_assessments(
    application_id,model_version,score,risk_tier,edd_required,factors,created_by
  ) VALUES (
    v_app.id,v_risk->>'modelVersion',(v_risk->>'score')::numeric,v_risk->>'riskTier',
    COALESCE((v_risk->>'eddRequired')::boolean,false),v_risk->'factors',p_user_id
  );

  INSERT INTO public.kyc_consents(application_id,consent_type,policy_version,accepted,ip_address,user_agent)
  VALUES
    (v_app.id,'privacy_notice',v_privacy_version,true,p_request_metadata->>'ipAddress',p_request_metadata->>'userAgent'),
    (v_app.id,'identity_verification',v_policy.policy_code,true,p_request_metadata->>'ipAddress',p_request_metadata->>'userAgent'),
    (v_app.id,'biometric_processing',v_biometric_version,true,p_request_metadata->>'ipAddress',p_request_metadata->>'userAgent'),
    (v_app.id,'ongoing_screening',v_policy.policy_code,true,p_request_metadata->>'ipAddress',p_request_metadata->>'userAgent');

  UPDATE public.kyc_upload_sessions
  SET used_at=now()
  WHERE user_id=p_user_id AND object_path IN (v_front,v_selfie,COALESCE(v_back,''));

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  INSERT INTO public.kyc_profiles(
    user_id,"fullName",dob,address,id_path,selfie_path,status,
    reviewed_by,reviewed_at,rejection_reason,updated_at
  ) VALUES (
    p_user_id,v_full_name,v_dob,btrim(p_payload->>'addressLine1'),v_front,v_selfie,'pending',
    NULL,NULL,NULL,now()
  ) ON CONFLICT (user_id) DO UPDATE SET
    "fullName"=EXCLUDED."fullName",dob=EXCLUDED.dob,address=EXCLUDED.address,
    id_path=EXCLUDED.id_path,selfie_path=EXCLUDED.selfie_path,status='pending',
    reviewed_by=NULL,reviewed_at=NULL,rejection_reason=NULL,updated_at=now();
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);

  INSERT INTO public.kyc_review_events(
    user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot
  ) VALUES (
    p_user_id,p_user_id,
    CASE WHEN v_app_version=1 THEN 'submitted' ELSE 'resubmitted' END,
    CASE WHEN v_prev_app.id IS NULL THEN NULL ELSE
      CASE WHEN v_prev_app.workflow_status='approved' THEN 'approved'
           WHEN v_prev_app.workflow_status='rejected' THEN 'rejected'
           ELSE 'pending' END
    END,
    'pending',NULL,
    jsonb_build_object(
      'schemaVersion',3,'policyVersion',v_policy.version,'applicationId',v_app.id,
      'riskTier',v_app.risk_tier,'eddRequired',v_app.edd_required,
      'documentType',v_document_type,'issuingCountry',v_issuing_country
    )
  );

  RETURN jsonb_build_object(
    'ok',true,'status','pending','workflowStatus','submitted','applicationId',v_app.id,
    'applicationVersion',v_app_version,'schemaVersion',3,'policyVersion',v_policy.version,
    'riskTier',v_app.risk_tier,'eddRequired',v_app.edd_required
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.set_kyc_provider_check_v3(
  p_admin_user_id uuid,
  p_application_id uuid,
  p_check_type text,
  p_status text,
  p_provider text,
  p_provider_reference text DEFAULT NULL,
  p_score numeric DEFAULT NULL,
  p_result_code text DEFAULT NULL,
  p_evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
  v_row public.kyc_provider_checks%ROWTYPE;
  v_user_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_REVIEWER_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF lower(btrim(COALESCE(p_check_type,''))) NOT IN
    ('document_authenticity','document_presence','face_match','liveness','address','database_identity')
     OR lower(btrim(COALESCE(p_status,''))) NOT IN
    ('not_run','pending','passed','manual_passed','review','failed','unavailable')
  THEN RAISE EXCEPTION 'KYC_V3_INVALID_PROVIDER_CHECK' USING ERRCODE='P0001'; END IF;

  SELECT user_id INTO v_user_id FROM public.kyc_applications WHERE id=p_application_id;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'KYC_V3_APPLICATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.kyc_provider_checks(
    application_id,check_type,status,provider,provider_reference,score,result_code,evidence,
    started_at,completed_at,updated_at
  ) VALUES (
    p_application_id,lower(p_check_type),lower(p_status),COALESCE(NULLIF(btrim(p_provider),''),'manual'),
    NULLIF(btrim(COALESCE(p_provider_reference,'')),''),p_score,
    NULLIF(btrim(COALESCE(p_result_code,'')),''),COALESCE(p_evidence,'{}'::jsonb),
    now(),CASE WHEN lower(p_status) IN ('passed','manual_passed','failed','unavailable') THEN now() END,now()
  ) ON CONFLICT (application_id,check_type) DO UPDATE SET
    status=EXCLUDED.status,provider=EXCLUDED.provider,provider_reference=EXCLUDED.provider_reference,
    score=EXCLUDED.score,result_code=EXCLUDED.result_code,evidence=EXCLUDED.evidence,
    started_at=COALESCE(public.kyc_provider_checks.started_at,now()),
    completed_at=EXCLUDED.completed_at,updated_at=now()
  RETURNING * INTO v_row;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,to_status,reason,snapshot)
  VALUES (
    v_user_id,p_admin_user_id,'provider_check_updated','in_review',NULL,
    jsonb_build_object('applicationId',p_application_id,'checkType',v_row.check_type,
      'status',v_row.status,'provider',v_row.provider,'score',v_row.score)
  );
  RETURN jsonb_build_object('ok',true,'checkType',v_row.check_type,'status',v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_kyc_screening_v3(
  p_admin_user_id uuid,
  p_application_id uuid,
  p_screening_type text,
  p_status text,
  p_provider text,
  p_provider_reference text DEFAULT NULL,
  p_list_version text DEFAULT NULL,
  p_match_score numeric DEFAULT NULL,
  p_match_count integer DEFAULT 0,
  p_result_summary jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
  v_user_id uuid;
  v_row public.kyc_screenings%ROWTYPE;
  v_overall text;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_REVIEWER_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF lower(btrim(COALESCE(p_screening_type,''))) NOT IN ('sanctions','pep','adverse_media')
     OR lower(btrim(COALESCE(p_status,''))) NOT IN
       ('not_run','pending','clear','potential_match','reviewed','confirmed_match','unavailable')
     OR COALESCE(p_match_count,0) < 0
  THEN RAISE EXCEPTION 'KYC_V3_INVALID_SCREENING' USING ERRCODE='P0001'; END IF;

  SELECT user_id INTO v_user_id FROM public.kyc_applications WHERE id=p_application_id FOR UPDATE;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'KYC_V3_APPLICATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.kyc_screenings(
    application_id,screening_type,status,provider,provider_reference,list_version,
    match_score,match_count,result_summary,screened_at,next_screen_at,updated_at
  ) VALUES (
    p_application_id,lower(p_screening_type),lower(p_status),COALESCE(NULLIF(btrim(p_provider),''),'manual'),
    NULLIF(btrim(COALESCE(p_provider_reference,'')),''),NULLIF(btrim(COALESCE(p_list_version,'')),''),
    p_match_score,COALESCE(p_match_count,0),COALESCE(p_result_summary,'{}'::jsonb),now(),now()+interval '1 day',now()
  ) ON CONFLICT (application_id,screening_type) DO UPDATE SET
    status=EXCLUDED.status,provider=EXCLUDED.provider,provider_reference=EXCLUDED.provider_reference,
    list_version=EXCLUDED.list_version,match_score=EXCLUDED.match_score,match_count=EXCLUDED.match_count,
    result_summary=EXCLUDED.result_summary,screened_at=now(),next_screen_at=EXCLUDED.next_screen_at,updated_at=now()
  RETURNING * INTO v_row;

  SELECT CASE
    WHEN bool_or(status='confirmed_match') THEN 'blocked'
    WHEN bool_or(status IN ('potential_match','unavailable','not_run','pending')) THEN 'review'
    ELSE 'clear' END
  INTO v_overall
  FROM public.kyc_screenings WHERE application_id=p_application_id;

  UPDATE public.kyc_applications SET screening_status=v_overall,updated_at=now()
  WHERE id=p_application_id;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,to_status,reason,snapshot)
  VALUES (
    v_user_id,p_admin_user_id,'screening_updated','in_review',NULL,
    jsonb_build_object('applicationId',p_application_id,'screeningType',v_row.screening_type,
      'status',v_row.status,'provider',v_row.provider,'listVersion',v_row.list_version,
      'matchCount',v_row.match_count)
  );
  RETURN jsonb_build_object('ok',true,'screeningType',v_row.screening_type,
    'status',v_row.status,'overallScreeningStatus',v_overall);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_kyc_v3(
  p_admin_user_id uuid,
  p_user_id uuid,
  p_decision text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_role text;
  v_decision text := lower(btrim(COALESCE(p_decision,'')));
  v_reason text := NULLIF(btrim(COALESCE(p_reason,'')),'');
  v_app public.kyc_applications%ROWTYPE;
  v_document_ok boolean;
  v_face_ok boolean;
  v_liveness_ok boolean;
  v_sanctions_ok boolean;
  v_pep_ok boolean;
  v_review_months integer;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_REVIEWER_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF p_user_id IS NULL OR v_decision NOT IN ('approved','rejected','needs_more_info') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_REVIEW' USING ERRCODE='P0001';
  END IF;
  IF v_decision IN ('rejected','needs_more_info') AND v_reason IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_REVIEW_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC:'||p_user_id::text,0));
  SELECT * INTO v_app FROM public.kyc_applications
  WHERE user_id=p_user_id ORDER BY application_version DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_app.schema_version < 3 THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_V3_APPLICATION_NOT_FOUND');
  END IF;
  IF v_app.workflow_status=v_decision THEN
    RETURN jsonb_build_object('ok',true,'status',v_decision,'idempotentReplay',true,
      'applicationId',v_app.id);
  END IF;
  IF v_app.workflow_status NOT IN ('submitted','in_review','needs_more_info') THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_V3_REVIEW_TERMINAL',
      'workflowStatus',v_app.workflow_status);
  END IF;

  IF v_decision='approved' THEN
    SELECT verification_status IN ('verified','manual_verified') INTO v_document_ok
    FROM public.kyc_documents WHERE application_id=v_app.id;
    SELECT status IN ('passed','manual_passed') INTO v_face_ok
    FROM public.kyc_provider_checks WHERE application_id=v_app.id AND check_type='face_match';
    SELECT status IN ('passed','manual_passed') INTO v_liveness_ok
    FROM public.kyc_provider_checks WHERE application_id=v_app.id AND check_type='liveness';
    SELECT status IN ('clear','reviewed') INTO v_sanctions_ok
    FROM public.kyc_screenings WHERE application_id=v_app.id AND screening_type='sanctions';
    SELECT status IN ('clear','reviewed') INTO v_pep_ok
    FROM public.kyc_screenings WHERE application_id=v_app.id AND screening_type='pep';

    IF COALESCE(v_document_ok,false) IS NOT TRUE
       OR COALESCE(v_face_ok,false) IS NOT TRUE
       OR COALESCE(v_liveness_ok,false) IS NOT TRUE
       OR COALESCE(v_sanctions_ok,false) IS NOT TRUE
       OR COALESCE(v_pep_ok,false) IS NOT TRUE
       OR v_app.screening_status='blocked'
    THEN
      RETURN jsonb_build_object(
        'ok',false,'code','KYC_V3_CHECKS_INCOMPLETE','message','Required verification checks are incomplete',
        'documentVerified',COALESCE(v_document_ok,false),'faceMatch',COALESCE(v_face_ok,false),
        'liveness',COALESCE(v_liveness_ok,false),'sanctions',COALESCE(v_sanctions_ok,false),
        'pep',COALESCE(v_pep_ok,false),'screeningStatus',v_app.screening_status
      );
    END IF;

    v_review_months := CASE v_app.risk_tier WHEN 'high' THEN 12 WHEN 'medium' THEN 24 ELSE 36 END;
  END IF;

  UPDATE public.kyc_applications SET
    workflow_status=v_decision,
    reviewed_by=CASE WHEN v_decision IN ('approved','rejected') THEN p_admin_user_id ELSE reviewed_by END,
    reviewed_at=CASE WHEN v_decision IN ('approved','rejected') THEN now() ELSE reviewed_at END,
    decision_reason=v_reason,
    assigned_to=COALESCE(assigned_to,p_admin_user_id),
    assigned_at=COALESCE(assigned_at,now()),
    next_review_at=CASE WHEN v_decision='approved' THEN now()+make_interval(months=>v_review_months) ELSE NULL END,
    updated_at=now()
  WHERE id=v_app.id;

  IF v_decision IN ('approved','rejected') THEN
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
    UPDATE public.kyc_profiles SET
      status=v_decision,reviewed_by=p_admin_user_id,reviewed_at=now(),
      rejection_reason=CASE WHEN v_decision='rejected' THEN v_reason ELSE NULL END,updated_at=now()
    WHERE user_id=p_user_id;
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  ELSE
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
    UPDATE public.kyc_profiles SET status='pending',rejection_reason=v_reason,updated_at=now()
    WHERE user_id=p_user_id;
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  END IF;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES (
    p_user_id,p_admin_user_id,v_decision,
    CASE WHEN v_app.workflow_status='rejected' THEN 'rejected'
         WHEN v_app.workflow_status='approved' THEN 'approved' ELSE 'pending' END,
    CASE WHEN v_decision='needs_more_info' THEN 'needs_more_info' ELSE v_decision END,
    v_reason,jsonb_build_object('applicationId',v_app.id,'riskTier',v_app.risk_tier,
      'screeningStatus',v_app.screening_status,'schemaVersion',v_app.schema_version)
  );

  RETURN jsonb_build_object(
    'ok',true,'status',CASE WHEN v_decision='needs_more_info' THEN 'pending' ELSE v_decision END,
    'workflowStatus',v_decision,'applicationId',v_app.id,'idempotentReplay',false,
    'riskTier',v_app.risk_tier,'nextReviewAt',
      CASE WHEN v_decision='approved' THEN now()+make_interval(months=>v_review_months) END
  );
END;
$$;

-- Backfill legacy approved/pending/rejected users into the versioned timeline.
INSERT INTO public.kyc_applications(
  user_id,application_version,schema_version,policy_version,workflow_status,
  assurance_level,verification_mode,full_name,dob,nationality,country_of_birth,
  residence_country,address_line1,city,employment_status,occupation,source_of_funds,
  account_purpose,expected_monthly_volume_band,pep_self_declared,pep_related_declared,
  risk_tier,screening_status,provider_status,submitted_at,reviewed_by,reviewed_at,
  decision_reason,metadata,created_at,updated_at
)
SELECT
  kp.user_id,1,2,3,
  CASE kp.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'submitted' END,
  'legacy','manual',COALESCE(NULLIF(kp."fullName",''),'Legacy KYC'),
  COALESCE(kp.dob,DATE '1900-01-01'),'SS','SS','SS',COALESCE(NULLIF(kp.address,''),'Legacy KYC'),
  'Unknown','legacy','legacy',jsonb_build_array('legacy'),'legacy','legacy',false,false,
  'unassessed','pending','pending',COALESCE(kp.created_at,now()),kp.reviewed_by,kp.reviewed_at,
  kp.rejection_reason,jsonb_build_object('backfilledFrom','kyc_profiles','requiresReverification',true),
  COALESCE(kp.created_at,now()),COALESCE(kp.updated_at,now())
FROM public.kyc_profiles kp
WHERE NOT EXISTS (SELECT 1 FROM public.kyc_applications a WHERE a.user_id=kp.user_id);

-- Protect KYC v3 evidence from direct client access. Backend service role is the
-- only data-plane actor; user-facing endpoints return sanitized projections.
ALTER TABLE public.kyc_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_provider_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_risk_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_provider_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kyc_policy_versions FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_applications FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_upload_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_documents FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_provider_checks FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_screenings FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_risk_assessments FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_consents FROM PUBLIC;
REVOKE ALL ON TABLE public.kyc_provider_webhook_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_kyc_v3(uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_kyc_provider_check_v3(uuid,uuid,text,text,text,text,numeric,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_kyc_screening_v3(uuid,uuid,text,text,text,text,text,numeric,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text) FROM PUBLIC;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_policy_versions FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_applications FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_upload_sessions FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_documents FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_provider_checks FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_screenings FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_risk_assessments FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_consents FROM %I',r);
      EXECUTE format('REVOKE ALL ON TABLE public.kyc_provider_webhook_events FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.submit_kyc_v3(uuid,jsonb,jsonb,jsonb,jsonb) FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text) FROM %I',r);
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON public.kyc_policy_versions TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_applications TO service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.kyc_upload_sessions TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_documents TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_provider_checks TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_screenings TO service_role;
    GRANT SELECT,INSERT ON public.kyc_risk_assessments TO service_role;
    GRANT SELECT,INSERT ON public.kyc_consents TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_provider_webhook_events TO service_role;
    GRANT EXECUTE ON FUNCTION public.submit_kyc_v3(uuid,jsonb,jsonb,jsonb,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.set_kyc_provider_check_v3(uuid,uuid,text,text,text,text,numeric,text,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.set_kyc_screening_v3(uuid,uuid,text,text,text,text,text,numeric,integer,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE public.kyc_applications IS
  'Versioned KYC applications. Never overwrite prior identity-proofing decisions when re-verifying a user.';
COMMENT ON TABLE public.kyc_documents IS
  'Protected government-identity evidence metadata. Document number is application-encrypted; raw storage paths are never user-facing.';
COMMENT ON TABLE public.kyc_screenings IS
  'Provider-neutral PEP, sanctions and adverse-media screening results with list/provider version evidence.';
COMMENT ON TABLE public.kyc_provider_checks IS
  'Provider-neutral document authenticity, document presence, face-match and liveness checks.';

COMMIT;
