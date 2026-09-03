BEGIN;

-- Phase 5.1 follow-up: avoid LIKE ESCAPE ambiguity by using exact prefix checks.

CREATE OR REPLACE FUNCTION public.guard_kyc_document_paths_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_prefix text;
BEGIN
  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'KYC_USER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_prefix := NEW.user_id::text || '/';

  IF NEW.id_path IS NULL
     OR NEW.selfie_path IS NULL
     OR left(NEW.id_path, length(v_prefix) + 3) <> v_prefix || 'id_'
     OR left(NEW.selfie_path, length(v_prefix) + 7) <> v_prefix || 'selfie_'
     OR NEW.id_path LIKE '%..%'
     OR NEW.selfie_path LIKE '%..%'
     OR NEW.id_path ~* '^https?://'
     OR NEW.selfie_path ~* '^https?://'
  THEN
    RAISE EXCEPTION 'KYC_DOCUMENT_PATH_OWNERSHIP_INVALID' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_kyc_v2(
  p_user_id uuid,
  p_full_name text,
  p_dob text,
  p_address text,
  p_id_path text,
  p_selfie_path text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_full_name text := btrim(COALESCE(p_full_name,''));
  v_address text := btrim(COALESCE(p_address,''));
  v_id_path text := btrim(COALESCE(p_id_path,''));
  v_selfie_path text := btrim(COALESCE(p_selfie_path,''));
  v_dob date;
  v_existing public.kyc_profiles%ROWTYPE;
  v_saved public.kyc_profiles%ROWTYPE;
  v_event text;
  v_prefix text;
BEGIN
  IF p_user_id IS NULL
     OR v_full_name = ''
     OR v_address = ''
     OR v_id_path = ''
     OR v_selfie_path = ''
  THEN
    RAISE EXCEPTION 'KYC_SUBMISSION_REQUIRED_FIELDS' USING ERRCODE = 'P0001';
  END IF;

  IF length(v_full_name) > 200 OR length(v_address) > 500 THEN
    RAISE EXCEPTION 'KYC_SUBMISSION_FIELD_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_dob := p_dob::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'KYC_SUBMISSION_INVALID_DOB' USING ERRCODE = 'P0001';
  END;

  IF v_dob > current_date OR v_dob < DATE '1900-01-01' THEN
    RAISE EXCEPTION 'KYC_SUBMISSION_INVALID_DOB' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = p_user_id
      AND COALESCE(is_system,false) = false
      AND COALESCE(is_active,true) = true
  ) THEN
    RAISE EXCEPTION 'KYC_SUBMISSION_USER_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  v_prefix := p_user_id::text || '/';

  IF left(v_id_path, length(v_prefix) + 3) <> v_prefix || 'id_'
     OR left(v_selfie_path, length(v_prefix) + 7) <> v_prefix || 'selfie_'
     OR v_id_path LIKE '%..%'
     OR v_selfie_path LIKE '%..%'
     OR v_id_path ~* '^https?://'
     OR v_selfie_path ~* '^https?://'
  THEN
    RAISE EXCEPTION 'KYC_DOCUMENT_PATH_OWNERSHIP_INVALID' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC:' || p_user_id::text,0));

  SELECT * INTO v_existing
  FROM public.kyc_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF FOUND AND v_existing.status = 'approved' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'KYC_ALREADY_APPROVED',
      'message', 'KYC is already approved',
      'status', 'approved'
    );
  END IF;

  IF FOUND AND v_existing.status = 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'KYC_ALREADY_PENDING',
      'message', 'KYC is already pending review',
      'status', 'pending'
    );
  END IF;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);

  IF NOT FOUND THEN
    INSERT INTO public.kyc_profiles(
      user_id, "fullName", dob, address, id_path, selfie_path,
      status, reviewed_by, reviewed_at, rejection_reason, updated_at
    ) VALUES (
      p_user_id, v_full_name, v_dob, v_address, v_id_path, v_selfie_path,
      'pending', NULL, NULL, NULL, now()
    )
    RETURNING * INTO v_saved;
    v_event := 'submitted';
  ELSE
    UPDATE public.kyc_profiles
    SET "fullName" = v_full_name,
        dob = v_dob,
        address = v_address,
        id_path = v_id_path,
        selfie_path = v_selfie_path,
        status = 'pending',
        reviewed_by = NULL,
        reviewed_at = NULL,
        rejection_reason = NULL,
        updated_at = now()
    WHERE user_id = p_user_id
    RETURNING * INTO v_saved;
    v_event := 'resubmitted';
  END IF;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);

  INSERT INTO public.kyc_review_events(
    user_id, actor_user_id, event_type, from_status, to_status, reason, snapshot
  ) VALUES (
    p_user_id,
    p_user_id,
    v_event,
    CASE WHEN v_event = 'resubmitted' THEN v_existing.status ELSE NULL END,
    'pending',
    NULL,
    jsonb_build_object(
      'fullName', v_full_name,
      'dob', v_dob,
      'address', v_address,
      'idPath', v_id_path,
      'selfiePath', v_selfie_path
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'event', v_event,
    'updatedAt', v_saved.updated_at
  );
END;
$$;

COMMENT ON FUNCTION public.guard_kyc_document_paths_v2() IS
  'Phase 5.1 exact owner-prefix validation for private KYC object paths.';

COMMIT;
