-- Org-scoped application settings — e.g. the input-importance weights the AI
-- health-future projection consumes (admin-configurable, replacing the hardcoded
-- INPUT_IMPORTANCE default). One row per (org, key); value is JSON.
create table if not exists public.app_settings (
  org_id uuid not null references public.organizations (id),
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, key)
);

alter table public.app_settings enable row level security;

-- Org members may READ their org's settings (the projection also reads them
-- server-side via the service-role path). Writes happen ONLY through the admin
-- server action (service-role, after a role check) — no client write policy.
create policy app_settings_org_read on public.app_settings
  for select using (org_id = private.auth_org_id());
