BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_legacy_opening_cutovers_v2 (
  cutover_key text PRIMARY KEY,
  snapshot_id uuid NOT NULL UNIQUE
    REFERENCES public.ledger_legacy_opening_snapshots_v2(id)
    ON DELETE RESTRICT,
  snapshot_key text NOT NULL UNIQUE,
  source_hash text NOT NULL,
  source_count integer NOT NULL,
  currency_count integer NOT NULL,
  journal_count integer NOT NULL,
  journal_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_key_check
    CHECK (cutover_key = 'LEGACY_OPENING_V2'),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_snapshot_key_not_blank
    CHECK (btrim(snapshot_key) <> ''),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_hash_format
    CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_source_count_positive
    CHECK (source_count > 0),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_currency_count_positive
    CHECK (currency_count > 0),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_journal_count_nonnegative
    CHECK (journal_count >= 0),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_journal_ids_object
    CHECK (jsonb_typeof(journal_ids) = 'object'),
  CONSTRAINT ledger_legacy_opening_cutovers_v2_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE OR REPLACE FUNCTION public.reject_ledger_legacy_opening_cutover_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_CUTOVER_IMMUTABLE'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS ledger_legacy_opening_cutovers_v2_immutable
  ON public.ledger_legacy_opening_cutovers_v2;
CREATE TRIGGER ledger_legacy_opening_cutovers_v2_immutable
BEFORE UPDATE OR DELETE ON public.ledger_legacy_opening_cutovers_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_ledger_legacy_opening_cutover_mutation_v2();

CREATE OR REPLACE FUNCTION public.execute_legacy_opening_cutover_v2(
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
  v_existing public.ledger_legacy_opening_cutovers_v2%ROWTYPE;
  v_snapshot public.ledger_legacy_opening_snapshots_v2%ROWTYPE;
  v_capture jsonb;
  v_drift jsonb;
  v_mapping jsonb;
  v_currency text;
  v_currency_total numeric(38, 12);
  v_entries jsonb;
  v_post_result jsonb;
  v_journal_id uuid;
  v_journal_ids jsonb := '{}'::jsonb;
  v_journal_count integer := 0;
  v_bad_count integer;
  v_expected_mapping_count integer;
  v_existing_journals integer;
  v_existing_entries integer;
BEGIN
  IF v_snapshot_key = '' OR length(v_snapshot_key) > 160 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_INVALID_SNAPSHOT_KEY'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_INVALID_METADATA'
      USING ERRCODE = 'P0001';
  END IF;

  -- Serialize the one-time opening cutover globally.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('ledger_legacy_opening_cutover_v2', 0)
  );

  SELECT * INTO v_existing
  FROM public.ledger_legacy_opening_cutovers_v2
  WHERE cutover_key = 'LEGACY_OPENING_V2';

  IF FOUND THEN
    IF v_existing.snapshot_key <> v_snapshot_key THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_ALREADY_COMPLETED'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'completedSnapshotKey', v_existing.snapshot_key,
                'requestedSnapshotKey', v_snapshot_key,
                'completedAt', v_existing.completed_at
              )::text;
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'cutoverKey', v_existing.cutover_key,
      'snapshotId', v_existing.snapshot_id,
      'snapshotKey', v_existing.snapshot_key,
      'sourceHash', v_existing.source_hash,
      'sourceCount', v_existing.source_count,
      'currencyCount', v_existing.currency_count,
      'journalCount', v_existing.journal_count,
      'journalIds', v_existing.journal_ids,
      'completedAt', v_existing.completed_at,
      'idempotentReplay', true
    );
  END IF;

  -- Phase 3.5 is only valid before any non-opening Ledger v2 journal exists.
  SELECT count(*) INTO v_existing_journals
  FROM public.ledger_journals_v2;
  SELECT count(*) INTO v_existing_entries
  FROM public.ledger_entries_v2;

  IF v_existing_journals <> 0 OR v_existing_entries <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_LEDGER_NOT_EMPTY'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'journalCount', v_existing_journals,
              'entryCount', v_existing_entries
            )::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_account_balances_v2
    WHERE balance <> 0
  ) THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_NONZERO_LEDGER_BALANCE'
      USING ERRCODE = 'P0001';
  END IF;

  -- These locks are held until the caller transaction ends. They block the
  -- INSERT/UPDATE/DELETE lock mode used by all legacy balance and identity
  -- writers, closing the capture/check/post race even if application writers
  -- have not fully quiesced.
  LOCK TABLE public.wallets IN SHARE MODE;
  LOCK TABLE public.merchant_balances IN SHARE MODE;
  LOCK TABLE public.users IN SHARE MODE;
  LOCK TABLE public.system_accounts IN SHARE MODE;

  v_capture := public.capture_legacy_opening_snapshot_v2(
    v_snapshot_key,
    v_metadata || jsonb_build_object(
      'purpose', 'ledger_v2_opening_cutover',
      'cutoverKey', 'LEGACY_OPENING_V2'
    )
  );

  SELECT * INTO v_snapshot
  FROM public.ledger_legacy_opening_snapshots_v2
  WHERE snapshot_key = v_snapshot_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_SNAPSHOT_NOT_FOUND'
      USING ERRCODE = 'P0001';
  END IF;

  v_drift := public.assert_legacy_opening_snapshot_unchanged_v2(v_snapshot_key);

  -- Deterministically create the 1:1 legacy account mappings and one negative
  -- opening-offset account per currency. This function never changes legacy
  -- balances and is idempotent.
  v_mapping := public.materialize_legacy_account_mappings_v2();

  SELECT count(*) INTO v_expected_mapping_count
  FROM public.ledger_legacy_opening_snapshot_items_v2
  WHERE snapshot_id = v_snapshot.id;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_legacy_opening_snapshot_items_v2 AS s
  LEFT JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = s.source_kind
   AND m.source_id = s.source_id
  LEFT JOIN public.ledger_accounts_v2 AS a
    ON a.id = m.ledger_account_id
  LEFT JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE s.snapshot_id = v_snapshot.id
    AND (
      m.ledger_account_id IS NULL
      OR m.source_owner_ref IS DISTINCT FROM s.source_owner_ref
      OR m.currency IS DISTINCT FROM s.currency
      OR m.account_key IS DISTINCT FROM s.account_key
      OR a.account_key IS DISTINCT FROM s.account_key
      OR a.account_type IS DISTINCT FROM s.account_type
      OR a.owner_type IS DISTINCT FROM s.owner_type
      OR a.owner_ref IS DISTINCT FROM s.source_owner_ref
      OR a.currency IS DISTINCT FROM s.currency
      OR b.account_id IS NULL
      OR b.balance <> 0
    );

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_MAPPING_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  IF (SELECT count(*) FROM public.ledger_legacy_account_map_v2)
     <> v_expected_mapping_count THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_MAPPING_COUNT_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'expected', v_expected_mapping_count,
              'actual', (SELECT count(*) FROM public.ledger_legacy_account_map_v2)
            )::text;
  END IF;

  -- One journal per currency. Each source receives its exact positive opening
  -- liability and the dedicated offset account receives the matching negative
  -- total. Zero-total currencies need no journal.
  FOR v_currency, v_currency_total IN
    SELECT
      currency,
      sum(legacy_balance)::numeric(38, 12)
    FROM public.ledger_legacy_opening_snapshot_items_v2
    WHERE snapshot_id = v_snapshot.id
    GROUP BY currency
    ORDER BY currency
  LOOP
    IF v_currency_total = 0 THEN
      CONTINUE;
    END IF;

    WITH source_entries AS (
      SELECT
        s.account_key,
        jsonb_build_object(
          'accountId', m.ledger_account_id,
          'currency', s.currency,
          'amountDelta', s.legacy_balance,
          'description', 'Legacy opening balance: ' || s.source_kind,
          'metadata', jsonb_build_object(
            'openingRole', 'SOURCE',
            'snapshotId', v_snapshot.id,
            'snapshotKey', v_snapshot.snapshot_key,
            'legacySourceKind', s.source_kind,
            'legacySourceId', s.source_id,
            'legacySourceFingerprint', s.source_fingerprint
          )
        ) AS entry
      FROM public.ledger_legacy_opening_snapshot_items_v2 AS s
      JOIN public.ledger_legacy_account_map_v2 AS m
        ON m.source_kind = s.source_kind
       AND m.source_id = s.source_id
      WHERE s.snapshot_id = v_snapshot.id
        AND s.currency = v_currency
        AND s.legacy_balance <> 0
    ),
    offset_entry AS (
      SELECT
        a.account_key,
        jsonb_build_object(
          'accountId', a.id,
          'currency', v_currency,
          'amountDelta', -v_currency_total,
          'description', 'Legacy opening offset',
          'metadata', jsonb_build_object(
            'openingRole', 'OFFSET',
            'snapshotId', v_snapshot.id,
            'snapshotKey', v_snapshot.snapshot_key
          )
        ) AS entry
      FROM public.ledger_accounts_v2 AS a
      WHERE a.account_key = 'LEGACY_OPENING_OFFSET:' || v_currency
        AND a.account_type = 'OPENING_OFFSET'
        AND a.owner_type = 'SYSTEM'
        AND a.owner_ref = 'LEGACY_OPENING'
        AND a.currency = v_currency
        AND a.allow_negative IS TRUE
    ),
    all_entries AS (
      SELECT account_key, entry FROM source_entries
      UNION ALL
      SELECT account_key, entry FROM offset_entry
    )
    SELECT jsonb_agg(entry ORDER BY account_key)
    INTO v_entries
    FROM all_entries;

    IF v_entries IS NULL
       OR jsonb_array_length(v_entries) < 2 THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_INVALID_CURRENCY_ENTRIES'
        USING ERRCODE = 'P0001',
              DETAIL = jsonb_build_object(
                'currency', v_currency,
                'total', v_currency_total
              )::text;
    END IF;

    v_post_result := public.post_ledger_journal_v2(
      'LEGACY_OPENING_V2',
      v_snapshot.id::text || ':' || v_currency,
      'legacy-opening-v2:' || v_snapshot.id::text || ':' || v_currency,
      'Legacy opening balance ' || v_currency,
      jsonb_build_object(
        'cutoverKey', 'LEGACY_OPENING_V2',
        'snapshotId', v_snapshot.id,
        'snapshotKey', v_snapshot.snapshot_key,
        'sourceHash', v_snapshot.source_hash,
        'currency', v_currency,
        'legacyTotal', v_currency_total
      ),
      v_entries
    );

    v_journal_id := (v_post_result->>'journalId')::uuid;

    IF v_journal_id IS NULL THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_JOURNAL_ID_MISSING'
        USING ERRCODE = 'P0001';
    END IF;

    v_journal_ids := v_journal_ids || jsonb_build_object(
      v_currency,
      v_journal_id::text
    );
    v_journal_count := v_journal_count + 1;
  END LOOP;

  -- Every snapshot source must now equal its exact immutable opening value in
  -- both the derived snapshot and immutable journal sum.
  SELECT count(*) INTO v_bad_count
  FROM public.ledger_legacy_opening_snapshot_items_v2 AS s
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = s.source_kind
   AND m.source_id = s.source_id
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(e.amount_delta), 0)::numeric(38, 12) AS journal_balance
    FROM public.ledger_entries_v2 AS e
    WHERE e.account_id = m.ledger_account_id
  ) AS j ON true
  WHERE s.snapshot_id = v_snapshot.id
    AND (
      b.balance IS DISTINCT FROM s.legacy_balance
      OR j.journal_balance IS DISTINCT FROM s.legacy_balance
    );

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_SOURCE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  -- Each offset must be the exact negative aggregate for its currency.
  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT
      s.currency,
      sum(s.legacy_balance)::numeric(38, 12) AS expected_total
    FROM public.ledger_legacy_opening_snapshot_items_v2 AS s
    WHERE s.snapshot_id = v_snapshot.id
    GROUP BY s.currency
    HAVING sum(s.legacy_balance) <> 0
  ) AS totals
  LEFT JOIN public.ledger_accounts_v2 AS a
    ON a.account_key = 'LEGACY_OPENING_OFFSET:' || totals.currency
   AND a.account_type = 'OPENING_OFFSET'
   AND a.owner_type = 'SYSTEM'
   AND a.owner_ref = 'LEGACY_OPENING'
   AND a.currency = totals.currency
  LEFT JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(e.amount_delta), 0)::numeric(38, 12) AS journal_balance
    FROM public.ledger_entries_v2 AS e
    WHERE e.account_id = a.id
  ) AS j ON true
  WHERE a.id IS NULL
     OR b.account_id IS NULL
     OR b.balance IS DISTINCT FROM -totals.expected_total
     OR j.journal_balance IS DISTINCT FROM -totals.expected_total;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_OFFSET_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badCurrencies', v_bad_count)::text;
  END IF;

  IF EXISTS (SELECT 1 FROM public.ledger_v2_unbalanced_journals) THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_UNBALANCED_JOURNAL'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_balance_reconciliation
    WHERE difference <> 0
  ) THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_OPENING_RECONCILIATION_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  -- Re-assert while the source locks are still held. This proves that the
  -- immutable snapshot is still exactly the live legacy state at posting time.
  v_drift := public.assert_legacy_opening_snapshot_unchanged_v2(v_snapshot_key);

  INSERT INTO public.ledger_legacy_opening_cutovers_v2 (
    cutover_key,
    snapshot_id,
    snapshot_key,
    source_hash,
    source_count,
    currency_count,
    journal_count,
    journal_ids,
    metadata
  ) VALUES (
    'LEGACY_OPENING_V2',
    v_snapshot.id,
    v_snapshot.snapshot_key,
    v_snapshot.source_hash,
    v_snapshot.source_count,
    v_snapshot.currency_count,
    v_journal_count,
    v_journal_ids,
    v_metadata || jsonb_build_object(
      'capture', v_capture,
      'mapping', v_mapping,
      'finalDrift', v_drift
    )
  )
  RETURNING * INTO v_existing;

  RETURN jsonb_build_object(
    'ok', true,
    'cutoverKey', v_existing.cutover_key,
    'snapshotId', v_existing.snapshot_id,
    'snapshotKey', v_existing.snapshot_key,
    'sourceHash', v_existing.source_hash,
    'sourceCount', v_existing.source_count,
    'currencyCount', v_existing.currency_count,
    'journalCount', v_existing.journal_count,
    'journalIds', v_existing.journal_ids,
    'completedAt', v_existing.completed_at,
    'idempotentReplay', false
  );
