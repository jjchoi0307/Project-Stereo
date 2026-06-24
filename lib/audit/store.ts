/**
 * Audit record store. v1 is in-memory (globalThis singleton), behind an
 * interface so a durable Supabase/Postgres store drops in later — audit records
 * are exactly the kind of thing that becomes permanent in production.
 */

import type { AuditRecord } from "@/lib/domain";
import { getBrokerContext } from "@/lib/supabase/auth";
import type { BrokerContext } from "@/lib/supabase/client";
import { stateStore } from "@/lib/supabase/env";
import { SupabaseAuditStore } from "./supabaseStore";

export interface AuditStore {
  save(record: AuditRecord): Promise<AuditRecord>; // upsert by id
  get(id: string): Promise<AuditRecord | null>;
  list(): Promise<AuditRecord[]>;
}

class InMemoryAuditStore implements AuditStore {
  private records = new Map<string, AuditRecord>();

  async save(record: AuditRecord): Promise<AuditRecord> {
    this.records.set(record.id, record);
    return record;
  }
  async get(id: string): Promise<AuditRecord | null> {
    return this.records.get(id) ?? null;
  }
  async list(): Promise<AuditRecord[]> {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

const g = globalThis as unknown as { __SMG_AUDIT_STORE__?: AuditStore };

/**
 * Returns the audit store. In supabase mode it resolves the signed-in broker and
 * returns an RLS-scoped, append-only Supabase store; otherwise the in-memory
 * singleton. `getBrokerContext()` is a no-op (null, no I/O) in memory mode, so
 * callers just await it.
 */
export async function getAuditStore(ctx?: BrokerContext): Promise<AuditStore> {
  const resolved = ctx ?? (await getBrokerContext()) ?? undefined;
  if (resolved && stateStore() === "supabase") {
    return new SupabaseAuditStore(resolved);
  }
  if (!g.__SMG_AUDIT_STORE__) g.__SMG_AUDIT_STORE__ = new InMemoryAuditStore();
  return g.__SMG_AUDIT_STORE__;
}
