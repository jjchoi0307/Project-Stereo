/**
 * Supabase environment + config gate. The app still runs entirely on in-memory
 * stores when these are unset (local dev / current default), so nothing here is
 * required until the persistence spine is switched on via DATA_STORE/STATE_STORE.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
/** Server-only. NEVER referenced from client components. */
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** True once the Supabase project is wired up. Used by the store factories. */
export function supabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Whether PHI state should persist to Supabase ("supabase") or stay in-memory. */
export function stateStore(): "memory" | "supabase" {
  return process.env.STATE_STORE === "supabase" ? "supabase" : "memory";
}
