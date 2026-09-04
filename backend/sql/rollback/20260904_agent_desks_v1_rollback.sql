BEGIN;

DROP FUNCTION IF EXISTS public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text);
DROP FUNCTION IF EXISTS public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text);

DROP FUNCTION IF EXISTS public.assert_agent_desk_operation_v1(uuid,text,text,numeric);
DROP FUNCTION IF EXISTS public.admin_set_agent_desk_capability_v1(uuid,uuid,text,boolean,boolean,numeric,numeric,numeric,numeric);
DROP FUNCTION IF EXISTS public.admin_upsert_agent_desk_v1(uuid,uuid,text,text,text,text,text);

DO $$
BEGIN
  IF to_regprocedure('public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)
      RENAME TO agent_cash_in_ledger_v2;
  END IF;

  IF to_regprocedure('public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)
      RENAME TO agent_cash_out_ledger_v2;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)
  TO service_role;

DROP TABLE IF EXISTS public.agent_desk_capabilities_v1;
DROP TABLE IF EXISTS public.agent_desks_v1;

COMMIT;
