BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.sanctions_sources_v1 (
  source_code text PRIMARY KEY,
  source_name text NOT NULL,
  official_url text NOT NULL,
  status text NOT NULL DEFAULT 'never_synced',
  last_sync_id uuid,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  snapshot_sha256 text,
  record_count integer NOT NULL DEFAULT 0,
  alias_count integer NOT NULL DEFAULT 0,
  data_date date,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sanctions_sources_v1_status_check
    CHECK (status IN ('never_synced','syncing','fresh','error')),
  CONSTRAINT sanctions_sources_v1_counts_nonnegative
    CHECK (record_count >= 0 AND alias_count >= 0)
);

CREATE TABLE IF NOT EXISTS public.sanctions_entities_v1 (
  id uuid PRIMARY KEY,
  source_code text NOT NULL REFERENCES public.sanctions_sources_v1(source_code) ON DELETE CASCADE,
  source_ref text NOT NULL,
  entity_type text NOT NULL DEFAULT 'unknown',
  primary_name text NOT NULL,
  normalized_primary_name text NOT NULL,
  dobs text[] NOT NULL DEFAULT '{}',
  nationalities text[] NOT NULL DEFAULT '{}',
  programs text[] NOT NULL DEFAULT '{}',
  remarks text,
  last_seen_sync_id uuid NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_code,source_ref),
  CONSTRAINT sanctions_entities_v1_type_check
    CHECK (entity_type IN ('individual','entity','vessel','aircraft','ship','unknown')),
  CONSTRAINT sanctions_entities_v1_raw_object CHECK (jsonb_typeof(raw)='object')
);

CREATE INDEX IF NOT EXISTS sanctions_entities_v1_source_idx
  ON public.sanctions_entities_v1(source_code,source_ref);
CREATE INDEX IF NOT EXISTS sanctions_entities_v1_sync_idx
  ON public.sanctions_entities_v1(source_code,last_seen_sync_id);

CREATE TABLE IF NOT EXISTS public.sanctions_names_v1 (
  entity_id uuid NOT NULL REFERENCES public.sanctions_entities_v1(id) ON DELETE CASCADE,
  source_code text NOT NULL,
  source_ref text NOT NULL,
  name_type text NOT NULL,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entity_id,normalized_name),
  CONSTRAINT sanctions_names_v1_type_check CHECK (name_type IN ('primary','alias','variation','fka'))
);

CREATE INDEX IF NOT EXISTS sanctions_names_v1_source_idx
  ON public.sanctions_names_v1(source_code,source_ref);
CREATE INDEX IF NOT EXISTS sanctions_names_v1_trgm_idx
  ON public.sanctions_names_v1 USING gin (normalized_name extensions.gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.normalize_sanctions_name_v1(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    lower(translate(COALESCE(p_name,''),
      'áàâäãåāăąçćčďđéèêëēėęěğíìîïīıłńňñóòôöõøōřśšşťúùûüūůýÿžźż',
      'aaaaaaaaacccddeeeeeeeegiiiiiilnnnooooooorssstuuuuuuyyzzz')),
    '[^a-z0-9]+',' ','g'));
$$;

