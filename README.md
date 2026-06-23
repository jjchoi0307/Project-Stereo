# SMG Broker Engagement Tool

A broker-facing plan recommendation tool for Seoul Medical Group. A broker enters
a prospective client's **factual** profile and gets a ranked recommendation across
the **real 2026 SMG-supported health plans** (47 plans across five carriers —
Alignment, Clever Care, Anthem Blue Cross, UnitedHealthcare, and SCAN), with a
plain-language reason for each result.

> **Plan data foundation:** the plan universe is extracted faithfully from the
> 2026 carrier PDFs in `SMG Healthplans/` into `lib/data/source/plans-2026.json`
> (the source of truth) and transformed into typed fixtures by
> `lib/data/fixtures/plans.ts`. See `lib/data/source/README.md` for provenance.
> No LLM is in the data path — the numbers are transcribed from the documents.

**Driving principle:** people misstate preferences on surveys, so the tool never
asks opinion/sentiment questions. It collects facts, infers likely future
utilization, and recommends the plan that holds up best across that person's
likely futures.

> **Conceptual base:** the simulation layer (score each plan across many
> simulated futures rather than the current state only) comes from the Recursive
> Language Models paradigm — that reference implementation lives in
> `reference/rlm-python/`. The product itself uses no LLM in v1; the simulation is
> plain seeded TypeScript.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Data behind a typed **data-access interface** (`lib/data`) — v1 uses synthetic
  in-memory fixtures; a Supabase implementation drops in later with no UI/engine change
- Simulation engine in server-side TypeScript (later step)

No PHI in URLs, query strings, or client logs. Secrets stay server-side.

## Status — all 8 steps complete (v1)

Build order: **(1) data models + fixtures + data-access**, **(2) intake UI**,
**(3) profile normalization**, **(4) rules engine**, **(5) simulation**,
**(6) scoring**, **(7) recommendation UI**, **(8) audit + preference flag** — all done.

Run the full engine test suite with `npm test`.

### What's in Step 8 (audit + preference flag)
- `lib/engine/pipeline.ts` — `runEngine(...)` is the single normalize→rules→
  simulate→score path; the live recommendation AND the audit record both use it,
  so what the broker sees and what's stored are provably the same computation.
- `lib/audit/record.ts` + `lib/audit/store.ts` — every recommendation produces a
  reproducible `AuditRecord` (profile snapshot, normalized profile, exclusion log,
  scenario seed + count, every per-plan score incl. the visible
  `preferenceContribution`, the ranking, and `preferenceChangedTop`). Stored behind
  an interface (in-memory for v1).
- `POST /api/sessions/[id]/audit` (auto-fired by the recommendation screen),
  `GET /api/audit/[id]`, and `GET /api/audit/[id]/verify` — the verify endpoint
  re-runs the engine from the snapshot and confirms the seed + ranking match.
- UI: `/audit` log + `/audit/[id]` detail with a live **"Reproduced exactly"**
  badge; the recommendation screen links to its saved record.
- **Preference-weighting feature flag**: `?preference=off` everywhere + the live UI
  toggle give the pure-fit vs. preference-weighted views side by side; the bounded
  contribution is logged in every audit record.
- `npm run test:audit` proves the record is complete and reproducible.

### Added: Health-futures simulation (clinical trajectories)

A second simulation stage, distinct from the per-plan financial one: it answers
"what could happen to **this person** over time?" rather than "how does each plan
handle a year of care?".

- `lib/engine/healthSim.ts` — `simulateHealthFutures(profile, normalized)`
  **replicates** the client into N seeded copies (default 250) and projects each
  one's clinical trajectory over a horizon (default 5 years): diabetes
  intensification → insulin, CKD onset/progression, cardiac events, cancer
  diagnosis, mental-health escalation, mobility decline, hospitalization — each
  probability driven by the client's conditions, risk markers, and advancing age,
  with acquired conditions raising downstream risk. Seeded → reproducible.
- `lib/engine/rng.ts` — shared seeded PRNG (used by both simulations).
- `GET /api/sessions/[id]/health-futures?replicas=N&years=Y` returns the outcome
  incidence distribution, per-year new-event rate, complexity stats, and sample
  trajectories.
- The broker session shows a **"Health futures (simulated)"** panel: stable /
  high-complexity / mean-acuity stats, an outcome-incidence bar list, and
  expandable sample year-by-year trajectories.
- `npm run test:health` checks reproducibility and that it's condition-driven.

> Currently a standalone clinical view. It can be wired to *feed* plan scoring
> (evaluate each plan against these longitudinal trajectories instead of one-year
> journeys) as a follow-up.

