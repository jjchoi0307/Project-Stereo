# Security & HIPAA posture — SMG Broker Plan Recommender

This app stores **ePHI** (patient clinical profiles). This document maps the
**technical** controls implemented in code to the HIPAA Security Rule, and — just
as important — states plainly what the code **cannot** do, which is the
organizational program you must run around it.

> **Honest framing:** HIPAA compliance is mostly organizational (BAAs, risk
> analysis, written policies, workforce training, breach response, access
> reviews). Code can satisfy the **technical safeguards** (§164.312) and harden
> the app; it cannot make an organization compliant. Treat §"Operational
> requirements" below as a hard gate before real PHI.

## Load-bearing mode switch
Safeguards are active **only** when `STATE_STORE=supabase`. The default
`STATE_STORE=memory` runs with **no auth, no RLS, no gating** (middleware no-ops)
and holds no real data — it's for local dev. **Never point real PHI at an
instance that isn't in supabase mode.** (`DEPLOY.md` gates on this.)

## Technical safeguards (45 CFR §164.312) — how they're met in code

| Safeguard | Status | Implementation |
|---|---|---|
| **(a) Access control — unique user id** | ✅ | Every actor is a Supabase Auth user; `brokers.id == auth.uid()`; all PHI rows carry `broker_id`/`org_id`. |
| **(a) Access control — RLS / least privilege** | ✅ | Owner-only RLS on `sessions`/`profiles`/`audit_records` (`broker_id = auth.uid()` + `org_id = private.auth_org_id()` on writes); `org_admin` gets read-only oversight scoped to its own org via forge-proof `SECURITY DEFINER` helpers in a non-exposed `private` schema. `role`/`org_id` are never client-settable (no UPDATE policy on `brokers`). **Defense-in-depth:** the session/profile and audit reads also carry an explicit `org_id` filter in code, so a misconfigured/absent policy can't widen reads across tenants. |
| **(a) Automatic logoff** | ⚠️ Partial — **configure** | Set a short Supabase JWT expiry + refresh-token rotation in the dashboard (session expiry = automatic logoff). In-app idle-timeout is a tracked enhancement. |
| **(a) Encryption at rest** | ⚠️ Platform | Delegated to Supabase Postgres (enable + BAA). No app-layer field encryption. |
| **(b) Audit controls** | ✅ | `lib/security/accessLog.ts` emits a structured, **PHI-free** access event (actor, action, session id, timestamp) on every persisted PHI read/write/list/token-issue/intake (including token *reuse*). Ship stdout to a log drain / SIEM with retention. Separately, `audit_records` is an append-only recommendation-reproducibility log. |
| **(c) Integrity** | ✅ | `audit_records` is append-only at the DB (no UPDATE/DELETE policy). Each record is **tamper-evident**: an HMAC-SHA256 over its canonical content (AI recommendation, citations, PHI snapshot, ranking, versions), keyed by a server-held secret (`AUDIT_HMAC_KEY`), is verified by `/api/audit/[id]/verify` — which also **re-runs the deterministic engine** (seed + ranking) and **pins to the recorded data/engine version** (a version mismatch is surfaced distinctly, never as a false tamper). Degrades safely to reproducibility-only when no key is set. |
| **(d) Person/entity authentication** | ✅ | Supabase password auth; JWT **server-verified** via `getUser()` on every request (middleware + context). A provisioning failure can never crash a page (fails closed to the public surface). MFA = Supabase config (operational). |
| **(e) Transmission security** | ✅ | TLS at the host; enforced by **HSTS** + a full security-header set + a **strict CSP** (`middleware.ts`). PHI never in URLs (capability tokens, not ids); only **de-identified** facts are sent to the LLM (`lib/sim/deidentify.ts`). |
| **§164.308(a)(4) Access establishment** | ✅ | Self-signup is **off by default** (`ALLOW_SIGNUP`); production provisions brokers deliberately (invite flow is the tracked successor to the bootstrap). |

## Application hardening (defense-in-depth)

**Headers / CSP (`middleware.ts`)**
- Production **script CSP uses a per-request nonce + `strict-dynamic`** — no `unsafe-inline`, so an injected inline `<script>` cannot execute. Dev keeps `unsafe-inline`/`unsafe-eval` for Fast Refresh only.
- HSTS, `frame-ancestors 'none'` / `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` lockdown; `X-Powered-By` removed; production source maps off.
- The only CSP relaxation is one image CDN + one trusted frame origin for the YouTube showcase (cannot execute code in our context).

