BEGIN;

-- Phase 5.3 integrity follow-up. This is kept separate from the foundation so
-- rollback can disable V3 enforcement without destroying historical evidence.

ALTER TABLE public.kyc_provider_checks
  DROP CONSTRAINT IF EXISTS kyc_provider_checks_type_check;
ALTER TABLE public.kyc_provider_checks
  ADD CONSTRAINT kyc_provider_checks_type_check CHECK (
    check_type IN (
      'document_authenticity','document_presence','face_match','liveness',
      'address','database_identity','enhanced_due_diligence'
    )
  );

CREATE OR REPLACE FUNCTION public.reject_kyc_v3_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'KYC_V3_IMMUTABLE_EVIDENCE' USING ERRCODE='P0001';
END;
$$;

DROP TRIGGER IF EXISTS kyc_consents_immutable_v3 ON public.kyc_consents;
CREATE TRIGGER kyc_consents_immutable_v3
BEFORE UPDATE OR DELETE ON public.kyc_consents
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

DROP TRIGGER IF EXISTS kyc_risk_assessments_immutable_v3 ON public.kyc_risk_assessments;
CREATE TRIGGER kyc_risk_assessments_immutable_v3
BEFORE UPDATE OR DELETE ON public.kyc_risk_assessments
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

CREATE OR REPLACE FUNCTION public.guard_kyc_application_identity_v3()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.application_version IS DISTINCT FROM OLD.application_version
     OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.full_name IS DISTINCT FROM OLD.full_name
     OR NEW.dob IS DISTINCT FROM OLD.dob
     OR NEW.nationality IS DISTINCT FROM OLD.nationality
     OR NEW.country_of_birth IS DISTINCT FROM OLD.country_of_birth
     OR NEW.residence_country IS DISTINCT FROM OLD.residence_country
     OR NEW.address_line1 IS DISTINCT FROM OLD.address_line1
     OR NEW.address_line2 IS DISTINCT FROM OLD.address_line2
     OR NEW.city IS DISTINCT FROM OLD.city
     OR NEW.region IS DISTINCT FROM OLD.region
     OR NEW.postal_code IS DISTINCT FROM OLD.postal_code
     OR NEW.employment_status IS DISTINCT FROM OLD.employment_status
     OR NEW.occupation IS DISTINCT FROM OLD.occupation
     OR NEW.employer_name IS DISTINCT FROM OLD.employer_name
     OR NEW.source_of_funds IS DISTINCT FROM OLD.source_of_funds
     OR NEW.source_of_wealth IS DISTINCT FROM OLD.source_of_wealth
     OR NEW.account_purpose IS DISTINCT FROM OLD.account_purpose
     OR NEW.expected_monthly_volume_band IS DISTINCT FROM OLD.expected_monthly_volume_band
     OR NEW.expected_monthly_tx_count_band IS DISTINCT FROM OLD.expected_monthly_tx_count_band
     OR NEW.pep_self_declared IS DISTINCT FROM OLD.pep_self_declared
     OR NEW.pep_related_declared IS DISTINCT FROM OLD.pep_related_declared
     OR NEW.tax_residencies IS DISTINCT FROM OLD.tax_residencies
     OR NEW.supersedes_application_id IS DISTINCT FROM OLD.supersedes_application_id
  THEN
    RAISE EXCEPTION 'KYC_V3_APPLICATION_IDENTITY_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kyc_applications_identity_guard_v3 ON public.kyc_applications;
CREATE TRIGGER kyc_applications_identity_guard_v3
BEFORE UPDATE ON public.kyc_applications
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_application_identity_v3();

CREATE OR REPLACE FUNCTION public.guard_kyc_document_identity_v3()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.application_id IS DISTINCT FROM OLD.application_id
     OR NEW.document_type IS DISTINCT FROM OLD.document_type
     OR NEW.issuing_country IS DISTINCT FROM OLD.issuing_country
     OR NEW.document_number_ciphertext IS DISTINCT FROM OLD.document_number_ciphertext
     OR NEW.document_number_fingerprint IS DISTINCT FROM OLD.document_number_fingerprint
     OR NEW.document_number_last4 IS DISTINCT FROM OLD.document_number_last4
     OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
     OR NEW.expiry_date IS DISTINCT FROM OLD.expiry_date
     OR NEW.no_expiry IS DISTINCT FROM OLD.no_expiry
     OR NEW.front_path IS DISTINCT FROM OLD.front_path
     OR NEW.back_path IS DISTINCT FROM OLD.back_path
     OR NEW.capture_method IS DISTINCT FROM OLD.capture_method
  THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_IDENTITY_IMMUTABLE' USING ERRCODE='P0001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kyc_documents_identity_guard_v3 ON public.kyc_documents;
