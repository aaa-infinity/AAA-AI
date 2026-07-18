-- AAA-AI Supabase mirror schema.
-- D1 (Cloudflare) stays authoritative; these tables are a browsable/queryable
-- mirror kept in sync by the Worker's supabaseUpsert(). Safe to re-run.
--
-- Run in: Supabase Dashboard -> SQL Editor -> New query -> Run.

-- ---- users (points + premium mirror) ----
create table if not exists public.users (
  uid            text primary key,
  points         integer not null default 100,
  premium_until  bigint  not null default 0,
  email          text,
  display_name   text,
  lifetime_earned integer not null default 0,
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- ---- promo codes (mirror of AI-generated codes) ----
create table if not exists public.promo_codes (
  code            text primary key,
  premium_days    integer not null default 7,
  max_redemptions integer not null default 30,
  redeemed        integer not null default 0,
  expires_at      bigint  not null default 0,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---- promo redemptions (one row per user+code) ----
create table if not exists public.promo_redemptions (
  code text not null,
  uid  text not null,
  ts   bigint not null,
  primary key (code, uid)
);

-- ---- youtube subscription verification ----
create table if not exists public.yt_subs (
  uid        text primary key,
  subscribed boolean not null default false,
  checked_at bigint  not null
);

-- ---- transactions (points audit trail, optional mirror) ----
create table if not exists public.transactions (
  id     bigserial primary key,
  uid    text not null,
  type   text not null,
  amount integer not null,
  reason text,
  ts     bigint not null
);

create index if not exists idx_users_premium on public.users(premium_until);
create index if not exists idx_promo_redeem_uid on public.promo_redemptions(uid);
create index if not exists idx_tx_uid on public.transactions(uid);

-- Keep updated_at fresh on upsert.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_users_touch on public.users;
create trigger trg_users_touch before update on public.users
  for each row execute function public.touch_updated_at();

-- ---- Row Level Security ----
-- The Worker uses the service_role key (bypasses RLS). Enable RLS so anon/public
-- keys cannot read/write these mirror tables directly.
alter table public.users             enable row level security;
alter table public.promo_codes       enable row level security;
alter table public.promo_redemptions enable row level security;
alter table public.yt_subs           enable row level security;
alter table public.transactions      enable row level security;

-- ---- Provisioning RPC ----
-- Lets the Worker (re)create the mirror schema on demand via a single REST call:
--   POST /rest/v1/rpc/aaa_provision_mirror  (service_role key)
-- Safe to re-run; all statements use IF NOT EXISTS.
create or replace function public.aaa_provision_mirror()
returns void language plpgsql as $$
begin
  create table if not exists public.users (
    uid            text primary key,
    points         integer not null default 100,
    premium_until  bigint  not null default 0,
    email          text,
    display_name   text,
    lifetime_earned integer not null default 0,
    updated_at     timestamptz not null default now(),
    created_at     timestamptz not null default now()
  );
  create table if not exists public.promo_codes (
    code            text primary key,
    premium_days    integer not null default 7,
    max_redemptions integer not null default 30,
    redeemed        integer not null default 0,
    expires_at      bigint  not null default 0,
    active          boolean not null default true,
    created_at      timestamptz not null default now()
  );
  create table if not exists public.promo_redemptions (
    code text not null,
    uid  text not null,
    ts   bigint not null,
    primary key (code, uid)
  );
  create table if not exists public.yt_subs (
    uid        text primary key,
    subscribed boolean not null default false,
    checked_at bigint  not null
  );
  create table if not exists public.transactions (
    id     bigserial primary key,
    uid    text not null,
    type   text not null,
    amount integer not null,
    reason text,
    ts     bigint not null
  );
  create index if not exists idx_users_premium on public.users(premium_until);
  create index if not exists idx_promo_redeem_uid on public.promo_redemptions(uid);
  create index if not exists idx_tx_uid on public.transactions(uid);
end; $$;
