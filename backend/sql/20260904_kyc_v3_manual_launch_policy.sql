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

-- Extend the existing controlled check RPC so face_match is recorded through
-- the same permissioned/audited path as every other KYC check. The current-state
-- compatibility profile has no separate face-match column; approval reads the
-- immutable check evidence directly from kyc_checks_v3.
CREATE OR REPLACE FUNCTION public.record_kyc_check_v3(
  p_admin_user_id uuid,p_user_id uuid,p_check_type text,p_status text,p_provider text DEFAULT NULL,
  p_provider_reference text DEFAULT NULL,p_notes text DEFAULT NULL,p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE
  v_role text; v_profile public.kyc_profiles%ROWTYPE; v_check_type text:=lower(btrim(COALESCE(p_check_type,'')));
  v_status text:=lower(btrim(COALESCE(p_status,''))); v_check_id uuid; v_new_workflow text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN('admin','super_admin','kyc_officer') THEN RAISE EXCEPTION 'KYC_V3_CHECK_NOT_AUTHORIZED' USING ERRCODE='P0001'; END IF;
  IF v_check_type NOT IN('document_verification','face_match','liveness','sanctions','pep','adverse_media','proof_of_address')
     OR v_status NOT IN('pending','verified','manual_verified','clear','manual_clear','potential_match','confirmed_match','confirmed_pep','failed','inconclusive','not_applicable')
     OR jsonb_typeof(COALESCE(p_details,'{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'KYC_V3_INVALID_CHECK' USING ERRCODE='P0001'; END IF;
  SELECT * INTO v_profile FROM public.kyc_profiles WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.current_application_id IS NULL THEN RAISE EXCEPTION 'KYC_V3_APPLICATION_NOT_FOUND' USING ERRCODE='P0001'; END IF;
  IF COALESCE(v_profile.workflow_status,v_profile.status) NOT IN('submitted','in_review','needs_more_info') THEN RAISE EXCEPTION 'KYC_V3_APPLICATION_NOT_REVIEWABLE' USING ERRCODE='P0001'; END IF;

  INSERT INTO public.kyc_checks_v3(application_id,user_id,check_type,status,provider,provider_reference,performed_by,notes,details)
  VALUES(v_profile.current_application_id,p_user_id,v_check_type,v_status,NULLIF(btrim(COALESCE(p_provider,'')),''),NULLIF(btrim(COALESCE(p_provider_reference,'')),''),p_admin_user_id,
    NULLIF(left(btrim(COALESCE(p_notes,'')),1000),''),COALESCE(p_details,'{}'::jsonb)) RETURNING id INTO v_check_id;
  v_new_workflow:=CASE WHEN COALESCE(v_profile.workflow_status,v_profile.status)='submitted' THEN 'in_review' ELSE COALESCE(v_profile.workflow_status,v_profile.status) END;

  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  UPDATE public.kyc_profiles SET identity_verification_status=CASE WHEN v_check_type='document_verification' THEN v_status ELSE identity_verification_status END,
    liveness_status=CASE WHEN v_check_type='liveness' THEN v_status ELSE liveness_status END,sanctions_status=CASE WHEN v_check_type='sanctions' THEN v_status ELSE sanctions_status END,
    pep_screening_status=CASE WHEN v_check_type='pep' THEN v_status ELSE pep_screening_status END,adverse_media_status=CASE WHEN v_check_type='adverse_media' THEN v_status ELSE adverse_media_status END,
    workflow_status=v_new_workflow,required_action=CASE WHEN v_check_type='sanctions' AND v_status IN('potential_match','confirmed_match') THEN 'sanctions_review'
      WHEN v_check_type='pep' AND v_status IN('potential_match','confirmed_pep') THEN 'pep_review' ELSE required_action END,updated_at=now() WHERE user_id=p_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);
  UPDATE public.kyc_applications_v3 SET workflow_status=v_new_workflow,updated_at=now() WHERE id=v_profile.current_application_id;

  IF v_check_type='sanctions' AND v_status='confirmed_match' THEN
    PERFORM public.set_compliance_entity_control_v1(p_admin_user_id,'USER',p_user_id::text,'frozen','Confirmed sanctions match during KYC',NULL);
  ELSIF (v_check_type='sanctions' AND v_status='potential_match') OR (v_check_type='pep' AND v_status IN('potential_match','confirmed_pep')) THEN
    PERFORM public.set_compliance_entity_control_v1(p_admin_user_id,'USER',p_user_id::text,'review','KYC screening requires compliance review',NULL);
  END IF;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES(p_user_id,p_admin_user_id,'check_recorded',COALESCE(v_profile.workflow_status,v_profile.status),v_new_workflow,NULLIF(left(btrim(COALESCE(p_notes,'')),500),''),
    jsonb_build_object('applicationId',v_profile.current_application_id,'checkId',v_check_id,'checkType',v_check_type,'status',v_status,'provider',p_provider));
  RETURN jsonb_build_object('ok',true,'checkId',v_check_id,'checkType',v_check_type,'status',v_status,'workflowStatus',v_new_workflow);
END $$;

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

  IF NEW.check_type='face_match' AND NEW.status='verified' THEN
    IF NULLIF(btrim(COALESCE(NEW.provider,'')),'') IS NULL
       OR lower(btrim(NEW.provider))='manual'
       OR NULLIF(btrim(COALESCE(NEW.provider_reference,'')),'') IS NULL THEN
      RAISE EXCEPTION 'KYC_V3_PROVIDER_FACE_MATCH_REFERENCE_REQUIRED' USING ERRCODE='P0001';
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

  -- Automated/provider biometric checks may use status=verified, but a reviewer
  -- may not label a manual check as provider-verified to bypass evidence.
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
