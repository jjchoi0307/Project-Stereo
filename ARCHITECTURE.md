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
  clinical-trajectory view; `horizonRecommendation.ts` scores `runEngine()` across
  simulated futures for the 5/10-yr picks (§4). `config.ts` holds every tunable.
  `rng.ts` is the seeded PRNG.
- **`lib/session/`, `lib/audit/`** — broker session + audit stores behind
  interfaces (in-memory today).
- **`lib/intake/`** — form types, validation (shared client+server), and the
  facts → `ClientProfileInput` mapping.
- **`lib/sim/`** — the one LLM-powered feature: Claude *interprets* the
  deterministic `healthSim.ts` projection into a 5- and 10-year narrative.
  Server-only, opt-in (`ANTHROPIC_API_KEY`), sits OUTSIDE the engine. See §3.
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
6. **No PHI in URLs; no LLM in the recommendation data path.** The lone LLM
   feature (`lib/sim/`) *interprets* the deterministic projection as a separate,
   advisory view — it never produces or alters a recommendation or audit record,
   and only de-identified clinical facts leave the process. See §3.

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
4. ✅ **Auth wiring.** `@supabase/ssr` cookie sessions (`lib/supabase/server.ts`)
   + Next middleware (`middleware.ts` → `lib/supabase/middleware.ts`) gating `/`,
   `/session`, `/audit` and the broker APIs (redirect to `/login`, 401 for APIs).
   `getBrokerContext()` (`lib/supabase/auth.ts`) resolves `BrokerContext`
   (`brokerId`, `orgId`) per request — and on first login provisions the broker's
   org + `brokers` row (service-role, the trusted path). The store factories
   (`getSessionStore`/`getAuditStore`) resolve it themselves, so it's all
   env-gated: `STATE_STORE=memory` (default) keeps auth off and stores in-memory;
   `=supabase` turns both on. Login UI: `/login` + `app/login/actions.ts`.
5. ✅ **Patient self-entry capability token.** The shareable link carries a random
   token (`sessions.intake_token`, broker-minted via `POST …/intake-token`), not
   the raw session id. The anonymous patient page `/intake/[token]` and submit
   `POST /api/intake/[token]` are public (token is the credential) and write that
   one profile through a service-role path that validates the token + expiry
   (`lib/session/patientIntake.ts`). Mode-aware: in memory mode the session id is
   the token and writes hit the in-memory store; in supabase mode it's a random
   capability written via service-role (RLS-bypass, server-only, narrow).
6. ⏭ Deploy (Vercel + BAA) — auth + persistence + patient path are now in.

### Auth provisioning — bootstrap policy to revisit
First login auto-creates the broker's OWN org and makes them `org_admin`. Right for
a solo broker / demo; for the multi-agency model, new brokers should JOIN an existing
org by invitation (role `broker`). Change `resolveBroker()` in `lib/supabase/auth.ts`
when the invite flow exists.

