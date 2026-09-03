BEGIN;

-- Phase 5.2: central SSP-launch compliance monitoring at the Ledger boundary.
-- This is a technical control framework, not a declaration of regulatory
-- compliance. Default numeric rules are review-only. Explicit frozen entity
-- controls are hard blocks.

CREATE TABLE IF NOT EXISTS public.compliance_entity_controls (
  entity_type text NOT NULL,
  entity_ref text NOT NULL,
  status text NOT NULL DEFAULT 'clear',
  reason text,
  expires_at timestamptz,
  updated_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_ref),
  CONSTRAINT compliance_entity_type_check CHECK (entity_type IN ('USER','MERCHANT')),
  CONSTRAINT compliance_entity_status_check CHECK (status IN ('clear','review','frozen')),
  CONSTRAINT compliance_entity_ref_not_blank CHECK (btrim(entity_ref) <> '')
);

CREATE TABLE IF NOT EXISTS public.compliance_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL UNIQUE,
  description text NOT NULL,
  currency text,
  source_types text[],
  metric text NOT NULL,
  threshold_value numeric(38,12) NOT NULL,
  window_seconds integer,
  action text NOT NULL DEFAULT 'review',
  severity text NOT NULL DEFAULT 'medium',
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_rule_code_not_blank CHECK (btrim(rule_code) <> ''),
  CONSTRAINT compliance_rule_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT compliance_rule_metric_check CHECK (metric IN ('single_outgoing','outgoing_count_window','outgoing_volume_window')),
  CONSTRAINT compliance_rule_threshold_positive CHECK (threshold_value > 0),
  CONSTRAINT compliance_rule_window_check CHECK (
    (metric = 'single_outgoing' AND window_seconds IS NULL)
    OR (metric <> 'single_outgoing' AND window_seconds IS NOT NULL AND window_seconds > 0)
  ),
  CONSTRAINT compliance_rule_action_check CHECK (action IN ('monitor','review','block')),
  CONSTRAINT compliance_rule_severity_check CHECK (severity IN ('low','medium','high','critical')),
  CONSTRAINT compliance_rule_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL REFERENCES public.ledger_journals_v2(id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_ref text,
  entity_type text NOT NULL,
  entity_ref text NOT NULL,
  currency text NOT NULL,
  outgoing_amount numeric(38,12) NOT NULL DEFAULT 0,
  incoming_amount numeric(38,12) NOT NULL DEFAULT 0,
  decision text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  triggered_rules text[] NOT NULL DEFAULT ARRAY[]::text[],
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_event_entity_type_check CHECK (entity_type IN ('USER','MERCHANT')),
  CONSTRAINT compliance_event_currency_format CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT compliance_event_amounts_nonnegative CHECK (outgoing_amount >= 0 AND incoming_amount >= 0),
  CONSTRAINT compliance_event_decision_check CHECK (decision IN ('allow','review')),
  CONSTRAINT compliance_event_severity_check CHECK (severity IN ('low','medium','high','critical')),
  CONSTRAINT compliance_event_metadata_object CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT compliance_event_journal_entity_uidx UNIQUE (journal_id, entity_type, entity_ref, currency)
);

