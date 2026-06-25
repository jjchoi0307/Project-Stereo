/**
 * PHI access logging — HIPAA Security Rule §164.312(b) (Audit Controls).
 *
 * Records WHO touched WHICH patient session WHEN, so access to ePHI can be
 * examined after the fact. Events are structured, PHI-FREE (ids + action only —
 * never patient facts), and emitted to stdout; in production ship stdout to a
 * log drain / SIEM with tamper-evident retention (see SECURITY.md). A persistent,
 * queryable `access_events` table is the documented production-grade upgrade.
 *
 * Logging only happens on the persisted (supabase) path — the in-memory dev mode
 * holds no real ePHI. SERVER-ONLY.
 */
import "server-only";

export type AccessAction =
  | "session.read"
  | "session.list"
  | "session.create"
  | "session.delete"
  | "profile.write"
  | "audit.read"
  | "audit.list"
  | "audit.write"
  | "intake.token_issue"
  | "intake.resolve"
  | "intake.submit";

export interface AccessEvent {
  /** Who: broker id (auth.uid()), "patient" (capability-token path), or "system". */
  actor: string;
  action: AccessAction;
  /** Which session/patient the action targeted, when applicable. */
  sessionId?: string;
  outcome?: "ok" | "denied" | "error";
}

export function logAccess(event: AccessEvent): void {
  // Must never throw into a request path. NEVER put patient facts in here.
  try {
    console.info(
      JSON.stringify({ ts: new Date().toISOString(), kind: "phi_access", outcome: "ok", ...event }),
    );
  } catch {
    /* logging is best-effort */
  }
}
