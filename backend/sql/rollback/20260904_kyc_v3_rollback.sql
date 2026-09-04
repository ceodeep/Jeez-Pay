BEGIN;

-- Emergency rollback for the additive KYC v3 platform before customer activation.
-- Refuse destructive rollback if a persistent v3 application exists.
DO $$
DECLARE v_count bigint := 0;
BEGIN
  IF to_regclass('public.kyc_applications_v3') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.kyc_applications_v3' INTO v_count;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'KYC_V3_ROLLBACK_REFUSED_PERSISTENT_APPLICATIONS:%', v_count
        USING ERRCODE='P0001';
    END IF;
  END IF;
END $$;

-- Operations layer. Guard trigger drops so rollback also works after a partial install.
DROP FUNCTION IF EXISTS public.kyc_purge_candidates_v3(integer);
DROP FUNCTION IF EXISTS public.mark_kyc_periodic_reviews_due_v3(integer);
DROP FUNCTION IF EXISTS public.set_kyc_legal_hold_v3(uuid,uuid,boolean,text);
DO $$ BEGIN
  IF to_regclass('public.kyc_applications_v3') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS kyc_applications_v3_initialize_retention ON public.kyc_applications_v3';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.initialize_kyc_retention_v3();
DO $$ BEGIN
  IF to_regclass('public.kyc_evidence_access_log_v3') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS kyc_evidence_access_log_v3_immutable ON public.kyc_evidence_access_log_v3';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.reject_kyc_access_log_mutation_v3();
DROP TABLE IF EXISTS public.kyc_evidence_access_log_v3;
DROP TABLE IF EXISTS public.kyc_retention_v3;

-- Scale / reviewer assignment layer.
DROP FUNCTION IF EXISTS public.claim_kyc_application_v3(uuid,uuid);

-- Lifecycle functions and profile guard.
DROP TRIGGER IF EXISTS kyc_profile_v3_guard ON public.kyc_profiles;
DROP FUNCTION IF EXISTS public.guard_kyc_profile_v3_mutation();
DROP FUNCTION IF EXISTS public.review_kyc_v3(uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.record_kyc_check_v3(uuid,uuid,text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS public.submit_kyc_v3(uuid,jsonb,text,text);
DROP FUNCTION IF EXISTS public.kyc_active_policy_v3();

-- Remove compatibility FK before dropping application tables.
ALTER TABLE public.kyc_profiles
  DROP CONSTRAINT IF EXISTS kyc_profiles_current_application_v3_fk;

-- Drop v3 tables in dependency order.
DROP TABLE IF EXISTS public.kyc_provider_jobs_v3;
DROP TABLE IF EXISTS public.kyc_risk_assessments_v3;
DROP TABLE IF EXISTS public.kyc_checks_v3;
DROP TABLE IF EXISTS public.kyc_consents_v3;
DROP TABLE IF EXISTS public.kyc_evidence_v3;
DROP TABLE IF EXISTS public.kyc_documents_v3;
DROP TABLE IF EXISTS public.kyc_applications_v3;
DROP TABLE IF EXISTS public.kyc_country_risk_v3;
DROP TABLE IF EXISTS public.kyc_policy_versions_v3;

DROP FUNCTION IF EXISTS public.reject_kyc_v3_immutable_mutation();

-- Restore the Phase 5.1 immutable review-event vocabulary if that table exists.
DO $$ BEGIN
  IF to_regclass('public.kyc_review_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.kyc_review_events DROP CONSTRAINT IF EXISTS kyc_review_events_event_type_check';
    EXECUTE 'ALTER TABLE public.kyc_review_events ADD CONSTRAINT kyc_review_events_event_type_check CHECK (event_type IN (''submitted'',''resubmitted'',''approved'',''rejected''))';
    EXECUTE 'ALTER TABLE public.kyc_review_events DROP CONSTRAINT IF EXISTS kyc_review_events_status_check';
    EXECUTE 'ALTER TABLE public.kyc_review_events ADD CONSTRAINT kyc_review_events_status_check CHECK (to_status IN (''pending'',''approved'',''rejected''))';
  END IF;
END $$;

-- Remove only columns introduced by the new v3 compatibility projection.
ALTER TABLE public.kyc_profiles
  DROP COLUMN IF EXISTS current_application_id,
  DROP COLUMN IF EXISTS schema_version,
  DROP COLUMN IF EXISTS policy_version,
  DROP COLUMN IF EXISTS workflow_status,
  DROP COLUMN IF EXISTS assurance_level,
  DROP COLUMN IF EXISTS verification_mode,
  DROP COLUMN IF EXISTS submitted_at,
  DROP COLUMN IF EXISTS next_review_at,
  DROP COLUMN IF EXISTS required_action,
  DROP COLUMN IF EXISTS risk_score,
  DROP COLUMN IF EXISTS risk_rating,
  DROP COLUMN IF EXISTS identity_verification_status,
  DROP COLUMN IF EXISTS liveness_status,
  DROP COLUMN IF EXISTS sanctions_status,
  DROP COLUMN IF EXISTS pep_screening_status,
  DROP COLUMN IF EXISTS adverse_media_status,
  DROP COLUMN IF EXISTS nationality,
  DROP COLUMN IF EXISTS country_of_birth,
  DROP COLUMN IF EXISTS residence_country,
  DROP COLUMN IF EXISTS address_line1,
  DROP COLUMN IF EXISTS address_line2,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS region,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS employment_status,
  DROP COLUMN IF EXISTS occupation,
  DROP COLUMN IF EXISTS employer_name,
  DROP COLUMN IF EXISTS source_of_funds,
  DROP COLUMN IF EXISTS source_of_wealth,
  DROP COLUMN IF EXISTS account_purpose,
  DROP COLUMN IF EXISTS expected_monthly_volume_band,
  DROP COLUMN IF EXISTS expected_monthly_tx_count_band,
  DROP COLUMN IF EXISTS pep_self_declared,
  DROP COLUMN IF EXISTS pep_related_declared,
  DROP COLUMN IF EXISTS tax_residencies;

COMMIT;
