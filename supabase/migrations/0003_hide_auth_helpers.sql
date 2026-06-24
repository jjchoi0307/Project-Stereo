-- Move the RLS helper functions out of the REST-exposed `public` schema.
--
-- In 0002 these lived in `public`, so PostgREST auto-published them as
-- /rest/v1/rpc/* endpoints callable by anon/authenticated. They leak nothing
-- (each only returns the CALLER's own org / admin flag), but policy helpers
-- have no business being part of the public API. PostgREST only exposes schemas
-- on its allow-list (default: just `public`), so a `private` schema is invisible
-- to REST while policies can still call it.

create schema if not exists private;

-- Re-create the helpers in `private` (definitions unchanged).
create or replace function private.auth_org_id() returns uuid
  language sql stable security definer set search_path = '' as $$
    select org_id from public.brokers where id = auth.uid()
  $$;

create or replace function private.auth_is_org_admin() returns boolean
  language sql stable security definer set search_path = '' as $$
    select exists (
      select 1 from public.brokers
      where id = auth.uid() and role = 'org_admin'
    )
  $$;

-- Least privilege: strip the default PUBLIC grant, let only logged-in users
-- (whose policy evaluations call these) reach them.
revoke execute on function private.auth_org_id()       from public;
revoke execute on function private.auth_is_org_admin() from public;
grant  usage   on schema   private to authenticated;
grant  execute on function private.auth_org_id()       to authenticated;
grant  execute on function private.auth_is_org_admin() to authenticated;

-- Re-point every policy at the private helpers.
alter policy org_member_read on organizations
  using (id = private.auth_org_id());

alter policy session_owner on sessions
  with check (broker_id = auth.uid() and org_id = private.auth_org_id());
alter policy profile_owner on profiles
  with check (broker_id = auth.uid() and org_id = private.auth_org_id());
alter policy audit_insert on audit_records
  with check (broker_id = auth.uid() and org_id = private.auth_org_id());

alter policy session_org_admin_read on sessions
  using (private.auth_is_org_admin() and org_id = private.auth_org_id());
alter policy profile_org_admin_read on profiles
  using (private.auth_is_org_admin() and org_id = private.auth_org_id());
alter policy audit_org_admin_read on audit_records
  using (private.auth_is_org_admin() and org_id = private.auth_org_id());
alter policy broker_org_admin_read on brokers
  using (private.auth_is_org_admin() and org_id = private.auth_org_id());

-- Drop the now-unreferenced public copies.
drop function if exists public.auth_org_id();
drop function if exists public.auth_is_org_admin();
