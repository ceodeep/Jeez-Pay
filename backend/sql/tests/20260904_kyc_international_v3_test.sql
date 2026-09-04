\pset pager off
\echo '=== INTERNATIONAL KYC V3 TESTS ==='
\echo 'ROLLBACK-ONLY: versioned application, checks, screening, approval, immutability.'

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  v_user uuid;
  v_user_text text;
  v_front text;
  v_back text;
  v_selfie text;
  v_result jsonb;
  v_app uuid;
  v_policy public.kyc_policy_versions%ROWTYPE;
  v_failed boolean;
  v_count integer;
BEGIN
  SELECT kp.user_id INTO v_user
  FROM public.kyc_profiles kp
  JOIN public.users u ON u.id=kp.user_id
  WHERE kp.status='approved'
    AND COALESCE(u.is_system,false)=false
    AND COALESCE(u.is_active,true)=true
  ORDER BY kp.user_id
  LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'TEST_REQUIRES_ONE_APPROVED_NON_SYSTEM_KYC_USER';
  END IF;

  SELECT * INTO v_policy FROM public.kyc_policy_versions
  WHERE status='active' ORDER BY version DESC LIMIT 1;
  IF v_policy.version IS NULL OR v_policy.schema_version <> 3 THEN
    RAISE EXCEPTION 'ACTIVE_V3_POLICY_MISSING';
  END IF;

  v_user_text := v_user::text;
  v_front := v_user_text || '/id_phase53_front.jpg';
  v_back := v_user_text || '/id_back_phase53_back.jpg';
  v_selfie := v_user_text || '/selfie_phase53.jpg';

  -- Temporarily make the already-approved fixture eligible to create a newer
  -- application. The whole test rolls back.
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  UPDATE public.kyc_profiles
  SET status='rejected', rejection_reason='Phase 5.3 rollback test', updated_at=now()
  WHERE user_id=v_user;
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);

  INSERT INTO public.kyc_upload_sessions(
    user_id,object_path,file_type,content_type,schema_version,expires_at
  ) VALUES
    (v_user,v_front,'id_front','image/jpeg',3,now()+interval '30 minutes'),
    (v_user,v_back,'id_back','image/jpeg',3,now()+interval '30 minutes'),
    (v_user,v_selfie,'selfie','image/jpeg',3,now()+interval '30 minutes');

  v_result := public.submit_kyc_v3(
    v_user,
    jsonb_build_object(
      'fullName','Phase 5.3 Test User',
      'dob','1990-01-01',
      'nationality','KE',
      'countryOfBirth','SS',
      'residenceCountry','KE',
      'addressLine1','Test address 1',
      'city','Nairobi',
      'employmentStatus','employed',
      'occupation','Engineer',
      'sourceOfFunds',jsonb_build_array('salary'),
      'accountPurpose','personal_payments',
      'expectedMonthlyVolumeBand','standard',
      'expectedMonthlyTxCountBand','1_20',
      'pepSelfDeclared',false,
      'pepRelatedDeclared',false,
      'taxResidencies',jsonb_build_array()
    ),
    jsonb_build_object(
      'documentType','passport',
      'issuingCountry','KE',
      'documentNumberCiphertext','v1.test.test.test',
      'documentNumberFingerprint',repeat('a',64),
      'documentNumberLast4','1234',
      'issueDate',(current_date-interval '1 year')::date,
      'expiryDate',(current_date+interval '5 years')::date,
      'noExpiry',false,
      'frontPath',v_front,
      'backPath',v_back,
      'selfiePath',v_selfie,
      'captureMethod','camera'
    ),
    jsonb_build_object(
      'privacyAccepted',true,
      'identityVerificationAccepted',true,
      'biometricAccepted',true,
      'ongoingScreeningAccepted',true,
      'privacyNoticeVersion',v_policy.privacy_notice_version,
      'biometricNoticeVersion',v_policy.biometric_notice_version
    ),
    jsonb_build_object('ipAddress','127.0.0.1','userAgent','phase53-test')
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR (v_result->>'schemaVersion')::integer <> 3
     OR v_result->>'workflowStatus' <> 'submitted'
  THEN
    RAISE EXCEPTION 'V3_SUBMISSION_FAILED: %',v_result;
  END IF;

  v_app := (v_result->>'applicationId')::uuid;

  SELECT count(*) INTO v_count FROM public.kyc_documents WHERE application_id=v_app;
  IF v_count <> 1 THEN RAISE EXCEPTION 'DOCUMENT_NOT_CREATED'; END IF;

  SELECT count(*) INTO v_count FROM public.kyc_consents WHERE application_id=v_app AND accepted=true;
  IF v_count <> 4 THEN RAISE EXCEPTION 'CONSENT_EVIDENCE_INCOMPLETE: %',v_count; END IF;

  SELECT count(*) INTO v_count FROM public.kyc_screenings WHERE application_id=v_app;
  IF v_count <> 3 THEN RAISE EXCEPTION 'SCREENING_PLACEHOLDERS_INCOMPLETE: %',v_count; END IF;

  SELECT count(*) INTO v_count FROM public.kyc_provider_checks WHERE application_id=v_app;
  IF v_count < 5 THEN RAISE EXCEPTION 'PROVIDER_CHECK_PLACEHOLDERS_INCOMPLETE: %',v_count; END IF;

  SELECT count(*) INTO v_count FROM public.kyc_risk_assessments WHERE application_id=v_app;
  IF v_count <> 1 THEN RAISE EXCEPTION 'RISK_ASSESSMENT_MISSING'; END IF;

  -- Identity evidence must be immutable after submission.
  v_failed := false;
  BEGIN
    UPDATE public.kyc_applications SET full_name='Tampered name' WHERE id=v_app;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'APPLICATION_IDENTITY_MUTATION_WAS_NOT_BLOCKED'; END IF;

  v_failed := false;
  BEGIN
    UPDATE public.kyc_consents SET policy_version='tampered' WHERE application_id=v_app;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'CONSENT_MUTATION_WAS_NOT_BLOCKED'; END IF;

  -- Record the manual/provider evidence required for a standard-risk approval.
  PERFORM public.set_kyc_provider_check_v3(
    v_user,v_app,'document_authenticity','manual_passed','manual',NULL,NULL,'VISUAL_REVIEW',
    jsonb_build_object('reviewMethod','trained_reviewer')
  );
  PERFORM public.set_kyc_provider_check_v3(
    v_user,v_app,'document_presence','manual_passed','manual',NULL,NULL,'LIVE_CAPTURE_CONFIRMED',
    jsonb_build_object('captureMethod','camera')
  );
  PERFORM public.set_kyc_provider_check_v3(
    v_user,v_app,'face_match','manual_passed','manual',NULL,NULL,'VISUAL_FACE_MATCH',
    jsonb_build_object('reviewMethod','trained_reviewer')
  );
  PERFORM public.set_kyc_provider_check_v3(
    v_user,v_app,'liveness','manual_passed','manual',NULL,NULL,'ATTENDED_TEST',
    jsonb_build_object('attendedSession',true)
  );

  PERFORM public.set_kyc_screening_v3(
    v_user,v_app,'sanctions','clear','manual',NULL,'TEST-LIST',NULL,0,
    jsonb_build_object('test',true)
  );
  PERFORM public.set_kyc_screening_v3(
    v_user,v_app,'pep','clear','manual',NULL,'TEST-LIST',NULL,0,
    jsonb_build_object('test',true)
  );
  PERFORM public.set_kyc_screening_v3(
    v_user,v_app,'adverse_media','clear','manual',NULL,'TEST-LIST',NULL,0,
    jsonb_build_object('test',true)
  );

  SELECT verification_status='manual_verified' INTO v_failed
  FROM public.kyc_documents WHERE application_id=v_app;
  IF NOT COALESCE(v_failed,false) THEN RAISE EXCEPTION 'DOCUMENT_VERIFICATION_STATUS_NOT_UPDATED'; END IF;

  v_result := public.review_kyc_v3(v_user,v_user,'approved',NULL);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'workflowStatus' <> 'approved'
     OR v_result->>'nextReviewAt' IS NULL
  THEN
    RAISE EXCEPTION 'V3_APPROVAL_FAILED: %',v_result;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_profiles WHERE user_id=v_user AND status='approved'
  ) THEN RAISE EXCEPTION 'PROFILE_SUMMARY_NOT_APPROVED'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.kyc_applications WHERE id=v_app AND workflow_status='approved'
  ) THEN RAISE EXCEPTION 'APPLICATION_NOT_APPROVED'; END IF;

  RAISE NOTICE 'INTERNATIONAL KYC V3 TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY V3 STATE ==='
SELECT schema_version,workflow_status,risk_tier,screening_status,provider_status,count(*)
FROM public.kyc_applications
WHERE schema_version=3
GROUP BY schema_version,workflow_status,risk_tier,screening_status,provider_status
ORDER BY workflow_status;

SELECT screening_type,status,count(*)
FROM public.kyc_screenings s
JOIN public.kyc_applications a ON a.id=s.application_id
WHERE a.schema_version=3
GROUP BY screening_type,status
ORDER BY screening_type;

ROLLBACK;
