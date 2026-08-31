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

CREATE INDEX IF NOT EXISTS otp_codes_email_purpose_idx
  ON public.otp_codes (email, purpose);

COMMIT;
