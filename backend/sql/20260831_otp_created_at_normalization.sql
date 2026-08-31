BEGIN;

-- Follow-up for deployments where otp_codes.created_at already existed before
-- 20260831_otp_hardening.sql. ADD COLUMN IF NOT EXISTS preserves the pre-existing
-- definition, so normalize it explicitly here instead of rewriting the applied
-- migration.
--
-- OTP rows are short-lived authentication challenges, not financial records.
-- Supabase/Postgres deployments are treated as UTC for this legacy timestamp
-- conversion, and the transaction fixes the interpretation deterministically.

SET LOCAL TIME ZONE 'UTC';

UPDATE public.otp_codes
SET created_at = now()
WHERE created_at IS NULL;

ALTER TABLE public.otp_codes
  ALTER COLUMN created_at TYPE timestamptz
  USING created_at AT TIME ZONE 'UTC';

ALTER TABLE public.otp_codes
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.otp_codes
  ALTER COLUMN created_at SET NOT NULL;

COMMIT;
