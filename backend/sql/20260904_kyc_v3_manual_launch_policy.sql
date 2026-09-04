BEGIN;

-- KYC v3 manual-launch policy (Option A).
-- Standard-risk onboarding remains strict on document review, selfie-to-ID face
-- comparison, sanctions and PEP screening. True liveness is conditional for
-- enhanced-due-diligence (high-risk / PEP) cases until an automated provider
-- is enabled later through a policy change.

DO $$
BEGIN
  IF to_regclass('public.kyc_policy_versions_v3') IS NULL
     OR to_regclass('public.kyc_applications_v3') IS NULL
     OR to_regclass('public.kyc_checks_v3') IS NULL
     OR to_regprocedure('public.review_kyc_v3(uuid,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_MANUAL_POLICY_FOUNDATION_MISSING' USING ERRCODE='P0001';
  END IF;
END $$;

-- Face-match is distinct from liveness. This lets low/medium-risk customers be
-- reviewed manually without pretending that a static selfie is a live-session
-- check.
ALTER TABLE public.kyc_checks_v3
  DROP CONSTRAINT IF EXISTS kyc_checks_v3_check_type_check;
ALTER TABLE public.kyc_checks_v3
  ADD CONSTRAINT kyc_checks_v3_check_type_check
  CHECK (check_type IN (
    'document_verification','face_match','liveness','sanctions','pep',
    'adverse_media','proof_of_address'
  ));

-- Preserve policy history. V1 stays immutable/historical; V2 is the launch
-- policy. The privacy/biometric notice versions are unchanged because this
-- changes verification mode, not the notices themselves.
UPDATE public.kyc_policy_versions_v3
SET active=false
WHERE active=true;

INSERT INTO public.kyc_policy_versions_v3(
  policy_version,schema_version,policy_code,privacy_notice_version,
  biometric_notice_version,minimum_age,max_upload_bytes,
  require_document_verification,require_liveness,
  require_sanctions_screening,require_pep_screening,
  require_adverse_media_screening,low_risk_review_months,
  medium_risk_review_months,high_risk_review_months,requirements,active,
  effective_at,created_at
)
SELECT
  2,
  schema_version,
  'JEEZPAY-KYC-V3-MANUAL-LAUNCH-2026',
  privacy_notice_version,
  biometric_notice_version,
  minimum_age,
  max_upload_bytes,
  require_document_verification,
  false,
  require_sanctions_screening,
  require_pep_screening,
  require_adverse_media_screening,
  low_risk_review_months,
  medium_risk_review_months,
  high_risk_review_months,
  requirements || jsonb_build_object(
    'manualLaunchPolicy',true,
    'selfieRequiredForAll',true,
    'faceMatchRequiredForAll',true,
    'automatedLivenessRequiredForStandardRisk',false,
    'attendedLivenessRequiredForEnhancedDueDiligence',true,
    'sanctionsScreeningMode','authoritative_public_lists_plus_manual_review',
    'pepScreeningMode','self_declaration_plus_manual_review',
    'paidVerificationProviderRequired',false
  ),
  true,
  now(),
  now()
FROM public.kyc_policy_versions_v3
WHERE policy_version=1
ON CONFLICT (policy_version) DO UPDATE
SET schema_version=EXCLUDED.schema_version,
    policy_code=EXCLUDED.policy_code,
    privacy_notice_version=EXCLUDED.privacy_notice_version,
    biometric_notice_version=EXCLUDED.biometric_notice_version,
    minimum_age=EXCLUDED.minimum_age,
    max_upload_bytes=EXCLUDED.max_upload_bytes,
    require_document_verification=EXCLUDED.require_document_verification,
    require_liveness=EXCLUDED.require_liveness,
    require_sanctions_screening=EXCLUDED.require_sanctions_screening,
    require_pep_screening=EXCLUDED.require_pep_screening,
    require_adverse_media_screening=EXCLUDED.require_adverse_media_screening,
    low_risk_review_months=EXCLUDED.low_risk_review_months,
    medium_risk_review_months=EXCLUDED.medium_risk_review_months,
    high_risk_review_months=EXCLUDED.high_risk_review_months,
    requirements=EXCLUDED.requirements,
    active=true,
    effective_at=EXCLUDED.effective_at;

DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.kyc_policy_versions_v3
    WHERE policy_version=2 AND active=true AND require_liveness=false
  ) THEN
    RAISE EXCEPTION 'KYC_V3_MANUAL_POLICY_ACTIVATION_FAILED' USING ERRCODE='P0001';
  END IF;
END $$;

