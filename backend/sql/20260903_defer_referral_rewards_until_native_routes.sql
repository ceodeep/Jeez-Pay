BEGIN;

-- Phase 4.5C launch safety gate.
-- Referral reward money mutation currently has two legacy application callers:
-- signup verification and admin KYC approval. Keep the feature disabled until
-- both callers are routed through grant_referral_reward_ledger_v2().

DO $$
BEGIN
  IF to_regclass('public.referral_reward_settings') IS NULL THEN
    RAISE EXCEPTION 'REFERRAL_REWARD_SETTINGS_TABLE_MISSING' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

UPDATE public.referral_reward_settings
SET enabled = false,
    updated_at = now()
WHERE enabled IS TRUE;

COMMENT ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text)
IS 'Phase 4.5B native referral reward primitive. Application payout execution remains temporarily disabled until both legacy callers are cut over.';

COMMIT;
