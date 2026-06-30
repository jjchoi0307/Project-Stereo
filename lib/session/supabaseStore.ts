/**
 * Supabase-backed SessionStore — implements the SAME interface as the in-memory
 * store (lib/session/store.ts), so routes/UI/engine are unchanged. Constructed
 * per-request with a broker-scoped client (RLS enforces the owner-only boundary).
 *
 * Skeleton: the mapping is complete, but it only runs once auth provides a
 * BrokerContext (see lib/supabase/client.ts) and STATE_STORE=supabase.
 */
import type { ClientProfileInput } from "@/lib/domain";
import { parseProfileRow } from "./parseProfileRow";
import { logAccess } from "@/lib/security/accessLog";
import type { BrokerContext } from "@/lib/supabase/client";
import type { BrokerSession, SessionStore } from "./store";

interface SessionRow {
  id: string;
  status: BrokerSession["status"];
  client_label: string | null;
  created_at: string;
}

export class SupabaseSessionStore implements SessionStore {
  constructor(private readonly ctx: BrokerContext) {}

  private toSession(row: SessionRow, profile?: ClientProfileInput): BrokerSession {
    return {
      id: row.id,
      createdAt: row.created_at,
      status: row.status,
      clientLabel: row.client_label ?? undefined,
      profile,
    };
  }

  async create(clientLabel?: string): Promise<BrokerSession> {
    const { data, error } = await this.ctx.client
      .from("sessions")
      .insert({ broker_id: this.ctx.brokerId, org_id: this.ctx.orgId, client_label: clientLabel ?? null })
      .select("id,status,client_label,created_at")
      .single();
    if (error || !data) throw error ?? new Error("session insert failed");
    logAccess({ actor: this.ctx.brokerId, action: "session.create", sessionId: (data as SessionRow).id });
    return this.toSession(data as SessionRow);
  }

  async get(id: string): Promise<BrokerSession | null> {
    // RLS (session_owner / session_org_admin_read) already scopes the row; the
    // explicit org_id filter is defense-in-depth on the most sensitive read path,
    // mirroring SupabaseAuditStore so a misconfigured/absent policy can't widen
    // reads across tenants. org_id (not broker_id) keeps org_admin oversight working.
    const { data: s } = await this.ctx.client
      .from("sessions")
      .select("id,status,client_label,created_at")
      .eq("id", id)
      .eq("org_id", this.ctx.orgId)
      .maybeSingle();
    if (!s) return null;
    const { data: p } = await this.ctx.client
      .from("profiles")
      .select("data")
      .eq("session_id", id)
      .eq("org_id", this.ctx.orgId)
      .maybeSingle();
    logAccess({ actor: this.ctx.brokerId, action: "session.read", sessionId: id });
    return this.toSession(s as SessionRow, parseProfileRow(p?.data));
  }

  async list(): Promise<BrokerSession[]> {
    // RLS already scopes to this broker; ordering mirrors the in-memory store.
    // Soft-deleted sessions are hidden from the broker's list (audit trail kept).
    const { data } = await this.ctx.client
      .from("sessions")
      .select("id,status,client_label,created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    logAccess({ actor: this.ctx.brokerId, action: "session.list" });
    return ((data as SessionRow[]) ?? []).map((r) => this.toSession(r));
  }

  async remove(id: string): Promise<boolean> {
    // Soft-delete: the audit_records → sessions FK is no-cascade and the audit
    // trail must persist, so we mark the session deleted (owner UPDATE policy)
    // rather than hard-deleting. It drops out of list() but its audit stays.
    // .select() returns the affected rows: the owner UPDATE policy (broker_id =
    // auth.uid()) matches 0 rows for a non-owner (e.g. an org_admin who can READ
    // the session via oversight but not delete it), so we report not-removed
    // instead of a misleading success.
    const { data, error } = await this.ctx.client
      .from("sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", this.ctx.orgId)
      .select("id");
    if (error) throw error;
    const removed = (data?.length ?? 0) > 0;
    if (removed) logAccess({ actor: this.ctx.brokerId, action: "session.delete", sessionId: id });
    return removed;
  }

  async setProfile(id: string, profile: ClientProfileInput): Promise<BrokerSession | null> {
    const { error: pErr } = await this.ctx.client.from("profiles").upsert(
      {
        session_id: id,
        broker_id: this.ctx.brokerId,
        org_id: this.ctx.orgId,
        captured_by: profile.capturedBy,
        data: profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    );
    if (pErr) throw pErr;
    const { data, error } = await this.ctx.client
      .from("sessions")
      .update({ status: "intake_complete", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("org_id", this.ctx.orgId)
      .select("id,status,client_label,created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    logAccess({ actor: this.ctx.brokerId, action: "profile.write", sessionId: id });
    return this.toSession(data as SessionRow, profile);
  }
}
