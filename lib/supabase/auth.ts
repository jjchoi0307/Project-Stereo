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

  const broker = await resolveBroker(user.id, user.email ?? "", {
    name: (user.user_metadata?.full_name as string | undefined)?.trim() || undefined,
    agency: (user.user_metadata?.agency as string | undefined)?.trim() || undefined,
  });
  return { client, brokerId: broker.id, orgId: broker.org_id };
});

/**
 * Find the broker row for this auth user, provisioning it on first login.
 *
 * ACCESS MODEL (multi-agency): each agency is an organization with a hard RLS wall
 * between agencies. A broker's first login JOINS their agency's org (found by name,
 * created if new — the agency comes from signup metadata). Role is `broker` by
 * default; org_admin only for emails in ORG_ADMIN_EMAILS (added by hand). Accounts
 * with no agency (hand-seeded admins) fall back to SMG_ORG_ID / the sole org.
 * Writes go through the service-role client (RLS-bypass, server-only).
 */
function adminEmails(): Set<string> {
  return new Set(
    (process.env.ORG_ADMIN_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Fallback org when no agency is given (hand-seeded admins). */
async function defaultOrgId(svc: ReturnType<typeof serviceClient>): Promise<string> {
  const pinned = process.env.SMG_ORG_ID?.trim();
  if (pinned) return pinned;
  const { data } = await svc.from("organizations").select("id");
  if (data && data.length === 1) return data[0].id as string;
  throw new Error("SMG_ORG_ID is not set and the organization is ambiguous");
}

/** The broker's agency org: matched case-insensitively by name, created if new. */
async function resolveOrgId(svc: ReturnType<typeof serviceClient>, agency: string | undefined): Promise<string> {
  if (!agency) return defaultOrgId(svc);
  const find = async () => {
    const { data } = await svc.from("organizations").select("id").ilike("name", agency).limit(1);
    return data?.[0]?.id as string | undefined;
  };
  const found = await find();
  if (found) return found;
  const { data: created } = await svc.from("organizations").insert({ name: agency }).select("id").single();
  if (created) return created.id as string;
  const raced = await find(); // two first-signups for the same new agency
  if (raced) return raced;
  throw new Error("agency org provisioning failed");
}

async function resolveBroker(
  userId: string,
  email: string,
  signup: { name?: string; agency?: string } = {},
): Promise<BrokerRow> {
  const svc = serviceClient();

  const { data: existing } = await svc
    .from("brokers")
    .select("id,org_id")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return existing as BrokerRow;

  // First login → join the broker's agency org. Admin only if allowlisted by hand.
  const orgId = await resolveOrgId(svc, signup.agency);
  const role = adminEmails().has(email.toLowerCase()) ? "org_admin" : "broker";

  const { data: broker, error: brokerErr } = await svc
    .from("brokers")
    .insert({ id: userId, org_id: orgId, email, role, name: signup.name ?? null })
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
