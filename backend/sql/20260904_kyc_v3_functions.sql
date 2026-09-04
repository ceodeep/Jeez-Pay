BEGIN;

DO $$ BEGIN
  IF to_regclass('public.kyc_applications_v3') IS NULL
     OR to_regclass('public.kyc_policy_versions_v3') IS NULL
     OR to_regprocedure('public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_REQUIRED_FOUNDATION_MISSING' USING ERRCODE='P0001';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.kyc_active_policy_v3()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
SELECT jsonb_build_object(
  'schemaVersion',schema_version,
  'policyVersion',policy_version,
  'policyCode',policy_code,
  'privacyNoticeVersion',privacy_notice_version,
  'biometricNoticeVersion',biometric_notice_version,
  'minimumAge',minimum_age,
  'maxUploadBytes',max_upload_bytes,
  'requireDocumentVerification',require_document_verification,
  'requireLiveness',require_liveness,
  'requireSanctionsScreening',require_sanctions_screening,
  'requirePepScreening',require_pep_screening,
  'requireAdverseMediaScreening',require_adverse_media_screening,
  'reviewMonths',jsonb_build_object('low',low_risk_review_months,'medium',medium_risk_review_months,'high',high_risk_review_months),
  'requirements',requirements
)
FROM public.kyc_policy_versions_v3
WHERE active=true
ORDER BY policy_version DESC
LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.guard_kyc_profile_v3_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('jeezpay.kyc_lifecycle_v3',true) IS DISTINCT FROM 'on'
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
     ) THEN
    RAISE EXCEPTION 'KYC_V3_PROFILE_DIRECT_MUTATION_FORBIDDEN' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kyc_profile_v3_guard ON public.kyc_profiles;
CREATE TRIGGER kyc_profile_v3_guard BEFORE UPDATE ON public.kyc_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_profile_v3_mutation();

