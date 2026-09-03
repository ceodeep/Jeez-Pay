BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_legacy_account_map_v2 (
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  source_owner_ref text NOT NULL,
  currency text NOT NULL,
  account_key text NOT NULL,
  ledger_account_id uuid NOT NULL
    REFERENCES public.ledger_accounts_v2(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_kind, source_id),
  CONSTRAINT ledger_legacy_account_map_v2_source_kind_check
    CHECK (source_kind IN ('USER_WALLET', 'MERCHANT_BALANCE')),
  CONSTRAINT ledger_legacy_account_map_v2_owner_ref_not_blank
    CHECK (btrim(source_owner_ref) <> ''),
  CONSTRAINT ledger_legacy_account_map_v2_currency_format
    CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT ledger_legacy_account_map_v2_account_key_not_blank
    CHECK (btrim(account_key) <> ''),
  CONSTRAINT ledger_legacy_account_map_v2_account_key_unique
    UNIQUE (account_key),
  CONSTRAINT ledger_legacy_account_map_v2_ledger_account_unique
    UNIQUE (ledger_account_id)
);

CREATE INDEX IF NOT EXISTS ledger_legacy_account_map_v2_owner_lookup_idx
  ON public.ledger_legacy_account_map_v2 (source_kind, source_owner_ref, currency);

CREATE OR REPLACE FUNCTION public.reject_ledger_legacy_mapping_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_LEGACY_MAPPING_IMMUTABLE'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS ledger_legacy_account_map_v2_immutable
  ON public.ledger_legacy_account_map_v2;

CREATE TRIGGER ledger_legacy_account_map_v2_immutable
BEFORE UPDATE OR DELETE ON public.ledger_legacy_account_map_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_ledger_legacy_mapping_mutation_v2();

CREATE OR REPLACE VIEW public.ledger_v2_legacy_source_candidates
WITH (security_invoker = true) AS
SELECT
  'USER_WALLET'::text AS source_kind,
  w.id AS source_id,
  w.user_id::text AS source_owner_ref,
  upper(w.currency) AS currency,
  ('USER_WALLET:' || w.user_id::text || ':' || upper(w.currency))::text AS account_key,
  'USER_WALLET'::text AS account_type,
  'USER'::text AS owner_type,
  w.balance::numeric(38, 12) AS legacy_balance
FROM public.wallets AS w
WHERE w.user_id IS NOT NULL
  AND w.currency IS NOT NULL
  AND btrim(w.currency) <> ''

UNION ALL

SELECT
  'MERCHANT_BALANCE'::text AS source_kind,
  mb.id AS source_id,
  mb.merchant_id::text AS source_owner_ref,
  upper(mb.currency) AS currency,
  ('MERCHANT_BALANCE:' || mb.merchant_id::text || ':' || upper(mb.currency))::text AS account_key,
  'MERCHANT_BALANCE'::text AS account_type,
  'MERCHANT'::text AS owner_type,
  mb.balance::numeric(38, 12) AS legacy_balance
FROM public.merchant_balances AS mb
WHERE mb.merchant_id IS NOT NULL
  AND mb.currency IS NOT NULL
  AND btrim(mb.currency) <> '';

