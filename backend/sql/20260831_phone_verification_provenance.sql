BEGIN;

-- Phase 1 phone identity hardening.
-- Historical phone_verified=true values were produced by the legacy signup
-- flow without proof of phone ownership. A real phone verification flow must
-- record both phone_verified=true and phone_verified_at=<verification time>.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;

-- Fail closed if applying this migration would remove the only usable login
-- identity from an active administrative account. Enroll and verify admin email
-- addresses first with backend/scripts/enroll-admin-email.js.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.users
    WHERE role IN (
      'admin',
      'super_admin',
      'finance_admin',
      'kyc_officer',
      'support_agent',
      'auditor'
    )
      AND is_active IS DISTINCT FROM false
      AND (
        email IS NULL
        OR btrim(email) = ''
        OR email_verified IS NOT TRUE
      )
  ) THEN
    RAISE EXCEPTION
      'Phone verification migration blocked: active admin account(s) lack a verified email';
  END IF;
END
$$;

-- Correct the legacy placeholder state. The repository contains no genuine
-- phone-verification flow that could have populated phone_verified_at, so any
-- true flag without provenance must not be treated as proof of ownership.
UPDATE public.users
SET phone_verified = false
WHERE phone_verified IS TRUE
  AND phone_verified_at IS NULL;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_phone_verified_at_requires_verified;

-- Defense in depth: the database must never accept a trusted phone flag unless
-- the successful ownership-verification time is recorded as well.
ALTER TABLE public.users
  ADD CONSTRAINT users_phone_verified_at_requires_verified
  CHECK (phone_verified IS NOT TRUE OR phone_verified_at IS NOT NULL);

COMMENT ON COLUMN public.users.phone_verified_at IS
  'Timestamp set only after successful proof of phone ownership.';

COMMIT;
