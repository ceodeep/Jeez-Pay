BEGIN;

-- Phase 4.4B
-- Atomic agent cash-in/cash-out primitives.
--
-- The existing wallet_transfer RPC remains the business-semantics authority
-- during this transition. These wrappers:
--   * validate the agent/customer roles,
--   * execute wallet_transfer with the Phase 4.1 generic mirror locally bypassed,
--   * derive the exact wallet deltas from the legacy transaction rows,
--   * post one native AGENT_CASH_IN_V2 / AGENT_CASH_OUT_V2 Ledger journal,
--   * insert the matching agent_operations row in the SAME PostgreSQL transaction,
--   * record the actual transfer fee returned by wallet_transfer rather than a
--     client-supplied fee value,
--   * provide idempotent replay without duplicate money movement or operations.

DO $$
BEGIN
  IF to_regprocedure('public.wallet_transfer(uuid,text,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_LEGACY_WALLET_TRANSFER_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.post_ledger_journal_v2(text,text,text,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_LEDGER_POSTING_PRIMITIVE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.materialize_legacy_account_mappings_v2()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_MAPPING_PRIMITIVE_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regprocedure('public.ledger_v2_legacy_balance_mirror_enabled()') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_MIRROR_CONTROL_MISSING' USING ERRCODE = 'P0001';
  END IF;

  IF to_regclass('public.agent_operations') IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_OPERATIONS_TABLE_MISSING' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.execute_agent_wallet_transfer_ledger_v2(
  p_source_type text,
  p_sender_user_id uuid,
  p_receiver_identifier text,
  p_currency text,
  p_amount numeric,
  p_description text,
  p_ledger_idempotency_key text,
  p_agent_operation_id uuid,
  p_operation_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  v_source_type text := upper(btrim(COALESCE(p_source_type, '')));
  v_receiver_identifier text := btrim(COALESCE(p_receiver_identifier, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
  v_idempotency_key text := btrim(COALESCE(p_ledger_idempotency_key, ''));
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
  v_actual_fee numeric(38, 12);
BEGIN
  IF v_source_type NOT IN ('AGENT_CASH_IN_V2', 'AGENT_CASH_OUT_V2') THEN
    RAISE EXCEPTION 'LEDGER_AGENT_INVALID_SOURCE_TYPE' USING ERRCODE = 'P0001';
  END IF;

  IF p_sender_user_id IS NULL OR p_agent_operation_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  IF v_receiver_identifier = '' THEN
    RAISE EXCEPTION 'LEDGER_AGENT_INVALID_RECEIVER' USING ERRCODE = 'P0001';
  END IF;

  IF v_currency !~ '^[A-Z0-9]{3,10}$' THEN
    RAISE EXCEPTION 'LEDGER_AGENT_INVALID_CURRENCY' USING ERRCODE = 'P0001';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_INVALID_AMOUNT' USING ERRCODE = 'P0001';
  END IF;

  IF v_idempotency_key = '' OR length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_INVALID_IDEMPOTENCY_KEY' USING ERRCODE = 'P0001';
  END IF;

  IF public.ledger_v2_legacy_balance_mirror_enabled() IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_AGENT_LEGACY_MIRROR_NOT_ENABLED' USING ERRCODE = 'P0001';
  END IF;

  v_request_fingerprint := encode(
    digest(
      convert_to(
        jsonb_build_object(
          'sourceType', v_source_type,
          'senderUserId', p_sender_user_id,
          'receiverIdentifier', v_receiver_identifier,
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

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_source_type || ':' || v_idempotency_key, 0)
  );

  SELECT id, metadata
  INTO v_existing_journal_id, v_existing_metadata
  FROM public.ledger_journals_v2
  WHERE source_type = v_source_type
    AND idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_metadata->>'requestFingerprint' IS DISTINCT FROM v_request_fingerprint THEN
      RAISE EXCEPTION 'LEDGER_AGENT_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P0001';
    END IF;

    IF v_existing_metadata->'legacyResult' IS NULL
       OR v_existing_metadata->>'agentOperationId' IS NULL THEN
      RAISE EXCEPTION 'LEDGER_AGENT_REPLAY_METADATA_MISSING' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_existing_metadata->'legacyResult'
      || jsonb_build_object(
        'ok', true,
        'ledgerJournalId', v_existing_journal_id,
        'agentOperationId', v_existing_metadata->>'agentOperationId',
        'idempotentReplay', true
      );
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_PRE_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'on', true);

  v_legacy_result := public.wallet_transfer(
    p_sender_user_id,
    v_receiver_identifier,
    v_currency,
    p_amount,
    v_description
  )::jsonb;

  PERFORM set_config('jeezpay.ledger_native_posting_v2', 'off', true);

  v_reference := NULLIF(btrim(COALESCE(v_legacy_result->>'reference', '')), '');
  v_actual_fee := COALESCE(NULLIF(v_legacy_result->>'fee', '')::numeric, 0)::numeric(38, 12);

  IF v_reference IS NULL OR v_actual_fee < 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_LEGACY_RESULT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.materialize_legacy_account_mappings_v2();

  SELECT count(*) INTO v_legacy_tx_count
  FROM public.transactions AS t
  WHERE t.reference = v_reference
    AND t.created_at >= transaction_timestamp();

  IF v_legacy_tx_count < 2 OR v_legacy_tx_count > 4 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_UNEXPECTED_LEGACY_TRANSACTION_COUNT'
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
    RAISE EXCEPTION 'LEDGER_AGENT_UNEXPECTED_WALLET_DELTA_COUNT'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'reference', v_reference,
              'walletDeltaCount', v_delta_count
            )::text;
  END IF;

  IF v_net_delta <> 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_LEGACY_DELTAS_NOT_BALANCED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object(
              'reference', v_reference,
              'netDelta', v_net_delta
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
  SELECT count(*) INTO v_bad_count
  FROM wallet_deltas AS d
  JOIN public.wallets AS w ON w.id = d.wallet_id
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
      OR b.balance IS DISTINCT FROM (w.balance::numeric(38, 12) - d.delta)
    );

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_PRE_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  WITH transfer_rows AS (
    SELECT t.id, t.wallet_id, t.type, t.amount
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
      'description', CASE
        WHEN v_source_type = 'AGENT_CASH_IN_V2' THEN 'Agent cash-in'
        ELSE 'Agent cash-out'
      END,
      'metadata', jsonb_build_object(
        'legacyWalletId', d.wallet_id,
        'legacyTransactionIds', d.transaction_ids,
        'legacyReference', v_reference,
        'agentOperationId', p_agent_operation_id
      )
    )
    ORDER BY m.account_key
  )
  INTO v_entries
  FROM wallet_deltas AS d
  JOIN public.wallets AS w ON w.id = d.wallet_id
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = 'USER_WALLET'
   AND m.source_id = d.wallet_id
  WHERE d.delta <> 0;

  IF v_entries IS NULL OR jsonb_array_length(v_entries) <> v_delta_count THEN
    RAISE EXCEPTION 'LEDGER_AGENT_ENTRY_BUILD_FAILED' USING ERRCODE = 'P0001';
  END IF;

  v_post_result := public.post_ledger_journal_v2(
    v_source_type,
    v_reference,
    v_idempotency_key,
    CASE
      WHEN v_source_type = 'AGENT_CASH_IN_V2' THEN 'Agent cash-in ' || v_currency
      ELSE 'Agent cash-out ' || v_currency
    END,
    COALESCE(p_operation_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'requestFingerprint', v_request_fingerprint,
        'legacyResult', v_legacy_result,
        'legacyReference', v_reference,
        'legacyTransactionCount', v_legacy_tx_count,
        'currency', v_currency,
        'amount', p_amount,
        'actualTransferFee', v_actual_fee,
        'agentOperationId', p_agent_operation_id,
        'mirrorBypass', true
      ),
    v_entries
  );

  IF COALESCE((v_post_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'LEDGER_AGENT_POST_FAILED' USING ERRCODE = 'P0001';
  END IF;

  v_journal_id := NULLIF(v_post_result->>'journalId', '')::uuid;

  IF v_journal_id IS NULL THEN
    RAISE EXCEPTION 'LEDGER_AGENT_JOURNAL_ID_MISSING' USING ERRCODE = 'P0001';
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
  SELECT count(*) INTO v_bad_count
  FROM wallet_deltas AS d
  JOIN public.wallets AS w ON w.id = d.wallet_id
  JOIN public.ledger_legacy_account_map_v2 AS m
    ON m.source_kind = 'USER_WALLET'
   AND m.source_id = d.wallet_id
  JOIN public.ledger_account_balances_v2 AS b
    ON b.account_id = m.ledger_account_id
  WHERE d.delta <> 0
    AND b.balance IS DISTINCT FROM w.balance::numeric(38, 12);

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_POST_BALANCE_MISMATCH'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  SELECT count(*) INTO v_bad_count
  FROM public.ledger_v2_legacy_live_reconciliation
  WHERE reconciliation_status <> 'MATCHED'
     OR difference IS DISTINCT FROM 0::numeric;

  IF v_bad_count <> 0 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_POST_RECONCILIATION_FAILED'
      USING ERRCODE = 'P0001',
            DETAIL = jsonb_build_object('badRows', v_bad_count)::text;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ledger_v2_unbalanced_journals
    WHERE journal_id = v_journal_id
  ) THEN
    RAISE EXCEPTION 'LEDGER_AGENT_UNBALANCED_JOURNAL' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_legacy_result
    || jsonb_build_object(
      'ok', true,
      'ledgerJournalId', v_journal_id,
      'agentOperationId', p_agent_operation_id,
      'idempotentReplay', false
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cash_in_ledger_v2(
  p_agent_user_id uuid,
  p_customer_identifier text,
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
  v_identifier text := btrim(COALESCE(p_customer_identifier, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_ledger_key text;
  v_agent public.users%ROWTYPE;
  v_customer public.users%ROWTYPE;
  v_operation_id uuid := gen_random_uuid();
  v_result jsonb;
  v_actual_fee numeric(38, 12);
  v_existing_operation public.agent_operations%ROWTYPE;
BEGIN
  IF p_agent_user_id IS NULL OR v_identifier = '' OR v_key = '' OR length(v_key) > 120 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_IN_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_agent
  FROM public.users
  WHERE id = p_agent_user_id;

  IF NOT FOUND OR v_agent.role <> 'agent' OR COALESCE(v_agent.is_system, false) IS TRUE
     OR COALESCE(v_agent.is_active, true) IS FALSE THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_IN_AGENT_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_customer
  FROM public.users
  WHERE COALESCE(is_system, false) = false
    AND COALESCE(is_active, true) = true
    AND role = 'user'
    AND (
      phone = v_identifier
      OR (
        v_identifier ~ '^[0-9]+$'
        AND wallet_account_number = v_identifier::bigint
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_IN_CUSTOMER_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_customer.id = v_agent.id THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_IN_SELF_TRANSFER' USING ERRCODE = 'P0001';
  END IF;

  v_ledger_key := p_agent_user_id::text || ':' || v_key;

  v_result := public.execute_agent_wallet_transfer_ledger_v2(
    'AGENT_CASH_IN_V2',
    p_agent_user_id,
    v_identifier,
    v_currency,
    p_amount,
    COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), 'Agent cash-in'),
    v_ledger_key,
    v_operation_id,
    jsonb_build_object(
      'operationType', 'cash_in',
      'agentUserId', v_agent.id,
      'customerUserId', v_customer.id
    )
  );

  IF COALESCE((v_result->>'idempotentReplay')::boolean, false) IS TRUE THEN
    SELECT * INTO v_existing_operation
    FROM public.agent_operations
    WHERE id = NULLIF(v_result->>'agentOperationId', '')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LEDGER_AGENT_CASH_IN_REPLAY_OPERATION_MISSING' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_result || jsonb_build_object(
      'agentOperation', to_jsonb(v_existing_operation),
      'customerUserId', v_customer.id
    );
  END IF;

  v_actual_fee := COALESCE(NULLIF(v_result->>'fee', '')::numeric, 0)::numeric(38, 12);

  INSERT INTO public.agent_operations(
    id, type, agent_user_id, customer_user_id,
    currency, amount, fee, description, status
  )
  VALUES (
    v_operation_id,
    'cash_in',
    v_agent.id,
    v_customer.id,
    v_currency,
    p_amount,
    v_actual_fee,
    COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), 'Cash-in'),
    'completed'
  );

  RETURN v_result || jsonb_build_object(
    'agentOperation', (
      SELECT to_jsonb(ao) FROM public.agent_operations ao WHERE ao.id = v_operation_id
    ),
    'customerUserId', v_customer.id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.agent_cash_out_ledger_v2(
  p_customer_user_id uuid,
  p_agent_identifier text,
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
  v_identifier text := btrim(COALESCE(p_agent_identifier, ''));
  v_currency text := upper(btrim(COALESCE(p_currency, '')));
  v_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_ledger_key text;
  v_customer public.users%ROWTYPE;
  v_agent public.users%ROWTYPE;
  v_operation_id uuid := gen_random_uuid();
  v_result jsonb;
  v_actual_fee numeric(38, 12);
  v_existing_operation public.agent_operations%ROWTYPE;
BEGIN
  IF p_customer_user_id IS NULL OR v_identifier = '' OR v_key = '' OR length(v_key) > 120 THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_OUT_INVALID_ARGUMENTS' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_customer
  FROM public.users
  WHERE id = p_customer_user_id;

  IF NOT FOUND OR v_customer.role <> 'user' OR COALESCE(v_customer.is_system, false) IS TRUE
     OR COALESCE(v_customer.is_active, true) IS FALSE THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_OUT_CUSTOMER_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_agent
  FROM public.users
  WHERE COALESCE(is_system, false) = false
    AND COALESCE(is_active, true) = true
    AND role = 'agent'
    AND (
      phone = v_identifier
      OR (
        v_identifier ~ '^[0-9]+$'
        AND wallet_account_number = v_identifier::bigint
      )
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_OUT_AGENT_NOT_ELIGIBLE' USING ERRCODE = 'P0001';
  END IF;

  IF v_agent.id = v_customer.id THEN
    RAISE EXCEPTION 'LEDGER_AGENT_CASH_OUT_SELF_TRANSFER' USING ERRCODE = 'P0001';
  END IF;

  v_ledger_key := p_customer_user_id::text || ':' || v_key;

  v_result := public.execute_agent_wallet_transfer_ledger_v2(
    'AGENT_CASH_OUT_V2',
    p_customer_user_id,
    v_identifier,
    v_currency,
    p_amount,
    COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), 'Agent cash-out'),
    v_ledger_key,
    v_operation_id,
    jsonb_build_object(
      'operationType', 'cash_out',
      'agentUserId', v_agent.id,
      'customerUserId', v_customer.id
    )
  );

  IF COALESCE((v_result->>'idempotentReplay')::boolean, false) IS TRUE THEN
    SELECT * INTO v_existing_operation
    FROM public.agent_operations
    WHERE id = NULLIF(v_result->>'agentOperationId', '')::uuid;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LEDGER_AGENT_CASH_OUT_REPLAY_OPERATION_MISSING' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_result || jsonb_build_object(
      'agentOperation', to_jsonb(v_existing_operation),
      'agentUserId', v_agent.id
    );
  END IF;

  v_actual_fee := COALESCE(NULLIF(v_result->>'fee', '')::numeric, 0)::numeric(38, 12);

  INSERT INTO public.agent_operations(
    id, type, agent_user_id, customer_user_id,
    currency, amount, fee, description, status
  )
  VALUES (
    v_operation_id,
    'cash_out',
    v_agent.id,
    v_customer.id,
    v_currency,
    p_amount,
    v_actual_fee,
    COALESCE(NULLIF(btrim(COALESCE(p_description, '')), ''), 'Cash-out'),
    'completed'
  );

  RETURN v_result || jsonb_build_object(
    'agentOperation', (
      SELECT to_jsonb(ao) FROM public.agent_operations ao WHERE ao.id = v_operation_id
    ),
    'agentUserId', v_agent.id
  );
END;
$$;

-- Internal helper is owner-only.
REVOKE ALL ON FUNCTION public.execute_agent_wallet_transfer_ledger_v2(
  text, uuid, text, text, numeric, text, text, uuid, jsonb
) FROM PUBLIC;

-- Public service-side primitives are not callable by client Supabase roles.
REVOKE ALL ON FUNCTION public.agent_cash_in_ledger_v2(
  uuid, text, text, numeric, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agent_cash_out_ledger_v2(
  uuid, text, text, numeric, text, text
) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_agent_wallet_transfer_ledger_v2(text,uuid,text,text,numeric,text,text,uuid,jsonb) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) FROM anon';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) FROM anon';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_agent_wallet_transfer_ledger_v2(text,uuid,text,text,numeric,text,text,uuid,jsonb) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) FROM authenticated';
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) FROM authenticated';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.execute_agent_wallet_transfer_ledger_v2(text,uuid,text,text,numeric,text,text,uuid,jsonb) FROM service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.agent_cash_in_ledger_v2(uuid,text,text,numeric,text,text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.agent_cash_out_ledger_v2(uuid,text,text,numeric,text,text) TO service_role';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agent_cash_in_ledger_v2(
  uuid, text, text, numeric, text, text
) IS 'Phase 4.4B service-role-only atomic agent cash-in primitive. Moves money through legacy wallet_transfer, posts AGENT_CASH_IN_V2 from exact transaction deltas, and writes agent_operations in the same transaction using the authoritative transfer fee.';

COMMENT ON FUNCTION public.agent_cash_out_ledger_v2(
  uuid, text, text, numeric, text, text
) IS 'Phase 4.4B service-role-only atomic agent cash-out primitive. Moves money through legacy wallet_transfer, posts AGENT_CASH_OUT_V2 from exact transaction deltas, and writes agent_operations in the same transaction using the authoritative transfer fee.';

COMMIT;
