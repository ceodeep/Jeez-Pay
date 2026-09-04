BEGIN;

-- Preserve the user's role from before Phase 6 so a later rollback can restore
-- the exact authorization posture that existed before desk controls were added.
ALTER TABLE public.agent_desks_v1
  ADD COLUMN original_user_role text;

CREATE OR REPLACE FUNCTION public.capture_agent_desk_original_role_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM public.users
  WHERE id = NEW.agent_user_id;

  IF v_role NOT IN ('user','agent') THEN
    RAISE EXCEPTION 'AGENT_DESK_ORIGINAL_ROLE_INVALID' USING ERRCODE='P0001';
  END IF;

  NEW.original_user_role := v_role;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_desks_v1_capture_original_role
BEFORE INSERT ON public.agent_desks_v1
FOR EACH ROW
EXECUTE FUNCTION public.capture_agent_desk_original_role_v1();

-- Defensive backfill for an interrupted/manual application sequence. Normal
-- deployment reaches this migration before any desk can be created.
UPDATE public.agent_desks_v1 d
SET original_user_role = u.role
FROM public.users u
WHERE u.id = d.agent_user_id
  AND d.original_user_role IS NULL
  AND u.role IN ('user','agent');

ALTER TABLE public.agent_desks_v1
  ALTER COLUMN original_user_role SET NOT NULL;

ALTER TABLE public.agent_desks_v1
  ADD CONSTRAINT agent_desks_v1_original_role_check
  CHECK (original_user_role IN ('user','agent'));

REVOKE ALL ON FUNCTION public.capture_agent_desk_original_role_v1()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
