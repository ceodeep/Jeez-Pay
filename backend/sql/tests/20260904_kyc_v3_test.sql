\pset pager off
\echo '=== KYC V3 INTERNATIONAL TESTS ==='
\echo 'ROLLBACK-ONLY: versioning, checks, EDD, scalable claiming, retention, periodic review, privacy and compliance hooks.'

BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

DO $$
DECLARE
  v_user_id uuid;
  v_admin_id uuid;
  v_kyc_officer_id uuid;
  v_payload jsonb;
  v_result jsonb;
  v_application_id uuid;
  v_failed boolean;
  v_marked integer;
BEGIN
  -- Always create a synthetic customer inside this transaction. This avoids
  -- borrowing or mutating a real customer's KYC state. ROLLBACK removes it.
  v_user_id := gen_random_uuid();

  INSERT INTO public.users(
    id,phone,email,"fullName",password_hash,phone_verified,email_verified,
    account_type,country_code,terms_accepted,role,referral_code,is_active,is_system
  ) VALUES (
    v_user_id,
    '+211999' || right(replace(v_user_id::text,'-',''),8),
    lower(replace(v_user_id::text,'-','')) || '@kyc-v3-rollback.invalid',
    'KYC V3 Rollback Test User',
    'ROLLBACK_ONLY_NOT_LOGINABLE',
    false,true,'personal','SS',true,'user',
    'T' || upper(substr(replace(v_user_id::text,'-',''),1,5)),
    true,false
  );

  SELECT id INTO v_admin_id FROM public.users
  WHERE role IN('super_admin','admin') AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false
  ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END,id LIMIT 1;
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_ACTIVE_ADMIN'; END IF;

  SELECT id INTO v_kyc_officer_id FROM public.users
  WHERE role='kyc_officer' AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false LIMIT 1;
  IF v_kyc_officer_id IS NULL THEN v_kyc_officer_id:=v_admin_id; END IF;

  v_payload:=jsonb_build_object(
    'schemaVersion',3,
    'fullName','KYC V3 Rollback Test User',
    'dob','1995-05-15',
    'nationality','SS',
    'countryOfBirth','SS',
    'residenceCountry','SS',
    'addressLine1','Rollback Test Address',
    'addressLine2',NULL,
    'city','Juba',
    'region','Central Equatoria',
    'postalCode',NULL,
    'employmentStatus','employed',
    'occupation','Software tester',
    'employerName','KYC V3 Test',
    'sourceOfFunds',jsonb_build_array('salary'),
    'sourceOfWealth',NULL,
    'accountPurpose','personal_payments',
    'expectedMonthlyVolumeBand','standard',
    'expectedMonthlyTxCountBand','1_20',
    'pepSelfDeclared',false,
    'pepRelatedDeclared',false,
    'taxResidencies',jsonb_build_array('SS'),
    'document',jsonb_build_object(
      'documentType','passport','issuingCountry','SS','documentNumber','ROLLBACK-TEST-0001',
      'issueDate','2024-01-01','expiryDate','2034-01-01','noExpiry',false,
      'frontPath',v_user_id::text||'/id_front_test.jpg','backPath',NULL,'selfiePath',v_user_id::text||'/selfie_test.jpg'
    ),
    'consents',jsonb_build_object(
      'privacyAccepted',true,'identityVerificationAccepted',true,'biometricAccepted',true,'ongoingScreeningAccepted',true,
      'privacyNoticeVersion','2026-09-v1','biometricNoticeVersion','2026-09-v1'
    )
  );

  v_result:=public.submit_kyc_v3(v_user_id,v_payload,'127.0.0.1','KYC-V3-ROLLBACK-TEST');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'workflowStatus'<>'submitted' THEN
    RAISE EXCEPTION 'INITIAL_SUBMISSION_FAILED: %',v_result;
  END IF;
  v_application_id:=(v_result->>'applicationId')::uuid;

  IF (SELECT count(*) FROM public.kyc_applications_v3 WHERE id=v_application_id)<>1 THEN RAISE EXCEPTION 'APPLICATION_MISSING'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.kyc_applications_v3 WHERE id=v_application_id AND review_seq IS NOT NULL) THEN RAISE EXCEPTION 'REVIEW_SEQUENCE_MISSING'; END IF;
  IF (SELECT count(*) FROM public.kyc_retention_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'RETENTION_RECORD_MISSING'; END IF;
  IF (SELECT count(*) FROM public.kyc_documents_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'DOCUMENT_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_documents_v3 WHERE application_id=v_application_id AND document_number_hash IS NULL) THEN RAISE EXCEPTION 'DOCUMENT_HASH_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kyc_documents_v3' AND column_name='document_number') THEN RAISE EXCEPTION 'RAW_DOCUMENT_NUMBER_COLUMN_FORBIDDEN'; END IF;
  IF (SELECT count(*) FROM public.kyc_consents_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'CONSENT_MISSING'; END IF;
  IF (SELECT count(*) FROM public.kyc_risk_assessments_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'RISK_ASSESSMENT_MISSING'; END IF;

  IF (
    SELECT COALESCE(array_agg(job_type ORDER BY job_type),ARRAY[]::text[])
    FROM public.kyc_provider_jobs_v3
    WHERE application_id=v_application_id
  ) IS DISTINCT FROM (
    SELECT COALESCE(array_agg(v.job_type ORDER BY v.job_type) FILTER (WHERE v.required),ARRAY[]::text[])
    FROM public.kyc_policy_versions_v3 p
    CROSS JOIN LATERAL (
      VALUES
        ('document_verification'::text,p.require_document_verification),
        ('liveness'::text,p.require_liveness),
        ('sanctions'::text,p.require_sanctions_screening),
        ('pep'::text,p.require_pep_screening),
        ('adverse_media'::text,p.require_adverse_media_screening)
    ) AS v(job_type,required)
    WHERE p.active=true
  ) THEN
    RAISE EXCEPTION 'REQUIRED_PROVIDER_JOB_SET_MISMATCH';
  END IF;

  -- Atomic reviewer assignment and queue-state transition.
  v_result:=public.claim_kyc_application_v3(v_kyc_officer_id,v_application_id);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'workflowStatus'<>'in_review' THEN
    RAISE EXCEPTION 'CLAIM_FAILED: %',v_result;
  END IF;

  -- Approval before verification must fail closed.
  v_result:=public.review_kyc_v3(v_admin_id,v_user_id,'approved',NULL,NULL);
  IF v_result->>'code'<>'DOCUMENT_VERIFICATION_REQUIRED' THEN RAISE EXCEPTION 'APPROVAL_DID_NOT_FAIL_CLOSED: %',v_result; END IF;

  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'document_verification','manual_verified','manual',NULL,'Rollback manual document verification','{}');
  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'liveness','manual_verified','manual',NULL,'Rollback manual liveness verification','{}');
  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'sanctions','manual_clear','manual',NULL,'Rollback sanctions clear','{}');
  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'pep','manual_clear','manual',NULL,'Rollback PEP clear','{}');

  -- Needs-more-info must preserve history and permit a new application version.
  v_result:=public.review_kyc_v3(v_kyc_officer_id,v_user_id,'needs_more_info','Please confirm your residential address','address_confirmation');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'workflowStatus'<>'needs_more_info' THEN RAISE EXCEPTION 'NEEDS_MORE_INFO_FAILED: %',v_result; END IF;

  v_result:=public.submit_kyc_v3(v_user_id,v_payload,'127.0.0.1','KYC-V3-ROLLBACK-TEST');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR (v_result->>'applicationVersion')::integer<>2 THEN RAISE EXCEPTION 'RESUBMISSION_VERSIONING_FAILED: %',v_result; END IF;
  v_application_id:=(v_result->>'applicationId')::uuid;
  IF (SELECT count(*) FROM public.kyc_retention_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'RESUBMISSION_RETENTION_RECORD_MISSING'; END IF;

  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'document_verification','manual_verified','manual',NULL,'Rollback document verification','{}');
  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'liveness','manual_verified','manual',NULL,'Rollback liveness verification','{}');
  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'sanctions','manual_clear','manual',NULL,'Rollback sanctions clear','{}');
  PERFORM public.record_kyc_check_v3(v_kyc_officer_id,v_user_id,'pep','manual_clear','manual',NULL,'Rollback PEP clear','{}');

  v_result:=public.review_kyc_v3(v_kyc_officer_id,v_user_id,'approved',NULL,NULL);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'status'<>'approved' OR v_result->>'nextReviewAt' IS NULL THEN
    RAISE EXCEPTION 'STANDARD_APPROVAL_FAILED: %',v_result;
  END IF;

  -- Approved current application cannot be silently overwritten.
  v_result:=public.submit_kyc_v3(v_user_id,v_payload,'127.0.0.1','KYC-V3-ROLLBACK-TEST');
  IF v_result->>'code'<>'KYC_ALREADY_APPROVED' THEN RAISE EXCEPTION 'APPROVED_RESUBMISSION_NOT_BLOCKED: %',v_result; END IF;

  -- Immutable customer evidence and privileged-access evidence.
  v_failed:=false;
  BEGIN
    UPDATE public.kyc_consents_v3 SET privacy_notice_version='tampered' WHERE application_id=v_application_id;
  EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'CONSENT_IMMUTABILITY_FAILED'; END IF;

  INSERT INTO public.kyc_evidence_access_log_v3(application_id,user_id,admin_user_id,action,reason,ip_address,user_agent)
  VALUES(v_application_id,v_user_id,v_admin_id,'DETAIL_VIEW','Rollback access audit','127.0.0.1','KYC-V3-ROLLBACK-TEST');
  v_failed:=false;
  BEGIN
    UPDATE public.kyc_evidence_access_log_v3 SET reason='tampered' WHERE application_id=v_application_id;
  EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'ACCESS_AUDIT_IMMUTABILITY_FAILED'; END IF;

  -- Legal hold is explicit and reversible by an authorized senior admin.
  v_result:=public.set_kyc_legal_hold_v3(v_admin_id,v_application_id,true,'Rollback legal hold test');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR COALESCE((v_result->>'legalHold')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEGAL_HOLD_ENABLE_FAILED: %',v_result;
  END IF;
  v_result:=public.set_kyc_legal_hold_v3(v_admin_id,v_application_id,false,NULL);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR COALESCE((v_result->>'legalHold')::boolean,true) IS NOT FALSE THEN
    RAISE EXCEPTION 'LEGAL_HOLD_DISABLE_FAILED: %',v_result;
  END IF;

  -- Retention candidates require an ended relationship, elapsed minimum period and no hold.
  UPDATE public.kyc_retention_v3
  SET relationship_ended_at=now()-interval '10 years',minimum_retain_until=now()-interval '1 day'
  WHERE application_id=v_application_id;
  IF NOT EXISTS(SELECT 1 FROM public.kyc_purge_candidates_v3(100) p WHERE p.application_id=v_application_id) THEN
    RAISE EXCEPTION 'PURGE_CANDIDATE_POLICY_FAILED';
  END IF;

  -- Periodic-review expiry is batch-safe and sends the customer to compliance review.
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  UPDATE public.kyc_profiles SET next_review_at=now()-interval '31 days' WHERE user_id=v_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);
  UPDATE public.kyc_applications_v3 SET next_review_at=now()-interval '31 days' WHERE id=v_application_id;

  v_marked:=public.mark_kyc_periodic_reviews_due_v3(100);
  IF v_marked<1 OR NOT EXISTS(SELECT 1 FROM public.kyc_profiles WHERE user_id=v_user_id AND status='pending' AND workflow_status='expired' AND required_action='periodic_review') THEN
    RAISE EXCEPTION 'PERIODIC_REVIEW_EXPIRY_FAILED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.compliance_entity_controls WHERE entity_type='USER' AND entity_ref=v_user_id::text AND status='review') THEN
    RAISE EXCEPTION 'PERIODIC_REVIEW_COMPLIANCE_HOOK_FAILED';
  END IF;

  -- Compliance hook: confirmed sanctions match must freeze the entity.
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  UPDATE public.kyc_profiles SET status='pending',workflow_status='in_review' WHERE user_id=v_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);
  UPDATE public.kyc_applications_v3 SET workflow_status='in_review' WHERE id=v_application_id;

  PERFORM public.record_kyc_check_v3(v_admin_id,v_user_id,'sanctions','confirmed_match','manual',NULL,'Rollback confirmed match','{}');
  IF NOT EXISTS(SELECT 1 FROM public.compliance_entity_controls WHERE entity_type='USER' AND entity_ref=v_user_id::text AND status='frozen') THEN
    RAISE EXCEPTION 'SANCTIONS_FREEZE_HOOK_FAILED';
  END IF;

  RAISE NOTICE 'KYC V3 INTERNATIONAL TESTS: OK';
END $$;

\echo ''
\echo '=== TEMPORARY KYC V3 COUNTS ==='
SELECT workflow_status,count(*) FROM public.kyc_applications_v3 GROUP BY workflow_status ORDER BY workflow_status;
SELECT check_type,status,count(*) FROM public.kyc_checks_v3 GROUP BY check_type,status ORDER BY check_type,status;
SELECT event_type,count(*) FROM public.kyc_review_events GROUP BY event_type ORDER BY event_type;
SELECT action,count(*) FROM public.kyc_evidence_access_log_v3 GROUP BY action ORDER BY action;

ROLLBACK;