### Not yet done (tracked)
- Threading the session's real `facts_version` into the audit row (skeleton uses 1).
- Persisting near-miss alternatives is supported (they're in the audit payload),
  pending the broader audit-on-Supabase switch.

---

## 3. AI health-future projection (`lib/sim/`)

The one place the product calls an LLM. Given a captured profile, it narrates
where the client's health is most likely headed at **5 and 10 years** — to inform
the plan-selection conversation, not to score plans.

### The key design choice: the LLM interprets, it does not compute
The deterministic Monte-Carlo engine (`lib/engine/healthSim.ts`) stays the
quantitative backbone: it replicates the client into N seeded synthetic copies
and reports incidence rates, complexity, and stable/severe shares — reproducibly.
Claude is handed those statistics plus the clinical facts and asked to **reason
over them**: a grounded narrative, watch-items each tied to a specific simulated
rate, a care outlook, and plan *considerations*. It never invents probabilities,
and its output never re-enters the engine.

This is what keeps invariant #6 intact. The numbers, the scoring, and the audit
record remain LLM-free and reproducible; the projection is an additive,
interpretive view bolted on the side.

### Boundaries that make it safe
- **Outside the data path.** Results carry `notForAudit: true` and are never
  persisted to `audit_records` or fed to `runEngine()`.
- **De-identified.** Only clinical facts leave the process (`deidentify.ts`) —
  the same boundary the simulation seed uses (`lib/engine/seed.ts`): no id, ZIP,
  county, gender, region, names, or timestamps.
- **Opt-in & server-only.** Gated on `ANTHROPIC_API_KEY`; the app runs fully
  without it. The Anthropic client (`client.ts`) throws if constructed in the
  browser — the key never ships client-side.
- **On-demand.** Unlike the deterministic panels (auto-loaded with the session),
  the projection is a live, billable call triggered by a broker click.

### Shape
```
  lib/sim/
    env.ts                ANTHROPIC_API_KEY / SIM_MODEL gate (default claude-opus-4-8)
    client.ts             Anthropic client factory — server-only guard
    deidentify.ts         clinical-facts-only payload boundary
    types.ts              DeterministicDigest, HealthFutureProjection, result
    healthFutureAgent.ts  projectHealthFuture(): backbone @ 5y+10y → Claude (structured output)
  app/api/sessions/[id]/health-future/projection/route.ts   GET, on-demand
  components/RecommendationTabs.tsx → NarrativePanel   per-horizon "Generate narrative"
  scripts/simulate-health-future.ts   npm run sim:health-future (CLI exercise)
```

The model call uses adaptive thinking + structured JSON output (`output_config.format`),
and the result is stamped with the `engineVersion`/`dataVersion` of the backbone
it reasoned over, so you always know which deterministic basis a given narrative
interpreted.

---

## 4. Across-futures horizon recommendation (`lib/engine/horizonRecommendation.ts`)

The recommendation gains a **time dimension**: not just today's plan, but the plan
that holds up as the client's health evolves at **5 and 10 years**. This is the
synthesis of the engine and the health simulation — and it is fully deterministic.

### How it works
`simulateReplicas()` (the population behind `healthSim.ts`) projects the client
into N seeded synthetic FUTURES at a horizon, each with its own acquired
conditions/medications. For each future we build a projected `ClientProfileInput`
(advance age, add the acquired facts) and run the **same `runEngine()`** on it.
The plan that wins the most futures is the horizon's recommendation, reported with
its **win-share**, the full win distribution, and whether it differs from today's
pick. It's a two-level simulation: clinically-projected patients (the futures) ×
financial scenarios (the engine's inner `simulate`).

### Why it stays on the spine
- **One computation path (#1).** Every per-future pick is a real `runEngine()`
  result — no parallel scoring logic. `runEngine` gained an optional pre-built
  `catalog` (`buildEngineCatalog`) so the loop skips re-reading the immutable plan
  universe on each call; the computation is byte-identical.
- **Deterministic (#2).** The futures are seeded off de-identified clinical facts
  (`seed.ts`), and each projected profile re-seeds the engine the same way, so the
  whole horizon recommendation reproduces exactly.
- **No LLM in the data path (#6).** The recommended plan per horizon is pure
  engine. The §3 AI projection only *narrates* the same futures alongside it.
- **Config-centralized (#5).** Future count, inner scenario count, and the
  assumption-incidence threshold live in `config.ts` (`HORIZON_REC`).

### Shape
```
  lib/engine/horizonRecommendation.ts   recommendAcrossHorizons() → today pick + per-horizon winners
  lib/engine/healthSim.ts → simulateReplicas()   the simulated future population
  lib/engine/pipeline.ts  → buildEngineCatalog()  reusable catalog for the hot loop
  app/api/sessions/[id]/recommendation/horizons/route.ts   GET (deterministic, no LLM)
  components/RecommendationTabs.tsx   Today / 5-yr / 10-yr tabs on the recommendation page
```
