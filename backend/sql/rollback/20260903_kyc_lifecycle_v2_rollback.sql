BEGIN;

-- Emergency rollback for Phase 5.1 deployment only.
-- Use only before any real Phase 5.1 KYC submission/review has been accepted.

DROP TRIGGER IF EXISTS kyc_lifecycle_guard_v2 ON public.kyc_profiles;
DROP TRIGGER IF EXISTS kyc_document_paths_guard_v2 ON public.kyc_profiles;

DROP FUNCTION IF EXISTS public.review_kyc_v2(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.submit_kyc_v2(uuid,text,text,text,text,text);
DROP FUNCTION IF EXISTS public.guard_kyc_lifecycle_mutation_v2();
DROP FUNCTION IF EXISTS public.guard_kyc_document_paths_v2();

DROP TRIGGER IF EXISTS kyc_review_events_immutable_v2 ON public.kyc_review_events;
DROP FUNCTION IF EXISTS public.reject_kyc_review_event_mutation_v2();
DROP TABLE IF EXISTS public.kyc_review_events;

ALTER TABLE public.kyc_profiles
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS rejection_reason;

COMMIT;