**CSRF**
- Cross-origin **state-changing** API requests rejected at the edge (Origin/Host + Fetch-Metadata), plus Supabase `SameSite` cookies.
- **Write-bearing GETs** (recommendation / horizons / audit-verify — they upsert caches, write audit/access events, and trigger expensive AI runs) also reject clearly cross-site requests, so they can't be CSRF-triggered against a logged-in broker.

**AI boundary (the recommendation is AI-powered, but bounded by code)**
- **Eligibility is a deterministic gate upstream of every model call** — an ineligible plan can never be recommended (code-enforced, not a prompt instruction); the model only reorders the eligible set, and invented plan ids are discarded.
- **Carrier-blind model input** — plans are ranked as opaque tokens (no carrier/name/source), so the ranking cannot encode carrier preference (proven by `scripts/test-neutrality.ts`).
- **Citations are server-pinned** (the model never supplies provenance) and quote-grounded against the plan's own facts.
- **The displayed annual cost is computed deterministically** from grounded plan facts + the member's reported utilization (`lib/ai/costCalc.ts`) — the model never produces a dollar figure (covered cost-share caps at the OOP-max; uncovered exposure is uncapped). A run with no grounded write-up **fails retryable + uncached** rather than presenting ungrounded numbers.
- Only **de-identified** facts are sent to the model on every AI path (recommendation, clinical read, horizons); patient-typed free text never leaves the process.

**Other**
- **`server-only`** guards on every service-role / secret-holding module — a client import becomes a build error.
- **Capability tokens** for patient self-entry: 122-bit random, 48h TTL, **single-use** — the burn is the *consumption gate* (a concurrent replay updating zero rows is rejected), and the write derives tenancy columns only from the server-resolved row, never client input.
- **Error redaction**: raw DB / internal errors are logged server-side, never returned to clients; no PHI in logs or URLs; the model id is kept out of client payloads.
- **Abuse/availability at scale**: a per-instance concurrency cap on model calls (`RLM_MAX_CONCURRENCY`) keeps a cold-load burst from stampeding the provider (not a substitute for an edge rate limiter — see Operational).
- **Third-party telemetry** (Vercel Analytics / Speed Insights) is scoped to the **public pages only** — never the authenticated PHI workspace or the patient intake link; both beacon same-origin and record route patterns, not identifiers.

## Operational requirements (NOT code — required before real PHI)
- [ ] **BAA** signed with **Vercel** (Enterprise) **and Supabase** (Team + HIPAA add-on). Until then: synthetic data only. *(If Vercel Enterprise is cost-prohibitive, self-host on a BAA-covered cloud.)*
- [ ] **TLS** enforced at the host; **encryption at rest** + **PITR backups** enabled on Supabase, with a tested restore.
- [ ] **Edge rate limiting / WAF** on the public surfaces (`/api/intake/[token]`, `/login`). *Not in app code* (serverless needs a distributed limiter); do it at Vercel/WAF or an Upstash-backed limiter.
- [ ] **MFA** for brokers (Supabase Auth).
- [ ] **Automatic logoff** configured (short JWT expiry + refresh rotation).
- [ ] **Supabase Auth URL config** (Site URL + redirect allow-list) point at the production origin (invite/confirmation emails); custom SMTP for email volume.
- [ ] **`AUDIT_HMAC_KEY`** set in production (activates audit tamper-evidence).
- [ ] **Data retention & disposal** policy + purge procedure (documented exception for the immutable `audit_records`).
- [ ] **Log retention + monitoring/alerting** on the access-event stream (SIEM).
- [ ] **Risk analysis, written policies, workforce training, breach-response plan, access reviews.**

## Tracked code follow-ups
- In-app idle auto-logoff (last-activity cookie in middleware).
- **Invite accept + set-password flow** (`/auth/confirm` via `verifyOtp`) to replace the bootstrap org_admin self-provisioning.
- Persistent, queryable `access_events` table (vs. log-drain only).
- Bind citation-number grounding to the semantic field (close cross-field numeric collisions).
- Consolidate de-identification into one shared module across the clinical-read and recommendation paths.
- Calibrate simulation priors / scoring weights against claims data + a documented sensitivity study.
- Add a deterministic backbone/audit for the 3y/5y horizons (parity with the Today path).

## Reporting
Report suspected vulnerabilities privately to the maintainer; do not open public issues for security reports.
