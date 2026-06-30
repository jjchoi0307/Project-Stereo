# SMG Broker Plan Recommender

A broker-facing Medicare Advantage / dual-eligible **health-plan** recommender for
Seoul Medical Group. A broker (or the member, via a secure link) enters a member's
**factual** profile and gets a ranked, **cited** recommendation across the real
2026 SMG-supported plans — plus a reproducible record of exactly how the result
was reached. Nothing is a black box.

Live: **https://project-stereo.vercel.app**

---

## What it does

1. **Capture the member's facts** — diagnosed conditions, medications, providers to
   keep, region. Entered by the broker, or by the member through a single-use
   secure intake link. Facts only — never opinions or sentiment.
2. **Screen on the hard rules** — plans not sold in the member's region, that drop a
   must-keep provider, or omit a critical medication are excluded *before* anything
   is ranked. This gate is deterministic; an ineligible plan can never be surfaced.
3. **Rank fit, grounded in the plan files** — eligible plans are ranked, scored, and
   explained by Claude reasoning **strictly over the official 2026 plan documents**,
   with every figure traceable to a source page. The model input is carrier-blind
   (test-enforced), and the result is cached per facts-version, so the same member
   always gets the same recommendation.
4. **Project likely futures** — a seeded Monte-Carlo simulation scores each plan
   across hundreds of simulated care years (not just today), and a separate
   clinical projection (3- and 5-year "health futures") shows how the member's needs
   may evolve. The numbers are deterministic; AI only narrates them.
5. **Seal a reproducible record** — every delivered recommendation becomes an
   immutable audit record that can be re-verified exactly: the deterministic engine
   re-runs to the same ranking, the data/engine versions are pinned, and an HMAC
   detects any tampering of the stored content.

**Driving principle:** people misstate preferences on surveys, so the tool never
asks opinion questions. It collects facts, infers likely future utilization, and
recommends the plan that holds up best across that member's likely futures.

---

## How a recommendation is made

```
intake facts ─▶ normalize ─▶ hard-rules gate ─▶ seeded simulation ─▶ scoring
                                   │                                     │
                                   ▼                                     ▼
                          (deterministic, reproducible engine — lib/engine/pipeline.ts)
                                                                         │
                              de-identified plan facts + member facts ───┘
                                                                         ▼
                            AI ranking + fit reasons + source citations (lib/ai)
                                                                         ▼
                                  sealed, re-verifiable audit record (lib/audit)
```

- **Deterministic backbone** (`lib/engine`): normalization, the eligibility gate,
  the seeded simulation, and scoring are pure TypeScript — same inputs, same
  outputs, every time. `runEngine(...)` is the single path the live result and the
  audit record both use, so what the broker sees and what's stored are provably the
  same computation.
- **AI layer** (`lib/ai`): Claude ranks the *eligible* plans and writes the
  plain-language reasons + citations, reasoning only over the real plan facts. It
  cannot include an ineligible plan or invent a figure. Member data is
  **de-identified before any model call** (`lib/sim/deidentify.ts`).
- **Audit** (`lib/audit`): each record stores the profile snapshot, exclusion log,
  seed, per-plan scores, ranking, and the AI recommendation verbatim. `/verify`
  re-runs the engine (seed + ranking), checks the record's pinned data/engine
  version, and verifies the content HMAC.

---

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** + **Tailwind**
- **Supabase** (Postgres + Row-Level Security) for the PHI spine (sessions,
  profiles, audit), with cookie-based broker auth via `@supabase/ssr`
- **Anthropic** (`@anthropic-ai/sdk`) for the grounded recommendation, the clinical
  read, and the health-futures narrative — all server-only and opt-in
- Reference data behind a typed **data-access interface** (`lib/data`), bundled and
  git-versioned (no live data dependency)

The AI work runs on a shared RLM-style orchestrator (`lib/ai/rlm.ts`) — decompose →
parallel grounded calls → synthesize — inspired by the Recursive Language Models
paradigm (`reference/rlm-python/`).

---

## Plan-data foundation

The plan universe — **50 plans across six carriers** (Alignment, Clever Care,
Anthem Blue Cross, UnitedHealthcare, SCAN, Humana) — is transcribed faithfully from
the 2026 carrier PDFs into `lib/data/source/plans-2026.json` (the committed source
of truth) and typed into fixtures by `lib/data/fixtures/`. **No LLM is in the data
path** — the numbers come from the documents. See `lib/data/source/README.md` for
provenance.

**SMG service area:** intake is scoped to where SMG actually has providers — **Los
Angeles, Orange, and Santa Clara** counties (`SMG_SERVICE_AREA_REGION_IDS`). Plans
sold only outside that footprint stay in the dataset but are never an SMG option.

---

## Security & privacy (PHI app)

