BEGIN;

DO $$
BEGIN
  IF NOT has_table_privilege('service_role', 'public.agent_desks_v1', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.agent_desk_capabilities_v1', 'SELECT') THEN
    RAISE EXCEPTION 'AGENT_DESK_SERVICE_ROLE_SELECT_MISSING';
  END IF;

  IF has_table_privilege('anon', 'public.agent_desks_v1', 'SELECT')
     OR has_table_privilege('authenticated', 'public.agent_desks_v1', 'SELECT')
     OR has_table_privilege('anon', 'public.agent_desk_capabilities_v1', 'SELECT')
     OR has_table_privilege('authenticated', 'public.agent_desk_capabilities_v1', 'SELECT') THEN
    RAISE EXCEPTION 'AGENT_DESK_CLIENT_TABLE_ACCESS_PRESENT';
  END IF;

  IF NOT has_function_privilege(
      'service_role',
      'public.admin_upsert_agent_desk_v1(uuid,uuid,text,text,text,text,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.admin_set_agent_desk_capability_v1(uuid,uuid,text,boolean,boolean,numeric,numeric,numeric,numeric)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege(
      'service_role',
      'public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'AGENT_DESK_SERVICE_ROLE_EXECUTE_MISSING';
  END IF;

  IF has_function_privilege(
      'service_role',
      'public.assert_agent_desk_operation_v1(uuid,text,text,numeric)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'service_role',
      'public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'AGENT_DESK_INTERNAL_FUNCTION_EXPOSED';
  END IF;

  IF has_function_privilege(
      'anon',
      'public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'anon',
      'public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    )
    OR has_function_privilege(
      'authenticated',
      'public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'AGENT_DESK_CLIENT_RPC_ACCESS_PRESENT';
  END IF;
END;
$$;

COMMIT;
