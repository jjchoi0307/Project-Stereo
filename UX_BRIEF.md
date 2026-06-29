# UX Brief — SMG Broker Engagement Tool

A design brief for (re)building the interface. It is **grounded in what already
exists** — every screen, control, and data point below maps to a real route,
component, and data shape in this repo. Treat it as the contract: the UI must be
fully **interactable against the real backend** (no static mockups, no dead
controls, no faked data). Where something is read-only by design, that's called
out explicitly.

> Read alongside `ARCHITECTURE.md` (data model + invariants), `SECURITY.md`
> (auth/PHI), and the existing components in `components/` and pages in `app/`.
> This brief describes the *intended* experience; the current components are a
> functional baseline to elevate, not a fixed design.

---

## 0. How to use this brief
- Section 5 is the screen-by-screen spec — the core. Each screen lists its
  **route**, **purpose**, **layout**, **every interactive element + the exact
  endpoint/data it hits**, and **all states** (loading / empty / error / success).
- Section 7 is the shared visual vocabulary (risk bands, win-share, exposure,
  confidence, provenance) — reuse it consistently everywhere.
- Section 8 is the **interactability contract** — the non-negotiable list of
  things that must call the real backend.

---

## 1. Product & purpose
A **broker-facing Medicare Advantage plan recommender** for Seoul Medical Group.
A licensed broker captures a prospective client's **factual** health profile and
receives a **ranked recommendation** across the real 2026 SMG-supported plans —
with a plain-language reason for every result, a **time dimension** (how the pick
holds up at 5 and 10 years), an optional **AI narrative** of the client's likely
health future, and a **reproducible compliance audit record**.

The product's character: **trustworthy, fact-driven, explainable, clinical-calm.**
It is a professional decision-support tool, not a consumer sales funnel. Every
number is traceable; nothing is a black box. The UI should feel like something a
broker is comfortable showing a client across the desk.

## 2. Personas & primary journeys

**Broker (primary).** Signs in, starts a client session, captures facts (or hands
the client a link), reviews the clinical read and recommendation, explains the
pick (today + future), and lands on a saved audit record.

**Patient (secondary, anonymous).** Receives a capability link from their broker,
fills in their own facts on a phone/tablet, submits — done. No account, sees only
their own intake form and a thank-you.

**Org admin (future).** Role exists in the data model (agency-wide read), but no
UI yet and onboarding is single-broker today — design can leave room for an
agency/team view later, but don't build it now.

**The broker golden path:**
`/login → / (dashboard) → Start session → /session/[id] (capture facts) →
Continue to recommendation → /session/[id]/recommendation (Today / 5yr / 10yr,
+ AI narrative) → audit record saved (link to /audit/[id])`

