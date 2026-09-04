\pset pager off
\echo '=== KYC V3 INTERNATIONAL TESTS ==='
\echo 'ROLLBACK-ONLY: versioning, checks, EDD, review workflow, privacy and compliance hooks.'

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
  v_before_controls integer;
  v_failed boolean;
BEGIN
  SELECT u.id INTO v_user_id
  FROM public.users u
  LEFT JOIN public.kyc_profiles k ON k.user_id=u.id
  WHERE COALESCE(u.is_system,false)=false
    AND COALESCE(u.is_active,true)=true
    AND u.role='user'
    AND k.user_id IS NULL
  ORDER BY u.created_at
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'TEST_REQUIRES_ACTIVE_USER_WITHOUT_KYC';
  END IF;

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
  IF (SELECT count(*) FROM public.kyc_documents_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'DOCUMENT_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_documents_v3 WHERE application_id=v_application_id AND document_number_hash IS NULL) THEN RAISE EXCEPTION 'DOCUMENT_HASH_MISSING'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='kyc_documents_v3' AND column_name='document_number') THEN RAISE EXCEPTION 'RAW_DOCUMENT_NUMBER_COLUMN_FORBIDDEN'; END IF;
  IF (SELECT count(*) FROM public.kyc_consents_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'CONSENT_MISSING'; END IF;
  IF (SELECT count(*) FROM public.kyc_risk_assessments_v3 WHERE application_id=v_application_id)<>1 THEN RAISE EXCEPTION 'RISK_ASSESSMENT_MISSING'; END IF;
  IF (SELECT count(*) FROM public.kyc_provider_jobs_v3 WHERE application_id=v_application_id)<>4 THEN RAISE EXCEPTION 'EXPECTED_FOUR_REQUIRED_PROVIDER_JOBS'; END IF;

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

  -- Immutable evidence must reject tampering.
  v_failed:=false;
  BEGIN
    UPDATE public.kyc_consents_v3 SET privacy_notice_version='tampered' WHERE application_id=v_application_id;
  EXCEPTION WHEN OTHERS THEN v_failed:=true; END;
  IF NOT v_failed THEN RAISE EXCEPTION 'CONSENT_IMMUTABILITY_FAILED'; END IF;

  -- Compliance hook: confirmed sanctions match must freeze the entity. Use a savepoint-like subtransaction
  -- after temporarily reopening workflow inside the outer transaction.
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  UPDATE public.kyc_profiles SET status='pending',workflow_status='in_review' WHERE user_id=v_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);
  UPDATE public.kyc_applications_v3 SET workflow_status='in_review' WHERE id=v_application_id;

  SELECT count(*) INTO v_before_controls FROM public.compliance_entity_controls;
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

ROLLBACK;
