BEGIN;

CREATE OR REPLACE FUNCTION
public.finalize_admin_mfa_enrollment_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_recovery_code_hashes text[]
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_role text;
  v_active boolean;
  v_session_id uuid;
  v_enabled_at timestamptz;
  v_total integer;
  v_distinct integer;
BEGIN
  IF p_user_id IS NULL
     OR p_session_id IS NULL THEN
    RAISE EXCEPTION
      'user and session are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    u.role,
    u.is_active
  INTO
    v_role,
    v_active
  FROM public.users u
  WHERE u.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_active IS NOT TRUE
     OR v_role NOT IN (
       'admin',
       'super_admin',
       'finance_admin',
       'kyc_officer',
       'support_agent',
       'auditor'
     ) THEN
    RAISE EXCEPTION
      'admin access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT f.enabled_at
  INTO v_enabled_at
  FROM public.admin_mfa_factors_v1 f
  WHERE f.user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'MFA enrollment not started'
      USING ERRCODE = '22023';
  END IF;

  IF v_enabled_at IS NOT NULL THEN
    RAISE EXCEPTION
      'MFA already enabled'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.id
  INTO v_session_id
  FROM public.user_sessions s
  WHERE s.id = p_session_id
    AND s.user_id = p_user_id
    AND s.revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'active session required'
      USING ERRCODE = '42501';
  END IF;

  v_total :=
    COALESCE(
      array_length(
        p_recovery_code_hashes,
        1
      ),
      0
    );

  IF v_total <> 10 THEN
    RAISE EXCEPTION
      'exactly 10 recovery code hashes required'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(
      p_recovery_code_hashes
    ) AS h(value)
    WHERE value IS NULL
       OR value !~ '^[a-f0-9]{64}$'
  ) THEN
    RAISE EXCEPTION
      'invalid recovery code hash'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT value)
  INTO v_distinct
  FROM unnest(
    p_recovery_code_hashes
  ) AS h(value);

  IF v_distinct <> 10 THEN
    RAISE EXCEPTION
      'recovery code hashes must be unique'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM
    public.admin_mfa_recovery_codes_v1
  WHERE user_id = p_user_id;

  INSERT INTO
    public.admin_mfa_recovery_codes_v1 (
      user_id,
      code_hash
    )
  SELECT
    p_user_id,
    value
  FROM unnest(
    p_recovery_code_hashes
  ) AS h(value);

  UPDATE
    public.admin_mfa_factors_v1
  SET
    enabled_at = v_now,
    last_verified_at = v_now,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = v_now
  WHERE user_id = p_user_id;

  UPDATE public.user_sessions
  SET revoked_at = v_now
  WHERE user_id = p_user_id
    AND id <> p_session_id
    AND revoked_at IS NULL;

  UPDATE public.user_sessions
  SET admin_mfa_verified_at = v_now
  WHERE id = p_session_id
    AND user_id = p_user_id
    AND revoked_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'current session disappeared'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_now;
END;
$$;

REVOKE ALL
ON FUNCTION
public.finalize_admin_mfa_enrollment_v1(
  uuid,
  uuid,
  text[]
)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='anon'
  ) THEN
    EXECUTE
      'REVOKE ALL ON FUNCTION
       public.finalize_admin_mfa_enrollment_v1(
         uuid,uuid,text[]
       )
       FROM anon';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='authenticated'
  ) THEN
    EXECUTE
      'REVOKE ALL ON FUNCTION
       public.finalize_admin_mfa_enrollment_v1(
         uuid,uuid,text[]
       )
       FROM authenticated';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname='service_role'
  ) THEN
    EXECUTE
      'GRANT EXECUTE ON FUNCTION
       public.finalize_admin_mfa_enrollment_v1(
         uuid,uuid,text[]
       )
       TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION
public.finalize_admin_mfa_enrollment_v1(
  uuid,
  uuid,
  text[]
)
IS
  'Atomically enables admin MFA, installs recovery hashes, revokes other sessions, and marks the current session MFA-verified. Backend service-role only.';

COMMIT;