**The patient path:**
`broker shares link → /intake/[token] → fill form → "Send to my broker" → thank-you`
(the broker's open session updates from "awaiting facts" to "facts captured" via polling).

## 3. Design principles & visual language

**Principles**
1. **Explain everything.** Every score, exclusion, and risk marker carries a
   reason/trace the broker can expand and read aloud. No unexplained verdicts.
2. **Facts, not sentiment.** Intake captures diagnosed conditions, meds,
   utilization — never "how do you feel about X." Mirror that neutrality in copy.
3. **Deterministic vs interpretive must look different.** The recommendation and
   all numbers are deterministic/auditable; the AI narrative is interpretive and
   clearly badged (it never changes the recommendation). Give them distinct visual
   treatments (see §7) so a broker never confuses "the engine says" with "the AI suggests."
4. **Progressive disclosure.** Lead with the answer (the recommended plan, the
   headline); let detail (traces, distributions, sample trajectories, tradeoffs)
   expand on demand.
5. **Calm and legible.** Generous whitespace, restrained color, tabular numbers
   for figures, plain language over jargon. This is healthcare + money.
6. **Accessible.** WAI-ARIA roles already exist on tabs; keep keyboard nav, focus
   states, labelled controls, and sufficient contrast throughout.

**Existing tokens (Tailwind, `tailwind.config.ts`)** — evolve, don't fight:
- `ink` `#0f172a` (primary text), `accent` `#0d6e6e` (calm clinical teal — primary actions/links), body `bg-slate-50`.
- Semantic colors in use: **emerald** = SMG/SCAN/positive/eligible; **amber** = flags/tradeoffs/warnings/awaiting; **rose** = errors/exclusions/not-recommended; **violet** = the **AI** layer (badge + narrative panels); **slate** = neutral chrome.
- Cards: `rounded-lg border border-slate-200 bg-white p-6`. Pills/chips: small rounded, tinted. This card/chip system is consistent across the app — keep it as the structural grammar.

## 4. Global shell, navigation & states

**Shell.** Centered max-width containers (`max-w-4xl`/`max-w-2xl`), white cards on
`slate-50`. There is currently no persistent top nav — pages carry their own
header + back-links. Consider a thin app header (SMG wordmark, broker identity +
**Sign out**, links to **Audit log** and **Plan data**) shown only when
authenticated; keep `/login`, `/intake/[token]`, `/plans` chrome-light.

**Auth states (when `STATE_STORE=supabase`).** Unauthed access to `/`, `/session/*`,
`/audit*` redirects to `/login?next=…`; broker APIs return 401. `/login`,
`/intake/[token]`, `/plans` are public. In the default in-memory dev mode auth is
off entirely. The design must handle: signed-out, signed-in, and "session expired
→ bounced to login."

**Universal states** every data view needs: **loading** (skeleton or quiet
spinner line), **empty** (friendly prompt), **error** (rose, with a retry where
possible), **success/result**. These already exist inconsistently — standardize them.

## 5. Screens (route-by-route)

### 5.1 `/login` — Broker sign in
- **Purpose:** authenticate the broker. Public.
- **Component:** `components/LoginForm.tsx` (client) + server actions in `app/login/actions.ts`.
- **Layout:** narrow centered card. SMG eyebrow label, "Broker sign in" heading, reassurance line ("Your clients and audit records are private to your account").
- **Interactions:**
  - Email + password fields → **`signIn`** server action → on success redirect to `next` (default `/`); on failure show inline error.
  - "Create account" toggle → **`signUp`** action — **only render when signup is enabled** (the page passes `allowSignup`). When disabled, show sign-in only.
  - Email-confirmation notice path: signUp may return "check your email to confirm."
- **States:** idle, submitting (disable button), error (inline rose text), notice (emerald).

### 5.2 `/` — Broker dashboard / home
- **Purpose:** start a new client session or resume a recent one.
- **Components:** `app/page.tsx` + `components/StartSessionButton.tsx`.
- **Data:** `GET` via the session store (`list()`); shows session id, optional client label, created-at, and a status pill.
- **Interactions:**
  - **Start new client session** → `POST /api/sessions` → navigate to `/session/[id]`. Must handle the failure case (it now shows an inline error — keep that).
  - **Recent sessions list** → each row links to `/session/[id]`. Status pill: `awaiting facts` (amber) vs `facts captured` (emerald).
  - Header links: **Audit log** → `/audit`, **Plan data** → `/plans`, **Sign out** (when authed) → `signOut` action.
- **States:** empty ("No sessions yet — start one above"), populated list.
- **Design note:** this is the broker's home base — make "Start session" the clear primary action; recent sessions should be scannable (client label + status + date).

### 5.3 `/session/[id]` — Client session (capture + clinical read)
The richest broker screen. `components/BrokerSession.tsx`. Two top-level modes:

**(A) Awaiting intake** (`status === "awaiting_intake"`)
- Two-column: left = **broker intake form**; right = **"or have the client enter their own facts"** aside.
- **Broker `IntakeForm`** (`components/IntakeForm.tsx`, variant `broker`) → `POST /api/sessions/[id]/intake`. Full field set (see §6 Forms).
- **Patient capability link aside:** auto-mints a token via `POST /api/sessions/[id]/intake-token`, builds `/intake/[token]`, shows it in a read-only field with a **Copy** button. While minting: "Generating link…"; on failure: rose error + Copy disabled. A pulsing "Waiting for the client to submit…" indicator.
- **Polling:** while awaiting, the page polls `GET /api/sessions/[id]` every 3s; when the patient submits, it flips to mode (B) live. Design should make that transition feel responsive (the waiting indicator → captured facts).

**(B) Intake complete** (`status === "intake_complete"`) — a vertical stack of analysis panels, each a card. All load in parallel on entry and recompute when facts change (keyed on `capturedAt`):
1. **Captured facts** (`ProfileSummary`): the entered profile, each field tagged with its **provenance** chip (`patient` = sky / `broker` = violet) — who entered it. Read-only display.
2. **Clinical read (inferred)** (`NormalizedPanel`) ← `GET …/normalized`: six **risk markers** (diabetes, oncology risk, specialist need, drug utilization, mental-health utilization, network sensitivity), each a labeled bar with a **band** chip (low/moderate/high/very_high) and a percent. Each row is **expandable** to show the `trace` — the exact inputs that produced it. (Interactive disclosure.)
3. **Health futures (simulated)** (`HealthFuturesPanel`) ← `GET …/health-futures`: the deterministic Monte-Carlo view — "no major change / high complexity / mean acuity" stat tiles, a per-outcome incidence list (bars), and an expandable **sample trajectories** section (high/mid/low replicas with year-by-year events). Carries a "reproducible · seed · N replicas" caption.
4. **Plan screening** (`RulesPanel`) ← `GET …/rules`: "N of M plans pass the hard rules." Two lists — **Eligible** (emerald header, plans with any amber flags) and **Not recommended for this profile** (excluded, rose ✗ reasons). Read-only.
5. **Simulation** (`SimulationPanel`) ← `GET …/simulation`: per-plan exposure table (mean/yr, worst/yr, meds covered %, catastrophic %), with drug-gap notes. Read-only table.
- **Footer actions:** **Continue to recommendation →** (`/session/[id]/recommendation`, primary) and **Correct facts** (re-opens the broker `IntakeForm` pre-filled → resubmits, merging provenance).
- **Plan tags** used throughout: `SCAN`/`SMG` (emerald), `competitor` (rose).
- **Design note:** this is a lot of information — use the card stack + progressive disclosure so it reads top-to-bottom as a narrative (here are the facts → here's what they imply clinically → here's what could happen → which plans survive → how they cost out), not as a dump.

### 5.4 `/session/[id]/recommendation` — The recommendation (the payoff)
`components/RecommendationTabs.tsx`. A **tabbed** view: **Today / 5 years / 10 years**
(WAI-ARIA tablist already implemented — keep roles, roving tabindex, arrow keys).

**Today tab** (`RecommendationView`) ← `GET …/recommendation?preference=on|off`:
- **Preference weighting toggle** (On / Off — "pure fit") in the header → refetches; when it changed the top pick, show an amber banner.
- **Recommended (top 1–3)**: prominent `TopCard`s — rank badge, plan name + tags, carrier/type/premium/OOP, big **fit score**, plain-language **reasons** (✓ positives, ⚑ tradeoffs), and a 4-up stat row (medications covered, network, worst-case + catastrophic %, confidence + est. $/yr).
- **Other eligible plans**: compact comparison **table** (score, meds %, worst/yr, main caveat).
- **Stress-test** (`ScenarioPanel`) ← `GET …/scenarios?preference=`: "how the pick holds up if the situation changes" — per-scenario ✓ holds / ⚑ top pick changes.
- **Not recommended**: excluded plans with rose ✗ reasons.
- **No-eligible-plan / near-miss**: if nothing survives, explain why; if it's provider-driven, surface the closest plans each labeled with which required provider they'd drop.
- **Audit:** on view, `POST …/audit` upserts the reproducible record; footer shows "Audit record saved · `aud-…`" linking to `/audit/[id]`.

**5-year / 10-year tabs** (`HorizonPanel`) ← `GET …/recommendation/horizons` (fetched once, shared):
- **The recommended plan at that horizon** — the plan that wins the most simulated futures: a highlighted card with **win share** ("wins X% of N simulated futures"), plan meta, representative reasons + exposure, and a **changed-vs-today** badge (amber "⚑ changes vs today" with the today→horizon explanation, or emerald "✓ same as today").
- **Win-share distribution** bars (how the futures split across plans) when more than one plan wins futures.
- **What the futures assumed by year N** — the newly-acquired conditions/meds (with incidence %) the projection added — as tinted chips.
- **AI narrative** (`NarrativePanel`, violet, **on-demand**) ← `GET …/health-future/projection`: a **"Generate narrative"** button (it's a live, ~30s Claude call). States: idle (button), loading ("Reasoning over the simulation…"), error (rose + retry; distinct "not enabled" message when the key is absent), done (headline + confidence chip, narrative, **watch-items** each with its grounding, care outlook, caveat). One call covers both horizons; share it across the 5y/10y tabs.
- **Design note:** the horizon tabs answer "does my plan still fit me as I age?" Make the **win share + changed/holds** the hero. Keep the violet AI section visually separate and clearly secondary to the deterministic recommendation above it.

### 5.5 `/intake/[token]` — Patient self-entry (anonymous)
- **Purpose:** the client fills their own facts via a capability-token link. Public; no account. `app/intake/[token]/page.tsx` → `components/PatientIntake.tsx`.
- **Layout:** single centered column, SMG eyebrow, "A few quick facts" heading. Phone/tablet-first — this is handed over or texted.
- **Interactions:** the same `IntakeForm` (variant `patient`, warmer copy, submit label "Send to my broker") → `POST /api/intake/[token]`. On success → a **thank-you** state ("Your facts have been sent to your broker. You can hand the device back now.").
- **States:** invalid/expired token → not-found (the link is dead — friendly message, not a stack trace); form → submitting → thank-you.
- **Design note:** maximally simple, reassuring, large touch targets. Required fields are only age, region, and one med/condition — make optionality obvious so it never stalls.

### 5.6 `/audit` — Audit log
- **Purpose:** the broker's list of saved, reproducible recommendation records. `app/audit/page.tsx`.
- **Data:** audit records (`list()`) + plan catalog.
- **Interactions:** each record links to `/audit/[id]`. Show id, created-at, the recommended plan, data/engine versions.
- **Design note:** this is the compliance trail — make it feel authoritative and searchable/scannable (by date, client/session).

### 5.7 `/audit/[id]` — Single audit record
- **Purpose:** the full reproducible record of one delivered recommendation. `app/audit/[id]/page.tsx` + `components/VerifyBadge.tsx`.
- **Data:** the stored `AuditRecord` — profile snapshot, normalized markers, exclusion log, per-plan scores, ranking, seed/scenario count, data/engine versions, preference flags.
- **Interactions:** **Verify badge** → `POST /api/audit/[id]/verify` re-runs the engine against the same data + engine version and confirms the ranking reproduces exactly (✓ reproduced / ✗ mismatch). This is the trust centerpiece — make it prominent.
- **Design note:** present it as an immutable receipt: "this recommendation, these inputs, this result, re-verifiable."

### 5.8 `/plans` — Plan data reference
- **Purpose:** browse the real 2026 SMG-supported plan universe (47 plans). Read-only reference. `app/plans/page.tsx`.
- **Design note:** a scannable catalog (carrier, type, premium, OOP max, tags, key benefits). Useful for the broker to look up specifics.

## 6. Forms — the intake form (shared, broker + patient)
`components/IntakeForm.tsx`, one component, two variants. Sections, in order:
1. **Basics:** age* (required), gender, market region* (select — SMG service area only: LA / Orange / Santa Clara), ZIP, county.
2. **Current medications:** add/remove rows, free text with a **drug-name datalist** for suggestions; each is matched to formularies server-side.
3. **Diagnosed conditions:** checkbox grid (controlled vocab) + "other conditions" free text.
4. **Height & weight:** → live **BMI** display.
5. **Family history:** per-condition yes/no/unknown selects.
6. **Doctors/hospitals to keep:** provider-system checkboxes (hard requirements — drive exclusions).
7. **Recent care (12 mo):** acupuncture / specialist / inpatient counts.
- **Validation:** required = age, region, and **at least one** of {medication, condition}; everything else optional but must be well-formed. Validation is shared client+server — surface field errors inline and a form-level error ("Enter at least one medication or one diagnosed condition").
- **Submit:** broker → `/api/sessions/[id]/intake`; patient → `/api/intake/[token]`. Disable while submitting.
- **Design note:** long form — section it clearly (the `<fieldset>` legend pattern exists), keep it calm, make required vs optional obvious, and keep the medication/condition repeaters pleasant on touch.

## 7. Data → display vocabulary (use consistently everywhere)
- **Risk band** (`low / moderate / high / very_high`): slate / amber / orange / rose tint + a 0–100 value bar. Always expandable to its `trace`.
- **Fit score / total:** a 0–100-ish integer; the hero number on a recommended plan.
- **Win share** (horizons): "% of N simulated futures" the plan won — the hero metric on horizon tabs; pair with a distribution bar list.
- **Exposure:** mean $/yr (expected), worst $/yr (downside), **meds covered %**, **catastrophic %** (rose if elevated). Tabular numbers.
- **Confidence:** low/moderate/high chip (slate/amber/emerald) — appears on plan cards and AI horizons.
- **Provenance chip:** `patient` (sky) / `broker` (violet) on each captured fact — who entered it.
- **Plan tags:** `SCAN`/`SMG` (emerald), `competitor` (rose).
- **Reason codes:** positives render with ✓ (emerald), tradeoffs/caveats with ⚑ (amber), exclusions with ✗ (rose) — always as plain-language text, never raw codes.
- **AI badge:** a small violet "AI" chip + violet-tinted container on anything Claude-generated; never on deterministic output.
- **Reproducibility caption:** "N scenarios · seed X · reproducible" wherever a seeded computation is shown.

## 8. Interactability contract (must be wired, not faked)
Everything below must call the real backend and reflect real state — no mock data, no disabled-looking-enabled controls:
- Start session → `POST /api/sessions`; dashboard list → real `list()`.
- Broker intake submit → `POST /api/sessions/[id]/intake`; patient submit → `POST /api/intake/[token]`; live **validation** (client + server).
- Patient link **Copy** → real minted token (`POST …/intake-token`); the broker page **polls** `GET /api/sessions/[id]` and updates live on patient submit.
- All five session-analysis panels → their real GET routes (`normalized`, `health-futures`, `rules`, `simulation`); expandable traces/trajectories show real data.
- Recommendation **preference toggle** → refetch `?preference=`; **tabs** → real `recommendation` + `recommendation/horizons`; **stress-test** → `scenarios`.
- AI **Generate narrative** → real `GET …/health-future/projection` (live model call; honor loading/error/not-enabled states).
- Audit auto-save → `POST …/audit`; **Verify** → `POST /api/audit/[id]/verify` (real re-computation).
- Auth: sign in/out + signup-gating + the `next` redirect all functional.
- Every loading/empty/error state above is reachable and must be designed, not just the happy path.

## 9. Constraints & non-goals
- **No PHI in URLs** (capability tokens, not patient data); no patient facts in query strings.
- **The AI never changes the recommendation** — it interprets, in its own clearly-marked region. Don't blur the line.
- **Deterministic numbers are reproducible** — don't add client-side randomness or re-ordering that breaks the "same facts → same result" guarantee.
- **Facts-only intake** — no sentiment/preference questions in the patient/broker form beyond the controlled fields.
- **Two runtime modes** — in-memory dev (no auth) vs Supabase (auth + persistence). The UI shouldn't assume auth chrome exists in dev; gate broker identity / sign-out on the authed state.
- **Not building now:** org-admin/agency team view and invite onboarding (data model supports admin reads, but onboarding is single-broker today) — leave layout headroom, don't implement.

## 10. Build notes
- Next.js App Router + React 19 + Tailwind. Server components fetch/guard; client
  components (`"use client"`) own interactivity (forms, tabs, fetches). Keep that split.
- Existing components in `components/` are the functional baseline — they already
  implement every interaction above (forms, tabs with ARIA, panels, fetch/loading/
  error patterns, the AI on-demand panel, audit verify). Redesign their presentation;
  preserve their wiring and the endpoint/data contracts in §5/§8.
- Reuse the card/chip/pill grammar and the `ink`/`accent`/semantic-color system, or
  evolve it deliberately and globally (tokens live in `tailwind.config.ts` + `app/globals.css`).
- Keep it accessible: labelled controls, focus-visible states, ARIA on tabs (already there), keyboard paths, contrast.
```
