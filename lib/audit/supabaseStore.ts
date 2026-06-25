/**
 * Supabase-backed AuditStore — same interface as the in-memory store
 * (lib/audit/store.ts). Audit rows are append-only at the DB level (the
 * migration grants no UPDATE/DELETE policy); `save` upserts by id so re-viewing
 * the same facts-version is idempotent rather than duplicative.
 *
 * Skeleton: runs once auth provides a BrokerContext and STATE_STORE=supabase.
 */
import type { AuditRecord } from "@/lib/domain";
import { recordEvent } from "./eventStore";
import type { BrokerContext } from "@/lib/supabase/client";
import type { AuditStore } from "./store";

/** sessionId is encoded in the profile id as `profile-<sessionId>`. */
function sessionIdOf(record: AuditRecord): string {
  return record.profileSnapshot.id.replace(/^profile-/, "");
}

export class SupabaseAuditStore implements AuditStore {
  constructor(private readonly ctx: BrokerContext) {}

  async save(record: AuditRecord): Promise<AuditRecord> {
    const { error } = await this.ctx.client.from("audit_records").upsert(
      {
        id: record.id,
        session_id: sessionIdOf(record),
        broker_id: this.ctx.brokerId,
        org_id: this.ctx.orgId,
        facts_version: 1, // TODO: thread the session's real facts_version through the engine run
        data_version: record.dataVersion ?? "unknown",
        engine_version: record.engineVersion ?? "unknown",
        payload: record,
      },
      // ON CONFLICT DO NOTHING — audit rows are append-only (no UPDATE RLS policy),
      // so re-viewing the same facts-version (same id) must NOT take the upsert's
      // update path (that hits the policy's USING check → 403). The record is
      // deterministic by id, so skipping a duplicate is correct & idempotent.
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw error;
    await recordEvent(this.ctx, { action: "audit.write", sessionId: sessionIdOf(record) });
    return record;
  }

  async get(id: string): Promise<AuditRecord | null> {
    // Defense-in-depth: scope to the broker's org (and broker) in addition to
    // RLS, so a misconfigured/absent policy can't widen reads across tenants.
    const { data } = await this.ctx.client
      .from("audit_records")
      .select("payload")
      .eq("id", id)
      .eq("org_id", this.ctx.orgId)
      .eq("broker_id", this.ctx.brokerId)
      .maybeSingle();
    const record = (data?.payload as AuditRecord) ?? null;
    if (record) await recordEvent(this.ctx, { action: "audit.read", sessionId: sessionIdOf(record) });
    return record;
  }

  async list(): Promise<AuditRecord[]> {
    const { data } = await this.ctx.client
      .from("audit_records")
      .select("payload")
      .eq("org_id", this.ctx.orgId)
      .eq("broker_id", this.ctx.brokerId)
      .order("created_at", { ascending: false });
    await recordEvent(this.ctx, { action: "audit.list" });
    return ((data as { payload: AuditRecord }[]) ?? []).map((r) => r.payload);
  }
}
