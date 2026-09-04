BEGIN;

DROP FUNCTION IF EXISTS public.screen_kyc_sanctions_public_v1(uuid,uuid);
DROP FUNCTION IF EXISTS public.screen_sanctions_candidates_v1(text,date,text,integer);
DROP FUNCTION IF EXISTS public.finalize_sanctions_source_sync_v1(text,uuid,text,text,text,integer,integer,date);
DROP FUNCTION IF EXISTS public.normalize_sanctions_name_v1(text);

DROP TABLE IF EXISTS public.sanctions_names_v1;
DROP TABLE IF EXISTS public.sanctions_entities_v1;
DROP TABLE IF EXISTS public.sanctions_sources_v1;

COMMIT;
