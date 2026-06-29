# WORKFLOW.md — the broker journey (clarity contract)

How the broker moves through the tool, end to end. Every screen must make
**"where am I, what just happened, what's next"** obvious. Read alongside
`DESIGN.md` (the SMG visual system) and `UX_BRIEF.md`. Presentation/guidance only
— never change endpoints, validation, or data contracts.

## The canonical journey
```
Sign up ─▶ Sign in ─▶ Dashboard ─▶ Start session ─▶ ① Capture facts
                                                       │  (broker form  OR  secure member link)
                                                       ▼
                                                    ② Clinical read  ──▶ ③ Recommendation ──▶ ④ On record
                                                    (review + correct)    (today / horizons)     (audit + verify)
```

## Shared device: the 4-step Stepper (`components/ui/Stepper.tsx`)
Steps: **① Capture facts · ② Clinical read · ③ Recommendation · ④ On record.**
- Shows on `/session/[id]` (steps 1–2), `/session/[id]/recommendation` (step 3),
  and the audit record (step 4).
- Completed steps link back; current is highlighted; upcoming is muted. SMG green
  for done/current. `aria-current="step"`.

## Stage requirements
**0 · Sign up / Sign in** (`/signup`, `/login`)
- Sign up: state plainly what an account is — *"your private workspace; your
  clients and audit records are visible only to you."* Show a compact **"How it
  works"** (Capture facts → Get a ranked recommendation → Save a reproducible
  record). Email-confirmation path handled. Sign-in reassurance line.

**Dashboard** (`/`) — the cockpit (already built)
- **First run (no sessions):** lead with a friendly "Start your first client
  session" and the 3-step "How it works"; hide the empty stat noise.
- Otherwise: pipeline stats + "Needs your attention" + recent recommendations.
- Primary action everywhere: **Start new client session**.

**① Capture facts** (`/session/[id]`, status `awaiting_intake`)
- Show the Stepper at step 1. Make the **two capture paths explicit and equal**:
  *Enter the facts yourself* (broker form) — or — *Send the member a secure link*
  (mint token, copy/share; live "waiting for the member…" with a pulsing **red**
  indicator; auto-advances when they submit).
- On submit: facts **saved** to the session → clear confirmation → advance to ②.

**② Clinical read** (`/session/[id]`, status `intake_complete`)
- Stepper at step 2. Captured facts (with provenance) + risk markers + health
  futures + plan screening + simulation. A clear **"Continue to recommendation →"**
  primary CTA, and a secondary **"Correct facts"** (re-opens the form prefilled;
  resubmit merges provenance — make the save/merge obvious).

**③ Recommendation** (`/session/[id]/recommendation`)
- Stepper at step 3. Today / horizon tabs. **"Present to member"** secondary.
- On view it auto-saves to the audit record (the seal record strip already shows
  "on record · re-verifiable").

**④ On record** (`/audit/[id]`)
- Stepper at step 4 (complete). The immutable certificate + **Verify** seal.

## Save semantics (be explicit)
- Intake submit = the save action; disable while saving; confirm on success.
- "Correct facts" = edit + resubmit; preserves original provenance, attributes
  changed fields to the corrector. The UI should say facts were updated.
- The recommendation is snapshotted to the audit record automatically on view.
