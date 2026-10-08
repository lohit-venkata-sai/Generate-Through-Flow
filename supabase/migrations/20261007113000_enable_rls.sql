-- Lock down server-only tables: enable RLS with no policies (deny all).
-- The backend uses the service_role key, which bypasses RLS, so nothing
-- changes at runtime. The public anon key can no longer touch these tables.
alter table public.profiles enable row level security;
alter table public.daily_usage enable row level security;
alter table public.billing_events enable row level security;