-- Manual biometric evidence must describe what the reviewer actually did.
CREATE OR REPLACE FUNCTION public.guard_kyc_manual_biometric_evidence_v3()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.check_type='face_match' AND NEW.status='manual_verified' THEN
    IF lower(COALESCE(NULLIF(btrim(NEW.provider),''),'manual')) <> 'manual'
       OR NEW.performed_by IS NULL
       OR COALESCE(NEW.details->'selfieComparedToDocument','false'::jsonb) <> 'true'::jsonb
       OR NULLIF(btrim(COALESCE(NEW.notes,'')),'') IS NULL THEN
      RAISE EXCEPTION 'KYC_V3_MANUAL_FACE_MATCH_EVIDENCE_REQUIRED' USING ERRCODE='P0001';
    END IF;
  END IF;

  IF NEW.check_type='liveness' AND NEW.status='manual_verified' THEN
    IF lower(COALESCE(NULLIF(btrim(NEW.provider),''),'manual')) <> 'manual'
       OR NEW.performed_by IS NULL
       OR COALESCE(NEW.details->'attendedSession','false'::jsonb) <> 'true'::jsonb
       OR NULLIF(btrim(COALESCE(NEW.notes,'')),'') IS NULL THEN
      RAISE EXCEPTION 'KYC_V3_MANUAL_LIVENESS_EVIDENCE_REQUIRED' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Automated/provider liveness may use status=verified, but a reviewer may
  -- not label a manual check as provider-verified to bypass attended-session
  -- evidence.
  IF NEW.check_type='liveness' AND NEW.status='verified' THEN
    IF NULLIF(btrim(COALESCE(NEW.provider,'')),'') IS NULL
       OR lower(btrim(NEW.provider))='manual'
       OR NULLIF(btrim(COALESCE(NEW.provider_reference,'')),'') IS NULL THEN
      RAISE EXCEPTION 'KYC_V3_PROVIDER_LIVENESS_REFERENCE_REQUIRED' USING ERRCODE='P0001';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS kyc_manual_biometric_evidence_guard_v3
  ON public.kyc_checks_v3;
CREATE TRIGGER kyc_manual_biometric_evidence_guard_v3
BEFORE INSERT ON public.kyc_checks_v3
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_manual_biometric_evidence_v3();

-- Approval guard is deliberately database-level so no HTTP route or future
-- worker can bypass it. All new V3 approvals require face comparison. High-risk
-- or PEP approvals additionally require true/provider liveness or an attended
-- manual live session.
CREATE OR REPLACE FUNCTION public.guard_kyc_manual_launch_approval_v3()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_app public.kyc_applications_v3%ROWTYPE;
  v_edd boolean := false;
BEGIN
  IF NEW.status='approved'
     AND OLD.status IS DISTINCT FROM 'approved'
     AND NEW.current_application_id IS NOT NULL THEN

    SELECT * INTO v_app
    FROM public.kyc_applications_v3
    WHERE id=NEW.current_application_id;

    IF FOUND THEN
      IF NOT EXISTS(
        SELECT 1
        FROM public.kyc_checks_v3 c
        WHERE c.application_id=v_app.id
          AND c.check_type='face_match'
          AND (
            c.status='verified'
            OR (
              c.status='manual_verified'
              AND lower(COALESCE(NULLIF(btrim(c.provider),''),'manual'))='manual'
              AND c.performed_by IS NOT NULL
              AND COALESCE(c.details->'selfieComparedToDocument','false'::jsonb)='true'::jsonb
            )
          )
      ) THEN
        RAISE EXCEPTION 'KYC_V3_FACE_MATCH_REQUIRED' USING ERRCODE='P0001';
      END IF;

      v_edd := v_app.risk_rating='high'
        OR v_app.pep_self_declared
        OR v_app.pep_related_declared;

      IF v_edd AND NOT EXISTS(
        SELECT 1
        FROM public.kyc_checks_v3 c
        WHERE c.application_id=v_app.id
          AND c.check_type='liveness'
          AND (
            (
              c.status='verified'
              AND NULLIF(btrim(COALESCE(c.provider,'')),'') IS NOT NULL
              AND lower(btrim(c.provider))<>'manual'
              AND NULLIF(btrim(COALESCE(c.provider_reference,'')),'') IS NOT NULL
            )
            OR (
              c.status='manual_verified'
              AND lower(COALESCE(NULLIF(btrim(c.provider),''),'manual'))='manual'
              AND c.performed_by IS NOT NULL
              AND COALESCE(c.details->'attendedSession','false'::jsonb)='true'::jsonb
            )
          )
      ) THEN
        RAISE EXCEPTION 'KYC_V3_EDD_LIVENESS_REQUIRED' USING ERRCODE='P0001';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS kyc_manual_launch_approval_guard_v3
  ON public.kyc_profiles;
CREATE TRIGGER kyc_manual_launch_approval_guard_v3
BEFORE UPDATE OF status ON public.kyc_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_manual_launch_approval_v3();

COMMENT ON FUNCTION public.guard_kyc_manual_biometric_evidence_v3() IS
  'Prevents manual selfie/face or liveness checks from being marked verified without explicit reviewer evidence.';
COMMENT ON FUNCTION public.guard_kyc_manual_launch_approval_v3() IS
  'Option A launch gate: face match for all V3 approvals; attended/provider liveness only for high-risk/PEP EDD approvals.';

COMMIT;
