BEGIN;

ALTER TABLE public.kyc_applications_v3
  ADD COLUMN IF NOT EXISTS review_seq bigserial,
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS kyc_applications_v3_review_seq_uidx
  ON public.kyc_applications_v3(review_seq);
CREATE INDEX IF NOT EXISTS kyc_applications_v3_review_queue_scale_idx
  ON public.kyc_applications_v3(workflow_status,risk_rating,review_seq DESC);
CREATE INDEX IF NOT EXISTS kyc_applications_v3_assignment_idx
  ON public.kyc_applications_v3(assigned_to,workflow_status,review_seq DESC)
  WHERE assigned_to IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_kyc_application_v3(
  p_admin_user_id uuid,
  p_application_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE
  v_role text;
  v_row public.kyc_applications_v3%ROWTYPE;
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE id=p_admin_user_id
    AND COALESCE(is_active,true)=true
    AND COALESCE(is_system,false)=false;

  IF v_role NOT IN('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_CLAIM_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_row
  FROM public.kyc_applications_v3
  WHERE id=p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_NOT_FOUND','message','KYC application not found');
  END IF;

  IF v_row.workflow_status NOT IN('submitted','in_review','needs_more_info') THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_REVIEW_TERMINAL','message','KYC application is closed');
  END IF;

  IF v_row.assigned_to IS NOT NULL AND v_row.assigned_to<>p_admin_user_id THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_ALREADY_ASSIGNED','message','KYC application is assigned to another reviewer','assignedTo',v_row.assigned_to);
  END IF;

  UPDATE public.kyc_applications_v3
  SET assigned_to=p_admin_user_id,
      assigned_at=COALESCE(assigned_at,now()),
      workflow_status=CASE WHEN workflow_status='submitted' THEN 'in_review' ELSE workflow_status END,
      updated_at=now()
  WHERE id=p_application_id
  RETURNING * INTO v_row;

  PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
  UPDATE public.kyc_profiles
  SET workflow_status=CASE WHEN workflow_status='submitted' THEN 'in_review' ELSE workflow_status END,
      updated_at=now()
  WHERE user_id=v_row.user_id
    AND current_application_id=v_row.id;
  PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

  INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
  VALUES(
    v_row.user_id,p_admin_user_id,'in_review','submitted',v_row.workflow_status,NULL,
    jsonb_build_object('applicationId',v_row.id,'assignedTo',p_admin_user_id,'assignedAt',v_row.assigned_at)
  );

  RETURN jsonb_build_object(
    'ok',true,
    'applicationId',v_row.id,
    'assignedTo',v_row.assigned_to,
    'assignedAt',v_row.assigned_at,
    'workflowStatus',v_row.workflow_status
  );
END $$;

REVOKE ALL ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE EXECUTE ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) FROM anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) FROM authenticated;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) TO service_role;
  END IF;
END $$;

COMMIT;
