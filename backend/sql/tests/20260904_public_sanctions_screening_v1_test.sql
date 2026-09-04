\pset pager off
\echo '=== PUBLIC SANCTIONS SCREENING V1 TEST ==='
\echo 'ROLLBACK-ONLY: fresh-source gate, exact-hit potential match, no-hit clear, no auto-confirm.'

BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';

DO $$
DECLARE
  v_admin uuid;
  v_hit_user uuid:=gen_random_uuid();
  v_clear_user uuid:=gen_random_uuid();
  v_payload jsonb;
  v_result jsonb;
  v_source text;
  v_sync uuid:=gen_random_uuid();
  v_entity uuid:=gen_random_uuid();
BEGIN
  SELECT id INTO v_admin FROM public.users
  WHERE role IN('super_admin','admin') AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false
  ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END,id LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'TEST_REQUIRES_ACTIVE_ADMIN'; END IF;

  FOREACH v_source IN ARRAY ARRAY['OFAC_SDN','OFAC_NON_SDN','UN_SC','UK'] LOOP
    INSERT INTO public.sanctions_sources_v1(
      source_code,source_name,official_url,status,last_sync_id,last_attempt_at,last_success_at,snapshot_sha256,record_count,alias_count,updated_at
    ) VALUES(v_source,'Rollback Test '||v_source,'https://example.invalid/'||v_source,'fresh',v_sync,now(),now(),repeat('a',64),1,0,now())
    ON CONFLICT(source_code) DO UPDATE SET status='fresh',last_success_at=now(),last_sync_id=v_sync,snapshot_sha256=repeat('a',64),updated_at=now();
  END LOOP;

  INSERT INTO public.sanctions_entities_v1(
    id,source_code,source_ref,entity_type,primary_name,normalized_primary_name,dobs,nationalities,programs,last_seen_sync_id,raw
  ) VALUES(
    v_entity,'OFAC_SDN','ROLLBACK-001','individual','Test Sanctioned Person',public.normalize_sanctions_name_v1('Test Sanctioned Person'),
    ARRAY['1990-01-02'],ARRAY['SS'],ARRAY['TEST'],v_sync,'{}'::jsonb
  );
  INSERT INTO public.sanctions_names_v1(entity_id,source_code,source_ref,name_type,display_name,normalized_name)
  VALUES(v_entity,'OFAC_SDN','ROLLBACK-001','primary','Test Sanctioned Person',public.normalize_sanctions_name_v1('Test Sanctioned Person'));

  INSERT INTO public.users(
    id,phone,email,"fullName",password_hash,phone_verified,email_verified,account_type,country_code,terms_accepted,role,referral_code,is_active,is_system
  ) VALUES
    (v_hit_user,'+211995'||right(replace(v_hit_user::text,'-',''),8),lower(replace(v_hit_user::text,'-',''))||'@sanctions-test.invalid','Test Sanctioned Person','ROLLBACK_ONLY',false,true,'personal','SS',true,'user','S'||upper(substr(replace(v_hit_user::text,'-',''),1,5)),true,false),
    (v_clear_user,'+211994'||right(replace(v_clear_user::text,'-',''),8),lower(replace(v_clear_user::text,'-',''))||'@sanctions-test.invalid','Completely Innocent Example','ROLLBACK_ONLY',false,true,'personal','SS',true,'user','C'||upper(substr(replace(v_clear_user::text,'-',''),1,5)),true,false);

  v_payload:=jsonb_build_object(
    'schemaVersion',3,'fullName','Test Sanctioned Person','dob','1990-01-02','nationality','SS','countryOfBirth','SS','residenceCountry','SS',
    'addressLine1','Rollback','city','Juba','employmentStatus','employed','occupation','Tester','sourceOfFunds',jsonb_build_array('salary'),
    'accountPurpose','personal_payments','expectedMonthlyVolumeBand','standard','expectedMonthlyTxCountBand','1_20','pepSelfDeclared',false,'pepRelatedDeclared',false,
    'taxResidencies',jsonb_build_array('SS'),'document',jsonb_build_object('documentType','passport','issuingCountry','SS','documentNumber','SANCTIONS-ROLLBACK-1','issueDate','2024-01-01','expiryDate','2034-01-01','noExpiry',false,'frontPath',v_hit_user::text||'/id_front.jpg','selfiePath',v_hit_user::text||'/selfie.jpg'),
    'consents',jsonb_build_object('privacyAccepted',true,'identityVerificationAccepted',true,'biometricAccepted',true,'ongoingScreeningAccepted',true,'privacyNoticeVersion','2026-09-v1','biometricNoticeVersion','2026-09-v1')
  );
  v_result:=public.submit_kyc_v3(v_hit_user,v_payload,'127.0.0.1','SANCTIONS-ROLLBACK-TEST');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'HIT_USER_SUBMIT_FAILED: %',v_result; END IF;

  v_result:=public.screen_kyc_sanctions_public_v1(v_admin,v_hit_user);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'status'<>'potential_match' THEN
    RAISE EXCEPTION 'EXACT_SANCTIONS_HIT_NOT_FLAGGED: %',v_result;
  END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_checks_v3 WHERE user_id=v_hit_user AND check_type='sanctions' AND status='confirmed_match') THEN
    RAISE EXCEPTION 'AUTOMATED_SANCTIONS_SCREEN_AUTO_CONFIRMED_MATCH';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.compliance_entity_controls WHERE entity_type='USER' AND entity_ref=v_hit_user::text AND status='review') THEN
    RAISE EXCEPTION 'POTENTIAL_MATCH_DID_NOT_CREATE_COMPLIANCE_REVIEW';
  END IF;

  v_payload:=jsonb_set(v_payload,'{fullName}','"Completely Innocent Example"'::jsonb);
  v_payload:=jsonb_set(v_payload,'{dob}','"1995-05-05"'::jsonb);
  v_payload:=jsonb_set(v_payload,'{document,documentNumber}','"SANCTIONS-ROLLBACK-2"'::jsonb);
  v_payload:=jsonb_set(v_payload,'{document,frontPath}',to_jsonb(v_clear_user::text||'/id_front.jpg'));
  v_payload:=jsonb_set(v_payload,'{document,selfiePath}',to_jsonb(v_clear_user::text||'/selfie.jpg'));
  v_result:=public.submit_kyc_v3(v_clear_user,v_payload,'127.0.0.1','SANCTIONS-ROLLBACK-TEST');
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION 'CLEAR_USER_SUBMIT_FAILED: %',v_result; END IF;

  v_result:=public.screen_kyc_sanctions_public_v1(v_admin,v_clear_user);
  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE OR v_result->>'status'<>'clear' THEN
    RAISE EXCEPTION 'NO_HIT_SANCTIONS_SCREEN_NOT_CLEAR: %',v_result;
  END IF;

  RAISE NOTICE 'PUBLIC SANCTIONS SCREENING V1 TESTS: OK';
END $$;

SELECT check_type,status,count(*) FROM public.kyc_checks_v3
WHERE provider='jeezpay_public_sanctions_v1'
GROUP BY check_type,status ORDER BY status;

ROLLBACK;
