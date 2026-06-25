/**
 * Persistent admin audit trail (access_events table, migration 0007) — the
 * production-grade upgrade of the stdout-only access log. Records WHO did WHAT to
 * WHICH session WHEN, plus PHI-free context (e.g. which plan was surfaced), so
 * SMG admins + security can review activity. Writes go through the service-role
 * client (append-only; clients can only read per RLS), and never throw into a
 * request path.
 *
 * SERVER-ONLY. NEVER put patient facts in `metadata` — ids + action context only.
 */
import "server-only";
import { serviceClient } from "@/lib/supabase/client";
import { stateStore, supabaseConfigured } from "@/lib/supabase/env";
import type { BrokerContext } from "@/lib/supabase/client";
import { logAccess, type AccessAction } from "@/lib/security/accessLog";

export interface AuditEventInput {
  action: AccessAction | string;
  /** Defaults to the broker id; pass "patient"/"system" for non-broker actors. */
  actor?: string;
  sessionId?: string;
  /** PHI-FREE context only (e.g. { topPlanId, topPlanName, model }). */
  metadata?: Record<string, unknown>;
  outcome?: "ok" | "denied" | "error";
  /** Org to attribute the event to when there's no broker context (patient path). */
  orgId?: string;
}

/**
 * Record one audit event. Best-effort: persists to access_events when in supabase
 * mode, and always mirrors to the structured stdout log (SIEM drain). `ctx` is the
 * resolved broker context (null in in-memory dev mode or the patient path).
 */
export async function recordEvent(ctx: BrokerContext | null, e: AuditEventInput): Promise<void> {
  const actor = e.actor ?? ctx?.brokerId ?? "system";
  // Always emit the structured stdout line (existing HIPAA audit behavior).
  logAccess({
    actor,
    action: e.action as AccessAction,
    sessionId: e.sessionId,
    outcome: e.outcome ?? "ok",
  });

  const orgId = ctx?.orgId ?? e.orgId;
  if (stateStore() !== "supabase" || !supabaseConfigured() || !orgId) return;

  try {
    await serviceClient()
      .from("access_events")
      .insert({
        org_id: orgId,
        broker_id: ctx?.brokerId ?? null,
        actor,
        action: e.action,
        session_id: e.sessionId ?? null,
        metadata: e.metadata ?? {},
        outcome: e.outcome ?? "ok",
      });
  } catch (err) {
    // Audit writes must never break the request; log PHI-free and move on.
    console.error("access_events write failed:", (err as Error)?.name, (err as Error)?.message);
  }
}

/** One audit row, as read back for the admin trail view. */
export interface AuditEventRow {
  id: string;
  created_at: string;
  actor: string;
  broker_id: string | null;
  action: string;
  session_id: string | null;
  metadata: Record<string, unknown>;
  outcome: string;
}