### What's in Step 7 (recommendation + comparison UI)
- `app/session/[id]/recommendation/page.tsx` + `components/RecommendationView.tsx`
  — the broker-facing screen. Reached via "Continue to recommendation" on the
  session (redirects back if no facts captured yet).
- **Top 1–3 plans** as cards: fit score, one-line summary, plain-language "why it
  fits" (from reason codes), and a Medications / Network / Worst-case / Confidence
  grid — plus a "Tradeoffs" section per plan.
- **Other eligible plans** in a compact comparison table (score, meds, worst-case,
  main caveat) so the broker can explain the runner-up.
- **"Not recommended for this profile"** section with each plan's specific reason.
- **Preference On / Off toggle** (live) for the compliance side-by-side, with an
  amber callout when preference weighting changed the top pick.

### What's in Step 6 (scoring & aggregation)
- `lib/engine/scoring.ts` — `score(...)` aggregates the simulation summaries into
  per-plan `expectedFit = coverageFit + networkFit + medicationFit − mismatchPenalty`,
  `downsideRisk = catastrophicDownside`, `confidence` (outcome tightness), a bounded
  `preferenceContribution`, `total`, and broker-friendly `reasonCodes`.
- **All weights in `lib/engine/config.ts`** (`SCORING`). Components are rounded
  first so the displayed/audited arithmetic adds up exactly.
- **`preferenceContribution`** is a logged, hard-capped tiebreaker
  (`SCORING.preference.max`) for SMG/SCAN plans — it can only reorder plans whose
  fit is already within the cap, never lift a clearly worse-fit plan above a
  better one. The scorer also reports `preferenceChangedTop`.
- `GET /api/sessions/[id]/recommendation?preference=off&count=N` returns the ranked
  scores (with reasons + exposure) and the excluded list; `preference=off` gives the
  pure-fit view for side-by-side compliance review.
- `lib/engine/reasons.ts` — reason-code → broker text + positive/caveat grouping.
- `npm run test:score` proves consistency and the bounded-preference guarantee.

### What's in Step 5 (simulation — the differentiator)
- `lib/engine/simulate.ts` — `simulate(profile, normalized, survivingPlans, ctx)`
  generates N seeded care journeys (default 500, configurable 100–500), each a mix
  of care events whose probabilities are weighted by the risk markers. The **same**
  journeys are evaluated against every surviving plan, estimating annual member
  exposure, drug coverage (current + newly-needed drugs), and network gaps per
  future. Summarized per plan: mean / p90 / worst exposure, std, med-coverage rate,
  catastrophic rate, top uncovered drugs.
- **Seeded** (`mulberry32`, seed from profile id) → fully reproducible for trust
  and compliance review.
- `lib/engine/config.ts` — all simulation tunables (scenario count, uncovered-drug
  costs, out-of-network penalty, catastrophic threshold) in one place.
- `GET /api/sessions/[id]/simulation?count=N` + a **"Simulation"** panel (per-plan
  mean / worst exposure, meds-covered %, catastrophic %).
- `npm run test:sim` checks reproducibility and that future coverage gaps surface.

### What's in Step 4 (rules engine)
- `lib/engine/rules.ts` — `applyRules(profile, plans, ctx)` runs three hard rules
  before any scoring: **region** (not sold here → exclude), **provider** (a hard
  must-keep system/provider out of network → exclude), **medication** (a current
  med off-formulary → exclude if critical e.g. insulin/oncology, else **flag**).
  Returns the surviving set, the excluded set, and a full exclusion log.
- `GET /api/sessions/[id]/rules` returns a display-shaped result (eligible plans
  with any flags; excluded plans with their specific reasons).
- The broker session shows a **"Plan screening"** panel: eligible vs. "not
  recommended for this profile", each with plain reasons.
- `npm run test:rules` asserts UCLA exclusions and the metformin off-formulary flag.

### What's in Step 3 (normalization)
- `lib/engine/normalize.ts` — `normalizeProfile(profile, drugs)` turns facts into
  six risk markers (diabetes, oncology, specialist need, drug utilization,
  mental-health utilization, network sensitivity). Each is a deterministic additive
  function of facts (conditions, drug classes, family history, BMI, age,
  utilization) and carries a **trace** of every contributing input + weight.
- `GET /api/sessions/[id]/normalized` returns the markers for a session's profile.
- The broker session shows a **"Clinical read (inferred)"** panel — each marker
  with a band, score bar, and an expandable trace.