- **Tenant isolation by RLS** — every broker query runs as `auth.uid()`; owner-only
  policies wall each broker (and each agency org) off from the others, with explicit
  `org_id` defense-in-depth on the most sensitive reads.
- **De-identification before AI** — only de-identified clinical facts ever leave the
  process to a model; provider free-text never does.
- **No PHI in URLs, query strings, or client logs.** Service-role key is server-only
  (used solely for the narrow patient-intake capability path).
- **Strict CSP** with a per-request **script nonce + `strict-dynamic`** (no
  `unsafe-inline` in production), HSTS, `frame-ancestors 'none'`, and origin/CSRF
  checks on state-changing requests (including write-bearing GETs).
- **Tamper-evident audit** — records are HMAC-signed (`AUDIT_HMAC_KEY`); `/verify`
  flags any later alteration of the stored recommendation, citations, or snapshot.
- **Stealth posture** — public surfaces describe principles, not internals; errors
  never leak stack traces or the model id.

Internal detail lives in `ARCHITECTURE.md` and `SECURITY.md` (not for public pages).

---

## Run locally

```bash
npm install
npm run dev          # http://localhost:3000  (the team uses `next dev -p 3737`)
npm run typecheck
npm test             # full deterministic engine + neutrality + de-id test suite
```

The app runs entirely on **in-memory stores with no auth** until you switch on
Supabase — so local dev needs no secrets. Copy `.env.example` → `.env.local` to
enable persistence/auth and the AI features.

### Test suite (`npm test`)

`validate:fixtures` · `test:normalize` · `test:rules` · `test:sim` · `test:score` ·
`test:audit` · `test:health` · `test:horizon` · `test:deidentify` · `test:neutrality`
— covering referential integrity, the deterministic engine, audit reproducibility,
PHI de-identification, and a proof that the ranking is carrier-unbiased.

---

## Configuration (`.env.example`)

| Variable | Purpose |
| --- | --- |
| `STATE_STORE` | `memory` (default, in-process) or `supabase` (Postgres + RLS + **turns on broker auth**) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only**; narrow patient-intake capability path only |
| `ANTHROPIC_API_KEY` | Enables the AI recommendation, clinical read, and health-futures narrative (opt-in; app runs without it) |
| `SIM_MODEL` | Optional model override (default `claude-sonnet-4-6`) |
| `SMG_ORG_ID` | Pins the default organization so an agency-less broker provisions deterministically (avoids ambiguity when multiple orgs exist) |
| `ORG_ADMIN_EMAILS` | Emails granted `org_admin` on first login (set by hand) |
| `ALLOW_SIGNUP` | Self-service broker sign-up. **Off in production** — provision brokers deliberately |
| `AUDIT_HMAC_KEY` | Server secret enabling audit-record tamper-evidence. Unset = records unsigned, verification degrades to reproducibility-only |

No secret is required to run locally. Never commit real values; no PHI in env.

---

## Deployment

Hosted on **Vercel**; **`main` is the production branch** (merging to `main`
publishes to `project-stereo.vercel.app`). Set the env vars above in the Vercel
project (Production), and in Supabase set **Auth → URL Configuration → Site URL** to
the production origin so invite/confirmation emails resolve correctly.

---

## Project layout

```
app/                      Next.js App Router
  page.tsx                broker workspace ( ⁠/ ⁠— redirects logged-out → /home)
  home/  login/  signup/  public landing, auth
  plans/                  plan-data catalog
  session/[id]/           a client session → recommendation → "present to member"
  intake/[token]/         member self-entry (capability-token link)
  audit/  admin/          reproducible audit log + elevated oversight
  api/                    sessions, audit, intake routes
components/               UI (PublicHome, HeroVideos, BrandVideo, RecommendationView, ui/*)
lib/domain/types.ts       the data model (single source of truth)
lib/data/                 data-access interface + fixtures (+ source/plans-2026.json)
lib/engine/               deterministic pipeline: normalize, rules, simulate, score
lib/ai/                   grounded recommendation, clinical read, horizons, RLM orchestrator
lib/audit/                reproducible records + HMAC integrity
lib/sim/                  de-identification + model client
lib/supabase/             auth, RLS-scoped clients, middleware
middleware.ts             CSP (nonce), CSRF/origin checks, auth gating
reference/rlm-python/     the RLM conceptual base
```

---

## Open questions (flagged, not silently decided)

1. **Preference-weighting ceiling** — how much carrier preference (if any) is
   acceptable under MA marketing-compliance review? Built as a bounded, logged,
   test-checked tiebreaker; the exact bound is a compliance decision. (Currently the
   ranking is carrier-neutral by construction.)
2. **Minimum input set** — the smallest intake that yields useful accuracy without
   hurting adoption. Current required set: age, region, and at least one of
   {medications, conditions}.
3. **Invite onboarding** — the broker invite → set-password flow is the next piece
   to finish (Supabase Site URL + an accept-invite route).
```
