/**
 * Supabase-backed SessionStore — implements the SAME interface as the in-memory
 * store (lib/session/store.ts), so routes/UI/engine are unchanged. Constructed
 * per-request with a broker-scoped client (RLS enforces the owner-only boundary).
 *
 * Skeleton: the mapping is complete, but it only runs once auth provides a
 * BrokerContext (see lib/supabase/client.ts) and STATE_STORE=supabase.
 */
import type { ClientProfileInput } from "@/lib/domain";
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
    const { data: s } = await this.ctx.client
      .from("sessions")
      .select("id,status,client_label,created_at")
      .eq("id", id)
      .maybeSingle();
    if (!s) return null;
    const { data: p } = await this.ctx.client
      .from("profiles")
      .select("data")
      .eq("session_id", id)
      .maybeSingle();
    logAccess({ actor: this.ctx.brokerId, action: "session.read", sessionId: id });
    return this.toSession(s as SessionRow, (p?.data as ClientProfileInput) ?? undefined);
  }

  async list(): Promise<BrokerSession[]> {
    // RLS already scopes to this broker; ordering mirrors the in-memory store.
    const { data } = await this.ctx.client
      .from("sessions")
      .select("id,status,client_label,created_at")
      .order("created_at", { ascending: false });
    logAccess({ actor: this.ctx.brokerId, action: "session.list" });
    return ((data as SessionRow[]) ?? []).map((r) => this.toSession(r));
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
      .select("id,status,client_label,created_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    logAccess({ actor: this.ctx.brokerId, action: "profile.write", sessionId: id });
    return this.toSession(data as SessionRow, profile);
  }
}
