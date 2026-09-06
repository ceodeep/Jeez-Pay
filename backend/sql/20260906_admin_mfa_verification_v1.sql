BEGIN;

CREATE OR REPLACE FUNCTION
public.complete_admin_mfa_verification_v1(
  p_user_id uuid,
  p_session_id uuid,
  p_recovery_code_hash text,
  p_require_unverified boolean
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz :=
    clock_timestamp();

  v_role text;
  v_active boolean;

  v_factor_enabled_at
    timestamptz;

  v_session_verified_at
    timestamptz;

  v_recovery_id uuid;
BEGIN
  IF p_user_id IS NULL
     OR p_session_id IS NULL
  THEN
    RAISE EXCEPTION
      'MFA_USER_SESSION_REQUIRED'
      USING ERRCODE='22023';
  END IF;

  SELECT
    u.role::text,
    u.is_active
  INTO
    v_role,
    v_active
  FROM public.users u
  WHERE u.id=p_user_id
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
     )
  THEN
    RAISE EXCEPTION
      'ADMIN_ACCESS_DENIED'
      USING ERRCODE='42501';
  END IF;

  SELECT
    f.enabled_at
  INTO
    v_factor_enabled_at
  FROM
    public.admin_mfa_factors_v1 f
  WHERE
    f.user_id=p_user_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_factor_enabled_at
        IS NULL
  THEN
    RAISE EXCEPTION
      'ADMIN_MFA_ENROLLMENT_REQUIRED'
      USING ERRCODE='42501';
  END IF;

  SELECT
    s.admin_mfa_verified_at
  INTO
    v_session_verified_at
  FROM
    public.user_sessions s
  WHERE
    s.id=p_session_id
    AND s.user_id=p_user_id
    AND s.revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'SESSION_REQUIRED'
      USING ERRCODE='42501';
  END IF;

  IF
    COALESCE(
      p_require_unverified,
      false
    )
    AND
    v_session_verified_at
      IS NOT NULL
  THEN
    RAISE EXCEPTION
      'MFA_CHALLENGE_ALREADY_USED'
      USING ERRCODE='22023';
  END IF;

  IF
    p_recovery_code_hash
      IS NOT NULL
  THEN
    IF
      p_recovery_code_hash
        !~ '^[a-f0-9]{64}$'
    THEN
      RAISE EXCEPTION
        'INVALID_RECOVERY_HASH'
        USING ERRCODE='22023';
    END IF;

    UPDATE
      public.admin_mfa_recovery_codes_v1
    SET
      used_at=v_now
    WHERE
      user_id=p_user_id
      AND code_hash=
        p_recovery_code_hash
      AND used_at IS NULL
    RETURNING id
    INTO v_recovery_id;

    /*
     * NULL is intentionally returned instead of
     * raising: the application maps it to the same
     * generic invalid-MFA response and increments
     * the shared failure counter.
     */
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  UPDATE
    public.admin_mfa_factors_v1
  SET
    last_verified_at=v_now,
    failed_attempts=0,
    locked_until=NULL,
    updated_at=v_now
  WHERE
    user_id=p_user_id;

  IF
    COALESCE(
      p_require_unverified,
      false
    )
  THEN
    UPDATE
      public.user_sessions
    SET
      admin_mfa_verified_at=
        v_now
    WHERE
      id=p_session_id
      AND user_id=p_user_id
      AND revoked_at IS NULL
      AND admin_mfa_verified_at
        IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'MFA_CHALLENGE_ALREADY_USED'
        USING ERRCODE='22023';
    END IF;
  ELSE
    UPDATE
      public.user_sessions
    SET
      admin_mfa_verified_at=
        v_now
    WHERE
      id=p_session_id
      AND user_id=p_user_id
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'SESSION_REQUIRED'
        USING ERRCODE='42501';
    END IF;
  END IF;

  RETURN v_now;
END;
$$;

REVOKE ALL
ON FUNCTION
public.complete_admin_mfa_verification_v1(
  uuid,
  uuid,
  text,
  boolean
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
       public.complete_admin_mfa_verification_v1(
         uuid,uuid,text,boolean
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
       public.complete_admin_mfa_verification_v1(
         uuid,uuid,text,boolean
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
       public.complete_admin_mfa_verification_v1(
         uuid,uuid,text,boolean
       )
       TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION
public.complete_admin_mfa_verification_v1(
  uuid,
  uuid,
  text,
  boolean
)
IS
  'Atomically completes admin TOTP/recovery verification, consumes an optional one-time recovery hash, updates MFA assurance, and supports single-use login challenges. Backend service-role only.';

COMMIT;
