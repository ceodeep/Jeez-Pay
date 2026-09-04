BEGIN;

DO $$
BEGIN
  IF to_regclass('public.sanctions_sources_v1') IS NULL
     OR to_regclass('public.sanctions_entities_v1') IS NULL
     OR to_regclass('public.sanctions_names_v1') IS NULL THEN
    RAISE EXCEPTION 'PUBLIC_SANCTIONS_V1_FOUNDATION_MISSING' USING ERRCODE='P0001';
  END IF;
END $$;

REVOKE ALL ON public.sanctions_sources_v1 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.sanctions_entities_v1 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.sanctions_names_v1 FROM PUBLIC,anon,authenticated;

GRANT SELECT,INSERT,UPDATE,DELETE ON public.sanctions_sources_v1 TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sanctions_entities_v1 TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.sanctions_names_v1 TO service_role;

DO $$
BEGIN
  IF has_table_privilege('anon','public.sanctions_sources_v1','SELECT')
     OR has_table_privilege('authenticated','public.sanctions_sources_v1','SELECT')
     OR has_table_privilege('anon','public.sanctions_entities_v1','SELECT')
     OR has_table_privilege('authenticated','public.sanctions_entities_v1','SELECT')
     OR has_table_privilege('anon','public.sanctions_names_v1','SELECT')
     OR has_table_privilege('authenticated','public.sanctions_names_v1','SELECT') THEN
    RAISE EXCEPTION 'PUBLIC_SANCTIONS_V1_CLIENT_PRIVILEGE_LEAK' USING ERRCODE='P0001';
  END IF;

  IF NOT has_table_privilege('service_role','public.sanctions_sources_v1','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role','public.sanctions_entities_v1','SELECT,INSERT,UPDATE,DELETE')
     OR NOT has_table_privilege('service_role','public.sanctions_names_v1','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'PUBLIC_SANCTIONS_V1_SERVICE_ROLE_PRIVILEGES_MISSING' USING ERRCODE='P0001';
  END IF;
END $$;

COMMIT;
