BEGIN;

DROP TABLE IF EXISTS
  public.admin_mfa_recovery_codes_v1;

DROP TABLE IF EXISTS
  public.admin_mfa_factors_v1;

ALTER TABLE public.user_sessions
  DROP COLUMN IF EXISTS admin_mfa_verified_at;

COMMIT;
