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

CREATE OR REPLACE FUNCTION public.guard_referral_rewards_deferred_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.enabled IS TRUE THEN
    RAISE EXCEPTION 'REFERRAL_REWARDS_TEMPORARILY_DISABLED'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS referral_rewards_deferred_v2_guard
  ON public.referral_reward_settings;

CREATE TRIGGER referral_rewards_deferred_v2_guard
BEFORE INSERT OR UPDATE OF enabled
ON public.referral_reward_settings
FOR EACH ROW
EXECUTE FUNCTION public.guard_referral_rewards_deferred_v2();

REVOKE ALL ON FUNCTION public.guard_referral_rewards_deferred_v2()
FROM PUBLIC;

COMMENT ON FUNCTION public.guard_referral_rewards_deferred_v2()
IS 'Launch safety gate preventing referral payouts from being re-enabled until both legacy callers use Ledger v2.';

COMMENT ON FUNCTION public.grant_referral_reward_ledger_v2(uuid,text)
IS 'Phase 4.5B native referral reward primitive. Application payout execution remains temporarily disabled until both legacy callers are cut over.';

COMMIT;