CREATE TRIGGER kyc_documents_identity_guard_v3
BEFORE UPDATE ON public.kyc_documents
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_document_identity_v3();

DROP TRIGGER IF EXISTS kyc_documents_delete_guard_v3 ON public.kyc_documents;
CREATE TRIGGER kyc_documents_delete_guard_v3
BEFORE DELETE ON public.kyc_documents
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_v3_immutable_mutation();

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
  v_provider_status text;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_REVIEWER_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;
  IF lower(btrim(COALESCE(p_check_type,''))) NOT IN (
      'document_authenticity','document_presence','face_match','liveness',
      'address','database_identity','enhanced_due_diligence'
     )
     OR lower(btrim(COALESCE(p_status,''))) NOT IN
      ('not_run','pending','passed','manual_passed','review','failed','unavailable')
     OR jsonb_typeof(COALESCE(p_evidence,'{}'::jsonb)) <> 'object'
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

  IF v_row.check_type='document_authenticity' THEN
    UPDATE public.kyc_documents SET
      verification_status=CASE v_row.status
        WHEN 'passed' THEN 'verified'
        WHEN 'manual_passed' THEN 'manual_verified'
        WHEN 'failed' THEN 'failed'
        WHEN 'unavailable' THEN 'unavailable'
        ELSE 'pending' END,
      verification_provider=v_row.provider,
      provider_reference=v_row.provider_reference,
      updated_at=now()
    WHERE application_id=p_application_id;
  END IF;

  SELECT CASE
    WHEN bool_or(status='failed') THEN 'failed'
    WHEN bool_and(status IN ('passed','manual_passed')) FILTER (
      WHERE check_type IN ('document_authenticity','face_match','liveness')
    ) THEN 'verified'
    WHEN bool_or(status IN ('pending','review')) THEN 'in_progress'
    WHEN bool_or(status='unavailable') THEN 'unavailable'
    ELSE 'pending' END
  INTO v_provider_status
  FROM public.kyc_provider_checks WHERE application_id=p_application_id;

  UPDATE public.kyc_applications SET provider_status=COALESCE(v_provider_status,'pending'),updated_at=now()
  WHERE id=p_application_id;

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,to_status,reason,snapshot)
  VALUES (
    v_user_id,p_admin_user_id,'provider_check_updated','in_review',NULL,
    jsonb_build_object('applicationId',p_application_id,'checkType',v_row.check_type,
      'status',v_row.status,'provider',v_row.provider,'score',v_row.score)
  );
  RETURN jsonb_build_object('ok',true,'checkType',v_row.check_type,'status',v_row.status,
    'providerStatus',v_provider_status);
END;
$$;

