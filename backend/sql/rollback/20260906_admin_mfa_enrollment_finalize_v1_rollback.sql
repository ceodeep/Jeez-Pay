BEGIN;

DROP FUNCTION IF EXISTS
public.finalize_admin_mfa_enrollment_v1(
  uuid,
  uuid,
  text[]
);

COMMIT;
