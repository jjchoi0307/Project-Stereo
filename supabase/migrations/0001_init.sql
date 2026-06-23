-- SMG Broker Engagement Tool — persistence + auth spine (PHI side only).
--
-- Reference data (plans/networks/formularies/drugs/regions) is intentionally NOT
-- here: it stays bundled + git-versioned (lib/data/source/plans-2026.json) so
-- audits reproduce against an immutable dataset (pinned via audit_records.data_version).
-- Only sessions, client profiles (PHI), and audit records live in Postgres.
--
-- Visibility model: BROKER-OWNS-THEIR-CLIENTS (owner-only RLS).
-- Audit records are APPEND-ONLY (no UPDATE/DELETE policies are granted).

-- ── Tenancy ──────────────────────────────────────────────────────────────────
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Brokers mirror Supabase Auth users: brokers.id == auth.uid()
create table if not exists brokers (
  id            uuid primary key references auth.users(id) on delete cascade,
  org_id        uuid not null references organizations(id),
  email         text not null,
  display_name  text,
  role          text not null default 'broker',   -- 'broker' | 'org_admin'
  created_at    timestamptz not null default now()
);

-- ── A broker's working session for one prospective client ────────────────────
create table if not exists sessions (
  id                       uuid primary key default gen_random_uuid(),
  broker_id                uuid not null references brokers(id),
  org_id                   uuid not null references organizations(id),  -- denormalized for RLS
  client_label             text,
  status                   text not null default 'awaiting_intake',     -- 'awaiting_intake' | 'intake_complete'
  intake_token             text unique,            -- capability for patient self-entry
  intake_token_expires_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists sessions_broker_idx on sessions (broker_id, created_at desc);

-- ── The captured client facts (PHI). One per session, structured as jsonb ────
create table if not exists profiles (
  session_id     uuid primary key references sessions(id) on delete cascade,
  broker_id      uuid not null,        -- denormalized for RLS
  org_id         uuid not null,        -- denormalized for RLS
  facts_version  int  not null default 1,
  captured_by    text not null,        -- 'broker' | 'patient'
  data           jsonb not null,       -- ClientProfileInput, verbatim
  updated_at     timestamptz not null default now()
);

-- ── Immutable, reproducible audit record per delivered recommendation ────────
create table if not exists audit_records (
  id             text primary key,     -- auditIdFor(profile) — stable per facts-version
  session_id     uuid not null references sessions(id),
  broker_id      uuid not null,        -- denormalized for RLS
  org_id         uuid not null,
  facts_version  int  not null,
  data_version   text not null,        -- which plans-20XX dataset (lib/version.ts)
  engine_version text not null,        -- which scoring/engine version
  payload        jsonb not null,       -- full AuditRecord (incl. near-miss alternatives)
  created_at     timestamptz not null default now()
);
create index if not exists audit_broker_idx on audit_records (broker_id, created_at desc);
create index if not exists audit_session_idx on audit_records (session_id);

-- ── Row-level security ───────────────────────────────────────────────────────
alter table sessions       enable row level security;
alter table profiles       enable row level security;
alter table audit_records  enable row level security;
alter table brokers        enable row level security;

-- A broker can read their own broker row (needed to resolve org_id client-side).
create policy broker_self on brokers
  for select using (id = auth.uid());

-- Sessions + profiles: full CRUD, owner only.
create policy session_owner on sessions
  for all using (broker_id = auth.uid()) with check (broker_id = auth.uid());

create policy profile_owner on profiles
  for all using (broker_id = auth.uid()) with check (broker_id = auth.uid());

-- Audit records: read + insert for the owner; NO update/delete policy exists,
-- so those operations are denied for everyone (append-only / immutable).
create policy audit_read on audit_records
  for select using (broker_id = auth.uid());
create policy audit_insert on audit_records
  for insert with check (broker_id = auth.uid());

-- NOTE: the patient self-entry path is NOT covered by these policies on purpose.
-- An unauthenticated patient writes their facts through a server route that
-- validates sessions.intake_token and uses the SERVICE-ROLE key (which bypasses
-- RLS) — never the browser. See lib/supabase/client.ts (serviceClient) and
-- ARCHITECTURE.md → "the patient-intake problem".
