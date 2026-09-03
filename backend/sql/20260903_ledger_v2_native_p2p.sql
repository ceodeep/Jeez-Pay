BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.wallet_transfer(uuid,text,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_P2P_LEGACY_WALLET_TRANSFER_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.post_ledger_journal_v2(text,text,text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_P2P_LEDGER_POSTING_PRIMITIVE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.materialize_legacy_account_mappings_v2()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_P2P_MAPPING_PRIMITIVE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Phase 4.2 database primitive:
-- 1) Add a transaction-local bypass understood only by the generic legacy mirror.
-- 2) Add a service-role-only P2P wrapper that runs the proven legacy wallet_transfer
--    and posts the exact resulting wallet deltas as one native Ledger v2 journal.
--
-- The HTTP route is NOT switched by this migration. Legacy callers continue to be
-- mirrored by Phase 4.1 until a later deployment checkpoint.

CREATE OR REPLACE FUNCTION public.mirror_legacy_balance_change_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_source_kind text := TG_ARGV[0];
  v_source_id uuid;
  v_currency text;
  v_old_balance numeric(38, 12);
  v_new_balance numeric(38, 12);
  v_delta numeric(38, 12);
  v_mapping public.ledger_legacy_account_map_v2%ROWTYPE;
  v_ledger_balance numeric(38, 12);
  v_bridge_id uuid;
  v_bridge_balance numeric(38, 12);
  v_entries jsonb;
  v_post_result jsonb;
  v_idempotency_key text;
