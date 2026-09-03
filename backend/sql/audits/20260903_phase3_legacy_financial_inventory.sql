\pset pager off
\echo '=== PHASE 3.2 LEGACY FINANCIAL INVENTORY ==='
\echo 'READ ONLY: this script starts a read-only transaction and ends with ROLLBACK.'

BEGIN READ ONLY;

\echo ''
\echo '=== DATABASE CONTEXT ==='
SELECT current_database() AS database_name, current_user AS database_user, now() AS captured_at;

\echo ''
\echo '=== LEGACY WALLET SCHEMA ==='
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'wallets'
ORDER BY ordinal_position;

\echo ''
\echo '=== LEGACY TRANSACTION SCHEMA ==='
SELECT
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'transactions'
ORDER BY ordinal_position;

\echo ''
\echo '=== WALLET BALANCE SUMMARY BY CURRENCY ==='
SELECT
  currency,
  count(*) AS wallet_count,
  count(*) FILTER (WHERE balance <> 0) AS nonzero_wallet_count,
  count(*) FILTER (WHERE balance < 0) AS negative_wallet_count,
  count(*) FILTER (WHERE balance IS NULL) AS null_balance_count,
  COALESCE(sum(balance), 0) AS total_balance,
  COALESCE(min(balance), 0) AS min_balance,
  COALESCE(max(balance), 0) AS max_balance
FROM public.wallets
GROUP BY currency
ORDER BY currency;

\echo ''
\echo '=== WALLET ID / OWNERSHIP INTEGRITY ==='
SELECT
  count(*) AS wallet_rows,
  count(DISTINCT id) AS distinct_wallet_ids,
  count(*) FILTER (WHERE user_id IS NULL) AS missing_user_id,
  count(*) FILTER (WHERE currency IS NULL OR btrim(currency) = '') AS missing_currency,
  count(*) - count(DISTINCT (user_id, currency)) AS duplicate_user_currency_rows
FROM public.wallets;

\echo ''
\echo '=== TRANSACTION SUMMARY BY TYPE ==='
SELECT
  COALESCE(type, '<NULL>') AS transaction_type,
  count(*) AS transaction_count,
  count(*) FILTER (WHERE amount < 0) AS negative_amount_count,
  count(*) FILTER (WHERE amount = 0) AS zero_amount_count,
  COALESCE(sum(amount), 0) AS summed_amount,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM public.transactions
GROUP BY type
ORDER BY transaction_type;

\echo ''
\echo '=== TRANSACTION / WALLET REFERENTIAL SHAPE ==='
SELECT
  count(*) AS transaction_rows,
  count(*) FILTER (WHERE wallet_id IS NULL) AS missing_wallet_id,
  count(*) FILTER (WHERE w.id IS NULL) AS orphan_wallet_reference,
  count(*) FILTER (WHERE t.reference IS NULL OR btrim(t.reference) = '') AS missing_reference
FROM public.transactions AS t
LEFT JOIN public.wallets AS w
  ON w.id = t.wallet_id;

\echo ''
\echo '=== MERCHANT BALANCE SUMMARY BY CURRENCY ==='
SELECT
  currency,
  count(*) AS merchant_balance_rows,
  count(*) FILTER (WHERE balance <> 0) AS nonzero_balance_rows,
  count(*) FILTER (WHERE balance < 0) AS negative_balance_rows,
  COALESCE(sum(balance), 0) AS total_balance,
  COALESCE(min(balance), 0) AS min_balance,
  COALESCE(max(balance), 0) AS max_balance
FROM public.merchant_balances
GROUP BY currency
ORDER BY currency;

\echo ''
\echo '=== MERCHANT BALANCE INTEGRITY ==='
SELECT
  count(*) AS rows,
  count(DISTINCT id) AS distinct_ids,
  count(*) FILTER (WHERE merchant_id IS NULL) AS missing_merchant_id,
  count(*) FILTER (WHERE currency IS NULL OR btrim(currency) = '') AS missing_currency,
  count(*) - count(DISTINCT (merchant_id, currency)) AS duplicate_merchant_currency_rows
FROM public.merchant_balances;

\echo ''
\echo '=== MERCHANT PAYMENT SUMMARY ==='
SELECT
  currency,
  status,
  count(*) AS payment_count,
  COALESCE(sum(amount), 0) AS total_amount,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM public.merchant_payments
GROUP BY currency, status
ORDER BY currency, status;

\echo ''
\echo '=== MERCHANT PAYOUT SUMMARY ==='
SELECT
  currency,
  status,
  count(*) AS payout_count,
  COALESCE(sum(amount), 0) AS total_amount,
  min(created_at) AS first_created_at,
  max(created_at) AS last_created_at
FROM public.merchant_payouts
GROUP BY currency, status
ORDER BY currency, status;

