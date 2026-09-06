BEGIN;

DROP FUNCTION IF EXISTS
public.complete_admin_mfa_verification_v1(
  uuid,
  uuid,
  text,
  boolean
);

COMMIT;
