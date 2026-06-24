-- Persistent cache for the deterministic across-futures horizon recommendation.
-- The compute is heavy (nested simulations) and its result is a pure function of
-- the captured facts + engine/data version, so we store it keyed by that and serve
-- it instantly on later requests — critical on serverless, where the in-memory
-- cache doesn't survive cold starts / instance changes.
create table if not exists public.horizon_cache (
  key text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

-- Server-derived cache: written/read only by the service-role (server) path; the
-- route that reads it has already authorized the session via RLS. No policies →
-- anon/authenticated clients have no direct access.
alter table public.horizon_cache enable row level security;