CREATE OR REPLACE FUNCTION public.finalize_sanctions_source_sync_v1(
  p_source_code text,
  p_sync_id uuid,
  p_source_name text,
  p_official_url text,
  p_snapshot_sha256 text,
  p_record_count integer,
  p_alias_count integer,
  p_data_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_source_code NOT IN ('OFAC_SDN','OFAC_NON_SDN','UN_SC','UK') THEN
    RAISE EXCEPTION 'SANCTIONS_SOURCE_INVALID' USING ERRCODE='P0001';
  END IF;

  DELETE FROM public.sanctions_entities_v1
  WHERE source_code=p_source_code
    AND last_seen_sync_id<>p_sync_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  INSERT INTO public.sanctions_sources_v1(
    source_code,source_name,official_url,status,last_sync_id,last_attempt_at,last_success_at,
    snapshot_sha256,record_count,alias_count,data_date,last_error,updated_at
  ) VALUES(
    p_source_code,p_source_name,p_official_url,'fresh',p_sync_id,now(),now(),
    p_snapshot_sha256,GREATEST(COALESCE(p_record_count,0),0),GREATEST(COALESCE(p_alias_count,0),0),p_data_date,NULL,now()
  )
  ON CONFLICT(source_code) DO UPDATE SET
    source_name=EXCLUDED.source_name,
    official_url=EXCLUDED.official_url,
    status='fresh',
    last_sync_id=EXCLUDED.last_sync_id,
    last_attempt_at=now(),
    last_success_at=now(),
    snapshot_sha256=EXCLUDED.snapshot_sha256,
    record_count=EXCLUDED.record_count,
    alias_count=EXCLUDED.alias_count,
    data_date=EXCLUDED.data_date,
    last_error=NULL,
    updated_at=now();

  RETURN jsonb_build_object('ok',true,'sourceCode',p_source_code,'deletedStale',v_deleted,'recordCount',p_record_count,'aliasCount',p_alias_count);
END $$;

CREATE OR REPLACE FUNCTION public.screen_sanctions_candidates_v1(
  p_name text,
  p_dob date DEFAULT NULL,
  p_nationality text DEFAULT NULL,
  p_limit integer DEFAULT 10
)
RETURNS TABLE(
  entity_id uuid,
  source_code text,
  source_ref text,
  primary_name text,
  matched_name text,
  entity_type text,
  name_similarity numeric,
  dob_year_match boolean,
  nationality_match boolean,
  score integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
WITH input AS (
  SELECT public.normalize_sanctions_name_v1(p_name) AS n,
         CASE WHEN p_dob IS NULL THEN NULL ELSE to_char(p_dob,'YYYY') END AS y,
         lower(btrim(COALESCE(p_nationality,''))) AS nat
), candidates AS (
  SELECT
    e.id,
    e.source_code,
    e.source_ref,
    e.primary_name,
    n.display_name,
    e.entity_type,
    extensions.similarity(n.normalized_name,i.n) AS sim,
    CASE WHEN i.y IS NULL THEN false ELSE EXISTS(
      SELECT 1 FROM unnest(e.dobs) d WHERE d ILIKE '%'||i.y||'%'
    ) END AS dob_match,
    CASE WHEN i.nat='' THEN false ELSE EXISTS(
      SELECT 1 FROM unnest(e.nationalities) nat WHERE lower(nat)=i.nat
    ) END AS nat_match
  FROM public.sanctions_names_v1 n
  JOIN public.sanctions_entities_v1 e ON e.id=n.entity_id
  CROSS JOIN input i
  WHERE i.n<>''
    AND extensions.similarity(n.normalized_name,i.n)>=0.55
), ranked AS (
  SELECT *,
    LEAST(100,
      CASE WHEN sim>=0.98 THEN 90 ELSE round(sim*75)::int END
      + CASE WHEN dob_match THEN 10 ELSE 0 END
      + CASE WHEN nat_match THEN 5 ELSE 0 END
    )::int AS computed_score,
    row_number() OVER (PARTITION BY id ORDER BY sim DESC) AS rn
  FROM candidates
)
SELECT id,source_code,source_ref,primary_name,display_name,entity_type,
       round(sim::numeric,4),dob_match,nat_match,computed_score
FROM ranked
WHERE rn=1
ORDER BY computed_score DESC,sim DESC
LIMIT LEAST(GREATEST(COALESCE(p_limit,10),1),50);
$$;

CREATE OR REPLACE FUNCTION public.screen_kyc_sanctions_public_v1(
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
  v_profile public.kyc_profiles%ROWTYPE;
  v_app public.kyc_applications_v3%ROWTYPE;
  v_missing integer;
  v_candidates jsonb;
  v_top_score integer:=0;
  v_top_similarity numeric:=0;
  v_status text;
  v_reference text;
  v_check jsonb;
BEGIN
  SELECT role INTO v_role FROM public.users
  WHERE id=p_admin_user_id AND COALESCE(is_active,true)=true AND COALESCE(is_system,false)=false;
  IF v_role NOT IN('admin','super_admin','kyc_officer') THEN
    RAISE EXCEPTION 'SANCTIONS_SCREEN_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_profile FROM public.kyc_profiles WHERE user_id=p_user_id;
  IF NOT FOUND OR v_profile.current_application_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','KYC_NOT_FOUND');
  END IF;
  SELECT * INTO v_app FROM public.kyc_applications_v3 WHERE id=v_profile.current_application_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','KYC_APPLICATION_NOT_FOUND'); END IF;

  SELECT count(*) INTO v_missing
  FROM (VALUES('OFAC_SDN'),('OFAC_NON_SDN'),('UN_SC'),('UK')) req(source_code)
  LEFT JOIN public.sanctions_sources_v1 s ON s.source_code=req.source_code
  WHERE s.source_code IS NULL OR s.status<>'fresh' OR s.last_success_at<now()-interval '36 hours';

  IF v_missing>0 THEN
    RETURN jsonb_build_object('ok',false,'code','SANCTIONS_DATASET_STALE','missingOrStaleSources',v_missing);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sourceCode',c.source_code,'sourceRef',c.source_ref,'primaryName',c.primary_name,
      'matchedName',c.matched_name,'entityType',c.entity_type,'nameSimilarity',c.name_similarity,
      'dobYearMatch',c.dob_year_match,'score',c.score
    ) ORDER BY c.score DESC,c.name_similarity DESC),'[]'::jsonb),
    COALESCE(max(c.score),0),COALESCE(max(c.name_similarity),0)
  INTO v_candidates,v_top_score,v_top_similarity
  FROM public.screen_sanctions_candidates_v1(v_app.full_name,v_app.dob,v_app.nationality,10) c;

  v_status:=CASE WHEN v_top_score>=80 OR v_top_similarity>=0.93 THEN 'potential_match' ELSE 'clear' END;

  SELECT encode(extensions.digest(convert_to(string_agg(source_code||':'||COALESCE(snapshot_sha256,''),'|' ORDER BY source_code),'UTF8'),'sha256'),'hex')
  INTO v_reference
  FROM public.sanctions_sources_v1
  WHERE source_code IN('OFAC_SDN','OFAC_NON_SDN','UN_SC','UK');

  v_check:=public.record_kyc_check_v3(
    p_admin_user_id,p_user_id,'sanctions',v_status,'jeezpay_public_sanctions_v1',v_reference,
    CASE WHEN v_status='clear' THEN 'Screened against fresh OFAC, UN and UK authoritative public sanctions lists; no threshold match.'
         ELSE 'Potential public-list sanctions match requires human compliance review; no automated confirmation.' END,
    jsonb_build_object('engine','JEEZPAY_PUBLIC_SANCTIONS_V1','candidates',v_candidates,'topScore',v_top_score,'topNameSimilarity',v_top_similarity)
  );

  RETURN jsonb_build_object('ok',true,'status',v_status,'check',v_check,'candidates',v_candidates,'topScore',v_top_score,'topNameSimilarity',v_top_similarity);
END $$;

ALTER TABLE public.sanctions_sources_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sanctions_entities_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sanctions_names_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sanctions_sources_v1 FROM anon,authenticated;
REVOKE ALL ON public.sanctions_entities_v1 FROM anon,authenticated;
REVOKE ALL ON public.sanctions_names_v1 FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.finalize_sanctions_source_sync_v1(text,uuid,text,text,text,integer,integer,date) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.screen_sanctions_candidates_v1(text,date,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.screen_kyc_sanctions_public_v1(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sanctions_source_sync_v1(text,uuid,text,text,text,integer,integer,date) TO service_role;
GRANT EXECUTE ON FUNCTION public.screen_sanctions_candidates_v1(text,date,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.screen_kyc_sanctions_public_v1(uuid,uuid) TO service_role;

COMMENT ON FUNCTION public.screen_kyc_sanctions_public_v1(uuid,uuid) IS
  'Screens current KYC against fresh OFAC SDN/non-SDN, UN SC and UK sanctions data. Fuzzy hits are potential matches only; confirmation remains a human compliance decision.';

COMMIT;
