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
import "server-only";
import { cache } from "react";
import type { BrokerContext } from "./client";
import { serviceClient } from "./client";
import { stateStore, supabaseConfigured } from "./env";
import { getServerSupabase } from "./server";

interface BrokerRow {
  id: string;
  org_id: string;
}

/**
 * Resolve the signed-in broker. Wrapped in React `cache()` so it runs at most
 * once per request even though several store factories call it — without this,
 * an audit POST resolved auth (cookie read + getUser + brokers select) 2-3×.
 */
export const getBrokerContext = cache(async (): Promise<BrokerContext | null> => {
  if (stateStore() !== "supabase" || !supabaseConfigured()) return null;

  const client = await getServerSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const broker = await resolveBroker(user.id, user.email ?? "");
  return { client, brokerId: broker.id, orgId: broker.org_id };
});

/**
 * Find the broker row for this auth user, provisioning it on first login.
 *
 * ACCESS MODEL (single SMG org): a first login JOINS the SMG organization. Role
 * is `broker` by default — self-signup (gated by ALLOW_SIGNUP) only ever mints
 * brokers. Org admins are added BY HAND: list their email in ORG_ADMIN_EMAILS, or
 * set role='org_admin' on their brokers row directly. Reads + writes go through
 * the service-role client (RLS-bypass, server-only): the trusted provisioning path.
 */
function adminEmails(): Set<string> {
  return new Set(
    (process.env.ORG_ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** The one SMG org all brokers join. SMG_ORG_ID pins it; falls back to the sole org. */
async function defaultOrgId(svc: ReturnType<typeof serviceClient>): Promise<string> {
  const pinned = process.env.SMG_ORG_ID?.trim();
  if (pinned) return pinned;
  const { data } = await svc.from("organizations").select("id");
  if (data && data.length === 1) return data[0].id as string;
  throw new Error("SMG_ORG_ID is not set and the organization is ambiguous");
}

async function resolveBroker(userId: string, email: string): Promise<BrokerRow> {
  const svc = serviceClient();

  const { data: existing } = await svc
    .from("brokers")
    .select("id,org_id")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return existing as BrokerRow;

  // First login → join the SMG org. Admin only if explicitly allowlisted by hand.
  const orgId = await defaultOrgId(svc);
  const role = adminEmails().has(email.toLowerCase()) ? "org_admin" : "broker";

  const { data: broker, error: brokerErr } = await svc
    .from("brokers")
    .insert({ id: userId, org_id: orgId, email, role })
    .select("id,org_id")
    .single();
  if (brokerErr || !broker) {
    // Two concurrent first-logins can both pass the existence check above; the
    // loser's insert conflicts on the PK. Re-fetch before failing.
    const { data: raced } = await svc.from("brokers").select("id,org_id").eq("id", userId).maybeSingle();
    if (raced) return raced as BrokerRow;
    throw brokerErr ?? new Error("broker provisioning failed");
  }

  return broker as BrokerRow;
}
