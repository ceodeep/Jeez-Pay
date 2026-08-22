-- JeezPay Issue #5
-- Secure merchant <-> JeezPay account authorization.
--
-- Important:
-- - merchant_id/provider_user_id are stored as text intentionally so this
--   migration does not assume the PK type used by existing JeezPay tables.
-- - raw authorization state is NEVER stored; only its SHA-256 hash is stored.
-- - direct anon/authenticated Supabase access is denied.

create extension if not exists pgcrypto;

create table if not exists public.merchant_account_links (
    id uuid primary key default gen_random_uuid(),

    merchant_id text not null,
    client_reference text not null,

    subject_hint text,

    state_hash text not null
        check (state_hash ~ '^[0-9a-f]{64}$'),

    status text not null default 'pending'
        check (
            status in (
                'pending',
                'approved',
                'cancelled',
                'consumed',
                'expired'
            )
        ),

    provider_user_id text,
    wallet_account_number text,
    full_name text,

    expires_at timestamptz not null,

    approved_at timestamptz,
    cancelled_at timestamptz,
    consumed_at timestamptz,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    unique (merchant_id, client_reference)
);

create index if not exists idx_merchant_account_links_merchant_status
    on public.merchant_account_links (merchant_id, status);

create index if not exists idx_merchant_account_links_expires
    on public.merchant_account_links (expires_at);

alter table public.merchant_account_links enable row level security;

revoke all
    on table public.merchant_account_links
    from anon, authenticated;

grant select, insert, update, delete
    on table public.merchant_account_links
    to service_role;
