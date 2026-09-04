BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS kyc_applications_full_name_trgm_idx
  ON public.kyc_applications USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS kyc_applications_user_status_idx
  ON public.kyc_applications(user_id, workflow_status, application_version DESC);

CREATE TABLE IF NOT EXISTS public.kyc_retention_policies (
  jurisdiction_code text PRIMARY KEY,
  status text NOT NULL DEFAULT 'requires_legal_signoff',
  relationship_end_retention_months integer,
  biometric_retention_months integer,
  evidence_retention_months integer,
  legal_basis text,
  policy_version text NOT NULL,
  effective_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_retention_status_check CHECK (
    status IN ('requires_legal_signoff','active','retired')
  ),
  CONSTRAINT kyc_retention_months_positive CHECK (
    (relationship_end_retention_months IS NULL OR relationship_end_retention_months > 0)
    AND (biometric_retention_months IS NULL OR biometric_retention_months > 0)
    AND (evidence_retention_months IS NULL OR evidence_retention_months > 0)
  )
);

INSERT INTO public.kyc_retention_policies(
  jurisdiction_code,status,policy_version,legal_basis
)
VALUES (
  'GLOBAL','requires_legal_signoff','retention-2026-09-v1',
  'Retention periods must be approved for each operating jurisdiction before automated deletion is enabled.'
)
ON CONFLICT (jurisdiction_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.kyc_retention_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.kyc_applications(id) ON DELETE RESTRICT,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending_legal_review',
  requested_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  not_before timestamptz,
  completed_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_retention_actions_type_check CHECK (
    action_type IN ('delete','anonymize','restrict_processing','legal_hold','release_legal_hold')
  ),
  CONSTRAINT kyc_retention_actions_status_check CHECK (
    status IN ('pending_legal_review','approved','blocked_by_legal_hold','completed','rejected')
  ),
  CONSTRAINT kyc_retention_actions_evidence_object CHECK (jsonb_typeof(evidence)='object')
);
CREATE INDEX IF NOT EXISTS kyc_retention_actions_queue_idx
  ON public.kyc_retention_actions(status,not_before,created_at);

ALTER TABLE public.kyc_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_retention_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyc_retention_policies FROM PUBLIC;
REVOKE ALL ON public.kyc_retention_actions FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.search_kyc_queue_v3(
  p_search text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_risk_tier text DEFAULT NULL,
  p_country text DEFAULT NULL,
  p_cursor_submitted_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 51
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  application_version integer,
  schema_version integer,
  policy_version integer,
  workflow_status text,
  assurance_level text,
  verification_mode text,
  full_name text,
  nationality text,
  residence_country text,
  risk_score numeric,
  risk_tier text,
  edd_required boolean,
  screening_status text,
  provider_status text,
  assigned_to uuid,
  assigned_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  decision_reason text,
  next_review_at timestamptz,
  phone text,
  wallet_account_number bigint,
  user_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
  WITH params AS (
    SELECT
      NULLIF(btrim(COALESCE(p_search,'')),'') AS q,
      lower(NULLIF(btrim(COALESCE(p_status,'')),'')) AS status_filter,
      lower(NULLIF(btrim(COALESCE(p_risk_tier,'')),'')) AS risk_filter,
      upper(NULLIF(btrim(COALESCE(p_country,'')),'')) AS country_filter,
      LEAST(GREATEST(COALESCE(p_limit,51),1),101) AS lim
  )
  SELECT
    a.id,a.user_id,a.application_version,a.schema_version,a.policy_version,
    a.workflow_status,a.assurance_level,a.verification_mode,a.full_name,
    a.nationality,a.residence_country,a.risk_score,a.risk_tier,a.edd_required,
    a.screening_status,a.provider_status,a.assigned_to,a.assigned_at,a.submitted_at,
    a.reviewed_at,a.decision_reason,a.next_review_at,u.phone,
    u.wallet_account_number::bigint,COALESCE(u.is_active,true)
  FROM public.kyc_applications a
  JOIN public.users u ON u.id=a.user_id
  CROSS JOIN params p
  WHERE (
    p.status_filter IS NULL OR p.status_filter='all'
    OR (p.status_filter='pending' AND a.workflow_status IN ('submitted','in_review','needs_more_info'))
    OR a.workflow_status=p.status_filter
  )
  AND (p.risk_filter IS NULL OR p.risk_filter='all' OR a.risk_tier=p.risk_filter)
  AND (p.country_filter IS NULL OR p.country_filter='ALL' OR a.residence_country=p.country_filter)
  AND (
    p_cursor_submitted_at IS NULL
    OR (a.submitted_at,a.id) < (p_cursor_submitted_at,COALESCE(p_cursor_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))
  )
  AND (
    p.q IS NULL
    OR lower(a.full_name) LIKE '%'||lower(p.q)||'%'
    OR a.user_id::text=p.q
    OR lower(COALESCE(u.phone,'')) LIKE '%'||lower(p.q)||'%'
    OR u.wallet_account_number::text=p.q
  )
  ORDER BY a.submitted_at DESC,a.id DESC
  LIMIT (SELECT lim FROM params);
$$;

REVOKE ALL ON FUNCTION public.search_kyc_queue_v3(text,text,text,text,timestamptz,uuid,integer) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
      EXECUTE format('REVOKE ALL ON public.kyc_retention_policies FROM %I',r);
      EXECUTE format('REVOKE ALL ON public.kyc_retention_actions FROM %I',r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.search_kyc_queue_v3(text,text,text,text,timestamptz,uuid,integer) FROM %I',r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    GRANT SELECT,INSERT,UPDATE ON public.kyc_retention_policies TO service_role;
    GRANT SELECT,INSERT,UPDATE ON public.kyc_retention_actions TO service_role;
    GRANT EXECUTE ON FUNCTION public.search_kyc_queue_v3(text,text,text,text,timestamptz,uuid,integer) TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE public.kyc_retention_policies IS
  'Jurisdiction-configurable retention policy. Automated deletion must remain disabled until legal retention periods are approved.';
COMMENT ON FUNCTION public.search_kyc_queue_v3(text,text,text,text,timestamptz,uuid,integer) IS
  'Indexed keyset-paginated KYC reviewer queue search for large datasets.';

COMMIT;
