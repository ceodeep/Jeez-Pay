BEGIN;

-- Phase 1 phone identity hardening.
-- Historical phone_verified=true values were produced by the legacy signup
-- flow without proof of phone ownership. A real phone verification flow must
-- record both phone_verified=true and phone_verified_at=<verification time>.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

-- Correct the legacy placeholder state. The repository contains no genuine
-- phone-verification flow that could have populated phone_verified_at, so any
-- true flag without provenance must not be treated as proof of ownership.
UPDATE public.users
SET phone_verified = false
WHERE phone_verified IS TRUE
  AND phone_verified_at IS NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_phone_verified_at_requires_verified;

ALTER TABLE public.users
  ADD CONSTRAINT users_phone_verified_at_requires_verified
  CHECK (phone_verified_at IS NULL OR phone_verified IS TRUE);

COMMENT ON COLUMN public.users.phone_verified_at IS
  'Timestamp set only after successful proof of phone ownership.';

COMMIT;