BEGIN
  -- Native Ledger-aware primitives set this LOCAL GUC only while they perform
  -- the legacy write that they will post themselves. Ordinary legacy writers
  -- cannot reach this path through the app API.
  IF current_setting('jeezpay.ledger_native_posting_v2', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_source_id := NEW.id;
    v_currency := upper(NEW.currency);
    v_old_balance := 0;
    v_new_balance := NEW.balance::numeric(38, 12);
  ELSIF TG_OP = 'UPDATE' THEN
    v_source_id := NEW.id;
    v_currency := upper(NEW.currency);
    v_old_balance := OLD.balance::numeric(38, 12);
    v_new_balance := NEW.balance::numeric(38, 12);
  ELSE
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_UNSUPPORTED_TRIGGER_OP'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.materialize_legacy_account_mappings_v2();
  END IF;

  SELECT * INTO v_mapping
  FROM public.ledger_legacy_account_map_v2
  WHERE source_kind = v_source_kind
    AND source_id = v_source_id;

  IF NOT FOUND THEN
    PERFORM public.materialize_legacy_account_mappings_v2();

    SELECT * INTO v_mapping
    FROM public.ledger_legacy_account_map_v2
    WHERE source_kind = v_source_kind
      AND source_id = v_source_id;
  END IF;

  IF v_mapping.ledger_account_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_MAPPING_MISSING'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'sourceKind', v_source_kind,
              'sourceId', v_source_id
            )::text;
  END IF;

  IF v_mapping.currency IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_MAPPING_CURRENCY_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_balance
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_mapping.ledger_account_id;

  IF v_ledger_balance IS NULL
     OR v_ledger_balance IS DISTINCT FROM v_old_balance THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_PRE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'sourceKind', v_source_kind,
              'sourceId', v_source_id,
              'legacyBefore', v_old_balance,
              'ledgerBefore', v_ledger_balance
            )::text;
  END IF;

  v_delta := (v_new_balance - v_old_balance)::numeric(38, 12);

  IF v_delta = 0 THEN
    RETURN NEW;
  END IF;

  v_bridge_id := public.ensure_ledger_account_v2(
    'LEGACY_MIRROR_BRIDGE:' || v_currency,
    'LEGACY_MIRROR_BRIDGE',
    'SYSTEM',
    'LEGACY_MIRROR',
    v_currency,
    true,
    jsonb_build_object(
      'purpose', 'temporary legacy balance mirror bridge',
      'phase', '4.1'
    )
  );

  v_idempotency_key := gen_random_uuid()::text;

  v_entries := jsonb_build_array(
    jsonb_build_object(
      'accountId', v_mapping.ledger_account_id,
      'currency', v_currency,
      'amountDelta', v_delta,
      'description', 'Legacy balance mirror source delta',
      'metadata', jsonb_build_object(
        'mirrorRole', 'SOURCE',
        'sourceKind', v_source_kind,
        'sourceId', v_source_id,
        'operation', TG_OP,
        'legacyBefore', v_old_balance,
        'legacyAfter', v_new_balance
      )
    ),
    jsonb_build_object(
      'accountId', v_bridge_id,
      'currency', v_currency,
      'amountDelta', -v_delta,
      'description', 'Legacy balance mirror bridge delta',
      'metadata', jsonb_build_object(
        'mirrorRole', 'BRIDGE',
        'sourceKind', v_source_kind,
        'sourceId', v_source_id,
        'operation', TG_OP
      )
    )
  );

  v_post_result := public.post_ledger_journal_v2(
    'LEGACY_BALANCE_MIRROR',
    v_source_kind || ':' || v_source_id::text,
    v_idempotency_key,
    'Mirror legacy balance delta',
    jsonb_build_object(
      'sourceKind', v_source_kind,
      'sourceId', v_source_id,
      'currency', v_currency,
      'operation', TG_OP,
      'legacyBefore', v_old_balance,
      'legacyAfter', v_new_balance,
      'delta', v_delta,
      'txid', txid_current()::text
    ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_POST_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_ledger_balance
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_mapping.ledger_account_id;

  IF v_ledger_balance IS DISTINCT FROM v_new_balance THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_POST_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'sourceKind', v_source_kind,
              'sourceId', v_source_id,
              'legacyAfter', v_new_balance,
              'ledgerAfter', v_ledger_balance
            )::text;
  END IF;

  SELECT balance::numeric(38, 12)
  INTO v_bridge_balance
  FROM public.ledger_account_balances_v2
  WHERE account_id = v_bridge_id;

  IF v_bridge_balance IS NULL THEN
    RAISE EXCEPTION 'LEDGER_LEGACY_MIRROR_BRIDGE_BALANCE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_transfer_ledger_v2(
  p_sender_user_id uuid,
  p_receiver_phone text,
  p_currency text,
  p_amount numeric,
  p_description text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_receiver_phone text := btrim(COALESCE(p_receiver_phone, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_idempotency_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_request_fingerprint text;
  v_existing_journal_id uuid;
  v_existing_metadata jsonb;
  v_legacy_result jsonb;
  v_reference text;
  v_entries jsonb;
  v_post_result jsonb;
  v_journal_id uuid;
  v_bad_count integer;
  v_legacy_tx_count integer;
  v_delta_count integer;
  v_net_delta numeric(38, 12);
BEGIN
  IF p_sender_user_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_P2P_INVALID_SENDER'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_receiver_phone = '' THEN
    RAISE EXCEPTION 'LEDGER_P2P_INVALID_RECEIVER'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_currency !~ '^[A-Z0-9]{3,10}$' THEN
    RAISE EXCEPTION 'LEDGER_P2P_INVALID_CURRENCY'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'LEDGER_P2P_INVALID_AMOUNT'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_idempotency_key = '' OR length(v_idempotency_key) > 160 THEN
    RAISE EXCEPTION 'LEDGER_P2P_INVALID_IDEMPOTENCY_KEY'
      USING ERRCODE = 'P0001';
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_P2P_LEGACY_MIRROR_NOT_ENABLED'
      USING ERRCODE = 'P0001';
  END IF;

  v_request_fingerprint := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'senderUserId', p_sender_user_id,
          'receiverPhone', v_receiver_phone,
          'currency', v_currency,
          'amount', p_amount,
          'description', v_description
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Serialize equal idempotency keys before checking or moving money.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('wallet_transfer_ledger_v2:' || v_idempotency_key, 0)
  );

  SELECT id, metadata
  INTO v_existing_journal_id, v_existing_metadata
  FROM public.ledger_journals_v2
  WHERE source_type = 'P2P_TRANSFER_V2'
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_metadata->>'requestFingerprint'
       IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'LEDGER_P2P_IDEMPOTENCY_CONFLICT'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_existing_metadata->'legacyResult' IS NULL THEN
      RAISE EXCEPTION 'LEDGER_P2P_REPLAY_METADATA_MISSING'
        USING ERRCODE = 'P0001';
    END IF;

    RETURN COALESCE(v_existing_metadata->'legacyResult', '{}'::jsonb)
      || jsonb_build_object(
        'ok', true,
        'ledgerJournalId', v_existing_journal_id,
        'idempotentReplay', true
      );
  END IF;

  -- Native P2P must start from an exactly reconciled legacy/Ledger state.
  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_P2P_PRE_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  -- Suppress only the generic Phase 4.1 mirror while the proven legacy RPC
  -- performs its writes. This wrapper posts those exact deltas itself.
  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'on', true);

  v_legacy_result := public.wallet_transfer(
    p_sender_user_id,
    v_receiver_phone,
    v_currency,
    p_amount,
    v_description
  )::jsonb;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'off', true);

  v_reference := NULLIF(btrim(COALESCE(v_legacy_result->>'reference', '')), '');

  IF v_reference IS NULL THEN
    RAISE EXCEPTION 'LEDGER_P2P_LEGACY_REFERENCE_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  -- If the legacy RPC ever creates a new wallet, create its deterministic
  -- mapping now before deriving the native journal.
  PERFORM public.materialize_legacy_account_mappings_v2();

  SELECT count(*) INTO v_legacy_tx_count
  FROM public.transactions AS t
  WHERE t.reference = v_reference
    AND t.created_at >= transaction_timestamp();

  IF v_legacy_tx_count < 2 OR v_legacy_tx_count > 4 THEN
    RAISE EXCEPTION 'LEDGER_P2P_UNEXPECTED_LEGACY_TRANSACTION_COUNT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'reference', v_reference,
              'transactionCount', v_legacy_tx_count
            )::text;
  END IF;

  WITH wallet_deltas AS (
    SELECT
      t.wallet_id,
      sum(
        CASE t.type
          WHEN 'credit' THEN t.amount
          WHEN 'debit' THEN -t.amount
          ELSE 0
        END
      )::numeric(38, 12) AS delta
    FROM public.transactions AS t
    WHERE t.reference = v_reference
      AND t.created_at >= transaction_timestamp()
    GROUP BY t.wallet_id
  )
  SELECT count(*), COALESCE(sum(delta), 0)::numeric(38, 12)
  INTO v_delta_count, v_net_delta
  FROM wallet_deltas
  WHERE delta <> 0;

  IF v_delta_count < 2 OR v_delta_count > 3 THEN
    RAISE EXCEPTION 'LEDGER_P2P_UNEXPECTED_WALLET_DELTA_COUNT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'reference', v_reference,
              'walletDeltaCount', v_delta_count
            )::text;
  END IF;

  IF v_net_delta <> 0 THEN
    RAISE EXCEPTION 'LEDGER_P2P_LEGACY_DELTAS_NOT_BALANCED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'reference', v_reference,
              'netDelta', v_net_delta
            )::text;
  END IF;

  -- Before native posting, every mapped Ledger balance must still equal the
  -- legacy wallet balance immediately before this transfer.
  WITH wallet_deltas AS (
    SELECT
      t.wallet_id,
      sum(
        CASE t.type
          WHEN 'credit' THEN t.amount
          WHEN 'debit' THEN -t.amount
          ELSE 0
        END
      )::numeric(38, 12) AS delta
    FROM public.transactions AS t
    WHERE t.reference = v_reference
      AND t.created_at >= transaction_timestamp()
    GROUP BY t.wallet_id
  )
  SELECT count(*) INTO v_bad_count
  FROM wallet_deltas AS d
  JOIN public.wallets AS w
    ON w.id = d.wallet_id
  LEFT JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = 'USER_WALLET'
   AND m.source_id = d.wallet_id
  LEFT JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  WHERE d.delta <> 0
    AND (
      m.ledger_account_id IS NULL
      OR b.account_id IS NULL
      OR m.currency IS DISTINCT FROM upper(w.currency)
      OR b.balance IS DISTINCT FROM
         (w.balance::numeric(38, 12) - d.delta)
    );

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_P2P_PRE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  WITH transfer_rows AS (
    SELECT
      t.id,
      t.wallet_id,
      t.type,
      t.amount,
      t.description
    FROM public.transactions AS t
    WHERE t.reference = v_reference
      AND t.created_at >= transaction_timestamp()
  ),
  wallet_deltas AS (
    SELECT
      wallet_id,
      sum(
        CASE type
          WHEN 'credit' THEN amount
          WHEN 'debit' THEN -amount
          ELSE 0
        END
      )::numeric(38, 12) AS delta,
      jsonb_agg(id ORDER BY id) AS transaction_ids
    FROM transfer_rows
    GROUP BY wallet_id
  )
  SELECT jsonb_agg(
    jsonb_build_object(
      'accountId', m.ledger_account_id,
      'currency', upper(w.currency),
      'amountDelta', d.delta,
      'description', 'P2P transfer',
      'metadata', jsonb_build_object(
        'legacyWalletId', d.wallet_id,
        'legacyTransactionIds', d.transaction_ids,
        'legacyReference', v_reference
      )
    )
    ORDER BY m.account_key
  )
  INTO v_entries
  FROM wallet_deltas AS d
  JOIN public.wallets AS w
    ON w.id = d.wallet_id
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = 'USER_WALLET'
   AND m.source_id = d.wallet_id
  WHERE d.delta <> 0;

  IF v_entries IS NULL
     OR jsonb_array_length(v_entries) <> v_delta_count THEN
    RAISE EXCEPTION 'LEDGER_P2P_ENTRY_BUILD_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  v_post_result := public.post_ledger_journal_v2(
    'P2P_TRANSFER_V2',
    v_reference,
    v_idempotency_key,
    'P2P transfer ' || v_currency,
    jsonb_build_object(
      'requestFingerprint', v_request_fingerprint,
      'legacyResult', v_legacy_result,
      'legacyReference', v_reference,
      'legacyTransactionCount', v_legacy_tx_count,
      'currency', v_currency,
      'amount', p_amount,
      'mirrorBypass', true
    ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_P2P_POST_FAILED'
      USING ERRCODE = 'P0001';
  END IF;

  v_journal_id := NULLIF(v_post_result->>'journalId', '')::uuid;

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_P2P_JOURNAL_ID_MISSING'
      USING ERRCODE = 'P0001';
  END IF;

  -- Native posting must bring every affected Ledger balance back to exact live
  -- equality with the legacy wallet table.
  WITH wallet_deltas AS (
    SELECT
      t.wallet_id,
      sum(
        CASE t.type
          WHEN 'credit' THEN t.amount
          WHEN 'debit' THEN -t.amount
          ELSE 0
        END
      )::numeric(38, 12) AS delta
    FROM public.transactions AS t
    WHERE t.reference = v_reference
      AND t.created_at >= transaction_timestamp()
    GROUP BY t.wallet_id
  )
  SELECT count(*) INTO v_bad_count
  FROM wallet_deltas AS d
  JOIN public.wallets AS w
    ON w.id = d.wallet_id
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = 'USER_WALLET'
   AND m.source_id = d.wallet_id
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  WHERE d.delta <> 0
    AND b.balance IS DISTINCT FROM w.balance::numeric(38, 12);

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_P2P_POST_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_P2P_POST_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_unbalanced_journals
    WHERE journal_id = v_journal_id
  ) THEN
    RAISE EXCEPTION 'LEDGER_P2P_UNBALANCED_JOURNAL'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN v_legacy_result
    || jsonb_build_object(
      'ok', true,
      'ledgerJournalId', v_journal_id,
      'idempotentReplay', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_transfer_ledger_v2(
  uuid, text, text, numeric, text, text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text) TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.wallet_transfer_ledger_v2(
  uuid, text, text, numeric, text, text
) IS
  'Phase 4.2 service-role-only P2P primitive. Runs legacy wallet_transfer with the generic mirror locally bypassed, then posts the exact legacy transaction deltas as one native P2P_TRANSFER_V2 Ledger journal with idempotent replay.';

COMMIT;
