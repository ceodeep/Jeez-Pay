BEGIN;

-- Phase 1 auth hardening.
-- This migration is backward-compatible with the currently deployed backend:
-- legacy code can keep using otp_codes.code while the hardened backend writes
-- a one-way HMAC into both code and code_hash during the transition.

ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS code_hash text;

ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.otp_codes
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.otp_codes
  DROP CONSTRAINT IF EXISTS otp_codes_attempt_count_nonnegative;

ALTER TABLE public.otp_codes
  ADD CONSTRAINT otp_codes_attempt_count_nonnegative
  CHECK (attempt_count >= 0);

-- Keep only the newest outstanding challenge for each email/purpose pair before
-- enforcing uniqueness. OTP rows are short-lived challenges, not financial data.
WITH ranked AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY email, purpose
      ORDER BY expires_at DESC NULLS LAST, created_at DESC, ctid DESC
    ) AS row_num
  FROM public.otp_codes
)
DELETE FROM public.otp_codes AS otp
USING ranked
WHERE otp.ctid = ranked.ctid
  AND ranked.row_num > 1;

DROP INDEX IF EXISTS public.otp_codes_email_purpose_idx;

CREATE UNIQUE INDEX IF NOT EXISTS otp_codes_email_purpose_uidx
  ON public.otp_codes (email, purpose);

COMMIT;
