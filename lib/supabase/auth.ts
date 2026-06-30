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
import type { BrokerContext, BrokerRole } from "./client";
import { serviceClient } from "./client";
import { stateStore, supabaseConfigured } from "./env";
import { getServerSupabase } from "./server";

interface BrokerRow {
  id: string;
  org_id: string;
  role: BrokerRole;
}

const asRole = (r: unknown): BrokerRole =>
  r === "org_admin" || r === "security" ? r : "broker";

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

  try {
    const broker = await resolveBroker(user.id, user.email ?? "", {
      name: (user.user_metadata?.full_name as string | undefined)?.trim() || undefined,
      agency: (user.user_metadata?.agency as string | undefined)?.trim() || undefined,
    });
    return { client, brokerId: broker.id, orgId: broker.org_id, role: broker.role };
  } catch (e) {
    // Provisioning can legitimately fail (e.g. ambiguous default org when
    // SMG_ORG_ID is unset, or a transient DB error). Never let that 500 a page —
    // treat the caller as not-yet-a-broker so the surface falls back to /home
    // instead of crashing. The error is logged for the operator to resolve.
    console.error("getBrokerContext: broker provisioning failed:", (e as Error)?.message);
    return null;
  }
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
function emailSet(envVar: string): Set<string> {
  return new Set(
    (process.env[envVar] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Role for a first-login email (added by hand, never browser-set):
 *   ORG_ADMIN_EMAILS → org_admin (agency-wide oversight + config write)
 *   SECURITY_EMAILS  → security  (org-wide audit READ for cyber/security monitoring)
 *   otherwise        → broker
 */
function roleForEmail(email: string): BrokerRole {
  const e = email.toLowerCase();
  if (emailSet("ORG_ADMIN_EMAILS").has(e)) return "org_admin";
  if (emailSet("SECURITY_EMAILS").has(e)) return "security";
  return "broker";
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
  const name = agency?.trim();
  if (!name) return defaultOrgId(svc);
  // Escape LIKE metacharacters so this is a LITERAL case-insensitive match, not a
  // pattern. Without this, agency="%" would ilike-match an ARBITRARY existing org
  // (the org is the RLS tenant boundary) — a cross-tenant PHI breach.
  const escaped = name.replace(/([\\%_])/g, "\\$1");
  const find = async () => {
    const { data } = await svc.from("organizations").select("id").ilike("name", escaped).limit(1);
    return data?.[0]?.id as string | undefined;
  };
  const found = await find();
  if (found) return found;
  // Atomic find-or-create: a UNIQUE index on lower(name) (migration 0005) means a
  // concurrent first-signup for the same new agency makes one insert lose on the
  // unique violation — re-select the winner's row rather than failing.
  const { data: created, error } = await svc.from("organizations").insert({ name }).select("id").single();
  if (created) return created.id as string;
  const raced = await find();
  if (raced) return raced;
  throw error ?? new Error("agency org provisioning failed");
}

async function resolveBroker(
  userId: string,
  email: string,
  signup: { name?: string; agency?: string } = {},
): Promise<BrokerRow> {
  const svc = serviceClient();

  const { data: existing } = await svc
    .from("brokers")
    .select("id,org_id,role")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return { ...(existing as { id: string; org_id: string }), role: asRole((existing as { role?: unknown }).role) };

  // First login → join the broker's agency org. Elevated roles only if allowlisted by hand.
  const orgId = await resolveOrgId(svc, signup.agency);
  const role = roleForEmail(email);

  const { data: broker, error: brokerErr } = await svc
    .from("brokers")
    .insert({ id: userId, org_id: orgId, email, role, name: signup.name ?? null })
    .select("id,org_id,role")
    .single();
  if (brokerErr || !broker) {
    // Two concurrent first-logins can both pass the existence check above; the
    // loser's insert conflicts on the PK. Re-fetch before failing.
    const { data: raced } = await svc.from("brokers").select("id,org_id,role").eq("id", userId).maybeSingle();
    if (raced) return { ...(raced as { id: string; org_id: string }), role: asRole((raced as { role?: unknown }).role) };
    throw brokerErr ?? new Error("broker provisioning failed");
  }

  return { ...(broker as { id: string; org_id: string }), role: asRole((broker as { role?: unknown }).role) };
}
