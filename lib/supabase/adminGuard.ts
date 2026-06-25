/**
 * Server-side role gate for the /admin area. Resolves the signed-in broker and
 * enforces an allowed-role list, redirecting anyone else away. SERVER-ONLY.
 *
 *   org_admin → full admin (audit trail + settings write)
 *   security  → read-only monitoring (audit trail)
 *   broker    → no admin access
 */
import "server-only";
import { redirect } from "next/navigation";
import { getBrokerContext } from "./auth";
import type { BrokerContext, BrokerRole } from "./client";

export async function requireRole(allowed: BrokerRole[]): Promise<BrokerContext> {
  const ctx = await getBrokerContext();
  if (!ctx) redirect("/login");
  if (!allowed.includes(ctx.role)) redirect("/");
  return ctx;
}
