/**
 * Cookie-based Supabase server client (@supabase/ssr). This is the broker's
 * RLS-scoped client for the App Router: it reads the auth JWT from request
 * cookies, so every query runs as the signed-in broker (auth.uid()) and the
 * owner-only policies enforce the PHI boundary. SERVER-ONLY (uses next/headers).
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export async function getServerSupabase(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Writable in Route Handlers / Server Actions; throws in a Server
        // Component render — that's fine, the middleware refreshes the session.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          /* called from a Server Component — ignore */
        }
      },
    },
  });
}
