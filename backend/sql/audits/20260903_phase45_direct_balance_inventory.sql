\pset pager off
\echo '=== PHASE 4.5 DIRECT BALANCE WRITER INVENTORY ==='
\echo 'READ-ONLY: captures schemas, DB-side wallet writers, swap/service/referral/admin-related state, and Ledger health.'

\echo ''
\echo '=== CURRENT DATABASE / ROLE ==='
SELECT current_database() AS database_name,
       current_user AS database_role,
       clock_timestamp() AS captured_at;

\echo ''
\echo '=== CORE TABLE PRESENCE ==='
SELECT
  to_regclass('public.wallets') AS wallets,
  to_regclass('public.transactions') AS transactions,
  to_regclass('public.exchange_rates') AS exchange_rates,
  to_regclass('public.service_requests') AS service_requests,
  to_regclass('public.users') AS users;

\echo ''
\echo '=== RELEVANT TABLE COLUMNS ==='
SELECT table_name,
       ordinal_position,
       column_name,
       data_type,
       udt_name,
       is_nullable,
       column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'wallets',
    'transactions',
    'exchange_rates',
    'service_requests',
    'users'
  )
ORDER BY table_name, ordinal_position;

\echo ''
\echo '=== REFERRAL / BONUS RELATED TABLES ==='
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND (
    table_name ILIKE '%referr%'
    OR table_name ILIKE '%bonus%'
    OR table_name ILIKE '%reward%'
  )
ORDER BY table_name;

\echo ''
\echo '=== RELEVANT CONSTRAINTS ==='
SELECT c.relname AS table_name,
       con.conname AS constraint_name,
       con.contype AS constraint_type,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'wallets',
    'transactions',
    'exchange_rates',
    'service_requests',
    'users'
  )
ORDER BY c.relname, con.conname;

\echo ''
\echo '=== RELEVANT INDEXES ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'wallets',
    'transactions',
    'exchange_rates',
    'service_requests',
    'users'
  )
ORDER BY tablename, indexname;

\echo ''
\echo '=== WALLET / TRANSACTION TRIGGERS ==='
SELECT event_object_table AS table_name,
       trigger_name,
       event_manipulation,
       action_timing,
       action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('wallets', 'transactions')
ORDER BY event_object_table, trigger_name, event_manipulation;

\echo ''
\echo '=== DB FUNCTIONS THAT REFERENCE WALLETS / BALANCE ==='
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       r.rolname AS owner,
       p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles r ON r.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    pg_get_functiondef(p.oid) ILIKE '%wallets%'
    OR pg_get_functiondef(p.oid) ILIKE '%balance%'
  )
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

\echo ''
\echo '=== DB FUNCTION DEFINITIONS THAT WRITE WALLETS ==='
SELECT p.oid::regprocedure AS function_signature,
       pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND (
    pg_get_functiondef(p.oid) ILIKE '%update public.wallets%'
    OR pg_get_functiondef(p.oid) ILIKE '%insert into public.wallets%'
    OR pg_get_functiondef(p.oid) ILIKE '%update wallets%'
    OR pg_get_functiondef(p.oid) ILIKE '%insert into wallets%'
  )
ORDER BY p.oid::regprocedure::text;

\echo ''
\echo '=== EXCHANGE RATE STATE ==='
SELECT *
FROM public.exchange_rates
ORDER BY 1
LIMIT 100;

\echo ''
\echo '=== SERVICE REQUEST SUMMARY ==='
SELECT status,
       currency,
       count(*) AS request_count,
       COALESCE(sum(amount), 0) AS gross_amount
FROM public.service_requests
GROUP BY status, currency
ORDER BY status, currency;

\echo ''
\echo '=== RECENT SERVICE REQUESTS (SAFE FIELDS) ==='
SELECT id, currency, amount, status, created_at
FROM public.service_requests
ORDER BY created_at DESC
LIMIT 25;

\echo ''
\echo '=== TRANSACTION DESCRIPTION / TYPE SUMMARY FOR DIRECT-WRITER CLUES ==='
SELECT type,
       CASE
         WHEN description ILIKE '%swap%' THEN 'SWAP'
         WHEN description ILIKE '%service%' THEN 'SERVICE'
         WHEN description ILIKE '%referr%' THEN 'REFERRAL'
         WHEN description ILIKE '%bonus%' THEN 'BONUS'
         WHEN description ILIKE '%admin%' THEN 'ADMIN'
         ELSE 'OTHER'
       END AS category,
       count(*) AS transaction_count,
       COALESCE(sum(amount), 0) AS total_amount
FROM public.transactions
WHERE description ILIKE ANY (ARRAY[
  '%swap%', '%service%', '%referr%', '%bonus%', '%admin%'
])
GROUP BY type, category
ORDER BY category, type;

\echo ''
\echo '=== RECENT DIRECT-WRITER-LIKE TRANSACTIONS (NO USER PII) ==='
SELECT id, wallet_id, type, amount, description, reference, created_at
FROM public.transactions
WHERE description ILIKE ANY (ARRAY[
  '%swap%', '%service%', '%referr%', '%bonus%', '%admin%'
])
ORDER BY created_at DESC
LIMIT 50;

\echo ''
\echo '=== WALLET TOTALS ==='
SELECT upper(currency) AS currency,
       count(*) AS wallet_count,
       count(*) FILTER (WHERE balance <> 0) AS nonzero_wallets,
       COALESCE(sum(balance), 0)::numeric(38,12) AS total_balance
FROM public.wallets
GROUP BY upper(currency)
ORDER BY upper(currency);

\echo ''
\echo '=== LEDGER / MIRROR HEALTH ==='
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
\echo '=== NATIVE / MIRROR JOURNAL COUNTS ==='
SELECT source_type, count(*) AS journal_count
FROM public.ledger_journals_v2
WHERE source_type IN (
  'P2P_TRANSFER_V2',
  'MERCHANT_PAYMENT_V2',
  'MERCHANT_PAYOUT_V2',
  'AGENT_CASH_IN_V2',
  'AGENT_CASH_OUT_V2',
  'SWAP_V2',
  'SERVICE_PAYMENT_V2',
  'AUTH_CREDIT_V2',
  'ADMIN_BALANCE_ADJUSTMENT_V2',
  'LEGACY_BALANCE_MIRROR'
)
GROUP BY source_type
ORDER BY source_type;

\echo ''
\echo '=== MIRROR BRIDGE BALANCES ==='
SELECT a.currency,
       b.balance
FROM public.ledger_accounts_v2 a
JOIN public.ledger_account_balances_v2 b
  ON b.account_id = a.id
WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE'
ORDER BY a.currency;

\echo ''
\echo '=== PHASE 4.5 DIRECT BALANCE WRITER INVENTORY COMPLETE ==='
