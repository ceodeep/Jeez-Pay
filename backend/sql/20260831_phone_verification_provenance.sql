BEGIN;

-- Phase 1 phone identity hardening.
-- Historical phone_verified=true values were produced by the legacy signup
-- flow without proof of phone ownership. Preserve those values for audit, but
-- do not treat them as trusted until a real verification flow records when the
-- phone was verified.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_phone_verified_at_requires_verified;

ALTER TABLE public.users
  ADD CONSTRAINT users_phone_verified_at_requires_verified
  CHECK (phone_verified_at IS NULL OR phone_verified IS TRUE);

COMMENT ON COLUMN public.users.phone_verified_at IS
  'Timestamp set only after successful proof of phone ownership. Legacy phone_verified flags are not backfilled.';

COMMIT;
