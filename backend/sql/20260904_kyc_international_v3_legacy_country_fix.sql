BEGIN;

-- Foundation backfills legacy rows without enough data to infer nationality or
-- country of residence. Use ISO 3166 user-assigned ZZ rather than pretending
-- those historical rows were South Sudanese. Run before the V3 identity guard.
UPDATE public.kyc_applications
SET nationality='ZZ',
    country_of_birth='ZZ',
    residence_country='ZZ',
    updated_at=now()
WHERE schema_version=2
  AND metadata->>'backfilledFrom'='kyc_profiles'
  AND nationality='SS'
  AND country_of_birth='SS'
  AND residence_country='SS';

COMMIT;
