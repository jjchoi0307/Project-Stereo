/**
 * Persistent cache for the deterministic horizon recommendation payload.
 *
 * The horizon compute is heavy (nested simulations) but a pure function of the
 * captured facts + engine/data version, so the shaped response is safe to store
 * and replay. On serverless (Vercel) the in-memory cache doesn't survive cold
 * starts / instance changes — this DB-backed cache makes the 5yr/10yr tabs
 * compute once and load instantly thereafter, across every instance.
 *
 * SERVER-ONLY. Read/written via the service-role client; the route that uses it
 * has already authorized the session (the key is namespaced by session id).
 */
import "server-only";
import { serviceClient } from "@/lib/supabase/client";
import { stateStore, supabaseConfigured } from "@/lib/supabase/env";

const enabled = () => stateStore() === "supabase" && supabaseConfigured();

export async function getHorizonPayload(key: string): Promise<unknown | null> {
  if (!enabled()) return null;
  try {
    const { data } = await serviceClient()
      .from("horizon_cache")
      .select("payload")
      .eq("key", key)
      .maybeSingle();
    return data?.payload ?? null;
  } catch {
    return null; // cache is best-effort — never block the recommendation on it
  }
}

export async function setHorizonPayload(key: string, payload: unknown): Promise<void> {
  if (!enabled()) return;
  try {
    await serviceClient().from("horizon_cache").upsert({ key, payload });
  } catch {
    /* best-effort */
  }
}

/**
 * Drop every cached AI payload for a session — the recommendation, the horizon
 * projection, and the clinical read. Called whenever a session's facts are
 * (re)written so a broker who corrects the intake ALWAYS gets a freshly computed
 * result, never a pre-edit cache. This is belt-and-suspenders on top of the
 * content-keyed cache (factsSignature): it also closes any gap where an edited
 * field isn't part of the signature, and prunes the now-orphaned old-signature
 * rows so the table doesn't grow unbounded.
 *
 * Every key is `${kind}:${sessionId}:${factsSignature}:…`, so matching the
 * `:${sessionId}:` segment scopes the delete to exactly this session's rows.
 * Session ids are UUIDs (no LIKE metacharacters), so no escaping is needed.
 */
export async function invalidateSessionCache(sessionId: string): Promise<void> {
  if (!enabled()) return;
  try {
    await serviceClient().from("horizon_cache").delete().like("key", `%:${sessionId}:%`);
  } catch {
    /* best-effort — a stale row is corrected by the content-keyed miss anyway */
  }
}
