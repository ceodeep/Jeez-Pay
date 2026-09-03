BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wallet_transfer(uuid,text,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'LEGACY_WALLET_TRANSFER_RPC_MISSING' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- wallet_transfer is an internal compatibility primitive. Customer and agent
-- HTTP routes call it only through the trusted backend service-role client (or
-- through service-role-only Ledger v2 wrappers). It must not be directly
-- executable by Supabase client roles or PUBLIC.
REVOKE ALL ON FUNCTION public.wallet_transfer(
  uuid, text, text, numeric, text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.wallet_transfer(uuid,text,text,numeric,text) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.wallet_transfer(uuid,text,text,numeric,text) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.wallet_transfer(uuid,text,text,numeric,text) TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.wallet_transfer(
  uuid, text, text, numeric, text
) IS 'Legacy internal wallet transfer compatibility primitive. Direct PUBLIC/anon/authenticated execution revoked during Phase 4.4; backend service_role access retained while callers migrate to Ledger v2 wrappers.';

COMMIT;
