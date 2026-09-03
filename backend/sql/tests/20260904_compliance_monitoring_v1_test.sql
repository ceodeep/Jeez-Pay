\pset pager off
\echo '=== PHASE 5.2 COMPLIANCE MONITORING TESTS ==='
\echo 'ROLLBACK-ONLY: frozen block + review event/case + immutability.'

BEGIN;
SET LOCAL statement_timeout='90s';
SET LOCAL lock_timeout='10s';

DO $$
DECLARE
  v_user_id uuid;
  v_wallet_id uuid;
  v_user_account_id uuid;
  v_offset_account_id uuid;
  v_before numeric(38,12);
  v_result jsonb;
  v_blocked boolean:=false;
  v_immutable boolean:=false;
  v_event_id uuid;
  v_case_count integer;
  v_journal_id uuid;
BEGIN
  IF to_regprocedure('public.post_ledger_journal_v2(text,text,text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'TEST_LEDGER_POSTING_PRIMITIVE_MISSING';
  END IF;

  IF to_regclass('public.compliance_events') IS NULL
     OR to_regclass('public.compliance_cases') IS NULL
     OR to_regclass('public.compliance_entity_controls') IS NULL
  THEN
    RAISE EXCEPTION 'TEST_COMPLIANCE_TABLES_MISSING';
  END IF;

  SELECT u.id,w.id,w.balance::numeric(38,12),m.ledger_account_id
  INTO v_user_id,v_wallet_id,v_before,v_user_account_id
  FROM public.users u
  JOIN public.kyc_profiles k ON k.user_id=u.id AND k.status='approved'
  JOIN public.wallets w ON w.user_id=u.id AND w.currency='SSP'
  JOIN public.ledger_legacy_account_map_v2 m
    ON m.source_kind='USER_WALLET' AND m.source_id=w.id
  WHERE COALESCE(u.is_active,true)=true
    AND COALESCE(u.is_system,false)=false
    AND w.balance >= 10
  ORDER BY w.balance DESC,u.id
  LIMIT 1;

  IF v_user_id IS NULL OR v_user_account_id IS NULL THEN
    RAISE EXCEPTION 'TEST_APPROVED_SSP_USER_MISSING';
  END IF;

  v_offset_account_id:=public.ensure_ledger_account_v2(
    'PHASE52_TEST_OFFSET:SSP',
    'COMPLIANCE_TEST_OFFSET',
    'SYSTEM',
    'PHASE52_TEST',
    'SSP',
    true,
    jsonb_build_object('phase','5.2','rollbackOnly',true)
  );

  -- Explicit freeze must abort the same Ledger posting transaction.
  INSERT INTO public.compliance_entity_controls(
    entity_type,entity_ref,status,reason
  ) VALUES (
    'USER',v_user_id::text,'frozen','Phase 5.2 rollback freeze test'
  )
  ON CONFLICT(entity_type,entity_ref)
  DO UPDATE SET status='frozen',reason=EXCLUDED.reason,expires_at=NULL,updated_at=now();

  BEGIN
    PERFORM public.post_ledger_journal_v2(
      'ADMIN_BALANCE_ADJUSTMENT_V2',
      'phase52-frozen-test',
      'phase52-frozen-test-v1',
      'Phase 5.2 frozen control rollback test',
      jsonb_build_object('phase','5.2','rollbackOnly',true),
      jsonb_build_array(
        jsonb_build_object(
          'accountId',v_user_account_id,
          'currency','SSP',
          'amountDelta',-1,
          'description','Phase 5.2 frozen test debit',
          'metadata',jsonb_build_object('rollbackOnly',true)
        ),
        jsonb_build_object(
          'accountId',v_offset_account_id,
          'currency','SSP',
          'amountDelta',1,
          'description','Phase 5.2 frozen test offset',
          'metadata',jsonb_build_object('rollbackOnly',true)
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%COMPLIANCE_ENTITY_FROZEN%' THEN
      v_blocked:=true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_blocked IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_FROZEN_ENTITY_NOT_BLOCKED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_journals_v2
    WHERE source_type='ADMIN_BALANCE_ADJUSTMENT_V2'
      AND idempotency_key='phase52-frozen-test-v1'
  ) THEN
    RAISE EXCEPTION 'TEST_BLOCKED_JOURNAL_PERSISTED';
  END IF;

  -- Review status itself should flag but not block. Force the seeded single
  -- amount rule low inside this rollback transaction to prove rule evaluation.
  UPDATE public.compliance_entity_controls
  SET status='review',reason='Phase 5.2 rollback review test',updated_at=now()
  WHERE entity_type='USER' AND entity_ref=v_user_id::text;

  UPDATE public.compliance_rules
  SET enabled=true,
      threshold_value=0.5,
      action='review',
      severity='high',
      updated_at=now()
  WHERE rule_code='SSP_SINGLE_NEAR_MAX';

  IF NOT FOUND THEN
    INSERT INTO public.compliance_rules(
      rule_code,description,currency,source_types,metric,
      threshold_value,window_seconds,action,severity,enabled,metadata
    ) VALUES (
      'SSP_SINGLE_NEAR_MAX',
      'Rollback-only seeded test fallback',
      'SSP',
      ARRAY['ADMIN_BALANCE_ADJUSTMENT_V2'],
      'single_outgoing',0.5,NULL,'review','high',true,
      jsonb_build_object('phase','5.2','rollbackOnly',true)
    );
  END IF;

  v_result:=public.post_ledger_journal_v2(
    'ADMIN_BALANCE_ADJUSTMENT_V2',
    'phase52-review-test',
    'phase52-review-test-v1',
    'Phase 5.2 review rule rollback test',
    jsonb_build_object('phase','5.2','rollbackOnly',true),
    jsonb_build_array(
      jsonb_build_object(
        'accountId',v_user_account_id,
        'currency','SSP',
        'amountDelta',-1,
        'description','Phase 5.2 review test debit',
        'metadata',jsonb_build_object('rollbackOnly',true)
      ),
      jsonb_build_object(
        'accountId',v_offset_account_id,
        'currency','SSP',
        'amountDelta',1,
        'description','Phase 5.2 review test offset',
        'metadata',jsonb_build_object('rollbackOnly',true)
      )
    )
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_REVIEW_JOURNAL_FAILED: %',v_result;
  END IF;

  v_journal_id:=(v_result->>'journalId')::uuid;

  SELECT id INTO v_event_id
  FROM public.compliance_events
  WHERE journal_id=v_journal_id
    AND entity_type='USER'
    AND entity_ref=v_user_id::text
    AND decision='review';

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'TEST_REVIEW_EVENT_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.compliance_events
    WHERE id=v_event_id
      AND 'ENTITY_MANUAL_REVIEW'=ANY(triggered_rules)
      AND 'SSP_SINGLE_NEAR_MAX'=ANY(triggered_rules)
  ) THEN
    RAISE EXCEPTION 'TEST_TRIGGERED_RULES_MISSING';
  END IF;

  SELECT count(*) INTO v_case_count
  FROM public.compliance_cases
  WHERE event_id=v_event_id
    AND status='open';

  IF v_case_count <> 1 THEN
    RAISE EXCEPTION 'TEST_REVIEW_CASE_MISSING';
  END IF;

  BEGIN
    UPDATE public.compliance_events
    SET decision='allow'
    WHERE id=v_event_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%COMPLIANCE_EVENT_IMMUTABLE%' THEN
      v_immutable:=true;
    ELSE
      RAISE;
    END IF;
  END;

  IF v_immutable IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST_COMPLIANCE_EVENT_NOT_IMMUTABLE';
  END IF;

  RAISE NOTICE 'PHASE 5.2 COMPLIANCE MONITORING TESTS: OK';
END;
$$;

\echo ''
\echo '=== TEMPORARY COMPLIANCE STATE ==='
SELECT decision,severity,count(*)
FROM public.compliance_events
GROUP BY decision,severity
ORDER BY decision,severity;

SELECT status,severity,count(*)
FROM public.compliance_cases
GROUP BY status,severity
ORDER BY status,severity;

ROLLBACK;
