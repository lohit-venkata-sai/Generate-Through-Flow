-- FlowPilot Supabase schema. Run in Supabase SQL editor.
-- Tables: profiles (one row per Google sub), daily_usage (one row per sub+date).

create table if not exists public.profiles (
  sub text primary key,
  email text not null default '',
  name text not null default '',
  picture text not null default '',
  base_plan text not null default 'free',
  pass_id text null,
  pass_started_at bigint null,
  pass_expires_at bigint null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_usage (
  sub text not null references public.profiles (sub) on delete cascade,
  date text not null,
  used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sub, date)
);

-- Service-role key bypasses RLS; no policies needed for server-only access.
-- If you later read these tables from the extension with the anon key,
-- enable RLS and add per-user policies.