END;
$$;

CREATE OR REPLACE VIEW public.ledger_v2_legacy_opening_cutover_currency_status
WITH (security_invoker = true) AS
WITH cutover AS (
  SELECT c.*, s.captured_at
  FROM public.ledger_legacy_opening_cutovers_v2 AS c
  JOIN public.ledger_legacy_opening_snapshots_v2 AS s
    ON s.id = c.snapshot_id
  WHERE c.cutover_key = 'LEGACY_OPENING_V2'
),
source_totals AS (
  SELECT
    c.snapshot_id,
    i.currency,
    count(*) AS source_count,
    count(*) FILTER (WHERE i.legacy_balance <> 0) AS nonzero_source_count,
    sum(i.legacy_balance)::numeric(38, 12) AS expected_source_balance,
    COALESCE(sum(b.balance), 0)::numeric(38, 12) AS actual_source_balance
  FROM cutover AS c
  JOIN public.ledger_legacy_opening_snapshot_items_v2 AS i
    ON i.snapshot_id = c.snapshot_id
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = i.source_kind
   AND m.source_id = i.source_id
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  GROUP BY c.snapshot_id, i.currency
),
offsets AS (
  SELECT
    a.currency,
    a.id AS offset_account_id,
    b.balance::numeric(38, 12) AS offset_balance
  FROM public.ledger_accounts_v2 AS a
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.account_type = 'OPENING_OFFSET'
    AND a.owner_type = 'SYSTEM'
    AND a.owner_ref = 'LEGACY_OPENING'
    AND a.account_key = 'LEGACY_OPENING_OFFSET:' || a.currency
),
combined AS (
  SELECT
    c.cutover_key,
    c.snapshot_id,
    c.snapshot_key,
    c.source_hash,
    c.captured_at,
    c.completed_at,
    st.currency,
    st.source_count,
    st.nonzero_source_count,
    st.expected_source_balance,
    st.actual_source_balance,
    o.offset_account_id,
    o.offset_balance,
    NULLIF(c.journal_ids->>st.currency, '')::uuid AS journal_id
  FROM cutover AS c
  JOIN source_totals AS st ON st.snapshot_id = c.snapshot_id
  LEFT JOIN offsets AS o ON o.currency = st.currency
)
SELECT
  combined.*,
  (actual_source_balance - expected_source_balance)::numeric(38, 12)
    AS source_balance_difference,
  (actual_source_balance + COALESCE(offset_balance, 0))::numeric(38, 12)
    AS currency_net,
  CASE
    WHEN expected_source_balance = 0
      AND actual_source_balance = 0
      AND COALESCE(offset_balance, 0) = 0
      AND journal_id IS NULL
    THEN 'OK_ZERO'
    WHEN journal_id IS NULL THEN 'JOURNAL_MISSING'
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.ledger_journals_v2 AS j
      WHERE j.id = combined.journal_id
        AND j.source_type = 'LEGACY_OPENING_V2'
    ) THEN 'JOURNAL_NOT_FOUND'
    WHEN EXISTS (
      SELECT 1
      FROM public.ledger_v2_unbalanced_journals AS u
      WHERE u.journal_id = combined.journal_id
    ) THEN 'JOURNAL_UNBALANCED'
    WHEN actual_source_balance <> expected_source_balance
    THEN 'SOURCE_BALANCE_MISMATCH'
    WHEN offset_account_id IS NULL THEN 'OFFSET_ACCOUNT_MISSING'
    WHEN offset_balance <> -expected_source_balance
    THEN 'OFFSET_BALANCE_MISMATCH'
    WHEN actual_source_balance + offset_balance <> 0
    THEN 'CURRENCY_NOT_NET_ZERO'
    ELSE 'OK'
  END AS status
