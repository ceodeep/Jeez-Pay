\pset pager off
\echo '=== KYC V3 MANUAL LAUNCH POLICY TEST ==='
\echo 'ROLLBACK-ONLY: standard-risk no-liveness approval + mandatory face match + EDD attended liveness.'

BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

DO $$
DECLARE
  v_standard_user uuid := gen_random_uuid();
  v_pep_user uuid := gen_random_uuid();
  v_admin uuid;
  v_officer uuid;
  v_payload jsonb;
  v_result jsonb;
  v_app uuid;
  v_failed boolean;
BEGIN
  SELECT id INTO v_admin
  FROM public.users
  WHERE role IN('super_admin','admin')
    AND COALESCE(is_active,true)=true
    AND COALESCE(is_system,false)=false
  ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END,id
  LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_ACTIVE_ADMIN'; END IF;

  SELECT id INTO v_officer
  FROM public.users
  WHERE role='kyc_officer'
    AND COALESCE(is_active,true)=true
    AND COALESCE(is_system,false)=false
  LIMIT 1;
  IF v_officer IS NULL THEN v_officer:=v_admin; END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.kyc_policy_versions_v3
    WHERE policy_version=2
      AND active=true
      AND require_liveness=false
      AND requirements->>'faceMatchRequiredForAll'='true'
      AND requirements->>'attendedLivenessRequiredForEnhancedDueDiligence'='true'
  ) THEN
    RAISE EXCEPTION 'MANUAL_LAUNCH_POLICY_NOT_ACTIVE';
  END IF;

  -- -----------------------------
  -- Standard-risk customer.
  -- -----------------------------
  INSERT INTO public.users(
    id,phone,email,"fullName",password_hash,phone_verified,email_verified,
    account_type,country_code,terms_accepted,role,referral_code,is_active,is_system
  ) VALUES (
    v_standard_user,
    '+211997' || right(replace(v_standard_user::text,'-',''),8),
    lower(replace(v_standard_user::text,'-','')) || '@kyc-option-a.invalid',
    'KYC Option A Standard Test','ROLLBACK_ONLY_NOT_LOGINABLE',
    false,true,'personal','SS',true,'user',
    'A' || upper(substr(replace(v_standard_user::text,'-',''),1,5)),true,false
  );

  v_payload:=jsonb_build_object(
    'schemaVersion',3,'fullName','KYC Option A Standard Test','dob','1995-05-15',
    'nationality','SS','countryOfBirth','SS','residenceCountry','SS',
    'addressLine1','Rollback Address','city','Juba','region','Central Equatoria',
    'employmentStatus','employed','occupation','Tester','employerName','JeezPay Test',
    'sourceOfFunds',jsonb_build_array('salary'),'sourceOfWealth',NULL,
    'accountPurpose','personal_payments','expectedMonthlyVolumeBand','standard',
    'expectedMonthlyTxCountBand','1_20','pepSelfDeclared',false,'pepRelatedDeclared',false,
    'taxResidencies',jsonb_build_array('SS'),
    'document',jsonb_build_object(
      'documentType','passport','issuingCountry','SS','documentNumber','OPTION-A-STANDARD-1',
      'issueDate','2024-01-01','expiryDate','2034-01-01','noExpiry',false,
      'frontPath',v_standard_user::text||'/id_front_test.jpg',
      'backPath',NULL,'selfiePath',v_standard_user::text||'/selfie_test.jpg'
    ),
    'consents',jsonb_build_object(
      'privacyAccepted',true,'identityVerificationAccepted',true,
      'biometricAccepted',true,'ongoingScreeningAccepted',true,
      'privacyNoticeVersion','2026-09-v1','biometricNoticeVersion','2026-09-v1'
    )
  );

  v_result:=public.submit_kyc_v3(v_standard_user,v_payload,'127.0.0.1','KYC-OPTION-A-TEST');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR (v_result->>'policyVersion')::int<>2 THEN
    RAISE EXCEPTION 'STANDARD_SUBMIT_FAILED: %',v_result;
  END IF;
  v_app:=(v_result->>'applicationId')::uuid;

  IF (SELECT count(*) FROM public.kyc_provider_jobs_v3 WHERE application_id=v_app)<>3 THEN
    RAISE EXCEPTION 'STANDARD_POLICY_SHOULD_QUEUE_THREE_PROVIDER_JOBS';
  END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_provider_jobs_v3 WHERE application_id=v_app AND job_type='liveness') THEN
    RAISE EXCEPTION 'STANDARD_POLICY_QUEUED_LIVENESS_UNEXPECTEDLY';
  END IF;

  PERFORM public.record_kyc_check_v3(v_officer,v_standard_user,'document_verification','manual_verified','manual',NULL,'Document visually inspected','{}');
  PERFORM public.record_kyc_check_v3(v_officer,v_standard_user,'sanctions','manual_clear','manual',NULL,'Authoritative-list screening clear','{}');
  PERFORM public.record_kyc_check_v3(v_officer,v_standard_user,'pep','manual_clear','manual',NULL,'PEP manual review clear','{}');

  v_failed:=false;
  BEGIN
    PERFORM public.review_kyc_v3(v_officer,v_standard_user,'approved',NULL,NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed:=position('KYC_V3_FACE_MATCH_REQUIRED' in SQLERRM)>0;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'STANDARD_APPROVAL_DID_NOT_REQUIRE_FACE_MATCH'; END IF;

  v_failed:=false;
  BEGIN
    PERFORM public.record_kyc_check_v3(
      v_officer,v_standard_user,'face_match','manual_verified','manual',NULL,
      'Compared selfie with document portrait',
      jsonb_build_object('selfieComparedToDocument',false)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed:=position('KYC_V3_MANUAL_FACE_MATCH_EVIDENCE_REQUIRED' in SQLERRM)>0;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FACE_MATCH_FALSE_EVIDENCE_WAS_ACCEPTED'; END IF;

  PERFORM public.record_kyc_check_v3(
    v_officer,v_standard_user,'face_match','manual_verified','manual',NULL,
    'Compared selfie with government-document portrait; visual match accepted',
    jsonb_build_object('selfieComparedToDocument',true)
  );

  v_result:=public.review_kyc_v3(v_officer,v_standard_user,'approved',NULL,NULL);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'status'<>'approved' THEN
    RAISE EXCEPTION 'STANDARD_APPROVAL_WITHOUT_LIVENESS_FAILED: %',v_result;
  END IF;

  -- -----------------------------
  -- PEP / enhanced-due-diligence customer.
  -- -----------------------------
  INSERT INTO public.users(
    id,phone,email,"fullName",password_hash,phone_verified,email_verified,
    account_type,country_code,terms_accepted,role,referral_code,is_active,is_system
  ) VALUES (
    v_pep_user,
    '+211996' || right(replace(v_pep_user::text,'-',''),8),
    lower(replace(v_pep_user::text,'-','')) || '@kyc-option-a.invalid',
    'KYC Option A PEP Test','ROLLBACK_ONLY_NOT_LOGINABLE',
    false,true,'personal','SS',true,'user',
    'P' || upper(substr(replace(v_pep_user::text,'-',''),1,5)),true,false
  );

  v_payload:=jsonb_build_object(
    'schemaVersion',3,'fullName','KYC Option A PEP Test','dob','1985-03-20',
    'nationality','SS','countryOfBirth','SS','residenceCountry','SS',
    'addressLine1','Rollback PEP Address','city','Juba','region','Central Equatoria',
    'employmentStatus','employed','occupation','Public official','employerName','Rollback Test',
    'sourceOfFunds',jsonb_build_array('salary'),'sourceOfWealth','Salary and accumulated savings',
    'accountPurpose','personal_payments','expectedMonthlyVolumeBand','standard',
    'expectedMonthlyTxCountBand','1_20','pepSelfDeclared',true,'pepRelatedDeclared',false,
    'taxResidencies',jsonb_build_array('SS'),
    'document',jsonb_build_object(
      'documentType','passport','issuingCountry','SS','documentNumber','OPTION-A-PEP-1',
      'issueDate','2024-01-01','expiryDate','2034-01-01','noExpiry',false,
      'frontPath',v_pep_user::text||'/id_front_test.jpg',
      'backPath',NULL,'selfiePath',v_pep_user::text||'/selfie_test.jpg'
    ),
    'consents',jsonb_build_object(
      'privacyAccepted',true,'identityVerificationAccepted',true,
      'biometricAccepted',true,'ongoingScreeningAccepted',true,
      'privacyNoticeVersion','2026-09-v1','biometricNoticeVersion','2026-09-v1'
    )
  );

  v_result:=public.submit_kyc_v3(v_pep_user,v_payload,'127.0.0.1','KYC-OPTION-A-TEST');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'riskRating'<>'high' THEN
    RAISE EXCEPTION 'PEP_SUBMIT_NOT_HIGH_RISK: %',v_result;
  END IF;

  PERFORM public.record_kyc_check_v3(v_officer,v_pep_user,'document_verification','manual_verified','manual',NULL,'Document visually inspected','{}');
  PERFORM public.record_kyc_check_v3(
    v_officer,v_pep_user,'face_match','manual_verified','manual',NULL,
    'Compared selfie with government-document portrait; visual match accepted',
    jsonb_build_object('selfieComparedToDocument',true)
  );
  PERFORM public.record_kyc_check_v3(v_officer,v_pep_user,'sanctions','manual_clear','manual',NULL,'Authoritative-list screening clear','{}');
  PERFORM public.record_kyc_check_v3(v_officer,v_pep_user,'pep','confirmed_pep','manual',NULL,'Customer is treated as PEP for EDD','{}');

  IF v_officer<>v_admin THEN
    v_result:=public.review_kyc_v3(v_officer,v_pep_user,'approved',NULL,NULL);
    IF v_result->>'code'<>'SENIOR_APPROVAL_REQUIRED' THEN
      RAISE EXCEPTION 'PEP_OFFICER_APPROVAL_NOT_BLOCKED: %',v_result;
    END IF;
  END IF;

  v_failed:=false;
  BEGIN
    PERFORM public.review_kyc_v3(v_admin,v_pep_user,'approved',NULL,NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed:=position('KYC_V3_EDD_LIVENESS_REQUIRED' in SQLERRM)>0;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'PEP_APPROVAL_DID_NOT_REQUIRE_ATTENDED_LIVENESS'; END IF;

  v_failed:=false;
  BEGIN
    PERFORM public.record_kyc_check_v3(
      v_admin,v_pep_user,'liveness','manual_verified','manual',NULL,
      'Live-session test with missing attendance evidence',
      jsonb_build_object('attendedSession',false)
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed:=position('KYC_V3_MANUAL_LIVENESS_EVIDENCE_REQUIRED' in SQLERRM)>0;
  END;
  IF NOT v_failed THEN RAISE EXCEPTION 'FALSE_MANUAL_LIVENESS_EVIDENCE_WAS_ACCEPTED'; END IF;

  PERFORM public.record_kyc_check_v3(
    v_admin,v_pep_user,'liveness','manual_verified','manual',NULL,
    'Reviewer attended live identity session and compared customer to submitted evidence',
    jsonb_build_object('attendedSession',true)
  );

  v_result:=public.review_kyc_v3(v_admin,v_pep_user,'approved',NULL,NULL);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR v_result->>'status'<>'approved' THEN
    RAISE EXCEPTION 'PEP_APPROVAL_AFTER_ATTENDED_LIVENESS_FAILED: %',v_result;
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.kyc_profiles
    WHERE user_id=v_pep_user AND assurance_level='enhanced'
  ) THEN
    RAISE EXCEPTION 'PEP_APPROVAL_NOT_MARKED_ENHANCED';
  END IF;

  RAISE NOTICE 'KYC V3 MANUAL LAUNCH POLICY TESTS: OK';
END $$;

\echo ''
\echo '=== TEMPORARY OPTION A COUNTS ==='
SELECT policy_version,policy_code,active,require_liveness
FROM public.kyc_policy_versions_v3
ORDER BY policy_version;
SELECT check_type,status,count(*)
FROM public.kyc_checks_v3
GROUP BY check_type,status
ORDER BY check_type,status;

ROLLBACK;