CREATE OR REPLACE FUNCTION public.materialize_legacy_account_mappings_v2()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_row record;
  v_existing public.ledger_legacy_account_map_v2%ROWTYPE;
  v_account_id uuid;
  v_source_count integer := 0;
  v_offset_count integer := 0;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.wallets
    WHERE user_id IS NULL
       OR currency IS NULL
       OR btrim(currency) = ''
       OR currency <> upper(currency)
       OR balance IS NULL
       OR balance < 0
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

  FOR v_row IN
    SELECT *
    FROM public.ledger_v2_legacy_source_candidates
    ORDER BY source_kind, source_id
  LOOP
    v_account_id := public.ensure_ledger_account_v2(
      v_row.account_key,
      v_row.account_type,
      v_row.owner_type,
      v_row.source_owner_ref,
      v_row.currency,
      false,
      jsonb_build_object(
        'legacySourceKind', v_row.source_kind,
        'legacySourceId', v_row.source_id,
        'migration', 'phase3_legacy_mapping_v2'
      )
    );

    INSERT INTO public.ledger_legacy_account_map_v2 (
      source_kind,
      source_id,
      source_owner_ref,
      currency,
      account_key,
      ledger_account_id
    )
    VALUES (
      v_row.source_kind,
      v_row.source_id,
      v_row.source_owner_ref,
      v_row.currency,
      v_row.account_key,
      v_account_id
    )
    ON CONFLICT (source_kind, source_id) DO NOTHING;

    SELECT *
    INTO v_existing
    FROM public.ledger_legacy_account_map_v2
    WHERE source_kind = v_row.source_kind
      AND source_id = v_row.source_id;

    IF v_existing.ledger_account_id IS DISTINCT FROM v_account_id
      OR v_existing.source_owner_ref IS DISTINCT FROM v_row.source_owner_ref
      OR v_existing.currency IS DISTINCT FROM v_row.currency
      OR v_existing.account_key IS DISTINCT FROM v_row.account_key
    THEN
      RAISE EXCEPTION 'LEDGER_LEGACY_MAPPING_CONFLICT'
        USING ERRCODE = 'P0001';
    END IF;

    v_source_count := v_source_count + 1;
  END LOOP;

  FOR v_row IN
    SELECT DISTINCT currency
    FROM public.ledger_v2_legacy_source_candidates
    ORDER BY currency
  LOOP
    PERFORM public.ensure_ledger_account_v2(
      'LEGACY_OPENING_OFFSET:' || v_row.currency,
      'OPENING_OFFSET',
      'SYSTEM',
      'LEGACY_OPENING',
      v_row.currency,
      true,
      jsonb_build_object(
        'purpose', 'legacy_opening_offset',
        'migration', 'phase3_legacy_mapping_v2'
      )
    );

    v_offset_count := v_offset_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'mappedSources', v_source_count,
    'openingOffsetAccounts', v_offset_count
  );
END;
$$;

CREATE OR REPLACE VIEW public.ledger_v2_legacy_mapping_status
WITH (security_invoker = true) AS
SELECT
  c.source_kind,
  c.source_id,
  c.source_owner_ref,
  c.currency,
  c.account_key,
  c.legacy_balance,
  m.ledger_account_id,
  a.account_type,
  a.owner_type,
  a.owner_ref,
  b.balance AS ledger_balance,
  CASE
    WHEN m.ledger_account_id IS NULL THEN 'UNMAPPED'
    WHEN a.id IS NULL THEN 'ACCOUNT_MISSING'
    WHEN b.account_id IS NULL THEN 'BALANCE_STATE_MISSING'
    WHEN a.account_key <> c.account_key
      OR a.currency <> c.currency
      OR a.owner_ref IS DISTINCT FROM c.source_owner_ref
    THEN 'IDENTITY_MISMATCH'
    ELSE 'MAPPED'
  END AS mapping_status
FROM public.ledger_v2_legacy_source_candidates AS c
LEFT JOIN public.ledger_legacy_account_map_v2 AS m
  ON m.source_kind = c.source_kind
 AND m.source_id = c.source_id
LEFT JOIN public.ledger_accounts_v2 AS a
  ON a.id = m.ledger_account_id
LEFT JOIN public.ledger_account_balances_v2 AS b
  ON b.account_id = m.ledger_account_id;

CREATE OR REPLACE VIEW public.ledger_v2_legacy_opening_entries_plan
WITH (security_invoker = true) AS
SELECT
  c.currency,
  'SOURCE'::text AS entry_role,
  c.source_kind,
  c.source_id,
  c.source_owner_ref,
  c.account_key,
  m.ledger_account_id,
  c.legacy_balance AS amount_delta