- `npm run test:normalize` asserts the example profiles land in the expected bands.

### What's in Step 2 (intake)
- **Broker-owned sessions** (`lib/session/store.ts`, in-memory for v1) — start a
  session at `/`, work it at `/session/[id]`.
- **Two capture paths, one shared form** (`components/IntakeForm.tsx`): broker
  entry, or patient self-entry via the shareable link `/intake/[id]` (which polls
  straight into the broker's session). Same field set either way.
- **Facts only** — no opinion/sentiment questions. Required: age, region, and at
  least one of {medications, conditions}; everything else optional.
- **Validation** shared client + server (`lib/intake/validate.ts`); medications
  normalized to drug codes (`normalize.ts`); BMI computed; provider "must-keep"
  constraints captured as hard requirements.
- **Provenance** — `capturedBy` records the origin path; `fieldProvenance` records
  per-field edits (a broker correction keeps the original origin and attributes
  only changed fields), so patient- vs broker-entered accuracy can be compared later.

### What's in Step 1
- `lib/domain/types.ts` — the full data model. Layers 1–2 (geography, providers,
  drugs, plans, **client intake**) are concrete; engine I/O contracts for layers
  3–6 (normalized profile, care journeys, plan scores, recommendation, audit
  record) are defined as **shapes only** so the whole contract is reviewable now.
- `lib/data/fixtures/*` — the **real 2026** plan set (47 plans / 5 carriers, built
  from `lib/data/source/plans-2026.json`), 20 California county regions, 8 provider
  systems (incl. Seoul Medical Group, UCLA Health, Astrana, Heritage, UCSD), 9
  carrier/partner networks, 2 formularies, the tracked drug list, + 2 example
  profiles. UCLA access is isolated to the UHC UCLA Health plans (the brief's
  hard-constraint demo); Clever Care is correctly an SMG-supported carrier, not a
  competitor.
- **SMG service area** — because the tool is SMG-specific, broker intake is scoped
  to where SMG actually has providers: **Los Angeles, Orange, and Santa Clara**
  (`SMG_SERVICE_AREA_REGION_IDS` in `regions.ts`, enforced in the intake route).
  Plans sold only outside that footprint (e.g. San Diego/Riverside-only) stay in
  the dataset but are never an SMG option (42/47 plans are SMG-reachable).
- `lib/data/store.ts` + `fixtureStore.ts` + `index.ts` — the data-access interface,
  the fixture implementation, and `getDataStore()`.
- `app/page.tsx` — a preview that renders the seeded plans through the data layer.

## Run

```bash
npm install
npm run validate:fixtures   # referential integrity + brief-requirement checks
npm run dev                 # http://localhost:3000 — plan-data preview
npm run typecheck
```

## Open questions (flagged, not silently decided)

1. ~~**Real data source**~~ — **RESOLVED.** Plan/benefit data now comes from the
   real 2026 carrier PDFs (`lib/data/source/plans-2026.json`), and the schema was
   expanded to hold the real richness (SNP type, in/out MOOP, 6 drug tiers, FLEX/
   OTC/transportation/SSBCI/dental/vision/hearing). Still synthetic/approximated:
   per-drug **formulary placement** (SBs give per-tier cost share, not drug-level
   tiers) and the **coinsurance→copay** dollar estimates (documented assumptions
   in `plans.ts`). Provider networks are modeled from the carrier/partner info in
   the PDFs (UCLA only via the UHC UCLA Health plans; SCAN's Astrana/Heritage/UCSD
   partners). The six summary-only UHC stub plans were omitted, not fabricated.
2. **Preference-weighting ceiling** — how much `preferenceWeight` is acceptable
   under MA marketing compliance review? Built as a bounded, logged tiebreaker;
   the exact bound is a compliance decision, not an engineering one.
3. **Minimum input set** — what's the smallest intake that yields useful accuracy
   without hurting broker adoption? Current required set: age, region, and at
   least one of {medications, conditions}. To validate against real outcomes.
4. **Scenario detail in the UI** — should brokers see scenario-level detail or
   only the aggregate recommendation + reasons? Affects step 5/7 output design.

## Layout

```
app/                     Next.js app (page.tsx = step-1 data preview)
lib/domain/types.ts      the data model (single source of truth)
lib/data/                data-access interface + fixture store + factory
lib/data/source/         real 2026 plan extraction (plans-2026.json) — source of truth
lib/data/fixtures/       real plans (built from source), formularies, networks, providers, regions, profiles
scripts/validate-fixtures.ts
reference/rlm-python/     the RLM conceptual base (the simulation paradigm)
```