CREATE OR REPLACE FUNCTION public.submit_kyc_v3(
  p_user_id uuid,
  p_payload jsonb,
  p_client_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE
  v_policy public.kyc_policy_versions_v3%ROWTYPE;
  v_existing public.kyc_profiles%ROWTYPE;
  v_profile_exists boolean := false;
  v_application_id uuid;
  v_application_version integer;
  v_full_name text;
  v_dob date;
  v_age integer;
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
  v_country_weight integer := 0;
  v_risk_score integer := 0;
  v_risk_rating text;
  v_risk_factors jsonb;
  v_event text;
BEGIN
  IF p_user_id IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_ARGUMENTS' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_policy FROM public.kyc_policy_versions_v3
  WHERE active=true ORDER BY policy_version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'KYC_V3_POLICY_MISSING' USING ERRCODE='P0001'; END IF;

  BEGIN
    IF (p_payload->>'schemaVersion')::integer <> v_policy.schema_version THEN
      RAISE EXCEPTION 'KYC_V3_SCHEMA_VERSION_MISMATCH' USING ERRCODE='P0001';
    END IF;
  EXCEPTION WHEN invalid_text_representation OR null_value_not_allowed THEN
    RAISE EXCEPTION 'KYC_V3_SCHEMA_VERSION_MISMATCH' USING ERRCODE='P0001';
  END;

  IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND COALESCE(is_system,false)=false AND COALESCE(is_active,true)=true) THEN
    RAISE EXCEPTION 'KYC_V3_USER_NOT_ELIGIBLE' USING ERRCODE='P0001';
  END IF;

  v_full_name:=btrim(COALESCE(p_payload->>'fullName',''));
  v_nationality:=upper(btrim(COALESCE(p_payload->>'nationality','')));
  v_country_of_birth:=upper(btrim(COALESCE(p_payload->>'countryOfBirth','')));
  v_residence_country:=upper(btrim(COALESCE(p_payload->>'residenceCountry','')));
  v_address_line1:=btrim(COALESCE(p_payload->>'addressLine1',''));
  v_address_line2:=NULLIF(btrim(COALESCE(p_payload->>'addressLine2','')),'');
  v_city:=btrim(COALESCE(p_payload->>'city',''));
  v_region:=NULLIF(btrim(COALESCE(p_payload->>'region','')),'');
  v_postal_code:=NULLIF(btrim(COALESCE(p_payload->>'postalCode','')),'');
  v_employment_status:=lower(btrim(COALESCE(p_payload->>'employmentStatus','')));
  v_occupation:=btrim(COALESCE(p_payload->>'occupation',''));
  v_employer_name:=NULLIF(btrim(COALESCE(p_payload->>'employerName','')),'');
  v_source_of_wealth:=NULLIF(btrim(COALESCE(p_payload->>'sourceOfWealth','')),'');
  v_account_purpose:=lower(btrim(COALESCE(p_payload->>'accountPurpose','')));
  v_volume_band:=lower(btrim(COALESCE(p_payload->>'expectedMonthlyVolumeBand','')));
  v_tx_band:=NULLIF(lower(btrim(COALESCE(p_payload->>'expectedMonthlyTxCountBand',''))),'');

  BEGIN
    v_dob:=(p_payload->>'dob')::date;
    v_pep_self:=COALESCE((p_payload->>'pepSelfDeclared')::boolean,false);
    v_pep_related:=COALESCE((p_payload->>'pepRelatedDeclared')::boolean,false);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_PERSONAL_DETAILS' USING ERRCODE='P0001';
  END;
  v_age:=date_part('year',age(current_date,v_dob))::integer;

  IF v_full_name='' OR length(v_full_name)>200 OR v_address_line1='' OR length(v_address_line1)>500
     OR v_city='' OR length(v_city)>150 OR v_occupation='' OR length(v_occupation)>200
     OR v_dob>current_date OR v_dob<DATE '1900-01-01' OR v_age<v_policy.minimum_age THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_PERSONAL_DETAILS' USING ERRCODE='P0001';
  END IF;
  IF v_nationality!~'^[A-Z]{2}$' OR v_country_of_birth!~'^[A-Z]{2}$' OR v_residence_country!~'^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_COUNTRY' USING ERRCODE='P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_country_risk_v3 WHERE active=true AND classification='prohibited' AND country_code IN(v_nationality,v_country_of_birth,v_residence_country)) THEN
    RAISE EXCEPTION 'KYC_V3_PROHIBITED_JURISDICTION' USING ERRCODE='P0001';
  END IF;
  IF v_employment_status NOT IN('employed','self_employed','student','unemployed','retired','homemaker','other') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_EMPLOYMENT' USING ERRCODE='P0001';
  END IF;
  IF v_account_purpose NOT IN('personal_payments','family_support','income_receiving','business_payments','savings','other') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_PURPOSE' USING ERRCODE='P0001';
  END IF;
  IF v_volume_band NOT IN('low','standard','high','very_high') OR (v_tx_band IS NOT NULL AND v_tx_band NOT IN('1_20','21_100','101_500','500_plus')) THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_EXPECTED_ACTIVITY' USING ERRCODE='P0001';
  END IF;

  IF jsonb_typeof(p_payload->'sourceOfFunds')<>'array' THEN RAISE EXCEPTION 'KYC_V3_SOURCE_OF_FUNDS_REQUIRED' USING ERRCODE='P0001'; END IF;
  SELECT array_agg(DISTINCT lower(btrim(value))) INTO v_source_of_funds FROM jsonb_array_elements_text(p_payload->'sourceOfFunds');
  IF COALESCE(cardinality(v_source_of_funds),0)=0 OR EXISTS(SELECT 1 FROM unnest(v_source_of_funds) s WHERE s NOT IN('salary','business','savings','investments','family_support','other')) THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_SOURCE_OF_FUNDS' USING ERRCODE='P0001';
  END IF;

  IF jsonb_typeof(p_payload->'taxResidencies')<>'array' THEN RAISE EXCEPTION 'KYC_V3_TAX_RESIDENCY_REQUIRED' USING ERRCODE='P0001'; END IF;
  SELECT array_agg(DISTINCT upper(btrim(value))) INTO v_tax_residencies FROM jsonb_array_elements_text(p_payload->'taxResidencies');
  IF COALESCE(cardinality(v_tax_residencies),0)=0 OR EXISTS(SELECT 1 FROM unnest(v_tax_residencies) c WHERE c!~'^[A-Z]{2}$') THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_TAX_RESIDENCY' USING ERRCODE='P0001';
  END IF;

  v_document:=COALESCE(p_payload->'document','{}'::jsonb);
  v_consents:=COALESCE(p_payload->'consents','{}'::jsonb);
  IF jsonb_typeof(v_document)<>'object' OR jsonb_typeof(v_consents)<>'object' THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_AND_CONSENT_REQUIRED' USING ERRCODE='P0001';
  END IF;
  v_document_type:=lower(btrim(COALESCE(v_document->>'documentType','')));
  v_issuing_country:=upper(btrim(COALESCE(v_document->>'issuingCountry','')));
  v_document_number:=upper(regexp_replace(btrim(COALESCE(v_document->>'documentNumber','')),'\s+','','g'));
  v_front_path:=btrim(COALESCE(v_document->>'frontPath',''));
  v_back_path:=NULLIF(btrim(COALESCE(v_document->>'backPath','')),'');
  v_selfie_path:=btrim(COALESCE(v_document->>'selfiePath',''));
  BEGIN v_no_expiry:=COALESCE((v_document->>'noExpiry')::boolean,false); EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT' USING ERRCODE='P0001'; END;

  IF v_document_type NOT IN('passport','national_id','driver_license','residence_permit','refugee_id','other_government_id')
     OR v_issuing_country!~'^[A-Z]{2}$' OR v_document_number='' OR length(v_document_number)>100 THEN
    RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT' USING ERRCODE='P0001';
  END IF;
  IF EXISTS(SELECT 1 FROM public.kyc_country_risk_v3 WHERE active=true AND classification='prohibited' AND country_code=v_issuing_country) THEN
    RAISE EXCEPTION 'KYC_V3_PROHIBITED_JURISDICTION' USING ERRCODE='P0001';
  END IF;
  IF NULLIF(v_document->>'issueDate','') IS NOT NULL THEN
    BEGIN v_issue_date:=(v_document->>'issueDate')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_DATES' USING ERRCODE='P0001'; END;
    IF v_issue_date>current_date THEN RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_DATES' USING ERRCODE='P0001'; END IF;
  END IF;
  IF NOT v_no_expiry THEN
    BEGIN v_expiry_date:=(v_document->>'expiryDate')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'KYC_V3_INVALID_DOCUMENT_DATES' USING ERRCODE='P0001'; END;
    IF v_expiry_date<current_date OR (v_issue_date IS NOT NULL AND v_expiry_date<=v_issue_date) THEN RAISE EXCEPTION 'KYC_V3_DOCUMENT_EXPIRED' USING ERRCODE='P0001'; END IF;
  END IF;
  IF v_front_path='' OR v_selfie_path='' OR left(v_front_path,length(p_user_id::text)+1)<>p_user_id::text||'/'
     OR left(v_selfie_path,length(p_user_id::text)+1)<>p_user_id::text||'/' OR position('..' in v_front_path)>0
     OR position('..' in v_selfie_path)>0 OR v_front_path~*'^https?://' OR v_selfie_path~*'^https?://' THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_PATH_OWNERSHIP_INVALID' USING ERRCODE='P0001';
  END IF;
  IF v_document_type<>'passport' AND (v_back_path IS NULL OR left(v_back_path,length(p_user_id::text)+1)<>p_user_id::text||'/' OR position('..' in v_back_path)>0 OR v_back_path~*'^https?://') THEN
    RAISE EXCEPTION 'KYC_V3_DOCUMENT_BACK_REQUIRED' USING ERRCODE='P0001';
  END IF;

  BEGIN
    IF COALESCE((v_consents->>'privacyAccepted')::boolean,false) IS NOT TRUE
       OR COALESCE((v_consents->>'identityVerificationAccepted')::boolean,false) IS NOT TRUE
       OR COALESCE((v_consents->>'biometricAccepted')::boolean,false) IS NOT TRUE
       OR COALESCE((v_consents->>'ongoingScreeningAccepted')::boolean,false) IS NOT TRUE
       OR btrim(COALESCE(v_consents->>'privacyNoticeVersion',''))<>v_policy.privacy_notice_version
       OR btrim(COALESCE(v_consents->>'biometricNoticeVersion',''))<>v_policy.biometric_notice_version THEN
      RAISE EXCEPTION 'KYC_V3_REQUIRED_CONSENT_MISSING' USING ERRCODE='P0001';
    END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'KYC_V3_REQUIRED_CONSENT_MISSING' USING ERRCODE='P0001';
  END;

  SELECT COALESCE(max(risk_weight),0) INTO v_country_weight FROM public.kyc_country_risk_v3
  WHERE active=true AND (expires_at IS NULL OR expires_at>now())
    AND country_code IN(v_nationality,v_country_of_birth,v_residence_country,v_issuing_country);
  v_risk_score:=LEAST(100,v_country_weight + CASE WHEN v_pep_self THEN 45 ELSE 0 END + CASE WHEN v_pep_related THEN 25 ELSE 0 END
    + CASE v_volume_band WHEN 'very_high' THEN 20 WHEN 'high' THEN 10 ELSE 0 END
    + CASE v_tx_band WHEN '500_plus' THEN 10 WHEN '101_500' THEN 5 ELSE 0 END);
  v_risk_rating:=CASE WHEN v_pep_self OR v_risk_score>=50 THEN 'high' WHEN v_risk_score>=20 THEN 'medium' ELSE 'low' END;
  IF (v_pep_self OR v_pep_related OR v_risk_rating='high') AND v_source_of_wealth IS NULL THEN
    RAISE EXCEPTION 'KYC_V3_SOURCE_OF_WEALTH_REQUIRED' USING ERRCODE='P0001';
  END IF;
  v_risk_factors:=jsonb_build_object('countryWeight',v_country_weight,'pepSelfDeclared',v_pep_self,'pepRelatedDeclared',v_pep_related,'volumeBand',v_volume_band,'txBand',v_tx_band);

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC-V3:'||p_user_id::text,0));
  SELECT * INTO v_existing FROM public.kyc_profiles WHERE user_id=p_user_id FOR UPDATE;
  v_profile_exists:=FOUND;
  IF v_profile_exists AND v_existing.status='approved' AND (v_existing.next_review_at IS NULL OR v_existing.next_review_at>now()) THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_ALREADY_APPROVED','message','KYC is already approved','status','approved');
  END IF;
  IF v_profile_exists AND COALESCE(v_existing.workflow_status,v_existing.status) IN('submitted','in_review') THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_ALREADY_PENDING','message','KYC is already pending review','status','pending');
  END IF;

  SELECT COALESCE(max(application_version),0)+1 INTO v_application_version FROM public.kyc_applications_v3 WHERE user_id=p_user_id;
  INSERT INTO public.kyc_applications_v3(
    user_id,application_version,schema_version,policy_version,full_name,dob,nationality,country_of_birth,residence_country,
    address_line1,address_line2,city,region,postal_code,employment_status,occupation,employer_name,source_of_funds,source_of_wealth,
    account_purpose,expected_monthly_volume_band,expected_monthly_tx_count_band,pep_self_declared,pep_related_declared,tax_residencies,
    workflow_status,risk_score,risk_rating,assurance_level,verification_mode
  ) VALUES(
    p_user_id,v_application_version,v_policy.schema_version,v_policy.policy_version,v_full_name,v_dob,v_nationality,v_country_of_birth,v_residence_country,
    v_address_line1,v_address_line2,v_city,v_region,v_postal_code,v_employment_status,v_occupation,v_employer_name,v_source_of_funds,v_source_of_wealth,
    v_account_purpose,v_volume_band,v_tx_band,v_pep_self,v_pep_related,v_tax_residencies,'submitted',v_risk_score,v_risk_rating,'pending','hybrid'
  ) RETURNING id INTO v_application_id;

  v_document_hash:=encode(digest(convert_to(v_issuing_country||':'||v_document_type||':'||v_document_number,'UTF8'),'sha256'),'hex');
  v_document_last4:=right(v_document_number,LEAST(4,length(v_document_number)));
  INSERT INTO public.kyc_documents_v3(application_id,user_id,document_type,issuing_country,document_number_hash,document_number_last4,issue_date,expiry_date,no_expiry,front_path,back_path)
  VALUES(v_application_id,p_user_id,v_document_type,v_issuing_country,v_document_hash,v_document_last4,v_issue_date,v_expiry_date,v_no_expiry,v_front_path,v_back_path);
  INSERT INTO public.kyc_evidence_v3(application_id,user_id,evidence_type,object_path)
  VALUES(v_application_id,p_user_id,'id_front',v_front_path),(v_application_id,p_user_id,'selfie',v_selfie_path);
  IF v_back_path IS NOT NULL THEN INSERT INTO public.kyc_evidence_v3(application_id,user_id,evidence_type,object_path) VALUES(v_application_id,p_user_id,'id_back',v_back_path); END IF;
  INSERT INTO public.kyc_consents_v3(application_id,user_id,privacy_accepted,identity_verification_accepted,biometric_accepted,ongoing_screening_accepted,privacy_notice_version,biometric_notice_version,client_ip,user_agent)
  VALUES(v_application_id,p_user_id,true,true,true,true,v_policy.privacy_notice_version,v_policy.biometric_notice_version,NULLIF(btrim(COALESCE(p_client_ip,'')),''),NULLIF(left(btrim(COALESCE(p_user_agent,'')),1000),''));
  INSERT INTO public.kyc_risk_assessments_v3(application_id,user_id,assessment_type,score,rating,factors)
  VALUES(v_application_id,p_user_id,'onboarding',v_risk_score,v_risk_rating,v_risk_factors);

  INSERT INTO public.kyc_provider_jobs_v3(application_id,user_id,job_type,payload)
  SELECT v_application_id,p_user_id,j.job_type,jsonb_build_object('applicationId',v_application_id,'userId',p_user_id)
  FROM (VALUES('document_verification'),('liveness'),('sanctions'),('pep'),('adverse_media')) j(job_type)
  WHERE CASE j.job_type WHEN 'document_verification' THEN v_policy.require_document_verification WHEN 'liveness' THEN v_policy.require_liveness
    WHEN 'sanctions' THEN v_policy.require_sanctions_screening WHEN 'pep' THEN v_policy.require_pep_screening WHEN 'adverse_media' THEN v_policy.require_adverse_media_screening ELSE false END;

  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  IF NOT v_profile_exists THEN
    INSERT INTO public.kyc_profiles(user_id,"fullName",dob,address,id_path,selfie_path,status,reviewed_by,reviewed_at,rejection_reason,updated_at,
      current_application_id,schema_version,policy_version,workflow_status,assurance_level,verification_mode,submitted_at,next_review_at,required_action,risk_score,risk_rating,
      identity_verification_status,liveness_status,sanctions_status,pep_screening_status,adverse_media_status,nationality,country_of_birth,residence_country,address_line1,address_line2,
      city,region,postal_code,employment_status,occupation,employer_name,source_of_funds,source_of_wealth,account_purpose,expected_monthly_volume_band,
      expected_monthly_tx_count_band,pep_self_declared,pep_related_declared,tax_residencies)
    VALUES(p_user_id,v_full_name,v_dob,v_address_line1,v_front_path,v_selfie_path,'pending',NULL,NULL,NULL,now(),v_application_id,v_policy.schema_version,v_policy.policy_version,
      'submitted','pending','hybrid',now(),NULL,NULL,v_risk_score,v_risk_rating,'pending','pending','pending','pending',CASE WHEN v_policy.require_adverse_media_screening THEN 'pending' ELSE 'not_applicable' END,
      v_nationality,v_country_of_birth,v_residence_country,v_address_line1,v_address_line2,v_city,v_region,v_postal_code,v_employment_status,v_occupation,v_employer_name,
      v_source_of_funds,v_source_of_wealth,v_account_purpose,v_volume_band,v_tx_band,v_pep_self,v_pep_related,v_tax_residencies);
    v_event:='submitted';
  ELSE
    UPDATE public.kyc_profiles SET "fullName"=v_full_name,dob=v_dob,address=v_address_line1,id_path=v_front_path,selfie_path=v_selfie_path,status='pending',reviewed_by=NULL,reviewed_at=NULL,
      rejection_reason=NULL,updated_at=now(),current_application_id=v_application_id,schema_version=v_policy.schema_version,policy_version=v_policy.policy_version,workflow_status='submitted',
      assurance_level='pending',verification_mode='hybrid',submitted_at=now(),next_review_at=NULL,required_action=NULL,risk_score=v_risk_score,risk_rating=v_risk_rating,
      identity_verification_status='pending',liveness_status='pending',sanctions_status='pending',pep_screening_status='pending',
      adverse_media_status=CASE WHEN v_policy.require_adverse_media_screening THEN 'pending' ELSE 'not_applicable' END,nationality=v_nationality,country_of_birth=v_country_of_birth,
      residence_country=v_residence_country,address_line1=v_address_line1,address_line2=v_address_line2,city=v_city,region=v_region,postal_code=v_postal_code,
      employment_status=v_employment_status,occupation=v_occupation,employer_name=v_employer_name,source_of_funds=v_source_of_funds,source_of_wealth=v_source_of_wealth,
      account_purpose=v_account_purpose,expected_monthly_volume_band=v_volume_band,expected_monthly_tx_count_band=v_tx_band,pep_self_declared=v_pep_self,
      pep_related_declared=v_pep_related,tax_residencies=v_tax_residencies WHERE user_id=p_user_id;
    v_event:='resubmitted';
  END IF;
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES(p_user_id,p_user_id,v_event,CASE WHEN v_profile_exists THEN COALESCE(v_existing.workflow_status,v_existing.status) ELSE NULL END,'submitted',NULL,
    jsonb_build_object('applicationId',v_application_id,'applicationVersion',v_application_version,'schemaVersion',v_policy.schema_version,'policyVersion',v_policy.policy_version,
      'riskScore',v_risk_score,'riskRating',v_risk_rating,'documentType',v_document_type,'issuingCountry',v_issuing_country,'documentLast4',v_document_last4));
  RETURN jsonb_build_object('ok',true,'status','pending','workflowStatus','submitted','applicationId',v_application_id,'applicationVersion',v_application_version,
    'schemaVersion',v_policy.schema_version,'policyVersion',v_policy.policy_version,'riskRating',v_risk_rating,'event',v_event);
