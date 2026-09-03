BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_legacy_opening_snapshots_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_key text NOT NULL UNIQUE,
  source_count integer NOT NULL,
  currency_count integer NOT NULL,
  source_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_legacy_opening_snapshots_v2_key_not_blank
    CHECK (btrim(snapshot_key) <> ''),
  CONSTRAINT ledger_legacy_opening_snapshots_v2_source_count_nonnegative
    CHECK (source_count >= 0),
  CONSTRAINT ledger_legacy_opening_snapshots_v2_currency_count_nonnegative
    CHECK (currency_count >= 0),
  CONSTRAINT ledger_legacy_opening_snapshots_v2_hash_format
    CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ledger_legacy_opening_snapshots_v2_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE IF NOT EXISTS public.ledger_legacy_opening_snapshot_items_v2 (
  snapshot_id uuid NOT NULL
    REFERENCES public.ledger_legacy_opening_snapshots_v2(id)
    ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  source_owner_ref text NOT NULL,
  currency text NOT NULL,
  account_key text NOT NULL,
  account_type text NOT NULL,
  owner_type text NOT NULL,
  legacy_balance numeric(38, 12) NOT NULL,
  source_fingerprint text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_id, source_kind, source_id),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_account_key_unique
    UNIQUE (snapshot_id, account_key),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_source_kind_check
    CHECK (source_kind IN ('USER_WALLET', 'MERCHANT_BALANCE')),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_owner_ref_not_blank
    CHECK (btrim(source_owner_ref) <> ''),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_currency_format
    CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_account_key_not_blank
    CHECK (btrim(account_key) <> ''),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_account_type_not_blank
    CHECK (btrim(account_type) <> ''),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_owner_type_not_blank
    CHECK (btrim(owner_type) <> ''),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_balance_nonnegative
    CHECK (legacy_balance >= 0),
  CONSTRAINT ledger_legacy_opening_snapshot_items_v2_fingerprint_format
    CHECK (source_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS ledger_legacy_opening_snapshot_items_v2_currency_idx
  ON public.ledger_legacy_opening_snapshot_items_v2 (snapshot_id, currency);

CREATE OR REPLACE FUNCTION public.reject_ledger_legacy_opening_snapshot_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_SNAPSHOT_IMMUTABLE'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS ledger_legacy_opening_snapshots_v2_immutable
  ON public.ledger_legacy_opening_snapshots_v2;
CREATE TRIGGER ledger_legacy_opening_snapshots_v2_immutable
BEFORE UPDATE OR DELETE ON public.ledger_legacy_opening_snapshots_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_ledger_legacy_opening_snapshot_mutation_v2();

DROP TRIGGER IF EXISTS ledger_legacy_opening_snapshot_items_v2_immutable
  ON public.ledger_legacy_opening_snapshot_items_v2;
CREATE TRIGGER ledger_legacy_opening_snapshot_items_v2_immutable
BEFORE UPDATE OR DELETE ON public.ledger_legacy_opening_snapshot_items_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_ledger_legacy_opening_snapshot_mutation_v2();

CREATE OR REPLACE FUNCTION public.ledger_legacy_opening_candidate_fingerprint_v2(
  p_source_kind text,
  p_source_id uuid,
  p_source_owner_ref text,
  p_currency text,
  p_account_key text,
  p_account_type text,
  p_owner_type text,
  p_legacy_balance numeric
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(
    digest(
      convert_to(
        jsonb_build_object(
          'sourceKind', p_source_kind,
          'sourceId', p_source_id,
          'sourceOwnerRef', p_source_owner_ref,
          'currency', p_currency,
          'accountKey', p_account_key,
          'accountType', p_account_type,
          'ownerType', p_owner_type,
          'legacyBalance', p_legacy_balance::numeric(38, 12)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.ledger_legacy_opening_current_hash_v2()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT encode(
    digest(
      convert_to(
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'sourceKind', c.source_kind,
              'sourceId', c.source_id,
              'sourceOwnerRef', c.source_owner_ref,
              'currency', c.currency,
              'accountKey', c.account_key,
              'accountType', c.account_type,
              'ownerType', c.owner_type,
              'legacyBalance', c.legacy_balance::numeric(38, 12)
            )
            ORDER BY c.source_kind, c.source_id
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM public.ledger_v2_legacy_source_candidates AS c;
$$;

CREATE OR REPLACE FUNCTION public.capture_legacy_opening_snapshot_v2(
  p_snapshot_key text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_snapshot_key text := btrim(COALESCE(p_snapshot_key, ''));
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_existing public.ledger_legacy_opening_snapshots_v2%ROWTYPE;
  v_snapshot_id uuid;
  v_source_count integer;
  v_currency_count integer;
  v_source_hash text;
BEGIN
  IF v_snapshot_key = '' OR length(v_snapshot_key) > 160 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_INVALID_SNAPSHOT_KEY'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_INVALID_METADATA'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ledger_legacy_opening_snapshot_v2:' || v_snapshot_key, 0)
  );

  SELECT * INTO v_existing
  FROM public.ledger_legacy_opening_snapshots_v2
  WHERE snapshot_key = v_snapshot_key;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'snapshotId', v_existing.id,
      'snapshotKey', v_existing.snapshot_key,
      'sourceCount', v_existing.source_count,
      'currencyCount', v_existing.currency_count,
      'sourceHash', v_existing.source_hash,
      'idempotentReplay', true
    );
  END IF;

  -- Capture must see a stable legacy source set. These SHARE locks block
  -- INSERT/UPDATE/DELETE writers for the duration of the caller transaction.
  LOCK TABLE public.wallets IN SHARE MODE;
  LOCK TABLE public.merchant_balances IN SHARE MODE;
  LOCK TABLE public.users IN SHARE MODE;
  LOCK TABLE public.system_accounts IN SHARE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.wallets AS w
    LEFT JOIN public.users AS u ON u.id = w.user_id
    WHERE w.user_id IS NULL
       OR u.id IS NULL
       OR w.currency IS NULL
       OR btrim(w.currency) = ''
       OR w.currency <> upper(w.currency)
       OR w.balance IS NULL
       OR w.balance < 0
  ) THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_USER_WALLET_SOURCE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.merchant_balances
    WHERE merchant_id IS NULL
       OR currency IS NULL
       OR btrim(currency) = ''
       OR currency <> upper(currency)
       OR balance IS NULL
       OR balance < 0
  ) THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MERCHANT_BALANCE_SOURCE_INVALID'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT account_key
    FROM public.ledger_v2_legacy_source_candidates
    GROUP BY account_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_ACCOUNT_KEY_COLLISION'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*), count(DISTINCT currency)
  INTO v_source_count, v_currency_count
  FROM public.ledger_v2_legacy_source_candidates;

  IF v_source_count = 0 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_NO_SOURCES'
      USING ERRCODE = 'P0001';
  END IF;

  v_source_hash := public.ledger_legacy_opening_current_hash_v2();

  INSERT INTO public.ledger_legacy_opening_snapshots_v2 (
    snapshot_key,
    source_count,
    currency_count,
    source_hash,
    metadata
  ) VALUES (
    v_snapshot_key,
    v_source_count,
    v_currency_count,
    v_source_hash,
    v_metadata
  )
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.ledger_legacy_opening_snapshot_items_v2 (
    snapshot_id,
    source_kind,
    source_id,
    source_owner_ref,
    currency,
    account_key,
    account_type,
    owner_type,
    legacy_balance,
    source_fingerprint
  )
  SELECT
    v_snapshot_id,
    c.source_kind,
    c.source_id,
    c.source_owner_ref,
    c.currency,
    c.account_key,
    c.account_type,
    c.owner_type,
    c.legacy_balance::numeric(38, 12),
    public.ledger_legacy_opening_candidate_fingerprint_v2(
      c.source_kind,
      c.source_id,
      c.source_owner_ref,
      c.currency,
      c.account_key,
      c.account_type,
      c.owner_type,
      c.legacy_balance
    )
  FROM public.ledger_v2_legacy_source_candidates AS c
  ORDER BY c.source_kind, c.source_id;

  IF (SELECT count(*) FROM public.ledger_legacy_opening_snapshot_items_v2 WHERE snapshot_id = v_snapshot_id)
     <> v_source_count THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_SNAPSHOT_ITEM_COUNT_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'snapshotId', v_snapshot_id,
    'snapshotKey', v_snapshot_key,
    'sourceCount', v_source_count,
    'currencyCount', v_currency_count,
    'sourceHash', v_source_hash,
    'idempotentReplay', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_legacy_opening_snapshot_drift_v2(
  p_snapshot_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_snapshot_key text := btrim(COALESCE(p_snapshot_key, ''));
  v_snapshot public.ledger_legacy_opening_snapshots_v2%ROWTYPE;
  v_missing_current integer;
  v_new_current integer;
  v_identity_mismatch integer;
  v_balance_mismatch integer;
  v_fingerprint_mismatch integer;
  v_current_count integer;
  v_current_currency_count integer;
  v_current_hash text;
  v_drift_free boolean;
BEGIN
  SELECT * INTO v_snapshot
  FROM public.ledger_legacy_opening_snapshots_v2
  WHERE snapshot_key = v_snapshot_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*), count(DISTINCT currency)
  INTO v_current_count, v_current_currency_count
  FROM public.ledger_v2_legacy_source_candidates;

  v_current_hash := public.ledger_legacy_opening_current_hash_v2();

  WITH compared AS (
    SELECT
      s.source_kind AS snapshot_source_kind,
      s.source_id AS snapshot_source_id,
      c.source_kind AS current_source_kind,
      c.source_id AS current_source_id,
      s.source_owner_ref AS snapshot_owner_ref,
      c.source_owner_ref AS current_owner_ref,
      s.currency AS snapshot_currency,
      c.currency AS current_currency,
      s.account_key AS snapshot_account_key,
      c.account_key AS current_account_key,
      s.account_type AS snapshot_account_type,
      c.account_type AS current_account_type,
      s.owner_type AS snapshot_owner_type,
      c.owner_type AS current_owner_type,
      s.legacy_balance AS snapshot_balance,
      c.legacy_balance::numeric(38, 12) AS current_balance,
      s.source_fingerprint AS snapshot_fingerprint,
      CASE
        WHEN c.source_id IS NULL THEN NULL
        ELSE public.ledger_legacy_opening_candidate_fingerprint_v2(
          c.source_kind,
          c.source_id,
          c.source_owner_ref,
          c.currency,
          c.account_key,
          c.account_type,
          c.owner_type,
          c.legacy_balance
        )
      END AS current_fingerprint
    FROM public.ledger_legacy_opening_snapshot_items_v2 AS s
    FULL OUTER JOIN public.ledger_v2_legacy_source_candidates AS c
      ON c.source_kind = s.source_kind
     AND c.source_id = s.source_id
    WHERE s.snapshot_id = v_snapshot.id
       OR s.snapshot_id IS NULL
  )
  SELECT
    count(*) FILTER (
      WHERE snapshot_source_id IS NOT NULL AND current_source_id IS NULL
    ),
    count(*) FILTER (
      WHERE snapshot_source_id IS NULL AND current_source_id IS NOT NULL
    ),
    count(*) FILTER (
      WHERE snapshot_source_id IS NOT NULL
        AND current_source_id IS NOT NULL
        AND (
          snapshot_owner_ref IS DISTINCT FROM current_owner_ref
          OR snapshot_currency IS DISTINCT FROM current_currency
          OR snapshot_account_key IS DISTINCT FROM current_account_key
          OR snapshot_account_type IS DISTINCT FROM current_account_type
          OR snapshot_owner_type IS DISTINCT FROM current_owner_type
        )
    ),
    count(*) FILTER (
      WHERE snapshot_source_id IS NOT NULL
        AND current_source_id IS NOT NULL
        AND snapshot_balance IS DISTINCT FROM current_balance
    ),
    count(*) FILTER (
      WHERE snapshot_source_id IS NOT NULL
        AND current_source_id IS NOT NULL
        AND snapshot_fingerprint IS DISTINCT FROM current_fingerprint
    )
  INTO
    v_missing_current,
    v_new_current,
    v_identity_mismatch,
    v_balance_mismatch,
    v_fingerprint_mismatch
  FROM compared;

  v_drift_free :=
    v_missing_current = 0
    AND v_new_current = 0
    AND v_identity_mismatch = 0
    AND v_balance_mismatch = 0
    AND v_fingerprint_mismatch = 0
    AND v_snapshot.source_count = v_current_count
    AND v_snapshot.currency_count = v_current_currency_count
    AND v_snapshot.source_hash = v_current_hash;

  RETURN jsonb_build_object(
    'ok', true,
    'driftFree', v_drift_free,
    'snapshotId', v_snapshot.id,
    'snapshotKey', v_snapshot.snapshot_key,
    'snapshotSourceCount', v_snapshot.source_count,
    'currentSourceCount', v_current_count,
    'snapshotCurrencyCount', v_snapshot.currency_count,
    'currentCurrencyCount', v_current_currency_count,
    'missingCurrentSources', v_missing_current,
    'newCurrentSources', v_new_current,
    'identityMismatches', v_identity_mismatch,
    'balanceMismatches', v_balance_mismatch,
    'fingerprintMismatches', v_fingerprint_mismatch,
    'snapshotHash', v_snapshot.source_hash,
    'currentHash', v_current_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_legacy_opening_snapshot_unchanged_v2(
  p_snapshot_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_report jsonb;
BEGIN
  v_report := public.check_legacy_opening_snapshot_drift_v2(p_snapshot_key);

  IF COALESCE((v_report->>'driftFree')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_SNAPSHOT_DRIFT'
      USING ERRCODE = 'P0001', DETAIL = v_report::text;
  END IF;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE VIEW public.ledger_v2_legacy_opening_snapshot_currency_summary
WITH (security_invoker = true) AS
SELECT
  s.id AS snapshot_id,
  s.snapshot_key,
  i.currency,
  count(*) AS source_count,
  count(*) FILTER (WHERE i.legacy_balance <> 0) AS nonzero_source_count,
  sum(i.legacy_balance)::numeric(38, 12) AS total_legacy_balance,
  s.source_hash,
  s.captured_at
FROM public.ledger_legacy_opening_snapshots_v2 AS s
JOIN public.ledger_legacy_opening_snapshot_items_v2 AS i
  ON i.snapshot_id = s.id
GROUP BY s.id, s.snapshot_key, i.currency, s.source_hash, s.captured_at;

ALTER TABLE public.ledger_legacy_opening_snapshots_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_legacy_opening_snapshot_items_v2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.ledger_legacy_opening_snapshots_v2,
  public.ledger_legacy_opening_snapshot_items_v2,
  public.ledger_v2_legacy_opening_snapshot_currency_summary
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.ledger_legacy_opening_candidate_fingerprint_v2(
  text, uuid, text, text, text, text, text, numeric
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ledger_legacy_opening_current_hash_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.capture_legacy_opening_snapshot_v2(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_legacy_opening_snapshot_drift_v2(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_legacy_opening_snapshot_unchanged_v2(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_opening_snapshots_v2, public.ledger_legacy_opening_snapshot_items_v2, public.ledger_v2_legacy_opening_snapshot_currency_summary FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_legacy_opening_candidate_fingerprint_v2(text, uuid, text, text, text, text, text, numeric) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_legacy_opening_current_hash_v2() FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.capture_legacy_opening_snapshot_v2(text, jsonb) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_legacy_opening_snapshot_drift_v2(text) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.assert_legacy_opening_snapshot_unchanged_v2(text) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_opening_snapshots_v2, public.ledger_legacy_opening_snapshot_items_v2, public.ledger_v2_legacy_opening_snapshot_currency_summary FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_legacy_opening_candidate_fingerprint_v2(text, uuid, text, text, text, text, text, numeric) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_legacy_opening_current_hash_v2() FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.capture_legacy_opening_snapshot_v2(text, jsonb) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_legacy_opening_snapshot_drift_v2(text) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.assert_legacy_opening_snapshot_unchanged_v2(text) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_opening_snapshots_v2, public.ledger_legacy_opening_snapshot_items_v2, public.ledger_v2_legacy_opening_snapshot_currency_summary FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_legacy_opening_candidate_fingerprint_v2(text, uuid, text, text, text, text, text, numeric) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.ledger_legacy_opening_current_hash_v2() FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.capture_legacy_opening_snapshot_v2(text, jsonb) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_legacy_opening_snapshot_drift_v2(text) FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.assert_legacy_opening_snapshot_unchanged_v2(text) FROM service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.ledger_legacy_opening_snapshots_v2 IS
  'Immutable Phase 3 snapshot headers for legacy wallet and merchant balance opening-state capture. Snapshot capture never changes legacy balances or posts ledger journals.';
COMMENT ON TABLE public.ledger_legacy_opening_snapshot_items_v2 IS
  'Immutable per-source legacy opening balances and identities captured from ledger_v2_legacy_source_candidates.';
COMMENT ON FUNCTION public.assert_legacy_opening_snapshot_unchanged_v2(text) IS
  'Fails closed when any legacy source identity, membership, currency, system classification, or balance differs from the named immutable opening snapshot.';

COMMIT;
