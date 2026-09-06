BEGIN;

CREATE TABLE public.admin_mfa_factors_v1 (
  user_id uuid PRIMARY KEY
    REFERENCES public.users(id)
    ON DELETE CASCADE,

  secret_ciphertext text NOT NULL,

  enabled_at timestamptz,
  last_verified_at timestamptz,

  failed_attempts integer NOT NULL DEFAULT 0
    CHECK (
      failed_attempts >= 0
      AND failed_attempts <= 20
    ),

  locked_until timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_mfa_secret_not_blank
    CHECK (
      btrim(secret_ciphertext) <> ''
    )
);

CREATE TABLE public.admin_mfa_recovery_codes_v1 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL
    REFERENCES public.admin_mfa_factors_v1(user_id)
    ON DELETE CASCADE,

  code_hash text NOT NULL,

  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_mfa_recovery_hash_not_blank
    CHECK (
      btrim(code_hash) <> ''
    ),

  CONSTRAINT admin_mfa_recovery_code_unique
    UNIQUE (
      user_id,
      code_hash
    )
);

CREATE INDEX admin_mfa_recovery_unused_idx
  ON public.admin_mfa_recovery_codes_v1 (
    user_id
  )
  WHERE used_at IS NULL;

ALTER TABLE public.user_sessions
  ADD COLUMN admin_mfa_verified_at timestamptz;

ALTER TABLE public.admin_mfa_factors_v1
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.admin_mfa_recovery_codes_v1
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
  ON TABLE public.admin_mfa_factors_v1
  FROM PUBLIC;

REVOKE ALL
  ON TABLE public.admin_mfa_recovery_codes_v1
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='anon'
  ) THEN
    EXECUTE
      'REVOKE ALL ON TABLE
       public.admin_mfa_factors_v1,
       public.admin_mfa_recovery_codes_v1
       FROM anon';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='authenticated'
  ) THEN
    EXECUTE
      'REVOKE ALL ON TABLE
       public.admin_mfa_factors_v1,
       public.admin_mfa_recovery_codes_v1
       FROM authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='service_role'
  ) THEN
    EXECUTE
      'GRANT SELECT, INSERT, UPDATE, DELETE
       ON TABLE
       public.admin_mfa_factors_v1,
       public.admin_mfa_recovery_codes_v1
       TO service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.admin_mfa_factors_v1 IS
  'Phase 9 admin TOTP MFA factors. TOTP secrets are stored only as authenticated encrypted ciphertext.';

COMMENT ON TABLE public.admin_mfa_recovery_codes_v1 IS
  'One-time high-entropy recovery codes for Phase 9 admin MFA. Only keyed hashes are stored.';

COMMENT ON COLUMN public.user_sessions.admin_mfa_verified_at IS
  'Timestamp of the most recent successful admin MFA verification in this server-side session.';

COMMIT;
