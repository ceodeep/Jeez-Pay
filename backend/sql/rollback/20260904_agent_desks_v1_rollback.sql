BEGIN;

-- Restore every desk user's pre-Phase-6 role before removing the desk policy.
-- Dynamic SQL keeps rollback usable even if deployment failed before the
-- original_user_role safety column was added.
DO $$
BEGIN
  IF to_regclass('public.agent_desks_v1') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM pg_attribute
       WHERE attrelid = 'public.agent_desks_v1'::regclass
         AND attname = 'original_user_role'
         AND attnum > 0
         AND NOT attisdropped
     ) THEN
    EXECUTE $sql$
      UPDATE public.users u
      SET role = d.original_user_role
      FROM public.agent_desks_v1 d
      WHERE u.id = d.agent_user_id
        AND d.original_user_role IN ('user','agent')
        AND u.role IS DISTINCT FROM d.original_user_role
    $sql$;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text);
DROP FUNCTION IF EXISTS public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text);

DROP FUNCTION IF EXISTS public.assert_agent_desk_operation_v1(uuid,text,text,numeric);
DROP FUNCTION IF EXISTS public.admin_set_agent_desk_capability_v1(uuid,uuid,text,boolean,boolean,numeric,numeric,numeric,numeric);
DROP FUNCTION IF EXISTS public.admin_upsert_agent_desk_v1(uuid,uuid,text,text,text,text,text);

DO $$
BEGIN
  IF to_regprocedure('public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
    IF to_regprocedure('public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
      DROP FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text);
    END IF;
    ALTER FUNCTION public.agent_cash_in_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)
      RENAME TO agent_cash_in_ledger_v2;
  END IF;

  IF to_regprocedure('public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
    IF to_regprocedure('public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
      DROP FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text);
    END IF;
    ALTER FUNCTION public.agent_cash_out_ledger_v2_pre_desk_v1(uuid,text,text,numeric,text,text)
      RENAME TO agent_cash_out_ledger_v2;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regprocedure('public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) TO service_role';
  END IF;

  IF to_regprocedure('public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) TO service_role';
  END IF;
END;
$$;

DROP TABLE IF EXISTS public.agent_desk_capabilities_v1;
DROP TABLE IF EXISTS public.agent_desks_v1;
DROP FUNCTION IF EXISTS public.capture_agent_desk_original_role_v1();

COMMIT;
