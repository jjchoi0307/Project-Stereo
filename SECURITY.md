# Security & HIPAA posture — SMG Broker Engagement Tool

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
| **(a) Access control — RLS / least privilege** | ✅ | Owner-only RLS on `sessions`/`profiles`/`audit_records` (`broker_id = auth.uid()` + `org_id = private.auth_org_id()` on writes); `org_admin` gets read-only oversight scoped to its own org via forge-proof `SECURITY DEFINER` helpers in a non-exposed `private` schema. `role`/`org_id` are never client-settable (no UPDATE policy on `brokers`). |
| **(a) Automatic logoff** | ⚠️ Partial — **configure** | Set a short Supabase JWT expiry + refresh-token rotation in the Supabase dashboard (session expiry = automatic logoff). In-app idle-timeout is a tracked enhancement (below). |
| **(a) Encryption at rest** | ⚠️ Platform | Delegated to Supabase Postgres (enable + BAA). No app-layer field encryption. |
| **(b) Audit controls** | ✅ | `lib/security/accessLog.ts` emits a structured, **PHI-free** access event (actor, action, session id, timestamp) on every persisted PHI read/write/list/token-issue/intake (instrumented in the Supabase session + audit stores and the patient path). Ship stdout to a log drain / SIEM with retention. (Persistent, queryable `access_events` table = production upgrade, tracked.) Separately, `audit_records` is an append-only recommendation-reproducibility log. |
| **(c) Integrity** | ✅ / ⚠️ | `audit_records` is append-only at the DB (no UPDATE/DELETE policy) and re-verifiable (`/api/audit/[id]/verify`). Profile integrity hashing + real `facts_version` are tracked follow-ups. |
| **(d) Person/entity authentication** | ✅ | Supabase password auth; JWT **server-verified** via `getUser()` on every request (middleware + context). MFA = Supabase config (operational). |
| **(e) Transmission security** | ✅ / ⚠️ | TLS at the host (platform); enforced by **HSTS** + full security-header set + CSP (`next.config.mjs`). PHI never in URLs (capability tokens, not ids); only **de-identified** facts sent to the LLM (`lib/sim/deidentify.ts`). |
| **§164.308(a)(4) Access establishment** | ✅ | Self-signup is **off by default** (`ALLOW_SIGNUP`); production provisions brokers deliberately (invite flow is the tracked successor to the bootstrap). |

## Application hardening (defense-in-depth)
- **Security headers + CSP** on every response (`next.config.mjs`); `X-Powered-By` removed.
- **CSRF**: cross-origin state-changing API requests rejected at the edge (`middleware.ts`), plus Supabase `SameSite` cookies.
- **`server-only`** guards on every service-role / secret-holding module — a client import becomes a build error.
- **De-identification** whitelist for the one LLM call; output is `notForAudit` and never re-enters the engine (invariant #6).
- **Capability tokens** for patient self-entry: 122-bit random, 48h TTL, **single-use** (burned on submit); the write derives tenancy columns only from the server-resolved row, never client input.
- **Error redaction**: raw DB errors are logged server-side, never returned to clients; no PHI in logs or URLs.
- **Determinism / no-LLM-in-data-path** keeps the recommendation auditable and reproducible.

## Operational requirements (NOT code — required before real PHI)
- [ ] **BAA** signed with **Vercel** (Enterprise) **and Supabase**. Until then: synthetic data only.
- [ ] **TLS** enforced at the host; **encryption at rest** enabled on Supabase.
- [ ] **Edge rate limiting / WAF** on the public surfaces (`/api/intake/[token]`, `/login`) — brute-force / abuse protection. *Not implemented in app code* (serverless needs a distributed limiter); do it at Vercel/WAF or an Upstash-backed limiter.
- [ ] **MFA** for brokers (Supabase Auth).
- [ ] **Automatic logoff** configured (short JWT expiry + refresh rotation).
- [ ] **Backups / PITR** (Supabase) + a tested restore.
- [ ] **Data retention & disposal** policy + a purge procedure (with a documented exception for the immutable `audit_records`).
- [ ] **Log retention + monitoring/alerting** on the access-event stream (SIEM).
- [ ] **Risk analysis, written policies, workforce training, breach-response plan, access reviews.**

## Tracked code follow-ups
- In-app idle auto-logoff (last-activity cookie in middleware).
- Profile integrity hash / version chain + thread the real `facts_version`.
- Persistent, queryable `access_events` table (vs. log-drain only).
- Invite-based onboarding (replace the bootstrap org_admin self-provisioning).
- Nonce-based strict CSP (drop `'unsafe-inline'`).
- `postcss` moderate advisory (build-time transitive via Next; not on the PHI runtime path) — clears on a Next patch bump.

## Reporting
Report suspected vulnerabilities privately to the maintainer; do not open public issues for security reports.
