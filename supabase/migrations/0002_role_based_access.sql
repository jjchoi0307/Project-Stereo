-- SMG Broker Engagement Tool — role-based access across many agencies.
--
-- Builds on 0001's owner-only spine. Visibility model is now:
--   • cross-agency isolation: HARD WALL (a broker only ever touches their org)
--   • intra-agency: a broker sees their own clients; an org_admin sees the
--     whole agency's clients (read-only oversight). Writes stay owner-only.
--
-- Two trusted helpers derive the caller's identity from the brokers table with
-- DEFINER rights, so policies key off facts a broker CANNOT forge (closes the
-- self-asserted org_id hole) and never recurse into brokers' own RLS.

-- ── Trusted identity helpers ─────────────────────────────────────────────────
-- SECURITY DEFINER → runs as the function owner, bypassing RLS on brokers (no
-- recursion). STABLE → Postgres caches the result per-statement, so this stays
-- cheap even with hundreds of brokers evaluating it per row.
create or replace function auth_org_id() returns uuid
  language sql stable security definer set search_path = '' as $$
    select org_id from public.brokers where id = auth.uid()
  $$;

create or replace function auth_is_org_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
    select exists (
      select 1 from public.brokers
      where id = auth.uid() and role = 'org_admin'
    )
  $$;

-- ── organizations: enable RLS, members read their own org only ───────────────
alter table organizations enable row level security;

create policy org_member_read on organizations
  for select using (id = auth_org_id());
-- No write policy: org provisioning happens server-side via the service-role
-- key (same pattern as patient intake), which bypasses RLS.

-- ── Close the org_id spoofing hole on writes ─────────────────────────────────
-- Now that admins read by org_id, a forged org_id would breach the tenant wall.
-- Tighten every browser write so the row's org_id MUST equal the writer's real
-- org. (Patient intake still writes via service-role and is unaffected.)
alter policy session_owner on sessions
  with check (broker_id = auth.uid() and org_id = auth_org_id());

alter policy profile_owner on profiles
  with check (broker_id = auth.uid() and org_id = auth_org_id());

alter policy audit_insert on audit_records
  with check (broker_id = auth.uid() and org_id = auth_org_id());

-- ── org_admin read oversight (additive; owner policies still apply) ──────────
-- Permissive policies are OR'd: owners keep full access to their own rows via
-- 0001's *_owner policies; these add agency-wide READ for org_admins only.
create policy session_org_admin_read on sessions
  for select using (auth_is_org_admin() and org_id = auth_org_id());

create policy profile_org_admin_read on profiles
  for select using (auth_is_org_admin() and org_id = auth_org_id());

create policy audit_org_admin_read on audit_records
  for select using (auth_is_org_admin() and org_id = auth_org_id());

-- An admin also needs to see the brokers in their agency to attribute clients
-- (e.g. "show Jane's book"). Owners still read their own row via broker_self.
create policy broker_org_admin_read on brokers
  for select using (auth_is_org_admin() and org_id = auth_org_id());
