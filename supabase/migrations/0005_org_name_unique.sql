-- Enforce one organization per agency name, case-insensitively, so first-signup
-- find-or-create (lib/supabase/auth.ts resolveOrgId) is race-safe: a concurrent
-- second insert for the same new agency loses on this unique violation, and the
-- caller re-selects the winning row. Existing rows ("gmail.com",
-- "Seoul Medical Group") are distinct when lowercased, so this won't conflict.
create unique index if not exists organizations_name_lower_key on public.organizations (lower(name));
