# Architecture — SMG Broker Engagement Tool

A broker-facing Medicare Advantage plan recommender for Seoul Medical Group. A
broker captures a prospective client's **factual** profile and gets a ranked
recommendation across the real 2026 SMG-supported plans, with a plain-language
reason for each result and a reproducible audit record.

This document covers (1) the current architecture and the invariants that define
it, and (2) the **persistence + auth spine** design now being scaffolded.

---

## 1. Current architecture

A layered, deterministic pipeline behind a Next.js (App Router) app. The defining
choice: **one pure computation path** that both the live UI and the compliance
audit run through, so they're provably identical.

```
  BROWSER (Next.js App Router, React)
  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────────┐
  │ IntakeForm   │  │ BrokerSession│  │ RecommendationView        │
  │ PatientIntake│  │ (panels)     │  │  + near-miss empty-state  │
  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────────┘
         │ facts           │ reads               │ reads
         ▼                 ▼                     ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  API ROUTES  app/api/sessions/[id]/…                           │
  │  POST intake · GET normalized · rules · simulation ·           │
  │  recommendation · health-futures · POST audit · audit/verify   │
  └───────────────────────────┬───────────────────────────────────┘
                              │ all recommendation reads go through ↓
  ┌───────────────────────────────────────────────────────────────┐
  │  ENGINE  lib/engine/  (pure server-side TS, no I/O, seeded)     │
  │   runEngine()  ── single path, used by live AND audit ──        │
  │     normalize ─▶ rules ─▶ simulate ─▶ score  (+ nearMiss)       │
  │   healthSim.ts = separate clinical-trajectory futures           │
  │   config.ts    = all weights / thresholds / dollar assumptions  │
  └───────────────────────────┬───────────────────────────────────┘
                              │ reads via interfaces
  ┌───────────────────────────────────────────────────────────────┐
  │  STORES (all behind interfaces)                                 │
  │   DataStore       lib/data/      → reference data (catalog)     │
  │   SessionStore    lib/session/   → broker sessions + profile    │
  │   AuditStore      lib/audit/     → reproducible audit records   │
  └───────────────────────────┬───────────────────────────────────┘
                              ▼
  ┌───────────────────────────────────────────────────────────────┐
  │  SOURCE OF TRUTH  lib/data/source/plans-2026.json (47 plans)    │
  │   transformer lib/data/fixtures/plans.ts → typed Plan[]         │
  │   regions · providers · networks · formularies · drugs          │
  └───────────────────────────────────────────────────────────────┘

  CONTRACT:  lib/domain/types.ts = single source of truth for every shape
  CONCEPT:   reference/rlm-python/ = the "score across futures" paradigm
```

### Layers
- **`lib/domain/types.ts`** — the data model; every other layer depends only on
  these shapes.
- **`lib/data/`** — `DataStore` interface + `FixtureDataStore` (built from
  `lib/data/source/plans-2026.json`) + `getDataStore()` factory.
- **`lib/engine/`** — pure server-side TS: `normalize` → `rules` → `simulate` →
  `score`, composed by `pipeline.ts::runEngine()`. `healthSim.ts` is a separate
  clinical-trajectory view. `config.ts` holds every tunable. `rng.ts` is the
  seeded PRNG.
- **`lib/session/`, `lib/audit/`** — broker session + audit stores behind
  interfaces (in-memory today).
- **`lib/intake/`** — form types, validation (shared client+server), and the
  facts → `ClientProfileInput` mapping.
- **`app/api/…`, `app/…`, `components/…`** — route handlers, pages, and the
  broker/patient UI.

### Invariants (the product's spine — preserve these)
1. **One computation path.** `runEngine()` is the only way a recommendation is
   produced; live and audit cannot diverge.
2. **Determinism.** Seeded PRNG keyed off the profile id → every run reproduces
   exactly; the audit re-verifies.
3. **Everything behind an interface.** Swapping a store is additive, never a
   rewrite (this is what makes the Supabase spine below a drop-in).
4. **Facts-only, traceable.** Every risk marker and exclusion carries a trace /
   reason; no black boxes.
5. **Config-centralized.** All weights/thresholds/dollar assumptions in `config.ts`.
6. **No PHI in URLs; no LLM in the data path.**