END $$;

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
  IF v_check_type NOT IN('document_verification','liveness','sanctions','pep','adverse_media','proof_of_address')
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

CREATE OR REPLACE FUNCTION public.review_kyc_v3(
  p_admin_user_id uuid,p_user_id uuid,p_decision text,p_reason text DEFAULT NULL,p_required_action text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE
  v_role text; v_profile public.kyc_profiles%ROWTYPE; v_application public.kyc_applications_v3%ROWTYPE; v_policy public.kyc_policy_versions_v3%ROWTYPE;
  v_decision text:=lower(btrim(COALESCE(p_decision,''))); v_reason text:=NULLIF(btrim(COALESCE(p_reason,'')),''); v_required_action text:=NULLIF(btrim(COALESCE(p_required_action,'')),'');
  v_next_review timestamptz; v_months integer; v_status text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN('admin','super_admin','kyc_officer') THEN RAISE EXCEPTION 'KYC_V3_REVIEW_NOT_AUTHORIZED' USING ERRCODE='P0001'; END IF;
  IF v_decision NOT IN('approved','rejected','needs_more_info') THEN RAISE EXCEPTION 'KYC_V3_INVALID_REVIEW_DECISION' USING ERRCODE='P0001'; END IF;
  IF v_decision IN('rejected','needs_more_info') AND v_reason IS NULL THEN RAISE EXCEPTION 'KYC_V3_REVIEW_REASON_REQUIRED' USING ERRCODE='P0001'; END IF;
  IF v_reason IS NOT NULL AND length(v_reason)>500 THEN RAISE EXCEPTION 'KYC_V3_REVIEW_REASON_TOO_LONG' USING ERRCODE='P0001'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC-V3:'||p_user_id::text,0));
  SELECT * INTO v_profile FROM public.kyc_profiles WHERE user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR v_profile.current_application_id IS NULL THEN RETURN jsonb_build_object('ok',false,'code','KYC_NOT_FOUND','message','KYC application not found'); END IF;
  SELECT * INTO v_application FROM public.kyc_applications_v3 WHERE id=v_profile.current_application_id FOR UPDATE;
  SELECT * INTO v_policy FROM public.kyc_policy_versions_v3 WHERE policy_version=v_application.policy_version;

  IF v_application.workflow_status=v_decision OR (v_decision='approved' AND v_profile.status='approved') THEN
    RETURN jsonb_build_object('ok',true,'status',v_profile.status,'workflowStatus',v_application.workflow_status,'idempotentReplay',true,'reviewedAt',v_profile.reviewed_at);
  END IF;
  IF v_application.workflow_status NOT IN('submitted','in_review','needs_more_info') THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_REVIEW_TERMINAL','message','KYC application is not reviewable','workflowStatus',v_application.workflow_status);
  END IF;

  IF v_decision='approved' THEN
    IF v_policy.require_document_verification AND COALESCE(v_profile.identity_verification_status,'pending') NOT IN('verified','manual_verified') THEN RETURN jsonb_build_object('ok',false,'code','DOCUMENT_VERIFICATION_REQUIRED','message','Document verification must be completed before approval'); END IF;
    IF v_policy.require_liveness AND COALESCE(v_profile.liveness_status,'pending') NOT IN('verified','manual_verified') THEN RETURN jsonb_build_object('ok',false,'code','LIVENESS_REQUIRED','message','Liveness verification must be completed before approval'); END IF;
    IF v_policy.require_sanctions_screening AND COALESCE(v_profile.sanctions_status,'pending') NOT IN('clear','manual_clear') THEN RETURN jsonb_build_object('ok',false,'code','SANCTIONS_SCREENING_REQUIRED','message','Sanctions screening must be clear before approval'); END IF;
    IF v_policy.require_pep_screening AND COALESCE(v_profile.pep_screening_status,'pending') NOT IN('clear','manual_clear','confirmed_pep') THEN RETURN jsonb_build_object('ok',false,'code','PEP_SCREENING_REQUIRED','message','PEP screening must be completed before approval'); END IF;
    IF v_policy.require_adverse_media_screening AND COALESCE(v_profile.adverse_media_status,'pending') NOT IN('clear','manual_clear','not_applicable') THEN RETURN jsonb_build_object('ok',false,'code','ADVERSE_MEDIA_SCREENING_REQUIRED','message','Adverse-media screening must be completed before approval'); END IF;
    IF (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high') AND v_role NOT IN('admin','super_admin') THEN RETURN jsonb_build_object('ok',false,'code','SENIOR_APPROVAL_REQUIRED','message','High-risk or PEP KYC requires senior approval'); END IF;
    IF (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high') AND NULLIF(btrim(COALESCE(v_application.source_of_wealth,'')),'') IS NULL THEN RETURN jsonb_build_object('ok',false,'code','SOURCE_OF_WEALTH_REQUIRED','message','Source of wealth is required for enhanced due diligence'); END IF;
    IF COALESCE(v_profile.sanctions_status,'pending')='confirmed_match' THEN RETURN jsonb_build_object('ok',false,'code','SANCTIONS_MATCH_BLOCKS_APPROVAL','message','Confirmed sanctions match blocks approval'); END IF;
    v_months:=CASE v_application.risk_rating WHEN 'high' THEN v_policy.high_risk_review_months WHEN 'medium' THEN v_policy.medium_risk_review_months ELSE v_policy.low_risk_review_months END;
    IF v_application.pep_self_declared OR v_application.pep_related_declared THEN v_months:=LEAST(v_months,v_policy.high_risk_review_months); END IF;
    v_next_review:=now()+make_interval(months=>v_months);
  END IF;

  v_status:=CASE WHEN v_decision='approved' THEN 'approved' ELSE 'rejected' END;
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true); PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
  UPDATE public.kyc_profiles SET status=v_status,workflow_status=v_decision,assurance_level=CASE WHEN v_decision='approved' AND (v_application.pep_self_declared OR v_application.pep_related_declared OR v_application.risk_rating='high') THEN 'enhanced' WHEN v_decision='approved' THEN 'standard' ELSE assurance_level END,
    reviewed_by=p_admin_user_id,reviewed_at=now(),rejection_reason=CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
    required_action=CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END,
    next_review_at=CASE WHEN v_decision='approved' THEN v_next_review ELSE NULL END,updated_at=now() WHERE user_id=p_user_id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true); PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);
  UPDATE public.kyc_applications_v3 SET workflow_status=v_decision,reviewed_by=p_admin_user_id,reviewed_at=now(),rejection_reason=CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
    required_action=CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END,next_review_at=CASE WHEN v_decision='approved' THEN v_next_review ELSE NULL END,
    assurance_level=CASE WHEN v_decision='approved' AND (pep_self_declared OR pep_related_declared OR risk_rating='high') THEN 'enhanced' WHEN v_decision='approved' THEN 'standard' ELSE assurance_level END,updated_at=now() WHERE id=v_application.id;
  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES(p_user_id,p_admin_user_id,v_decision,v_application.workflow_status,v_decision,CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,
    jsonb_build_object('applicationId',v_application.id,'riskRating',v_application.risk_rating,'nextReviewAt',v_next_review,'requiredAction',CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END));
  RETURN jsonb_build_object('ok',true,'status',v_status,'workflowStatus',v_decision,'idempotentReplay',false,'reviewedBy',p_admin_user_id,'reviewedAt',now(),
    'rejectionReason',CASE WHEN v_decision='approved' THEN NULL ELSE v_reason END,'requiredAction',CASE WHEN v_decision='needs_more_info' THEN COALESCE(v_required_action,'resubmit_requested_information') ELSE NULL END,'nextReviewAt',v_next_review);
