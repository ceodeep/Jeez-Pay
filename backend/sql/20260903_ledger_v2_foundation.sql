BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ledger_accounts_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_key text NOT NULL UNIQUE,
  account_type text NOT NULL,
  owner_type text NOT NULL,
  owner_ref text,
  currency text NOT NULL,
  allow_negative boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_v2_account_key_not_blank
    CHECK (btrim(account_key) <> ''),
  CONSTRAINT ledger_accounts_v2_account_type_not_blank
    CHECK (btrim(account_type) <> ''),
  CONSTRAINT ledger_accounts_v2_owner_type_not_blank
    CHECK (btrim(owner_type) <> ''),
  CONSTRAINT ledger_accounts_v2_currency_format
    CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT ledger_accounts_v2_status_check
    CHECK (status IN ('active', 'frozen', 'closed')),
  CONSTRAINT ledger_accounts_v2_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS ledger_accounts_v2_owner_lookup_idx
  ON public.ledger_accounts_v2 (owner_type, owner_ref, currency);

CREATE INDEX IF NOT EXISTS ledger_accounts_v2_currency_status_idx
  ON public.ledger_accounts_v2 (currency, status);

CREATE TABLE IF NOT EXISTS public.ledger_account_balances_v2 (
  account_id uuid PRIMARY KEY
    REFERENCES public.ledger_accounts_v2(id)
    ON DELETE RESTRICT,
  balance numeric(38, 12) NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_account_balances_v2_version_nonnegative
    CHECK (version >= 0)
);