### Data foundation
Plan data is the **real 2026 SMG-supported universe** (47 plans across Alignment,
Clever Care, Anthem, UnitedHealthcare, SCAN), extracted faithfully from the
carrier PDFs into `lib/data/source/plans-2026.json` and transformed into typed
`Plan[]`. See `lib/data/source/README.md` for provenance and the documented
approximations (coinsurance→copay, drug-tier placement, SCAN deck-level numbers).

---

## 2. Persistence + auth spine (in progress)

### The core insight: two data classes
| | Reference data | Client data |
|---|---|---|
| Examples | plans, networks, formularies, drugs, regions | sessions, profiles, audit |
| PHI? | No | **Yes** |
| Tenancy | Shared | Per-broker |
| Mutability | Read-only, versioned by plan-year | Read/write; audit append-only |
| Lives in | **Bundled versioned JSON (git)** | **Supabase Postgres + RLS** |

Reference data stays bundled JSON: it's the strongest choice for the audit
guarantee — an audit reproduces against the dataset **as it was**, pinned by
`AuditRecord.dataVersion` (`lib/version.ts`). Only PHI/stateful data goes in
Postgres, keeping the PHI surface to three tables.

### Schema + RLS
See `supabase/migrations/0001_init.sql`. Tables: `organizations`, `brokers`
(mirror `auth.users`), `sessions`, `profiles` (PHI, jsonb), `audit_records`
(append-only). **Visibility model: broker-owns-their-clients** — owner-only RLS
policies keyed on `auth.uid()`, with `broker_id`/`org_id` denormalized onto every
PHI table so policies need no joins. Audit records get SELECT + INSERT policies
only (no UPDATE/DELETE ⇒ immutable).

### The two-client model
Three access paths, two clients (`lib/supabase/client.ts`):
- **Broker (authenticated)** → `brokerClient(token)`: RLS-scoped to `auth.uid()`;
  the owner-only policies enforce the PHI boundary.
- **Patient (anonymous)** → cannot use user-based RLS. The patient self-entry
  flows through a server route that validates `sessions.intake_token` and writes
  that one profile via `serviceClient()` (service-role, RLS-bypass, **server-only**,
  never shipped to the browser). This also fixes a latent issue: the intake link
  becomes a capability token, not the raw session id.

### Reproducibility
`AuditRecord` now carries `dataVersion` + `engineVersion` (`lib/version.ts`), so
`audit/verify` re-runs `runEngine()` against the same reference data + engine that
produced the recommendation. With bundled, git-versioned reference data this stays
sound without temporal DB tables.

### Drop-in wiring
The Supabase stores implement the existing interfaces, so nothing upstream
changes:
- `lib/session/supabaseStore.ts` → `SupabaseSessionStore implements SessionStore`
- `lib/audit/supabaseStore.ts` → `SupabaseAuditStore implements AuditStore`
- `getSessionStore(ctx?)` / `getAuditStore(ctx?)` return the Supabase store when a
  broker context is supplied **and** `STATE_STORE=supabase`; otherwise the
  in-memory singleton. No-argument callers (today's routes) keep in-memory behavior.

Env (`.env.example`): `STATE_STORE`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

### Rollout sequence
1. ✅ SQL migration (tables + owner-only RLS, append-only audit).
2. ✅ `dataVersion`/`engineVersion` on the audit record.
3. ✅ Supabase client helpers + store skeletons behind the interfaces + env-switched factories.
4. ⏭ **Auth wiring (follow-up):** `@supabase/ssr` cookie sessions + Next
   middleware protecting `/session` and `/audit`; resolve `BrokerContext`
   (`brokerId`, `orgId`) per request and pass it to the store factories.
5. ⏭ Patient intake → `/intake/[token]` + a service-role server route.
6. ⏭ Deploy (Vercel + BAA) once auth + persistence are live.

### Not yet done (tracked)
- Auth/middleware and the per-request `BrokerContext` resolution.
- Patient capability-token route.
- Threading the session's real `facts_version` into the audit row (skeleton uses 1).
- Persisting near-miss alternatives is supported (they're in the audit payload),
  pending the broader audit-on-Supabase switch.
