/**
 * Supabase clients for the two server-side access paths (see ARCHITECTURE.md →
 * "the two-client model"). Both are SERVER-ONLY — never import this from a client
 * component, and never expose the service-role key to the browser.
 *
 * Skeleton note: this uses @supabase/supabase-js (already a dependency). The
 * cookie-based broker session (reading the JWT from request cookies via
 * @supabase/ssr + Next middleware) is the auth-wiring follow-up; for now a broker
 * client is built from an access token the route already has.
 */
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL } from "./env";

/**
 * RLS-SCOPED client for an authenticated broker. Every query runs as the broker
 * (auth.uid()), so the owner-only policies enforce the PHI boundary. Pass the
 * broker's access token (JWT) obtained from the session/cookies.
 */
export function brokerClient(accessToken: string): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/**
 * SERVICE-ROLE client — bypasses RLS. Use ONLY on the server, and ONLY for the
 * narrow patient-intake capability path (validate sessions.intake_token, then
 * write that one profile). Never for broker-driven reads/writes.
 */
export function serviceClient(): SupabaseClient {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A broker's access role: own clients only; org-wide oversight; read-only monitor. */
export type BrokerRole = "broker" | "org_admin" | "security";

/** Identity a broker-scoped store needs (resolved from auth + the brokers table). */
export interface BrokerContext {
  client: SupabaseClient;
  brokerId: string;
  orgId: string;
  role: BrokerRole;
}