CREATE TABLE IF NOT EXISTS public.ledger_journals_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL,
  source_ref text,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_journals_v2_source_type_not_blank
    CHECK (btrim(source_type) <> ''),
  CONSTRAINT ledger_journals_v2_idempotency_key_not_blank
    CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT ledger_journals_v2_request_hash_format
    CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ledger_journals_v2_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ledger_journals_v2_source_idempotency_uidx
    UNIQUE (source_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ledger_journals_v2_source_ref_idx
  ON public.ledger_journals_v2 (source_type, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS ledger_journals_v2_posted_at_idx
  ON public.ledger_journals_v2 (posted_at DESC);

CREATE TABLE IF NOT EXISTS public.ledger_entries_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_id uuid NOT NULL
    REFERENCES public.ledger_journals_v2(id)
    ON DELETE RESTRICT,
  account_id uuid NOT NULL
    REFERENCES public.ledger_accounts_v2(id)
    ON DELETE RESTRICT,
  currency text NOT NULL,
  amount_delta numeric(38, 12) NOT NULL,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entries_v2_currency_format
    CHECK (currency ~ '^[A-Z0-9]{3,10}$'),
  CONSTRAINT ledger_entries_v2_nonzero_amount
    CHECK (amount_delta <> 0),
  CONSTRAINT ledger_entries_v2_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ledger_entries_v2_one_line_per_account
    UNIQUE (journal_id, account_id)
);

CREATE INDEX IF NOT EXISTS ledger_entries_v2_account_created_idx
  ON public.ledger_entries_v2 (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ledger_entries_v2_journal_idx
  ON public.ledger_entries_v2 (journal_id);

CREATE OR REPLACE FUNCTION public.initialize_ledger_account_balance_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.ledger_account_balances_v2 (account_id, balance, version)
  VALUES (NEW.id, 0, 0)
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_accounts_v2_initialize_balance
  ON public.ledger_accounts_v2;

CREATE TRIGGER ledger_accounts_v2_initialize_balance
AFTER INSERT ON public.ledger_accounts_v2
FOR EACH ROW
EXECUTE FUNCTION public.initialize_ledger_account_balance_v2();

INSERT INTO public.ledger_account_balances_v2 (account_id, balance, version)
SELECT id, 0, 0
FROM public.ledger_accounts_v2
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.guard_ledger_account_identity_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_key IS DISTINCT FROM OLD.account_key
    OR NEW.account_type IS DISTINCT FROM OLD.account_type
    OR NEW.owner_type IS DISTINCT FROM OLD.owner_type
    OR NEW.owner_ref IS DISTINCT FROM OLD.owner_ref
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.allow_negative IS DISTINCT FROM OLD.allow_negative
  THEN
    RAISE EXCEPTION 'LEDGER_ACCOUNT_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_accounts_v2_guard_identity
  ON public.ledger_accounts_v2;

CREATE TRIGGER ledger_accounts_v2_guard_identity
BEFORE UPDATE ON public.ledger_accounts_v2
FOR EACH ROW
EXECUTE FUNCTION public.guard_ledger_account_identity_v2();

CREATE OR REPLACE FUNCTION public.reject_ledger_v2_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LEDGER_V2_IMMUTABLE_RECORD'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS ledger_journals_v2_immutable
  ON public.ledger_journals_v2;

CREATE TRIGGER ledger_journals_v2_immutable
BEFORE UPDATE OR DELETE ON public.ledger_journals_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_ledger_v2_immutable_mutation();

DROP TRIGGER IF EXISTS ledger_entries_v2_immutable
  ON public.ledger_entries_v2;

CREATE TRIGGER ledger_entries_v2_immutable
BEFORE UPDATE OR DELETE ON public.ledger_entries_v2
FOR EACH ROW
EXECUTE FUNCTION public.reject_ledger_v2_immutable_mutation();

CREATE OR REPLACE FUNCTION public.guard_ledger_balance_mutation_v2()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('jeezpay.ledger_posting_v2', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'LEDGER_BALANCE_DIRECT_MUTATION_FORBIDDEN'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ledger_account_balances_v2_guard_update
  ON public.ledger_account_balances_v2;

CREATE TRIGGER ledger_account_balances_v2_guard_update
BEFORE UPDATE OR DELETE ON public.ledger_account_balances_v2
FOR EACH ROW
EXECUTE FUNCTION public.guard_ledger_balance_mutation_v2();

CREATE OR REPLACE FUNCTION public.ensure_ledger_account_v2(
  p_account_key text,
  p_account_type text,
  p_owner_type text,
  p_owner_ref text,
  p_currency text,
  p_allow_negative boolean DEFAULT false,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_account_id uuid;
  v_existing public.ledger_accounts_v2%ROWTYPE;
  v_account_key text := btrim(COALESCE(p_account_key, ''));
  v_account_type text := upper(btrim(COALESCE(p_account_type, '')));
  v_owner_type text := upper(btrim(COALESCE(p_owner_type, '')));
  v_owner_ref text := NULLIF(btrim(COALESCE(p_owner_ref, '')), '');
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF v_account_key = '' OR length(v_account_key) > 200 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_ACCOUNT_KEY' USING ERRCODE = 'P0001';
  END IF;

  IF v_account_type = '' OR length(v_account_type) > 80 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_ACCOUNT_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF v_owner_type = '' OR length(v_owner_type) > 80 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_OWNER_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF v_currency !~ '^[A-Z0-9]{3,10}$' THEN
    RAISE EXCEPTION 'LEDGER_INVALID_CURRENCY' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'LEDGER_INVALID_METADATA' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.ledger_accounts_v2
  WHERE account_key = v_account_key;

  IF FOUND THEN
    IF v_existing.account_type <> v_account_type
      OR v_existing.owner_type <> v_owner_type
      OR v_existing.owner_ref IS DISTINCT FROM v_owner_ref
      OR v_existing.currency <> v_currency
      OR v_existing.allow_negative <> COALESCE(p_allow_negative, false)
    THEN
      RAISE EXCEPTION 'LEDGER_ACCOUNT_KEY_CONFLICT'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN v_existing.id;
  END IF;

  INSERT INTO public.ledger_accounts_v2 (
    account_key,
    account_type,
    owner_type,
    owner_ref,
    currency,
    allow_negative,
    metadata
  )
  VALUES (
    v_account_key,
    v_account_type,
    v_owner_type,
    v_owner_ref,
    v_currency,
    COALESCE(p_allow_negative, false),
    v_metadata
  )
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_ledger_journal_v2(
  p_source_type text,
  p_source_ref text,
  p_idempotency_key text,
  p_description text,
  p_metadata jsonb,
  p_entries jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source_type text := upper(btrim(COALESCE(p_source_type, '')));
  v_source_ref text := NULLIF(btrim(COALESCE(p_source_ref, '')), '');
  v_idempotency_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_request_hash text;
  v_existing_id uuid;
  v_existing_hash text;
  v_journal_id uuid;
  v_account_ids uuid[];
  v_entry_count integer;
  v_bad_count integer;
BEGIN
  IF v_source_type = '' OR length(v_source_type) > 80 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_SOURCE_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF v_idempotency_key = '' OR length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_IDEMPOTENCY_KEY' USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'LEDGER_INVALID_METADATA' USING ERRCODE = 'P0001';
  END IF;

  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'LEDGER_ENTRIES_MUST_BE_ARRAY' USING ERRCODE = 'P0001';
  END IF;

  v_entry_count := jsonb_array_length(p_entries);
  IF v_entry_count < 2 OR v_entry_count > 64 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_ENTRY_COUNT' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_bad_count
  FROM jsonb_array_elements(p_entries) AS e
  WHERE jsonb_typeof(e) <> 'object'
     OR NULLIF(btrim(e->>'accountId'), '') IS NULL
     OR NULLIF(btrim(e->>'currency'), '') IS NULL
     OR NULLIF(btrim(e->>'amountDelta'), '') IS NULL
     OR COALESCE(jsonb_typeof(e->'metadata'), 'object') <> 'object';

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_INVALID_ENTRY_SHAPE' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    SELECT array_agg((e->>'accountId')::uuid ORDER BY (e->>'accountId')::uuid)
    INTO v_account_ids
    FROM jsonb_array_elements(p_entries) AS e;

    PERFORM (e->>'amountDelta')::numeric
    FROM jsonb_array_elements(p_entries) AS e;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'LEDGER_INVALID_ENTRY_VALUE' USING ERRCODE = 'P0001';
  END;

  IF cardinality(v_account_ids) <> (
    SELECT count(DISTINCT account_id)
    FROM unnest(v_account_ids) AS account_id
  ) THEN
    RAISE EXCEPTION 'LEDGER_DUPLICATE_ACCOUNT_ENTRY' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_bad_count
  FROM jsonb_array_elements(p_entries) AS e
  WHERE (e->>'amountDelta')::numeric = 0;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_ZERO_ENTRY_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_bad_count
  FROM (
    SELECT
      upper(btrim(e->>'currency')) AS currency,
      sum((e->>'amountDelta')::numeric) AS net_delta
    FROM jsonb_array_elements(p_entries) AS e
    GROUP BY upper(btrim(e->>'currency'))
    HAVING sum((e->>'amountDelta')::numeric) <> 0
  ) AS unbalanced;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_JOURNAL_NOT_BALANCED' USING ERRCODE = 'P0001';
  END IF;

  v_request_hash := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'sourceType', v_source_type,
          'sourceRef', v_source_ref,
          'description', p_description,
          'metadata', v_metadata,
          'entries', p_entries
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  SELECT id, request_hash
  INTO v_existing_id, v_existing_hash
  FROM public.ledger_journals_v2
  WHERE source_type = v_source_type
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash <> v_request_hash THEN
      RAISE EXCEPTION 'LEDGER_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'journalId', v_existing_id,
      'idempotentReplay', true
    );
  END IF;

  PERFORM id
  FROM public.ledger_accounts_v2
  WHERE id = ANY(v_account_ids)
  ORDER BY id
  FOR UPDATE;

  SELECT count(*)
  INTO v_bad_count
  FROM unnest(v_account_ids) AS requested(id)
  LEFT JOIN public.ledger_accounts_v2 AS a ON a.id = requested.id
  WHERE a.id IS NULL;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_ACCOUNT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_bad_count
  FROM public.ledger_accounts_v2 AS a
  WHERE a.id = ANY(v_account_ids)
    AND a.status <> 'active';

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_ACCOUNT_NOT_ACTIVE' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_bad_count
  FROM jsonb_array_elements(p_entries) AS e
  JOIN public.ledger_accounts_v2 AS a
    ON a.id = (e->>'accountId')::uuid
  WHERE upper(btrim(e->>'currency')) <> a.currency;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_ENTRY_CURRENCY_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
  INTO v_bad_count
  FROM jsonb_array_elements(p_entries) AS e
  JOIN public.ledger_accounts_v2 AS a
    ON a.id = (e->>'accountId')::uuid
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = a.id
  WHERE a.allow_negative IS FALSE
    AND b.balance + (e->>'amountDelta')::numeric < 0;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'LEDGER_INSUFFICIENT_BALANCE' USING ERRCODE = 'P0001';
  END IF;

  -- Recheck after deterministic account locks so concurrent duplicate requests
  -- cannot post twice while waiting on the same account set.
  SELECT id, request_hash
  INTO v_existing_id, v_existing_hash
  FROM public.ledger_journals_v2
  WHERE source_type = v_source_type
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_hash <> v_request_hash THEN
      RAISE EXCEPTION 'LEDGER_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    RETURN jsonb_build_object(
      'ok', true,
      'journalId', v_existing_id,
      'idempotentReplay', true
    );
  END IF;

  BEGIN
    INSERT INTO public.ledger_journals_v2 (
      source_type,
      source_ref,
      idempotency_key,
      request_hash,
      description,
      metadata
    )
    VALUES (
      v_source_type,
      v_source_ref,
      v_idempotency_key,
      v_request_hash,
      p_description,
      v_metadata
    )
    RETURNING id INTO v_journal_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id, request_hash
      INTO v_existing_id, v_existing_hash
      FROM public.ledger_journals_v2
      WHERE source_type = v_source_type
        AND idempotency_key = v_idempotency_key;

      IF v_existing_id IS NULL OR v_existing_hash <> v_request_hash THEN
        RAISE EXCEPTION 'LEDGER_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
      END IF;

      RETURN jsonb_build_object(
        'ok', true,
        'journalId', v_existing_id,
        'idempotentReplay', true
      );
  END;

  INSERT INTO public.ledger_entries_v2 (
    journal_id,
    account_id,
    currency,
    amount_delta,
    description,
    metadata
  )
  SELECT
    v_journal_id,
    (e->>'accountId')::uuid,
    upper(btrim(e->>'currency')),
    (e->>'amountDelta')::numeric(38, 12),
    NULLIF(btrim(COALESCE(e->>'description', '')), ''),
    COALESCE(e->'metadata', '{}'::jsonb)
  FROM jsonb_array_elements(p_entries) AS e;

  PERFORM set_config('jeezpay.ledger_posting_v2', 'on', true);

  UPDATE public.ledger_account_balances_v2 AS b
  SET
    balance = b.balance + delta.amount_delta,
    version = b.version + 1,
    updated_at = now()
  FROM (
    SELECT
      (e->>'accountId')::uuid AS account_id,
      (e->>'amountDelta')::numeric(38, 12) AS amount_delta
    FROM jsonb_array_elements(p_entries) AS e
  ) AS delta
  WHERE b.account_id = delta.account_id;

  PERFORM set_config('jeezpay.ledger_posting_v2', 'off', true);

  RETURN jsonb_build_object(
    'ok', true,
    'journalId', v_journal_id,
    'idempotentReplay', false
  );
END;
$$;

CREATE OR REPLACE VIEW public.ledger_v2_unbalanced_journals AS
SELECT
  e.journal_id,
  e.currency,
  sum(e.amount_delta) AS net_delta
FROM public.ledger_entries_v2 AS e
GROUP BY e.journal_id, e.currency
HAVING sum(e.amount_delta) <> 0;

CREATE OR REPLACE VIEW public.ledger_v2_balance_reconciliation AS
SELECT
  a.id AS account_id,
  a.account_key,
  a.account_type,
  a.owner_type,
  a.owner_ref,
  a.currency,
  b.balance AS snapshot_balance,
  COALESCE(sum(e.amount_delta), 0)::numeric(38, 12) AS journal_balance,
  (b.balance - COALESCE(sum(e.amount_delta), 0))::numeric(38, 12) AS difference,
  b.version,
  b.updated_at
FROM public.ledger_accounts_v2 AS a
JOIN public.ledger_account_balances_v2 AS b
  ON b.account_id = a.id
LEFT JOIN public.ledger_entries_v2 AS e
  ON e.account_id = a.id
GROUP BY
  a.id,
  a.account_key,
  a.account_type,
  a.owner_type,
  a.owner_ref,
  a.currency,
  b.balance,
  b.version,
  b.updated_at;

ALTER TABLE public.ledger_accounts_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_account_balances_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_journals_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries_v2 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.ensure_ledger_account_v2(
  text, text, text, text, text, boolean, jsonb
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.post_ledger_journal_v2(
  text, text, text, text, jsonb, jsonb
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.ensure_ledger_account_v2(
      text, text, text, text, text, boolean, jsonb
    ) TO service_role;

    GRANT EXECUTE ON FUNCTION public.post_ledger_journal_v2(
      text, text, text, text, jsonb, jsonb
    ) TO service_role;

    GRANT SELECT ON
      public.ledger_accounts_v2,
      public.ledger_account_balances_v2,
      public.ledger_journals_v2,
      public.ledger_entries_v2
    TO service_role;
  END IF;
END;
$$;

COMMENT ON TABLE public.ledger_journals_v2 IS
  'Ledger v2 immutable posting headers. Legacy wallet balances remain authoritative until Phase 4 cutover.';

COMMENT ON TABLE public.ledger_entries_v2 IS
  'Ledger v2 immutable signed balance deltas. Each journal must net to zero independently per currency.';

COMMENT ON TABLE public.ledger_account_balances_v2 IS
  'Derived balance snapshot maintained atomically by post_ledger_journal_v2; ledger entries remain the audit source of truth.';

COMMIT;