CREATE INDEX IF NOT EXISTS compliance_events_entity_created_idx
  ON public.compliance_events(entity_type, entity_ref, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_events_decision_created_idx
  ON public.compliance_events(decision, created_at DESC);

CREATE TABLE IF NOT EXISTS public.compliance_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.compliance_events(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_ref text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  severity text NOT NULL DEFAULT 'medium',
  assigned_to uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolution_note text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_case_entity_type_check CHECK (entity_type IN ('USER','MERCHANT')),
  CONSTRAINT compliance_case_status_check CHECK (status IN ('open','reviewing','closed')),
  CONSTRAINT compliance_case_severity_check CHECK (severity IN ('low','medium','high','critical'))
);

CREATE INDEX IF NOT EXISTS compliance_cases_status_created_idx
  ON public.compliance_cases(status, created_at DESC);

-- Immutable monitoring evidence. Cases remain mutable only through service-role
-- application code so reviewers can assign/close them.
CREATE OR REPLACE FUNCTION public.reject_compliance_event_mutation_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'COMPLIANCE_EVENT_IMMUTABLE' USING ERRCODE='P0001';
END;
$$;

DROP TRIGGER IF EXISTS compliance_events_immutable_v1 ON public.compliance_events;
CREATE TRIGGER compliance_events_immutable_v1
BEFORE UPDATE OR DELETE ON public.compliance_events
FOR EACH ROW EXECUTE FUNCTION public.reject_compliance_event_mutation_v1();

-- Seed review-only defaults. These are technical launch defaults, not legal
-- reporting thresholds. They can be tuned later without code deployment.
INSERT INTO public.compliance_rules(
  rule_code, description, currency, source_types, metric,
  threshold_value, window_seconds, action, severity, enabled, metadata
)
VALUES
  (
    'SSP_RAPID_OUTGOING_10M',
    'Review when an entity reaches 10 outgoing native money journals within 10 minutes',
    'SSP',
    ARRAY['P2P_TRANSFER_V2','MERCHANT_PAYMENT_V2','MERCHANT_PAYOUT_V2','AGENT_CASH_IN_V2','AGENT_CASH_OUT_V2','FIAT_WITHDRAWAL_V2','ADMIN_BALANCE_ADJUSTMENT_V2'],
    'outgoing_count_window',
    10,
    600,
    'review',
    'medium',
    true,
    jsonb_build_object('phase','5.2','classification','technical_default_review_only')
  )
ON CONFLICT (rule_code) DO NOTHING;

-- Derive amount/volume review defaults from the live SSP max transfer instead of
-- inventing a separate legal number. If max_transfer is absent/zero, these two
-- rules are not seeded.
INSERT INTO public.compliance_rules(
  rule_code, description, currency, source_types, metric,
  threshold_value, window_seconds, action, severity, enabled, metadata
)
SELECT
  'SSP_SINGLE_NEAR_MAX',
  'Review a single outgoing movement at or above 80% of configured SSP max transfer',
  'SSP',
  ARRAY['P2P_TRANSFER_V2','MERCHANT_PAYMENT_V2','MERCHANT_PAYOUT_V2','AGENT_CASH_IN_V2','AGENT_CASH_OUT_V2','FIAT_WITHDRAWAL_V2','ADMIN_BALANCE_ADJUSTMENT_V2'],
  'single_outgoing',
  (max_transfer::numeric * 0.80)::numeric(38,12),
  NULL,
  'review',
  'high',
  true,
  jsonb_build_object('phase','5.2','classification','derived_review_only','derivedFrom','currency_settings.max_transfer')
FROM public.currency_settings
WHERE currency='SSP'
  AND max_transfer IS NOT NULL
  AND max_transfer::numeric > 0
ON CONFLICT (rule_code) DO NOTHING;

INSERT INTO public.compliance_rules(
  rule_code, description, currency, source_types, metric,
  threshold_value, window_seconds, action, severity, enabled, metadata
)
SELECT
  'SSP_OUTGOING_VOLUME_24H',
  'Review rolling 24-hour outgoing volume at three times configured SSP max transfer',
  'SSP',
  ARRAY['P2P_TRANSFER_V2','MERCHANT_PAYMENT_V2','MERCHANT_PAYOUT_V2','AGENT_CASH_IN_V2','AGENT_CASH_OUT_V2','FIAT_WITHDRAWAL_V2','ADMIN_BALANCE_ADJUSTMENT_V2'],
  'outgoing_volume_window',
  (max_transfer::numeric * 3)::numeric(38,12),
  86400,
  'review',
  'high',
  true,
  jsonb_build_object('phase','5.2','classification','derived_review_only','derivedFrom','currency_settings.max_transfer')
FROM public.currency_settings
WHERE currency='SSP'
  AND max_transfer IS NOT NULL
  AND max_transfer::numeric > 0
ON CONFLICT (rule_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.evaluate_ledger_compliance_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_journal record;
  v_entity record;
  v_control public.compliance_entity_controls%ROWTYPE;
  v_rule public.compliance_rules%ROWTYPE;
  v_hit boolean;
  v_count numeric(38,12);
  v_triggered text[];
  v_review boolean;
  v_block boolean;
  v_severity text;
  v_event_id uuid;
  v_kyc_status text;
BEGIN
  -- post_ledger_journal_v2 inserts every journal's entries in one INSERT
  -- statement. Transition-table rows therefore contain the complete journal.
  FOR v_journal IN
    SELECT DISTINCT j.id, j.source_type, j.source_ref, j.metadata, j.created_at
    FROM new_entries ne
    JOIN public.ledger_journals_v2 j ON j.id=ne.journal_id
    WHERE j.source_type IN (
      'P2P_TRANSFER_V2',
      'MERCHANT_PAYMENT_V2',
      'MERCHANT_PAYOUT_V2',
      'AGENT_CASH_IN_V2',
      'AGENT_CASH_OUT_V2',
      'ADMIN_BALANCE_ADJUSTMENT_V2',
      'FIAT_WITHDRAWAL_V2',
      'REFERRAL_REWARD_V2'
    )
  LOOP
    FOR v_entity IN
      SELECT
        a.owner_type AS entity_type,
        a.owner_ref AS entity_ref,
        e.currency,
        sum(CASE WHEN e.amount_delta < 0 THEN -e.amount_delta ELSE 0 END)::numeric(38,12) AS outgoing_amount,
        sum(CASE WHEN e.amount_delta > 0 THEN e.amount_delta ELSE 0 END)::numeric(38,12) AS incoming_amount
      FROM public.ledger_entries_v2 e
      JOIN public.ledger_accounts_v2 a ON a.id=e.account_id
      WHERE e.journal_id=v_journal.id
        AND a.owner_type IN ('USER','MERCHANT')
        AND a.owner_ref IS NOT NULL
      GROUP BY a.owner_type,a.owner_ref,e.currency
    LOOP
      v_triggered := ARRAY[]::text[];
      v_review := false;
      v_block := false;
      v_severity := 'low';

      SELECT * INTO v_control
      FROM public.compliance_entity_controls
      WHERE entity_type=v_entity.entity_type
        AND entity_ref=v_entity.entity_ref;

      IF FOUND
         AND (v_control.expires_at IS NULL OR v_control.expires_at > now())
      THEN
        IF v_control.status='frozen' THEN
          RAISE EXCEPTION 'COMPLIANCE_ENTITY_FROZEN'
            USING ERRCODE='P0001',
                  DETAIL=jsonb_build_object(
                    'entityType',v_entity.entity_type,
                    'entityRef',v_entity.entity_ref,
                    'sourceType',v_journal.source_type
                  )::text;
        ELSIF v_control.status='review' THEN
          v_review := true;
          v_triggered := array_append(v_triggered,'ENTITY_MANUAL_REVIEW');
          v_severity := 'high';
        END IF;
      END IF;

      -- Defense in depth: user-originated outgoing SSP launch flows require an
      -- approved KYC profile even if an HTTP route is accidentally bypassed.
      IF v_entity.entity_type='USER'
         AND v_entity.outgoing_amount > 0
         AND v_journal.source_type IN (
           'P2P_TRANSFER_V2','MERCHANT_PAYMENT_V2',
           'AGENT_CASH_IN_V2','AGENT_CASH_OUT_V2',
           'FIAT_WITHDRAWAL_V2'
         )
      THEN
        SELECT status INTO v_kyc_status
        FROM public.kyc_profiles
        WHERE user_id::text=v_entity.entity_ref;

        IF v_kyc_status IS DISTINCT FROM 'approved' THEN
          RAISE EXCEPTION 'COMPLIANCE_KYC_REQUIRED'
            USING ERRCODE='P0001',
                  DETAIL=jsonb_build_object(
                    'entityType','USER',
                    'entityRef',v_entity.entity_ref,
                    'sourceType',v_journal.source_type
                  )::text;
        END IF;
      END IF;

      FOR v_rule IN
        SELECT *
        FROM public.compliance_rules r
        WHERE r.enabled IS TRUE
          AND (r.currency IS NULL OR r.currency=v_entity.currency)
          AND (r.source_types IS NULL OR v_journal.source_type=ANY(r.source_types))
        ORDER BY r.rule_code
      LOOP
        v_hit := false;
        v_count := 0;

        IF v_rule.metric='single_outgoing' THEN
          v_hit := v_entity.outgoing_amount >= v_rule.threshold_value;

        ELSIF v_rule.metric='outgoing_count_window' THEN
          SELECT count(DISTINCT j2.id)::numeric
          INTO v_count
          FROM public.ledger_entries_v2 e2
          JOIN public.ledger_accounts_v2 a2 ON a2.id=e2.account_id
          JOIN public.ledger_journals_v2 j2 ON j2.id=e2.journal_id
          WHERE a2.owner_type=v_entity.entity_type
            AND a2.owner_ref=v_entity.entity_ref
            AND e2.currency=v_entity.currency
            AND e2.amount_delta < 0
            AND j2.created_at >= now() - make_interval(secs=>v_rule.window_seconds)
            AND (v_rule.source_types IS NULL OR j2.source_type=ANY(v_rule.source_types));
          v_hit := v_count >= v_rule.threshold_value;

        ELSIF v_rule.metric='outgoing_volume_window' THEN
          SELECT COALESCE(sum(-e2.amount_delta),0)::numeric(38,12)
          INTO v_count
          FROM public.ledger_entries_v2 e2
          JOIN public.ledger_accounts_v2 a2 ON a2.id=e2.account_id
          JOIN public.ledger_journals_v2 j2 ON j2.id=e2.journal_id
          WHERE a2.owner_type=v_entity.entity_type
            AND a2.owner_ref=v_entity.entity_ref
            AND e2.currency=v_entity.currency
            AND e2.amount_delta < 0
            AND j2.created_at >= now() - make_interval(secs=>v_rule.window_seconds)
            AND (v_rule.source_types IS NULL OR j2.source_type=ANY(v_rule.source_types));
          v_hit := v_count >= v_rule.threshold_value;
        END IF;

        IF v_hit THEN
          v_triggered := array_append(v_triggered,v_rule.rule_code);

          IF v_rule.severity='critical'
             OR (v_rule.severity='high' AND v_severity NOT IN ('critical'))
             OR (v_rule.severity='medium' AND v_severity='low')
          THEN
            v_severity := v_rule.severity;
          END IF;

          IF v_rule.action='block' THEN
            v_block := true;
          ELSIF v_rule.action='review' THEN
            v_review := true;
          END IF;
        END IF;
      END LOOP;

      IF v_block THEN
        RAISE EXCEPTION 'COMPLIANCE_RULE_BLOCKED'
          USING ERRCODE='P0001',
                DETAIL=jsonb_build_object(
                  'entityType',v_entity.entity_type,
                  'entityRef',v_entity.entity_ref,
                  'sourceType',v_journal.source_type,
                  'rules',v_triggered
                )::text;
      END IF;

      INSERT INTO public.compliance_events(
        journal_id,source_type,source_ref,entity_type,entity_ref,currency,
        outgoing_amount,incoming_amount,decision,severity,triggered_rules,metadata
      ) VALUES (
        v_journal.id,v_journal.source_type,v_journal.source_ref,
        v_entity.entity_type,v_entity.entity_ref,v_entity.currency,
        v_entity.outgoing_amount,v_entity.incoming_amount,
        CASE WHEN v_review THEN 'review' ELSE 'allow' END,
        v_severity,v_triggered,
        jsonb_build_object('journalMetadata',v_journal.metadata,'phase','5.2')
      )
      ON CONFLICT (journal_id,entity_type,entity_ref,currency) DO NOTHING
      RETURNING id INTO v_event_id;

      IF v_review AND v_event_id IS NOT NULL THEN
        INSERT INTO public.compliance_cases(
          event_id,entity_type,entity_ref,status,severity
        ) VALUES (
          v_event_id,v_entity.entity_type,v_entity.entity_ref,'open',v_severity
        ) ON CONFLICT (event_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS compliance_monitor_ledger_entries_v1
  ON public.ledger_entries_v2;
CREATE TRIGGER compliance_monitor_ledger_entries_v1
AFTER INSERT ON public.ledger_entries_v2
REFERENCING NEW TABLE AS new_entries
FOR EACH STATEMENT
EXECUTE FUNCTION public.evaluate_ledger_compliance_v1();

CREATE OR REPLACE FUNCTION public.set_compliance_entity_control_v1(
  p_admin_user_id uuid,
  p_entity_type text,
  p_entity_ref text,
  p_status text,
  p_reason text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public,extensions
AS $$
DECLARE
  v_role text;
  v_entity_type text:=upper(btrim(COALESCE(p_entity_type,'')));
  v_entity_ref text:=btrim(COALESCE(p_entity_ref,''));
  v_status text:=lower(btrim(COALESCE(p_status,'')));
  v_reason text:=NULLIF(btrim(COALESCE(p_reason,'')),'');
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE id=p_admin_user_id
    AND COALESCE(is_active,true)=true
    AND COALESCE(is_system,false)=false;

  IF v_role NOT IN ('admin','super_admin') THEN
    RAISE EXCEPTION 'COMPLIANCE_ADMIN_NOT_AUTHORIZED' USING ERRCODE='P0001';
  END IF;

  IF v_entity_type NOT IN ('USER','MERCHANT')
     OR v_entity_ref=''
     OR v_status NOT IN ('clear','review','frozen')
  THEN
    RAISE EXCEPTION 'COMPLIANCE_CONTROL_INVALID_ARGUMENTS' USING ERRCODE='P0001';
  END IF;

  IF v_status <> 'clear' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'COMPLIANCE_CONTROL_REASON_REQUIRED' USING ERRCODE='P0001';
  END IF;

  INSERT INTO public.compliance_entity_controls(
    entity_type,entity_ref,status,reason,expires_at,updated_by,updated_at
  ) VALUES (
    v_entity_type,v_entity_ref,v_status,v_reason,p_expires_at,p_admin_user_id,now()
  )
  ON CONFLICT (entity_type,entity_ref)
  DO UPDATE SET
    status=EXCLUDED.status,
    reason=EXCLUDED.reason,
    expires_at=EXCLUDED.expires_at,
    updated_by=EXCLUDED.updated_by,
    updated_at=now();

  RETURN jsonb_build_object(
    'ok',true,
    'entityType',v_entity_type,
    'entityRef',v_entity_ref,
    'status',v_status,
    'expiresAt',p_expires_at
  );
END;
$$;

ALTER TABLE public.compliance_entity_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_cases ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.compliance_entity_controls FROM PUBLIC;
REVOKE ALL ON TABLE public.compliance_rules FROM PUBLIC;
REVOKE ALL ON TABLE public.compliance_events FROM PUBLIC;
REVOKE ALL ON TABLE public.compliance_cases FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_entity_controls FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_rules FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_events FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_cases FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_entity_controls FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_rules FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_events FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE public.compliance_cases FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT SELECT,INSERT,UPDATE ON TABLE public.compliance_entity_controls TO service_role';
    EXECUTE 'GRANT SELECT,INSERT,UPDATE ON TABLE public.compliance_rules TO service_role';
    EXECUTE 'GRANT SELECT,INSERT ON TABLE public.compliance_events TO service_role';
    EXECUTE 'GRANT SELECT,INSERT,UPDATE ON TABLE public.compliance_cases TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.set_compliance_entity_control_v1(uuid,text,text,text,text,timestamptz) TO service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.compliance_events IS
  'Immutable Phase 5.2 Ledger-bound transaction monitoring evidence. Review-only defaults are technical launch controls, not statutory thresholds.';
COMMENT ON FUNCTION public.evaluate_ledger_compliance_v1() IS
  'Statement-level Ledger-entry compliance trigger. Explicit frozen controls and block rules abort the same financial transaction.';

COMMIT;