FROM public.ledger_v2_legacy_source_candidates AS c
LEFT JOIN public.ledger_legacy_account_map_v2 AS m
  ON m.source_kind = c.source_kind
 AND m.source_id = c.source_id
WHERE c.legacy_balance <> 0

UNION ALL

SELECT
  totals.currency,
  'OFFSET'::text AS entry_role,
  'SYSTEM'::text AS source_kind,
  NULL::uuid AS source_id,
  'LEGACY_OPENING'::text AS source_owner_ref,
  'LEGACY_OPENING_OFFSET:' || totals.currency AS account_key,
  offset_account.id AS ledger_account_id,
  -totals.total_balance AS amount_delta
FROM (
  SELECT
    currency,
    sum(legacy_balance)::numeric(38, 12) AS total_balance
  FROM public.ledger_v2_legacy_source_candidates
  GROUP BY currency
  HAVING sum(legacy_balance) <> 0
) AS totals
LEFT JOIN public.ledger_accounts_v2 AS offset_account
  ON offset_account.account_key = 'LEGACY_OPENING_OFFSET:' || totals.currency
 AND offset_account.account_type = 'OPENING_OFFSET'
 AND offset_account.owner_type = 'SYSTEM'
 AND offset_account.owner_ref = 'LEGACY_OPENING'
 AND offset_account.currency = totals.currency;

CREATE OR REPLACE VIEW public.ledger_v2_legacy_opening_summary
WITH (security_invoker = true) AS
SELECT
  currency,
  count(*) FILTER (WHERE entry_role = 'SOURCE') AS nonzero_source_entries,
  count(*) FILTER (WHERE entry_role = 'OFFSET') AS offset_entries,
  count(*) FILTER (WHERE ledger_account_id IS NULL) AS missing_ledger_accounts,
  sum(amount_delta)::numeric(38, 12) AS net_delta
FROM public.ledger_v2_legacy_opening_entries_plan
GROUP BY currency;

ALTER TABLE public.ledger_legacy_account_map_v2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.ledger_legacy_account_map_v2,
  public.ledger_v2_legacy_source_candidates,
  public.ledger_v2_legacy_mapping_status,
  public.ledger_v2_legacy_opening_entries_plan,
  public.ledger_v2_legacy_opening_summary
FROM PUBLIC;

REVOKE ALL ON FUNCTION public.materialize_legacy_account_mappings_v2()
FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_account_map_v2, public.ledger_v2_legacy_source_candidates, public.ledger_v2_legacy_mapping_status, public.ledger_v2_legacy_opening_entries_plan, public.ledger_v2_legacy_opening_summary FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.materialize_legacy_account_mappings_v2() FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_account_map_v2, public.ledger_v2_legacy_source_candidates, public.ledger_v2_legacy_mapping_status, public.ledger_v2_legacy_opening_entries_plan, public.ledger_v2_legacy_opening_summary FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.materialize_legacy_account_mappings_v2() FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE ALL ON TABLE public.ledger_legacy_account_map_v2, public.ledger_v2_legacy_source_candidates, public.ledger_v2_legacy_mapping_status, public.ledger_v2_legacy_opening_entries_plan, public.ledger_v2_legacy_opening_summary FROM service_role';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.materialize_legacy_account_mappings_v2() FROM service_role';
  END IF;
END;
$$;

COMMENT ON TABLE public.ledger_legacy_account_map_v2 IS
  'Immutable identity mapping from legacy user-wallet and merchant-balance rows to Ledger v2 accounts. No balances are copied by this table.';

COMMENT ON VIEW public.ledger_v2_legacy_opening_entries_plan IS
  'Read-only Phase 3 opening-balance plan. Positive legacy liabilities are offset per currency by LEGACY_OPENING_OFFSET accounts; this view never posts journals.';

COMMIT;
