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
