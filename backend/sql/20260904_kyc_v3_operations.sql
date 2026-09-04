BEGIN;

ALTER TABLE public.kyc_policy_versions_v3
  ADD COLUMN IF NOT EXISTS retention_years integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS review_grace_days integer NOT NULL DEFAULT 30;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='kyc_policy_v3_retention_years_check') THEN
    ALTER TABLE public.kyc_policy_versions_v3 ADD CONSTRAINT kyc_policy_v3_retention_years_check CHECK(retention_years BETWEEN 1 AND 25);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='kyc_policy_v3_review_grace_days_check') THEN
    ALTER TABLE public.kyc_policy_versions_v3 ADD CONSTRAINT kyc_policy_v3_review_grace_days_check CHECK(review_grace_days BETWEEN 0 AND 365);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.kyc_retention_v3 (
  application_id uuid PRIMARY KEY REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  minimum_retain_until timestamptz NOT NULL,
  relationship_ended_at timestamptz,
  legal_hold boolean NOT NULL DEFAULT false,
  legal_hold_reason text,
  legal_hold_set_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  legal_hold_set_at timestamptz,
  disposition_status text NOT NULL DEFAULT 'retain'
    CHECK(disposition_status IN('retain','review_for_purge','purged')),
  purge_reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  purge_reviewed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_retention_v3_due_idx
  ON public.kyc_retention_v3(minimum_retain_until,application_id)
  WHERE legal_hold=false AND disposition_status='retain';

CREATE TABLE IF NOT EXISTS public.kyc_evidence_access_log_v3 (
  id bigserial PRIMARY KEY,
  application_id uuid NOT NULL REFERENCES public.kyc_applications_v3(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  admin_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK(action IN('DETAIL_VIEW','SIGNED_EVIDENCE_ISSUED')),
  reason text,
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kyc_evidence_access_log_v3_app_idx
  ON public.kyc_evidence_access_log_v3(application_id,created_at DESC);
CREATE INDEX IF NOT EXISTS kyc_evidence_access_log_v3_admin_idx
  ON public.kyc_evidence_access_log_v3(admin_user_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.initialize_kyc_retention_v3()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE v_years integer;
BEGIN
  SELECT retention_years INTO v_years
  FROM public.kyc_policy_versions_v3
  WHERE policy_version=NEW.policy_version;
  INSERT INTO public.kyc_retention_v3(application_id,user_id,minimum_retain_until)
  VALUES(NEW.id,NEW.user_id,NEW.created_at + make_interval(years=>COALESCE(v_years,5)))
  ON CONFLICT(application_id) DO NOTHING;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kyc_applications_v3_initialize_retention ON public.kyc_applications_v3;
CREATE TRIGGER kyc_applications_v3_initialize_retention
AFTER INSERT ON public.kyc_applications_v3
FOR EACH ROW EXECUTE FUNCTION public.initialize_kyc_retention_v3();

INSERT INTO public.kyc_retention_v3(application_id,user_id,minimum_retain_until)
SELECT a.id,a.user_id,a.created_at + make_interval(years=>COALESCE(p.retention_years,5))
FROM public.kyc_applications_v3 a
JOIN public.kyc_policy_versions_v3 p ON p.policy_version=a.policy_version
ON CONFLICT(application_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reject_kyc_access_log_mutation_v3()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'KYC_ACCESS_LOG_IMMUTABLE' USING ERRCODE='P0001';
END $$;
DROP TRIGGER IF EXISTS kyc_evidence_access_log_v3_immutable ON public.kyc_evidence_access_log_v3;
CREATE TRIGGER kyc_evidence_access_log_v3_immutable
BEFORE UPDATE OR DELETE ON public.kyc_evidence_access_log_v3
FOR EACH ROW EXECUTE FUNCTION public.reject_kyc_access_log_mutation_v3();

CREATE OR REPLACE FUNCTION public.set_kyc_legal_hold_v3(
  p_admin_user_id uuid,p_application_id uuid,p_enabled boolean,p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_role text; v_row public.kyc_retention_v3%ROWTYPE; v_reason text:=NULLIF(btrim(COALESCE(p_reason,'')),'');
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN('admin','super_admin') THEN RAISE EXCEPTION 'KYC_RETENTION_NOT_AUTHORIZED' USING ERRCODE='P0001'; END IF;
  IF p_enabled AND v_reason IS NULL THEN RAISE EXCEPTION 'KYC_LEGAL_HOLD_REASON_REQUIRED' USING ERRCODE='P0001'; END IF;
  UPDATE public.kyc_retention_v3 SET legal_hold=COALESCE(p_enabled,false),legal_hold_reason=CASE WHEN p_enabled THEN v_reason ELSE NULL END,
    legal_hold_set_by=CASE WHEN p_enabled THEN p_admin_user_id ELSE NULL END,legal_hold_set_at=CASE WHEN p_enabled THEN now() ELSE NULL END,updated_at=now()
  WHERE application_id=p_application_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','KYC_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok',true,'applicationId',p_application_id,'legalHold',v_row.legal_hold,'minimumRetainUntil',v_row.minimum_retain_until);
END $$;

CREATE OR REPLACE FUNCTION public.mark_kyc_periodic_reviews_due_v3(p_batch_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
DECLARE v_count integer:=0; r record;
BEGIN
  FOR r IN
    SELECT k.user_id,k.current_application_id,k.workflow_status,k.next_review_at,p.review_grace_days
    FROM public.kyc_profiles k
    JOIN public.kyc_applications_v3 a ON a.id=k.current_application_id
    JOIN public.kyc_policy_versions_v3 p ON p.policy_version=a.policy_version
    WHERE k.status='approved'
      AND k.next_review_at IS NOT NULL
      AND k.next_review_at + make_interval(days=>p.review_grace_days) <= now()
    ORDER BY k.next_review_at,k.user_id
    LIMIT LEAST(GREATEST(COALESCE(p_batch_limit,1000),1),10000)
    FOR UPDATE OF k SKIP LOCKED
  LOOP
    PERFORM set_config('jeezpay.kyc_lifecycle_v3','on',true);
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','on',true);
    UPDATE public.kyc_profiles SET status='pending',workflow_status='expired',required_action='periodic_review',updated_at=now()
    WHERE user_id=r.user_id AND current_application_id=r.current_application_id AND status='approved';
    PERFORM set_config('jeezpay.kyc_lifecycle_v2','off',true);
    PERFORM set_config('jeezpay.kyc_lifecycle_v3','off',true);

    UPDATE public.kyc_applications_v3 SET workflow_status='expired',required_action='periodic_review',updated_at=now()
    WHERE id=r.current_application_id AND workflow_status='approved';

    INSERT INTO public.kyc_review_events(user_id,actor_user_id,event_type,from_status,to_status,reason,snapshot)
    VALUES(r.user_id,NULL,'periodic_review_due','approved','expired','Periodic KYC refresh overdue after grace period',
      jsonb_build_object('applicationId',r.current_application_id,'nextReviewAt',r.next_review_at,'graceDays',r.review_grace_days));

    PERFORM public.set_compliance_entity_control_v1(
      (SELECT id FROM public.users WHERE role IN('super_admin','admin') AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END,id LIMIT 1),
      'USER',r.user_id::text,'review','KYC periodic review overdue',NULL
    );
    v_count:=v_count+1;
  END LOOP;
  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.kyc_purge_candidates_v3(p_limit integer DEFAULT 1000)
RETURNS TABLE(application_id uuid,user_id uuid,minimum_retain_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,extensions AS $$
  SELECT r.application_id,r.user_id,r.minimum_retain_until
  FROM public.kyc_retention_v3 r
  WHERE r.legal_hold=false
    AND r.disposition_status='retain'
    AND r.relationship_ended_at IS NOT NULL
    AND r.minimum_retain_until <= now()
  ORDER BY r.minimum_retain_until,r.application_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit,1000),1),10000);
$$;

ALTER TABLE public.kyc_retention_v3 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_evidence_access_log_v3 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyc_retention_v3 FROM PUBLIC;
REVOKE ALL ON public.kyc_evidence_access_log_v3 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.kyc_purge_candidates_v3(integer) FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON public.kyc_retention_v3 TO service_role;
    GRANT SELECT,INSERT ON public.kyc_evidence_access_log_v3 TO service_role;
    GRANT EXECUTE ON FUNCTION public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.mark_kyc_periodic_reviews_due_v3(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.kyc_purge_candidates_v3(integer) TO service_role;
  END IF;
END $$;

COMMENT ON TABLE public.kyc_retention_v3 IS 'KYC record-retention and legal-hold controls. Purge is never automatic; candidates require disposition review.';
COMMENT ON TABLE public.kyc_evidence_access_log_v3 IS 'Immutable audit of privileged KYC evidence access.';

COMMIT;