END $$;

-- Preserve every existing approved user. They become explicit legacy/manual KYC
-- and are scheduled for refresh instead of being de-approved.
DO $$ BEGIN
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  UPDATE public.kyc_profiles SET
    workflow_status=COALESCE(workflow_status,CASE status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' ELSE 'submitted' END),
    assurance_level=COALESCE(assurance_level,CASE WHEN status='approved' THEN 'legacy_manual' ELSE 'pending' END),
    verification_mode=COALESCE(verification_mode,CASE WHEN status='approved' THEN 'legacy_manual' ELSE 'hybrid' END),
    submitted_at=COALESCE(submitted_at,created_at,updated_at),risk_score=COALESCE(risk_score,0),risk_rating=COALESCE(risk_rating,'low'),
    identity_verification_status=COALESCE(identity_verification_status,CASE WHEN status='approved' THEN 'manual_verified' ELSE 'pending' END),
    liveness_status=COALESCE(liveness_status,CASE WHEN status='approved' THEN 'manual_verified' ELSE 'pending' END),
    sanctions_status=COALESCE(sanctions_status,CASE WHEN status='approved' THEN 'manual_clear' ELSE 'pending' END),
    pep_screening_status=COALESCE(pep_screening_status,CASE WHEN status='approved' THEN 'manual_clear' ELSE 'pending' END),
    adverse_media_status=COALESCE(adverse_media_status,'not_applicable'),next_review_at=CASE WHEN status='approved' THEN COALESCE(next_review_at,now()+interval '12 months') ELSE next_review_at END,
    address_line1=COALESCE(address_line1,address)
  WHERE current_application_id IS NULL;
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);
END $$;

REVOKE ALL ON FUNCTION public.kyc_active_policy_v3() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.kyc_active_policy_v3() FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb) FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) FROM %I',r);
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.kyc_active_policy_v3() TO service_role;
    GRANT EXECUTE ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) TO service_role;
  END IF;
END $$;

COMMENT ON FUNCTION public.submit_kyc_v3(uuid,jsonb,text,text) IS 'Versioned KYC v3 submission: CDD profile, document fingerprint, consent evidence, onboarding risk and provider jobs.';
COMMENT ON FUNCTION public.review_kyc_v3(uuid,uuid,text,text,text) IS 'Controlled KYC v3 review with mandatory checks and senior approval for high-risk/PEP cases.';

COMMIT;
