BEGIN;

-- Emergency rollback for Option A before meaningful V3 production usage.
-- It restores the original V1 policy and removes only the manual-launch guards.
-- The additive face_match check type remains accepted so historical evidence is
-- never made invalid by rollback.

DROP TRIGGER IF EXISTS kyc_manual_launch_approval_guard_v3
  ON public.kyc_profiles;
DROP FUNCTION IF EXISTS public.guard_kyc_manual_launch_approval_v3();

DROP TRIGGER IF EXISTS kyc_manual_biometric_evidence_guard_v3
  ON public.kyc_checks_v3;
DROP FUNCTION IF EXISTS public.guard_kyc_manual_biometric_evidence_v3();

UPDATE public.kyc_policy_versions_v3
SET active=false
WHERE active=true;

UPDATE public.kyc_policy_versions_v3
SET active=true
WHERE policy_version=1;

DO $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.kyc_policy_versions_v3
    WHERE policy_version=1 AND active=true
  ) THEN
    RAISE EXCEPTION 'KYC_V3_MANUAL_POLICY_ROLLBACK_FAILED' USING ERRCODE='P0001';
  END IF;
END $$;

COMMIT;
