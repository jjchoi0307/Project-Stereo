/**
 * Resolve the signed-in broker into a BrokerContext the stores can use.
 *
 * - In memory mode (STATE_STORE != "supabase") this is a fast no-op returning
 *   null, so the store factories keep their in-memory behavior with zero I/O.
 * - In supabase mode it reads the auth user from cookies, resolves (or, on first
 *   login, provisions) the matching `brokers` row, and returns an RLS-scoped
 *   context. The provisioning uses the service-role client — the trusted server
 *   path the RLS design requires (brokers.org_id / role are never browser-set).
 *
 * SERVER-ONLY.
 */
import type { BrokerContext } from "./client";
import { serviceClient } from "./client";
import { stateStore, supabaseConfigured } from "./env";
import { getServerSupabase } from "./server";

interface BrokerRow {
  id: string;
  org_id: string;
}

export async function getBrokerContext(): Promise<BrokerContext | null> {
  if (stateStore() !== "supabase" || !supabaseConfigured()) return null;

  const client = await getServerSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const broker = await resolveBroker(user.id, user.email ?? "");
  return { client, brokerId: broker.id, orgId: broker.org_id };
}

/**
 * Find the broker row for this auth user, provisioning it on first login.
 *
 * BOOTSTRAP POLICY (revisit for the multi-agency model): a brand-new login gets
 * its OWN organization and is made `org_admin` of it. That's the right default
 * for a solo broker or a demo, but real agencies will want new brokers to JOIN
 * an existing org by invitation (role `broker`) instead — wire that here when the
 * onboarding/invite flow exists. Reads + writes go through the service-role
 * client (RLS-bypass, server-only): the trusted path for creating broker/org rows.
 */
async function resolveBroker(userId: string, email: string): Promise<BrokerRow> {
  const svc = serviceClient();

  const { data: existing } = await svc
    .from("brokers")
    .select("id,org_id")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return existing as BrokerRow;

  const orgName = email.includes("@") ? email.split("@")[1] : "Agency";
  const { data: org, error: orgErr } = await svc
    .from("organizations")
    .insert({ name: orgName })
    .select("id")
    .single();
  if (orgErr || !org) throw orgErr ?? new Error("organization provisioning failed");

  const { data: broker, error: brokerErr } = await svc
    .from("brokers")
    .insert({ id: userId, org_id: org.id, email, role: "org_admin" })
    .select("id,org_id")
    .single();
  if (brokerErr || !broker) throw brokerErr ?? new Error("broker provisioning failed");

  return broker as BrokerRow;
}
