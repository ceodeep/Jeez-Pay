\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_suffix text := txid_current()::text;
  v_source uuid;
  v_alice uuid;
  v_bob uuid;
  v_result jsonb;
  v_error text;
  v_alice_balance numeric(38, 12);
  v_bob_balance numeric(38, 12);
  v_source_balance numeric(38, 12);
  v_unbalanced_count bigint;
  v_reconciliation_count bigint;
BEGIN
  v_source := public.ensure_ledger_account_v2(
    'phase3-test:source:' || v_suffix,
    'MIGRATION_CLEARING',
    'SYSTEM',
    'phase3-test',
    'SSP',
    true,
    jsonb_build_object('test', true)
  );

  v_alice := public.ensure_ledger_account_v2(
    'phase3-test:alice:' || v_suffix,
    'WALLET',
    'USER',
    'alice-test',
    'SSP',
    false,
    jsonb_build_object('test', true)
  );

  v_bob := public.ensure_ledger_account_v2(
    'phase3-test:bob:' || v_suffix,
    'WALLET',
    'USER',
    'bob-test',
    'SSP',
    false,
    jsonb_build_object('test', true)
  );

  -- Account creation must be idempotent for the same exact identity.
  IF public.ensure_ledger_account_v2(
    'phase3-test:alice:' || v_suffix,
    'WALLET',
    'USER',
    'alice-test',
    'SSP',
    false,
    jsonb_build_object('ignoredOnReplay', true)
  ) <> v_alice THEN
    RAISE EXCEPTION 'TEST_FAILED_ACCOUNT_IDEMPOTENCY';
  END IF;

  v_result := public.post_ledger_journal_v2(
    'TEST_SEED',
    'seed-' || v_suffix,
    'seed-' || v_suffix,
    'Seed Alice test balance',
    jsonb_build_object('test', true),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', v_source,
        'currency', 'SSP',
        'amountDelta', '-100.000000000000'
      ),
      jsonb_build_object(
        'accountId', v_alice,
        'currency', 'SSP',
        'amountDelta', '100.000000000000'
      )
    )
  );

  IF COALESCE((v_result->>'idempotentReplay')::boolean, true) IS TRUE THEN
    RAISE EXCEPTION 'TEST_FAILED_FIRST_POST_REPLAY_FLAG';
  END IF;

  -- Exact retry must return the original journal rather than post again.
  v_result := public.post_ledger_journal_v2(
    'TEST_SEED',
    'seed-' || v_suffix,
    'seed-' || v_suffix,
    'Seed Alice test balance',
    jsonb_build_object('test', true),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', v_source,
        'currency', 'SSP',
        'amountDelta', '-100.000000000000'
      ),
      jsonb_build_object(
        'accountId', v_alice,
        'currency', 'SSP',
        'amountDelta', '100.000000000000'
      )
    )
  );

  IF COALESCE((v_result->>'idempotentReplay')::boolean, false) IS FALSE THEN
    RAISE EXCEPTION 'TEST_FAILED_IDEMPOTENT_REPLAY';
  END IF;

  -- Same idempotency key with a different payload must be rejected.
  v_error := NULL;
  BEGIN
    PERFORM public.post_ledger_journal_v2(
      'TEST_SEED',
      'seed-' || v_suffix,
      'seed-' || v_suffix,
      'Different payload',
      jsonb_build_object('test', true),
      jsonb_build_array(
        jsonb_build_object(
          'accountId', v_source,
          'currency', 'SSP',
          'amountDelta', '-90'
        ),
        jsonb_build_object(
          'accountId', v_alice,
          'currency', 'SSP',
          'amountDelta', '90'
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error <> 'LEDGER_IDEMPOTENCY_CONFLICT' THEN
    RAISE EXCEPTION 'TEST_FAILED_IDEMPOTENCY_CONFLICT: %', COALESCE(v_error, 'no error');
  END IF;

  -- Normal transfer preserves value and updates both snapshots atomically.
  PERFORM public.post_ledger_journal_v2(
    'TEST_TRANSFER',
    'transfer-' || v_suffix,
    'transfer-' || v_suffix,
    'Alice to Bob',
    jsonb_build_object('test', true),
    jsonb_build_array(
      jsonb_build_object(
        'accountId', v_alice,
        'currency', 'SSP',
        'amountDelta', '-30'
      ),
      jsonb_build_object(
        'accountId', v_bob,
        'currency', 'SSP',
        'amountDelta', '30'
      )
    )
  );

  SELECT balance INTO v_source_balance
  FROM public.ledger_account_balances_v2 WHERE account_id = v_source;

  SELECT balance INTO v_alice_balance
  FROM public.ledger_account_balances_v2 WHERE account_id = v_alice;

  SELECT balance INTO v_bob_balance
  FROM public.ledger_account_balances_v2 WHERE account_id = v_bob;

  IF v_source_balance <> -100 OR v_alice_balance <> 70 OR v_bob_balance <> 30 THEN
    RAISE EXCEPTION 'TEST_FAILED_BALANCES source=% alice=% bob=%',
      v_source_balance, v_alice_balance, v_bob_balance;
  END IF;

  -- An unbalanced journal must never reach the journal/entry tables.
  v_error := NULL;
  BEGIN
    PERFORM public.post_ledger_journal_v2(
      'TEST_BAD_BALANCE',
      NULL,
      'unbalanced-' || v_suffix,
      'Must fail',
      '{}'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'accountId', v_alice,
          'currency', 'SSP',
          'amountDelta', '-10'
        ),
        jsonb_build_object(
          'accountId', v_bob,
          'currency', 'SSP',
          'amountDelta', '9'
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error <> 'LEDGER_JOURNAL_NOT_BALANCED' THEN
    RAISE EXCEPTION 'TEST_FAILED_UNBALANCED_GUARD: %', COALESCE(v_error, 'no error');
  END IF;

  -- Non-negative wallet accounts must reject overdrafts.
  v_error := NULL;
  BEGIN
    PERFORM public.post_ledger_journal_v2(
      'TEST_OVERDRAFT',
      NULL,
      'overdraft-' || v_suffix,
      'Must fail',
      '{}'::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'accountId', v_alice,
          'currency', 'SSP',
          'amountDelta', '-1000'
        ),
        jsonb_build_object(
          'accountId', v_bob,
          'currency', 'SSP',
          'amountDelta', '1000'
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error <> 'LEDGER_INSUFFICIENT_BALANCE' THEN
    RAISE EXCEPTION 'TEST_FAILED_OVERDRAFT_GUARD: %', COALESCE(v_error, 'no error');
  END IF;

  -- Snapshot balances cannot be changed directly outside the posting primitive.
  v_error := NULL;
  BEGIN
    UPDATE public.ledger_account_balances_v2
    SET balance = balance + 1
    WHERE account_id = v_alice;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error <> 'LEDGER_BALANCE_DIRECT_MUTATION_FORBIDDEN' THEN
    RAISE EXCEPTION 'TEST_FAILED_DIRECT_BALANCE_GUARD: %', COALESCE(v_error, 'no error');
  END IF;

  -- Posted journal headers and entries are immutable.
  v_error := NULL;
  BEGIN
    UPDATE public.ledger_journals_v2
    SET description = 'tampered'
    WHERE source_type = 'TEST_TRANSFER'
      AND idempotency_key = 'transfer-' || v_suffix;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error <> 'LEDGER_V2_IMMUTABLE_RECORD' THEN
    RAISE EXCEPTION 'TEST_FAILED_JOURNAL_IMMUTABILITY: %', COALESCE(v_error, 'no error');
  END IF;

  v_error := NULL;
  BEGIN
    UPDATE public.ledger_entries_v2
    SET amount_delta = amount_delta + 1
    WHERE journal_id = (
      SELECT id
      FROM public.ledger_journals_v2
      WHERE source_type = 'TEST_TRANSFER'
        AND idempotency_key = 'transfer-' || v_suffix
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;

  IF v_error <> 'LEDGER_V2_IMMUTABLE_RECORD' THEN
    RAISE EXCEPTION 'TEST_FAILED_ENTRY_IMMUTABILITY: %', COALESCE(v_error, 'no error');
  END IF;

  SELECT count(*) INTO v_unbalanced_count
  FROM public.ledger_v2_unbalanced_journals;

  IF v_unbalanced_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED_UNBALANCED_VIEW: %', v_unbalanced_count;
  END IF;

  SELECT count(*) INTO v_reconciliation_count
  FROM public.ledger_v2_balance_reconciliation
  WHERE difference <> 0;

  IF v_reconciliation_count <> 0 THEN
    RAISE EXCEPTION 'TEST_FAILED_RECONCILIATION_VIEW: %', v_reconciliation_count;
  END IF;

  RAISE NOTICE 'LEDGER V2 FOUNDATION TESTS: OK';
END;
$$;

ROLLBACK;
