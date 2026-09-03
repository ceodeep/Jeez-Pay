BEGIN;

-- Phase 5.1: KYC lifecycle hardening.
-- Keeps existing kyc_profiles data compatible while moving all future
-- submission/review state transitions behind service-role-only RPCs.

ALTER TABLE public.kyc_profiles
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

CREATE TABLE IF NOT EXISTS public.kyc_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_review_events_event_type_check
    CHECK (event_type IN ('submitted','resubmitted','approved','rejected')),
  CONSTRAINT kyc_review_events_status_check
    CHECK (to_status IN ('pending','approved','rejected')),
  CONSTRAINT kyc_review_events_snapshot_object
    CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS kyc_review_events_user_created_idx
  ON public.kyc_review_events(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_kyc_review_event_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'KYC_REVIEW_EVENT_IMMUTABLE' USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS kyc_review_events_immutable_v2
  ON public.kyc_review_events;
CREATE TRIGGER kyc_review_events_immutable_v2
BEFORE UPDATE OR DELETE ON public.kyc_review_events
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_review_event_mutation_v2();

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
     OR NEW.id_path NOT LIKE v_prefix || 'id\_%' ESCAPE '\\'
     OR NEW.selfie_path NOT LIKE v_prefix || 'selfie\_%' ESCAPE '\\'
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

DROP TRIGGER IF EXISTS kyc_document_paths_guard_v2
  ON public.kyc_profiles;
CREATE TRIGGER kyc_document_paths_guard_v2
BEFORE INSERT OR UPDATE OF id_path, selfie_path, user_id ON public.kyc_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_document_paths_v2();

CREATE OR REPLACE FUNCTION public.guard_kyc_lifecycle_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('jeezpay.kyc_lifecycle_v2', true) IS DISTINCT FROM 'on'
       AND (
         COALESCE(NEW.status, 'pending') <> 'pending'
         OR NEW.reviewed_by IS NOT NULL
         OR NEW.reviewed_at IS NOT NULL
         OR NEW.rejection_reason IS NOT NULL
       )
    THEN
      RAISE EXCEPTION 'KYC_LIFECYCLE_DIRECT_MUTATION_FORBIDDEN' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF current_setting('jeezpay.kyc_lifecycle_v2', true) IS DISTINCT FROM 'on'
     AND (
       NEW.status IS DISTINCT FROM OLD.status
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
     )
  THEN
    RAISE EXCEPTION 'KYC_LIFECYCLE_DIRECT_MUTATION_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kyc_lifecycle_guard_v2
  ON public.kyc_profiles;
CREATE TRIGGER kyc_lifecycle_guard_v2
BEFORE INSERT OR UPDATE OF status, reviewed_by, reviewed_at, rejection_reason
ON public.kyc_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_kyc_lifecycle_mutation_v2();

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

  IF v_id_path NOT LIKE p_user_id::text || '/id\_%' ESCAPE '\\'
     OR v_selfie_path NOT LIKE p_user_id::text || '/selfie\_%' ESCAPE '\\'
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

CREATE OR REPLACE FUNCTION public.review_kyc_v2(
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
  v_decision text := lower(btrim(COALESCE(p_decision,'')));
  v_reason text := NULLIF(btrim(COALESCE(p_reason,'')), '');
  v_admin_role text;
  v_existing public.kyc_profiles%ROWTYPE;
  v_saved public.kyc_profiles%ROWTYPE;
BEGIN
  IF p_admin_user_id IS NULL OR p_user_id IS NULL
     OR v_decision NOT IN ('approved','rejected')
  THEN
    RAISE EXCEPTION 'KYC_REVIEW_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_admin_role
  FROM public.users
  WHERE id = p_admin_user_id
    AND COALESCE(is_system,false) = false
    AND COALESCE(is_active,true) = true;

  IF v_admin_role IS NULL
     OR v_admin_role NOT IN ('admin','super_admin','kyc_officer')
  THEN
    RAISE EXCEPTION 'KYC_REVIEW_ADMIN_NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;

  IF v_decision = 'rejected' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'KYC_REVIEW_REJECTION_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_reason IS NOT NULL AND length(v_reason) > 500 THEN
    RAISE EXCEPTION 'KYC_REVIEW_REASON_TOO_LONG' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC:' || p_user_id::text,0));

  SELECT * INTO v_existing
  FROM public.kyc_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'KYC_NOT_FOUND',
      'message', 'KYC record not found'
    );
  END IF;

  IF v_existing.status = v_decision THEN
    RETURN jsonb_build_object(
      'ok', true,
      'status', v_existing.status,
      'idempotentReplay', true,
      'reviewedBy', v_existing.reviewed_by,
      'reviewedAt', v_existing.reviewed_at,
      'rejectionReason', v_existing.rejection_reason
    );
  END IF;

  IF v_existing.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'KYC_REVIEW_TERMINAL',
      'message', 'Only pending KYC records can be reviewed',
      'status', v_existing.status
    );
  END IF;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);

  UPDATE public.kyc_profiles
  SET status = v_decision,
      reviewed_by = p_admin_user_id,
      reviewed_at = now(),
      rejection_reason = CASE WHEN v_decision = 'rejected' THEN v_reason ELSE NULL END,
      updated_at = now()
  WHERE user_id = p_user_id
  RETURNING * INTO v_saved;

  PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);

  INSERT INTO public.kyc_review_events(
    user_id, actor_user_id, event_type, from_status, to_status, reason, snapshot
  ) VALUES (
    p_user_id,
    p_admin_user_id,
    v_decision,
    v_existing.status,
    v_decision,
    CASE WHEN v_decision = 'rejected' THEN v_reason ELSE NULL END,
    jsonb_build_object(
      'reviewedBy', p_admin_user_id,
      'reviewedAt', v_saved.reviewed_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'status', v_decision,
    'idempotentReplay', false,
    'reviewedBy', p_admin_user_id,
    'reviewedAt', v_saved.reviewed_at,
    'rejectionReason', v_saved.rejection_reason
  );
END;
$$;

ALTER TABLE public.kyc_review_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kyc_review_events FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_kyc_v2(uuid,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_kyc_v2(uuid,uuid,text,text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.kyc_review_events FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.submit_kyc_v2(uuid,text,text,text,text,text) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.review_kyc_v2(uuid,uuid,text,text) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.kyc_review_events FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.submit_kyc_v2(uuid,text,text,text,text,text) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.review_kyc_v2(uuid,uuid,text,text) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT SELECT, INSERT ON TABLE public.kyc_review_events TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.submit_kyc_v2(uuid,text,text,text,text,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.review_kyc_v2(uuid,uuid,text,text) TO service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.kyc_review_events IS
  'Immutable Phase 5.1 KYC submission/review lifecycle evidence.';
COMMENT ON FUNCTION public.submit_kyc_v2(uuid,text,text,text,text,text) IS
  'Service-role-only KYC submission/resubmission primitive with document ownership and terminal-state enforcement.';
COMMENT ON FUNCTION public.review_kyc_v2(uuid,uuid,text,text) IS
  'Service-role-only KYC approve/reject primitive with reviewer attribution and immutable review events.';

COMMIT;
