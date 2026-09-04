BEGIN;

CREATE OR REPLACE FUNCTION public.claim_kyc_application_v3(
  p_admin_user_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE
  v_role text;
  v_app public.kyc_applications%ROWTYPE;
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE id=p_admin_user_id
    AND COALESCE(is_active,true)=true
    AND COALESCE(is_system,false)=false;

  IF v_role NOT IN ('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'KYC_V3_REVIEWER_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('KYC-CLAIM:'||p_user_id::text,0));

  SELECT * INTO v_app
  FROM public.kyc_applications
  WHERE user_id=p_user_id AND schema_version>=3
  ORDER BY application_version DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_V3_APPLICATION_NOT_FOUND');
  END IF;

  IF v_app.workflow_status IN ('approved','rejected','expired','cancelled') THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_V3_APPLICATION_CLOSED','workflowStatus',v_app.workflow_status);
  END IF;

  IF v_app.assigned_to IS NOT NULL AND v_app.assigned_to <> p_admin_user_id THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_ALREADY_ASSIGNED','assignedTo',v_app.assigned_to);
  END IF;

  UPDATE public.kyc_applications
  SET assigned_to=p_admin_user_id,
      assigned_at=COALESCE(assigned_at,now()),
      workflow_status=CASE WHEN workflow_status='submitted' THEN 'in_review' ELSE workflow_status END,
      updated_at=now()
  WHERE id=v_app.id
  RETURNING * INTO v_app;

  INSERT INTO public.kyc_review_events(
    user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot
  )
  SELECT p_user_id,p_admin_user_id,'in_review','pending','in_review',NULL,
         jsonb_build_object('applicationId',v_app.id,'assignedTo',p_admin_user_id)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.kyc_review_events
    WHERE user_id=p_user_id AND event_type='in_review'
      AND snapshot->>'applicationId'=v_app.id::text
      AND snapshot->>'assignedTo'=p_admin_user_id::text
  );

  RETURN jsonb_build_object(
    'ok',true,'applicationId',v_app.id,'workflowStatus',v_app.workflow_status,
    'assignedTo',v_app.assigned_to,'assignedAt',v_app.assigned_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE EXECUTE ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT EXECUTE ON FUNCTION public.claim_kyc_application_v3(uuid,uuid) TO service_role;
  END IF;
END $$;

COMMIT;
