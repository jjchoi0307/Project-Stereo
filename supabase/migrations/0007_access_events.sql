-- Persistent admin audit trail — the production-grade upgrade of the stdout-only
-- access log (HIPAA Security Rule §164.312(b), Audit Controls). Every meaningful
-- action in either the recommender or the engagement view writes ONE row: who
-- (actor / broker), which org, the action, the target session, PHI-free metadata
-- (e.g. which plan was surfaced), outcome, and timestamp. Append-only.
create table if not exists public.access_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id),
  broker_id uuid, -- null for patient/system actors; drives own-row visibility
  actor text not null, -- broker id, 'patient', or 'system'
  action text not null,
  session_id text,
  metadata jsonb not null default '{}'::jsonb, -- PHI-FREE: ids + action context only
  outcome text not null default 'ok',
  created_at timestamptz not null default now()
);
create index if not exists access_events_org_created_idx on public.access_events (org_id, created_at desc);
create index if not exists access_events_broker_idx on public.access_events (broker_id, created_at desc);

alter table public.access_events enable row level security;

-- org_admin + security may read the whole org's trail; 'security' is read-only
-- monitoring. Lives in the `private` schema beside auth_org_id / auth_is_org_admin
-- (0003) so PostgREST never exposes it as an RPC endpoint.
create or replace function private.auth_can_read_org_audit() returns boolean
  language sql stable security definer set search_path = '' as $$
    select exists (
      select 1 from public.brokers
      where id = auth.uid() and role in ('org_admin', 'security')
    )
  $$;
revoke execute on function private.auth_can_read_org_audit() from public;
grant execute on function private.auth_can_read_org_audit() to authenticated;

-- A broker sees their OWN events; org_admin/security see the whole org.
create policy access_events_own_read on public.access_events
  for select using (broker_id = auth.uid());
create policy access_events_org_read on public.access_events
  for select using (private.auth_can_read_org_audit() and org_id = private.auth_org_id());
-- No insert/update/delete policy: events are written ONLY by the service-role
-- server path (which bypasses RLS) and are immutable/append-only to all clients.
