\pset pager off
\set ON_ERROR_STOP on

\echo '=== PHASE 4.3 MERCHANT MONEY RPC INVENTORY ==='
\echo 'READ-ONLY: captures exact live RPC contracts and merchant money schema before Ledger v2 wrappers.'

\echo ''
\echo '=== CURRENT DATABASE / ROLE ==='
SELECT current_database() AS database_name,
       current_user AS database_role,
       now() AS captured_at;

\echo ''
\echo '=== TARGET FUNCTION SIGNATURES ==='
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  r.rolname AS owner,
  p.proacl AS acl
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
JOIN pg_roles AS r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN ('confirm_merchant_payment', 'execute_merchant_payout')
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

\echo ''
\echo '=== TARGET FUNCTION DEFINITIONS ==='
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('confirm_merchant_payment', 'execute_merchant_payout')
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

\echo ''
\echo '=== APP-ROLE EXECUTE PRIVILEGES ==='
WITH funcs AS (
  SELECT p.oid,
         format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature,
         p.proname
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('confirm_merchant_payment', 'execute_merchant_payout')
)
SELECT
  funcs.proname AS function_name,
  funcs.signature,
  role_name,
  has_function_privilege(role_name, funcs.oid, 'EXECUTE') AS can_execute
FROM funcs
CROSS JOIN (VALUES ('anon'::text), ('authenticated'::text), ('service_role'::text)) AS roles(role_name)
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name)
ORDER BY funcs.proname, funcs.signature, role_name;

\echo ''
\echo '=== RELEVANT TABLE COLUMNS ==='
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'merchant_payments',
    'merchant_balances',
    'merchant_payouts',
    'transactions',
    'wallets',
    'merchants'
  )
ORDER BY table_name, ordinal_position;

\echo ''
\echo '=== RELEVANT CONSTRAINTS ==='
SELECT
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint AS c
WHERE c.connamespace = 'public'::regnamespace
  AND c.conrelid IN (
    'public.merchant_payments'::regclass,
    'public.merchant_balances'::regclass,
    'public.merchant_payouts'::regclass,
    'public.transactions'::regclass,
    'public.wallets'::regclass
  )
ORDER BY c.conrelid::regclass::text, c.conname;

\echo ''
\echo '=== RELEVANT INDEXES ==='
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'merchant_payments',
    'merchant_balances',
    'merchant_payouts',
    'transactions',
    'wallets'
  )
ORDER BY tablename, indexname;

\echo ''
\echo '=== MONEY-TABLE TRIGGERS ==='
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('wallets', 'merchant_balances')
ORDER BY event_object_table, trigger_name, event_manipulation;

\echo ''
\echo '=== LEDGER / MIRROR CONTROL STATE ==='
SELECT control_key, enabled, metadata
FROM public.ledger_v2_runtime_controls
ORDER BY control_key;

SELECT count(*) AS bad_live_reconciliation
FROM public.ledger_v2_legacy_live_reconciliation
WHERE reconciliation_status <> 'MATCHED'
   OR difference IS DISTINCT FROM 0::numeric;

SELECT count(*) AS unbalanced_journals
FROM public.ledger_v2_unbalanced_journals;

SELECT count(*) AS ledger_reconciliation_differences
FROM public.ledger_v2_balance_reconciliation
WHERE difference <> 0;

\echo ''
\echo '=== MERCHANT BALANCE SUMMARY ==='
SELECT
  upper(currency) AS currency,
  count(*) AS balance_rows,
  count(*) FILTER (WHERE balance <> 0) AS nonzero_rows,
  sum(balance)::numeric(38,12) AS total_balance,
  count(*) FILTER (WHERE balance < 0) AS negative_rows
FROM public.merchant_balances
GROUP BY upper(currency)
ORDER BY upper(currency);

\echo ''
\echo '=== MERCHANT PAYMENT SUMMARY ==='
SELECT
  upper(currency) AS currency,
  status,
  count(*) AS payment_count,
  sum(amount)::numeric(38,12) AS gross_amount
FROM public.merchant_payments
GROUP BY upper(currency), status
ORDER BY upper(currency), status;

\echo ''
\echo '=== MERCHANT PAYOUT SUMMARY ==='
SELECT
  upper(currency) AS currency,
  status,
  count(*) AS payout_count,
  sum(amount)::numeric(38,12) AS gross_amount
FROM public.merchant_payouts
GROUP BY upper(currency), status
ORDER BY upper(currency), status;

\echo ''
\echo '=== NATIVE LEDGER JOURNAL COUNTS ==='
SELECT source_type, count(*) AS journal_count
FROM public.ledger_journals_v2
WHERE source_type IN (
  'P2P_TRANSFER_V2',
  'MERCHANT_PAYMENT_V2',
  'MERCHANT_PAYOUT_V2',
  'LEGACY_BALANCE_MIRROR'
)
GROUP BY source_type
ORDER BY source_type;

\echo ''
\echo '=== PHASE 4.3 MERCHANT RPC INVENTORY COMPLETE ==='