\echo ''
\echo '=== PUBLIC FINANCIAL-LIKE TABLE INVENTORY ==='
SELECT
  c.relname AS table_name,
  c.reltuples::bigint AS estimated_rows,
  c.relrowsecurity AS rls_enabled
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname ~* '(wallet|transaction|merchant|payment|payout|withdraw|deposit|service|agent|referral|crypto|sweep|treasury|fee|balance|settlement)'
ORDER BY c.relname;

\echo ''
\echo '=== BALANCE-BEARING BASE TABLES ==='
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name ~* '(^|_)(balance|available_balance|reserved_balance|ledger_balance)($|_)'
ORDER BY table_name, ordinal_position;

\echo ''
\echo '=== BALANCE / MONEY-LIKE COLUMNS ==='
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    column_name ~* '(^|_)(balance|amount|fee|total|gross|net|debit|credit|payout|reward|reserve|available|settled)($|_)'
    OR table_name ~* '(wallet|transaction|merchant|payment|payout|withdraw|deposit|service|agent|referral|crypto|sweep|treasury|settlement)'
  )
ORDER BY table_name, ordinal_position;

\echo ''
\echo '=== WALLET / TRANSACTION CONSTRAINTS ==='
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid IN (
    'public.wallets'::regclass,
    'public.transactions'::regclass,
    'public.merchant_balances'::regclass
  )
ORDER BY conrelid::regclass::text, conname;

\echo ''
\echo '=== WALLET / TRANSACTION / MERCHANT BALANCE INDEXES ==='
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('wallets', 'transactions', 'merchant_balances')
ORDER BY tablename, indexname;

\echo ''
\echo '=== FINANCIAL TRIGGERS ==='
SELECT
  c.relname AS table_name,
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid, true) AS trigger_definition
FROM pg_trigger AS t
JOIN pg_class AS c ON c.oid = t.tgrelid
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
  AND (
    c.relname ~* '(wallet|transaction|merchant|payment|payout|withdraw|deposit|service|agent|referral|crypto|sweep|treasury|settlement)'
    OR pg_get_triggerdef(t.oid, true) ~* '(wallet|transaction|merchant|payment|payout|withdraw|deposit|service|agent|referral|crypto|sweep|treasury|settlement)'
  )
ORDER BY c.relname, t.tgname;

\echo ''
\echo '=== FINANCIAL DATABASE FUNCTIONS / RPC DEFINITIONS ==='
WITH financial_functions AS MATERIALIZED (
  SELECT
    p.oid,
    p.proname,
    p.oid::regprocedure::text AS function_signature,
    l.lanname AS language,
    p.prosecdef AS security_definer,
    pg_get_functiondef(p.oid) AS function_definition
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_language AS l ON l.oid = p.prolang
  WHERE n.nspname = 'public'
    AND p.prokind IN ('f', 'p')
    AND l.lanname IN ('sql', 'plpgsql')
)
SELECT
  function_signature,
  language,
  security_definer,
  function_definition
FROM financial_functions
WHERE proname IN (
    'wallet_transfer',
    'confirm_merchant_payment',
    'execute_merchant_payout',
    'credit_usdt_trc20_deposit',
    'credit_usdt_bep20_deposit'
  )
  OR function_definition ~* '(wallets|transactions|merchant_balances|merchant_payments|merchant_payout|withdraw|deposit|service_request|agent_operations|referral)'
ORDER BY proname, function_signature;

\echo ''
\echo '=== RLS POLICIES ON FINANCIAL-LIKE TABLES ==='
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename ~* '(wallet|transaction|merchant|payment|payout|withdraw|deposit|service|agent|referral|crypto|sweep|treasury|settlement|ledger)'
ORDER BY tablename, policyname;

\echo ''
\echo '=== LEDGER V2 CURRENT STATE ==='
SELECT count(*) AS ledger_accounts FROM public.ledger_accounts_v2;
SELECT count(*) AS ledger_journals FROM public.ledger_journals_v2;
SELECT count(*) AS ledger_entries FROM public.ledger_entries_v2;
SELECT count(*) AS unbalanced_journals FROM public.ledger_v2_unbalanced_journals;
SELECT count(*) AS reconciliation_differences
FROM public.ledger_v2_balance_reconciliation
WHERE difference <> 0;

\echo ''
\echo '=== LEGACY WALLET -> LEDGER CANDIDATE COUNTS ==='
SELECT
  currency,
  count(*) AS legacy_wallets,
  count(*) FILTER (WHERE balance <> 0) AS wallets_requiring_opening_balance,
  COALESCE(sum(balance), 0) AS legacy_total_balance
FROM public.wallets
GROUP BY currency
ORDER BY currency;

\echo ''
\echo '=== MERCHANT BALANCE -> LEDGER CANDIDATE COUNTS ==='
SELECT
  currency,
  count(*) AS merchant_balances,
  count(*) FILTER (WHERE balance <> 0) AS balances_requiring_opening_balance,
  COALESCE(sum(balance), 0) AS legacy_total_balance
FROM public.merchant_balances
GROUP BY currency
ORDER BY currency;

\echo ''
\echo '=== PHASE 3.2 INVENTORY COMPLETE ==='
ROLLBACK;
