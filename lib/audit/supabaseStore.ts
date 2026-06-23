/**
 * Supabase-backed AuditStore — same interface as the in-memory store
 * (lib/audit/store.ts). Audit rows are append-only at the DB level (the
 * migration grants no UPDATE/DELETE policy); `save` upserts by id so re-viewing
 * the same facts-version is idempotent rather than duplicative.
 *
 * Skeleton: runs once auth provides a BrokerContext and STATE_STORE=supabase.
 */
import type { AuditRecord } from "@/lib/domain";
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
      { onConflict: "id" },
    );
    if (error) throw error;
    return record;
  }

  async get(id: string): Promise<AuditRecord | null> {
    const { data } = await this.ctx.client
      .from("audit_records")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    return (data?.payload as AuditRecord) ?? null;
  }

  async list(): Promise<AuditRecord[]> {
    const { data } = await this.ctx.client
      .from("audit_records")
      .select("payload")
      .order("created_at", { ascending: false });
    return ((data as { payload: AuditRecord }[]) ?? []).map((r) => r.payload);
  }
}