-- Seed the EDD placeholder for all V3 applications that require it.
INSERT INTO public.kyc_provider_checks(application_id,check_type,status,provider)
SELECT id,'enhanced_due_diligence','not_run','manual'
FROM public.kyc_applications
WHERE schema_version>=3 AND edd_required=true
ON CONFLICT (application_id,check_type) DO NOTHING;

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
  v_edd_ok boolean := true;
  v_review_months integer;
  v_next_review timestamptz;
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
    IF v_app.edd_required THEN
      SELECT status IN ('passed','manual_passed') INTO v_edd_ok
      FROM public.kyc_provider_checks
      WHERE application_id=v_app.id AND check_type='enhanced_due_diligence';
    END IF;

    IF COALESCE(v_document_ok,false) IS NOT TRUE
       OR COALESCE(v_face_ok,false) IS NOT TRUE
       OR COALESCE(v_liveness_ok,false) IS NOT TRUE
       OR COALESCE(v_sanctions_ok,false) IS NOT TRUE
       OR COALESCE(v_pep_ok,false) IS NOT TRUE
       OR COALESCE(v_edd_ok,false) IS NOT TRUE
       OR v_app.screening_status='blocked'
    THEN
      RETURN jsonb_build_object(
        'ok',false,'code','KYC_V3_CHECKS_INCOMPLETE','message','Required verification checks are incomplete',
        'documentVerified',COALESCE(v_document_ok,false),'faceMatch',COALESCE(v_face_ok,false),
        'liveness',COALESCE(v_liveness_ok,false),'sanctions',COALESCE(v_sanctions_ok,false),
        'pep',COALESCE(v_pep_ok,false),'edd',COALESCE(v_edd_ok,false),
        'screeningStatus',v_app.screening_status
      );
    END IF;

    v_review_months := CASE v_app.risk_tier WHEN 'high' THEN 12 WHEN 'medium' THEN 24 ELSE 36 END;
    v_next_review := now()+make_interval(months=>v_review_months);
  END IF;

  UPDATE public.kyc_applications SET
    workflow_status=v_decision,
    reviewed_by=CASE WHEN v_decision IN ('approved','rejected') THEN p_admin_user_id ELSE reviewed_by END,
    reviewed_at=CASE WHEN v_decision IN ('approved','rejected') THEN now() ELSE reviewed_at END,
    decision_reason=v_reason,
    assigned_to=COALESCE(assigned_to,p_admin_user_id),
    assigned_at=COALESCE(assigned_at,now()),
    next_review_at=CASE WHEN v_decision='approved' THEN v_next_review ELSE NULL END,
    updated_at=now()
  WHERE id=v_app.id;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  UPDATE public.kyc_profiles SET
    status=CASE WHEN v_decision='approved' THEN 'approved'
                WHEN v_decision='rejected' THEN 'rejected' ELSE 'pending' END,
    reviewed_by=CASE WHEN v_decision IN ('approved','rejected') THEN p_admin_user_id ELSE reviewed_by END,
    reviewed_at=CASE WHEN v_decision IN ('approved','rejected') THEN now() ELSE reviewed_at END,
    rejection_reason=CASE WHEN v_decision IN ('rejected','needs_more_info') THEN v_reason ELSE NULL END,
    updated_at=now()
  WHERE user_id=p_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES (
    p_user_id,p_admin_user_id,v_decision,
    CASE WHEN v_app.workflow_status='rejected' THEN 'rejected'
         WHEN v_app.workflow_status='approved' THEN 'approved' ELSE 'pending' END,
    CASE WHEN v_decision='needs_more_info' THEN 'needs_more_info' ELSE v_decision END,
    v_reason,jsonb_build_object('applicationId',v_app.id,'riskTier',v_app.risk_tier,
      'screeningStatus',v_app.screening_status,'schemaVersion',v_app.schema_version,
      'nextReviewAt',v_next_review)
  );

  RETURN jsonb_build_object(
    'ok',true,'status',CASE WHEN v_decision='needs_more_info' THEN 'pending' ELSE v_decision END,
    'workflowStatus',v_decision,'applicationId',v_app.id,'idempotentReplay',false,
    'riskTier',v_app.risk_tier,'nextReviewAt',v_next_review
  );
END;
$$;

-- Unknown legacy country data must never be misrepresented as South Sudan.
UPDATE public.kyc_applications
SET nationality='ZZ',country_of_birth='ZZ',residence_country='ZZ',updated_at=now()
WHERE schema_version=2
  AND metadata->>'backfilledFrom'='kyc_profiles'
  AND nationality='SS' AND country_of_birth='SS' AND residence_country='SS';

CREATE OR REPLACE VIEW public.kyc_due_diligence_queue_v3 AS
SELECT
  a.id AS application_id,
  a.user_id,
  a.workflow_status,
  a.risk_tier,
  a.edd_required,
  a.next_review_at,
  min(s.next_screen_at) AS next_screen_at,
  bool_or(s.status IN ('potential_match','confirmed_match','unavailable')) AS screening_attention
FROM public.kyc_applications a
LEFT JOIN public.kyc_screenings s ON s.application_id=a.id
WHERE a.workflow_status='approved'
GROUP BY a.id,a.user_id,a.workflow_status,a.risk_tier,a.edd_required,a.next_review_at;

REVOKE ALL ON public.kyc_due_diligence_queue_v3 FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON public.kyc_due_diligence_queue_v3 FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON public.kyc_due_diligence_queue_v3 FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT ON public.kyc_due_diligence_queue_v3 TO service_role;
  END IF;
END;
$$;

COMMIT;
