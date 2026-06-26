/**
 * Next.js instrumentation hook — runs once at server startup.
 *
 * Fail CLOSED in production. The whole access-control story (auth, RLS, per-broker
 * data isolation) hinges on STATE_STORE=supabase: in "memory" mode middleware skips
 * auth and every visitor shares one unauthenticated, globally-scoped in-memory
 * store. That is the right default for local dev, but a missing/mistyped env var in
 * production would silently serve PHI with no safeguards. So in production we refuse
 * to start unless Supabase persistence is actually configured — a misconfiguration
 * becomes a hard boot failure (visible) instead of a silent open fallback.
 *
 * Dev/test are unaffected (they intentionally run on the in-memory store).
 */
export async function register() {
  // Only the Node.js server runtime owns the stores; skip the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const isProduction =
    process.env.VERCEL_ENV === "production" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview" && process.env.VERCEL_ENV !== "development");
  if (!isProduction) return;

  const { stateStore, supabaseConfigured } = await import("@/lib/supabase/env");
  if (stateStore() !== "supabase" || !supabaseConfigured()) {
    throw new Error(
      "FATAL: production boot blocked. This app handles patient clinical facts (PHI) under HIPAA and " +
        "requires STATE_STORE=supabase with Supabase configured (NEXT_PUBLIC_SUPABASE_URL + " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY). The in-memory fallback is UNAUTHENTICATED and globally shared, " +
        "so serving it in production would expose every session to every visitor. Refusing to start.",
    );
  }
}
