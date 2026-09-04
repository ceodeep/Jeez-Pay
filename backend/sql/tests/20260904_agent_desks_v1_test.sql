\set ON_ERROR_STOP on
\pset pager off

\echo '=== AGENT DESKS V1 TESTS ==='
\echo 'ROLLBACK-ONLY: lifecycle, KYC/compliance gate, SSP capability, transaction/daily limits, suspension block, no money movement.'

BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

DO $$
DECLARE
  v_admin uuid;
  v_agent uuid;
  v_customer uuid;
  v_result jsonb;
  v_desk_id uuid;
  v_before_ops integer;
  v_after_ops integer;
  v_before_journals integer;
  v_after_journals integer;
  v_seen boolean;
BEGIN
  SELECT id INTO v_admin
  FROM public.users
  WHERE role IN ('super_admin','admin')
    AND COALESCE(is_active,true)=true
    AND COALESCE(is_system,false)=false
  ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END, id
  LIMIT 1;

  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_REQUIRES_ACTIVE_ADMIN';
  END IF;

  SELECT u.id INTO v_agent
  FROM public.users u
  JOIN public.kyc_profiles kp ON kp.user_id=u.id AND kp.status='approved'
  WHERE u.role='user'
    AND COALESCE(u.is_active,true)=true
    AND COALESCE(u.is_system,false)=false
    AND NOT EXISTS (
      SELECT 1
      FROM public.compliance_entity_controls c
      WHERE c.entity_type='USER'
        AND c.entity_ref=u.id::text
        AND c.status IN ('review','frozen')
    )
  ORDER BY u.id
  LIMIT 1;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_REQUIRES_APPROVED_KYC_USER';
  END IF;

  SELECT u.id INTO v_customer
  FROM public.users u
  WHERE u.role='user'
    AND u.id<>v_agent
    AND COALESCE(u.is_active,true)=true
    AND COALESCE(u.is_system,false)=false
  ORDER BY u.id
  LIMIT 1;

  IF v_customer IS NULL THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_REQUIRES_SECOND_USER';
  END IF;

  PERFORM 1 FROM public.users WHERE id IN(v_agent,v_customer) ORDER BY id FOR UPDATE;

  -- Pending profile must not promote the user.
  v_result:=public.admin_upsert_agent_desk_v1(
    v_admin,v_agent,'Rollback Agent Desk','SS','Juba','Rollback-only test','pending'
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_PENDING_PROFILE_FAILED: %',v_result;
  END IF;

  SELECT id INTO v_desk_id FROM public.agent_desks_v1 WHERE agent_user_id=v_agent;
  IF v_desk_id IS NULL THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_DESK_MISSING';
  END IF;

  IF (SELECT role FROM public.users WHERE id=v_agent)<>'user' THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_PENDING_PROFILE_PROMOTED_USER';
  END IF;

  -- Explicit SSP limits/capabilities. No defaults silently activate money.
  v_result:=public.admin_set_agent_desk_capability_v1(
    v_admin,v_agent,'SSP',true,true,1,10,100,100
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_CAPABILITY_SETUP_FAILED: %',v_result;
  END IF;

  -- Activation requires approved KYC, unrestricted compliance and an enabled capability.
  v_result:=public.admin_upsert_agent_desk_v1(
    v_admin,v_agent,'Rollback Agent Desk','SS','Juba','Rollback-only test','active'
  );

  IF COALESCE((v_result->>'ok')::boolean,false) IS NOT TRUE
     OR (SELECT role FROM public.users WHERE id=v_agent)<>'agent'
     OR (SELECT status FROM public.agent_desks_v1 WHERE id=v_desk_id)<>'active' THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_ACTIVATION_FAILED: %',v_result;
  END IF;

  PERFORM public.assert_agent_desk_operation_v1(v_agent,'cash_in','SSP',1);
  PERFORM public.assert_agent_desk_operation_v1(v_agent,'cash_out','SSP',1);

  v_seen:=false;
  BEGIN
    PERFORM public.assert_agent_desk_operation_v1(v_agent,'cash_in','SSP',11);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%AGENT_DESK_TX_LIMIT_EXCEEDED%' THEN v_seen:=true; ELSE RAISE; END IF;
  END;
  IF v_seen IS NOT TRUE THEN RAISE EXCEPTION 'AGENT_DESK_TEST_MAX_TX_NOT_ENFORCED'; END IF;

  -- Capability-specific disable must fail closed.
  PERFORM public.admin_set_agent_desk_capability_v1(
    v_admin,v_agent,'SSP',true,false,1,10,100,NULL
  );

  v_seen:=false;
  BEGIN
    PERFORM public.assert_agent_desk_operation_v1(v_agent,'cash_out','SSP',1);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%AGENT_DESK_CAPABILITY_DISABLED%' THEN v_seen:=true; ELSE RAISE; END IF;
  END;
  IF v_seen IS NOT TRUE THEN RAISE EXCEPTION 'AGENT_DESK_TEST_DISABLED_CAPABILITY_NOT_BLOCKED'; END IF;

  PERFORM public.admin_set_agent_desk_capability_v1(
    v_admin,v_agent,'SSP',true,true,1,10,100,100
  );

  -- Daily usage is serialized and counted from completed agent_operations.
  INSERT INTO public.agent_operations(
    id,type,agent_user_id,customer_user_id,currency,amount,fee,description,status
  ) VALUES (
    gen_random_uuid(),'cash_in',v_agent,v_customer,'SSP',100,0,'Rollback daily-limit test','completed'
  );

  v_seen:=false;
  BEGIN
    PERFORM public.assert_agent_desk_operation_v1(v_agent,'cash_in','SSP',1);
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%AGENT_DESK_DAILY_LIMIT_EXCEEDED%' THEN v_seen:=true; ELSE RAISE; END IF;
  END;
  IF v_seen IS NOT TRUE THEN RAISE EXCEPTION 'AGENT_DESK_TEST_DAILY_LIMIT_NOT_ENFORCED'; END IF;

  -- Remove synthetic usage so subsequent suspension test isolates the status gate.
  DELETE FROM public.agent_operations
  WHERE agent_user_id=v_agent
    AND description='Rollback daily-limit test'
    AND created_at>=transaction_timestamp();

  PERFORM public.admin_upsert_agent_desk_v1(
    v_admin,v_agent,'Rollback Agent Desk','SS','Juba','Rollback-only test','suspended'
  );

  SELECT count(*) INTO v_before_ops FROM public.agent_operations;
  SELECT count(*) INTO v_before_journals FROM public.ledger_journals_v2;

  v_seen:=false;
  BEGIN
    PERFORM public.agent_cash_in_ledger_v2(
      v_agent,'+211000000000','SSP',1,'Suspended desk must not move money','agent-desk-v1-suspended-test'
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%AGENT_DESK_NOT_ACTIVE%' THEN v_seen:=true; ELSE RAISE; END IF;
  END;

  IF v_seen IS NOT TRUE THEN RAISE EXCEPTION 'AGENT_DESK_TEST_SUSPENSION_NOT_ENFORCED'; END IF;

  SELECT count(*) INTO v_after_ops FROM public.agent_operations;
  SELECT count(*) INTO v_after_journals FROM public.ledger_journals_v2;

  IF v_after_ops<>v_before_ops OR v_after_journals<>v_before_journals THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_BLOCKED_CALL_MOVED_MONEY';
  END IF;

  IF EXISTS(SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_UNBALANCED_JOURNAL';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.ledger_v2_legacy_live_reconciliation
    WHERE reconciliation_status<>'MATCHED' OR difference IS DISTINCT FROM 0
  ) THEN
    RAISE EXCEPTION 'AGENT_DESK_TEST_RECONCILIATION_FAILED';
  END IF;

  RAISE NOTICE 'AGENT DESKS V1 TESTS: OK';
END $$;

SELECT status,count(*)
FROM public.agent_desks_v1
GROUP BY status
ORDER BY status;

ROLLBACK;
