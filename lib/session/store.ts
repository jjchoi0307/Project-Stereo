/**
 * Broker session store. A broker owns a session; the client's facts (entered by
 * the patient via a shared link, or by the broker) flow into it. The broker
 * drives the recommendation.
 *
 * v1 is an in-memory ephemeral store (lost on server restart) — durable
 * profile/CRM storage is explicitly out of scope for v1. It sits behind a
 * SessionStore interface so a Supabase-backed store can replace it later, exactly
 * like the data layer. The singleton is stashed on globalThis so it survives dev
 * HMR within a running server process.
 */

import type { ClientProfileInput } from "@/lib/domain";
import { getBrokerContext } from "@/lib/supabase/auth";
import type { BrokerContext } from "@/lib/supabase/client";
import { stateStore } from "@/lib/supabase/env";
import { SupabaseSessionStore } from "./supabaseStore";

export type SessionStatus = "awaiting_intake" | "intake_complete";

export interface BrokerSession {
  id: string;
  createdAt: string;
  status: SessionStatus;
  clientLabel?: string;
  profile?: ClientProfileInput;
}

export interface SessionStore {
  create(clientLabel?: string): Promise<BrokerSession>;
  get(id: string): Promise<BrokerSession | null>;
  list(): Promise<BrokerSession[]>;
  setProfile(id: string, profile: ClientProfileInput): Promise<BrokerSession | null>;
  /** Remove a session from the broker's list. Soft-delete in supabase mode (the
   *  audit trail is retained); hard removal in the in-memory dev store. */
  remove(id: string): Promise<void>;
}

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, BrokerSession>();

  async create(clientLabel?: string): Promise<BrokerSession> {
    const id = crypto.randomUUID().slice(0, 8);
    const session: BrokerSession = {
      id,
      createdAt: new Date().toISOString(),
      status: "awaiting_intake",
      clientLabel,
    };
    this.sessions.set(id, session);
    return session;
  }

  async get(id: string): Promise<BrokerSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async list(): Promise<BrokerSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setProfile(id: string, profile: ClientProfileInput): Promise<BrokerSession | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    session.profile = profile;
    session.status = "intake_complete";
    return session;
  }

  async remove(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

const globalForStore = globalThis as unknown as { __SMG_SESSION_STORE__?: SessionStore };

/**
 * Returns the session store. In supabase mode it resolves the signed-in broker
 * (auth.uid() → brokers row) and returns a fresh, RLS-scoped Supabase store for
 * that request; otherwise it returns the in-memory singleton. `getBrokerContext()`
 * is a fast no-op (returns null, no I/O) in memory mode, so this stays cheap and
 * backward-compatible — callers just await it.
 */
export async function getSessionStore(ctx?: BrokerContext): Promise<SessionStore> {
  const resolved = ctx ?? (await getBrokerContext()) ?? undefined;
  if (resolved && stateStore() === "supabase") {
    return new SupabaseSessionStore(resolved);
  }
  if (!globalForStore.__SMG_SESSION_STORE__) {
    globalForStore.__SMG_SESSION_STORE__ = new InMemorySessionStore();
  }
  return globalForStore.__SMG_SESSION_STORE__;
}
