\pset pager off

\echo '=== PHASE 4.4 AGENT MONEY FLOW INVENTORY ==='
\echo 'READ-ONLY: captures exact live agent-operation schema, wallet_transfer contract, agent/user SSP wallet state, operation history, and Ledger health.'

\echo ''
\echo '=== CURRENT DATABASE / ROLE ==='
SELECT current_database() AS database_name,
       current_user AS database_role,
       clock_timestamp() AS captured_at;

\echo ''
\echo '=== REQUIRED OBJECTS ==='
SELECT
  to_regclass('public.agent_operations') AS agent_operations_table,
  to_regprocedure('public.wallet_transfer(uuid,text,text,numeric,text)') AS wallet_transfer_rpc,
  to_regprocedure('public.wallet_transfer_ledger_v2(uuid,text,text,numeric,text,text)') AS native_p2p_rpc;

\echo ''
\echo '=== WALLET TRANSFER SIGNATURE / PRIVILEGES ==='
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  pg_get_userbyid(p.proowner) AS owner,
  p.proacl AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('wallet_transfer','wallet_transfer_ledger_v2')
ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

\echo ''
\echo '=== LEGACY WALLET_TRANSFER DEFINITION ==='
SELECT pg_get_functiondef('public.wallet_transfer(uuid,text,text,numeric,text)'::regprocedure)
WHERE to_regprocedure('public.wallet_transfer(uuid,text,text,numeric,text)') IS NOT NULL;

\echo ''
\echo '=== AGENT_OPERATIONS COLUMNS ==='
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
  AND table_name = 'agent_operations'
ORDER BY ordinal_position;

\echo ''
\echo '=== AGENT_OPERATIONS CONSTRAINTS ==='
SELECT
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = to_regclass('public.agent_operations')
ORDER BY c.contype, c.conname;

\echo ''
\echo '=== AGENT_OPERATIONS INDEXES ==='
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'agent_operations'
ORDER BY indexname;

\echo ''
\echo '=== AGENT_OPERATIONS TRIGGERS ==='
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'agent_operations'
ORDER BY trigger_name, event_manipulation;

\echo ''
\echo '=== AGENT USER SUMMARY ==='
SELECT
  role,
  count(*) AS user_count,
  count(*) FILTER (WHERE is_active IS TRUE) AS active_users
FROM public.users
WHERE role IN ('agent','user')
GROUP BY role
ORDER BY role;

\echo ''
\echo '=== SSP WALLETS BY USER ROLE ==='
SELECT
  u.role,
  count(*) AS wallet_count,
  count(*) FILTER (WHERE w.balance <> 0) AS nonzero_wallets,
  COALESCE(sum(w.balance),0)::numeric(38,12) AS total_balance,
  min(w.balance)::numeric(38,12) AS min_balance,
  max(w.balance)::numeric(38,12) AS max_balance
FROM public.wallets w
JOIN public.users u ON u.id = w.user_id
WHERE w.currency = 'SSP'
  AND u.role IN ('agent','user')
GROUP BY u.role
ORDER BY u.role;

\echo ''
\echo '=== AGENT OPERATION SUMMARY ==='
SELECT
  type,
  currency,
  status,
  count(*) AS operation_count,
  COALESCE(sum(amount),0)::numeric(38,12) AS gross_amount,
  COALESCE(sum(fee),0)::numeric(38,12) AS total_recorded_fee
FROM public.agent_operations
GROUP BY type, currency, status
ORDER BY type, currency, status;

\echo ''
\echo '=== RECENT AGENT OPERATIONS (SAFE FIELDS) ==='
SELECT
  id,
  type,
  currency,
  amount,
  fee,
  status,
  created_at
FROM public.agent_operations
ORDER BY created_at DESC
LIMIT 20;

\echo ''
\echo '=== CURRENCY SETTINGS FOR SSP ==='
SELECT
  currency,
  fee_percent,
  flat_fee,
  min_transfer,
  max_transfer,
  is_enabled
FROM public.currency_settings
WHERE currency = 'SSP';

\echo ''
\echo '=== MIRROR / LEDGER HEALTH ==='
SELECT control_key, enabled, metadata
FROM public.ledger_v2_runtime_controls;

SELECT count(*) AS bad_live_reconciliation
FROM public.ledger_v2_legacy_live_reconciliation
WHERE reconciliation_status <> 'MATCHED'
   OR difference IS DISTINCT FROM 0::numeric;

SELECT count(*) AS unbalanced_journals
FROM public.ledger_v2_unbalanced_journals;

SELECT count(*) AS ledger_reconciliation_differences
FROM public.ledger_v2_balance_reconciliation
WHERE difference <> 0;

SELECT
  source_type,
  count(*) AS journal_count
FROM public.ledger_journals_v2
WHERE source_type IN (
  'P2P_TRANSFER_V2',
  'MERCHANT_PAYMENT_V2',
  'MERCHANT_PAYOUT_V2',
  'AGENT_CASH_IN_V2',
  'AGENT_CASH_OUT_V2',
  'LEGACY_BALANCE_MIRROR'
)
GROUP BY source_type
ORDER BY source_type;

\echo ''
\echo '=== MIRROR BRIDGE BALANCES ==='
SELECT
  a.currency,
  b.balance
FROM public.ledger_accounts_v2 a
JOIN public.ledger_account_balances_v2 b ON b.account_id = a.id
WHERE a.account_type = 'LEGACY_MIRROR_BRIDGE'
ORDER BY a.currency;

\echo ''
\echo '=== PHASE 4.4 AGENT MONEY FLOW INVENTORY COMPLETE ==='