FROM combined;

ALTER TABLE public.ledger_legacy_opening_cutovers_v2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.ledger_legacy_opening_cutovers_v2,
  public.ledger_v2_legacy_opening_cutover_currency_status
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.execute_legacy_opening_cutover_v2(text, jsonb)
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_opening_cutovers_v2, public.ledger_v2_legacy_opening_cutover_currency_status FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_legacy_opening_cutover_v2(text, jsonb) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_opening_cutovers_v2, public.ledger_v2_legacy_opening_cutover_currency_status FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_legacy_opening_cutover_v2(text, jsonb) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_opening_cutovers_v2, public.ledger_v2_legacy_opening_cutover_currency_status FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_legacy_opening_cutover_v2(text, jsonb) FROM service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.ledger_legacy_opening_cutovers_v2 IS
  'Immutable one-time record of the Ledger v2 legacy opening cutover. A completed row proves the named immutable snapshot was mapped and posted while legacy source tables were locked.';
COMMENT ON FUNCTION public.execute_legacy_opening_cutover_v2(text, jsonb) IS
  'One-time atomic legacy opening cutover primitive. Locks legacy sources, captures/asserts snapshot, materializes deterministic accounts, posts one zero-sum journal per nonzero currency, re-asserts drift, and records completion. Does not change legacy balances.';
COMMENT ON VIEW public.ledger_v2_legacy_opening_cutover_currency_status IS
  'Post-cutover per-currency proof that snapshot liabilities equal Ledger v2 source balances, opening offsets negate them, and the opening journal exists and balances.';

COMMIT;
