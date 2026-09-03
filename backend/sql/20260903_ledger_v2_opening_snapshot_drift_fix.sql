BEGIN;

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

  WITH snapshot_items AS (
    SELECT *
    FROM public.ledger_legacy_opening_snapshot_items_v2
    WHERE snapshot_id = v_snapshot.id
  ),
  compared AS (
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
    FROM snapshot_items AS s
    FULL OUTER JOIN public.ledger_v2_legacy_source_candidates AS c
      ON c.source_kind = s.source_kind
     AND c.source_id = s.source_id
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

COMMENT ON FUNCTION public.check_legacy_opening_snapshot_drift_v2(text) IS
  'Compares one immutable opening snapshot only against the current legacy source set, detecting missing/new sources, identity drift, system classification drift, and balance drift.';

COMMIT;
