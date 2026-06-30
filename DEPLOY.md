# Deploy — SMG Broker Engagement Tool

The rollout's final step (ARCHITECTURE.md §2, step 6). The app is feature-complete
and runs fully in-memory with auth off by default; deploying means turning on the
Supabase persistence + auth spine in a hosted environment. Most of this is yours
to execute — it needs accounts and a signed agreement that can't be automated.

## ⚠️ Before anything: PHI / BAA
This app stores **PHI** (patient profiles). The host must be covered by a **Business
Associate Agreement**:
- **Vercel:** a BAA is available on Enterprise — confirm it's in place before sending
  real patient data. Until then, deploy with **synthetic data only**.
- **Supabase:** sign Supabase's BAA (available on paid plans) for the project that
  holds the PHI tables.
Do not put real PHI in any environment not covered by both.

## Prerequisites
- The Supabase project is already migrated (0001–0003 applied; RLS live, advisors clean).
- A Vercel project linked to the GitHub repo (`jjchoi0307/Project-Stereo`).

## Environment variables (set in Vercel project settings)
| Var | Value | Notes |
|---|---|---|
| `STATE_STORE` | `supabase` | **Turns on persistence AND auth.** Omit/`memory` = in-memory, no auth. |
| `DATA_STORE` | `fixtures` | Reference data stays bundled + git-versioned. |
| `NEXT_PUBLIC_SUPABASE_URL` | project URL | Safe in the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/publishable key | Safe in the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key | **Server-only** — never `NEXT_PUBLIC_`. Used only for first-login provisioning + the patient capability path. |
| `ANTHROPIC_API_KEY` | Claude key | Server-only. Enables the AI health-future narrative; app works without it (button shows "not enabled"). |
| `SIM_MODEL` | _(optional)_ | Defaults to `claude-opus-4-8`. |

## Supabase auth settings
- **Email confirmation:** new projects default to "Confirm email" ON. Either keep it
  (brokers confirm via email before first sign-in) or disable it under
  *Authentication → Sign In / Providers* for a frictionless first login. Sign-up
  returns no session until confirmed.
- **Site URL / redirect URLs:** set to the deployed origin so auth emails link back correctly.

## First broker
Onboarding is currently a **bootstrap**: the first time a broker signs in, their
organization + `brokers` row are auto-provisioned (they become `org_admin` of their
own org). To create the first account: visit `/login` on the deployed site →
**Create account**. (Invite-based joining for multi-agency is the documented next step —
ARCHITECTURE.md §2 "Auth provisioning — bootstrap policy to revisit".)

## Hosting notes
- **`maxDuration`:** the AI projection route (`/api/sessions/[id]/health-future/projection`)
  and the horizons route declare `maxDuration = 120`. Confirm the Vercel plan allows
  that function duration (Hobby caps lower); the projection's adaptive-thinking call
  can run ~30s.
- The app is all dynamic (`force-dynamic`) server rendering — no static export concerns.

## Scaling (~1000 brokers)

Steady state is cheap — every AI result is cached per facts-version, so a member is
computed once and re-served until their intake changes. The pressure is the
**cold-load burst**: each first view fans out the Today ensemble + both horizon
ensembles, ~30–45 model calls. Guidance:

- **Concurrency cap (in code):** `RLM_MAX_CONCURRENCY` (default 6) caps concurrent
  Anthropic calls **per serverless instance** — a burst queues instead of
  stampeding. Tune it to your Anthropic tier ÷ expected concurrent instances.
- **Anthropic tier:** size the account's requests/min + tokens/min to the expected
  concurrent cold loads (enrollment-season bursts, not the daily average). The
  per-instance cap + the SDK's retry/backoff are the in-app guard; the account rate
  limit is the real ceiling.
- **Supabase:** enable connection pooling (PgBouncer / Supavisor) — many short
  RLS-scoped queries per request — and size the plan for the `horizon_cache` write
  throughput (see `supabase/migrations/0006`).
- **Vercel:** the recommendation route holds a function for the duration of the
  ensemble (`maxDuration` up to 300s). Confirm the plan's concurrent-function limit
  covers peak; consider lazy-loading horizons (compute only when the broker opens the
  3y/5y view) so a Today view doesn't pay for horizons it may not show.

## Pre-deploy checklist
- [ ] **Work through `SECURITY.md` → "Operational requirements"** (the HIPAA items code can't satisfy: rate limiting/WAF, MFA, automatic logoff, backups, retention/disposal, log monitoring, risk analysis/policies/training).
- [ ] BAAs in place (Vercel + Supabase) **before** any real PHI.
- [ ] All env vars set (table above); `SUPABASE_SERVICE_ROLE_KEY` not exposed to the client.
- [ ] Supabase Site URL / redirect URLs point at the deployed origin.
- [ ] `npm run build` green locally (CI optional).
- [ ] Smoke test on the deployment: create account → start session → broker intake →
      recommendation (Today/5y/10y) → generate AI narrative → audit record persists →
      sign out → confirm another account can't see the first's sessions (RLS).
- [ ] Patient link: open `/intake/[token]` from a logged-out browser, submit, confirm
      it lands on the broker's session.
