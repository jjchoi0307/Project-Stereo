/**
 * Patient self-entry — the anonymous capability-token path (ARCHITECTURE.md
 * rollout step 5). A patient is NOT a broker, so they can't use owner-only RLS.
 * Instead the broker mints a single-use-ish capability token on the session
 * (`sessions.intake_token`), and the patient writes that one profile through a
 * SERVER-ONLY service-role path that validates the token (RLS-bypass, narrow).
 *
 * Mode-aware, mirroring the store factories:
 *  - supabase mode: token is a random capability stored on the session; resolve
 *    + write go through the service-role client.
 *  - memory mode (local dev, no RLS): the session id *is* the token, and we read
 *    /write the in-memory store directly. No capability machinery needed.
 *
 * SERVER-ONLY.
 */
import "server-only";
import type { BrokerContext } from "@/lib/supabase/client";
import { serviceClient } from "@/lib/supabase/client";
import { stateStore, supabaseConfigured } from "@/lib/supabase/env";
import { getDataStore } from "@/lib/data";
import { SMG_SERVICE_AREA_REGION_IDS } from "@/lib/data/fixtures/regions";
import { mergeProvenance, toProfileInput } from "@/lib/intake/toProfile";
import type { IntakeFormValues } from "@/lib/intake/types";
import { validateIntake } from "@/lib/intake/validate";
import type { ClientProfileInput } from "@/lib/domain";
import { logAccess } from "@/lib/security/accessLog";
import { getSessionStore } from "./store";

// Short-lived capability: a broker shares the link and the patient fills it soon
// after. 48h balances convenience against a leaked-link exposure window.
const TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

const supabaseMode = () => stateStore() === "supabase" && supabaseConfigured();

/**
 * Broker-side: mint (or reuse a still-valid) capability token for a session the
 * broker owns, returned for the shareable `/intake/[token]` link. In memory mode
 * the session id is the token.
 */
export async function issueIntakeToken(sessionId: string, ctx: BrokerContext | null): Promise<string> {
  if (ctx && supabaseMode()) {
    const { data: existing } = await ctx.client
      .from("sessions")
      .select("intake_token,intake_token_expires_at")
      .eq("id", sessionId)
      .maybeSingle();
    if (
      existing?.intake_token &&
      existing.intake_token_expires_at &&
      new Date(existing.intake_token_expires_at).getTime() > Date.now()
    ) {
      return existing.intake_token as string;
    }
    const token = crypto.randomUUID();
    const { error } = await ctx.client
      .from("sessions")
      .update({ intake_token: token, intake_token_expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString() })
      .eq("id", sessionId);
    if (error) throw error;
    logAccess({ actor: ctx.brokerId, action: "intake.token_issue", sessionId });
    return token;
  }
  return sessionId; // memory mode: id is the capability
}

interface ResolvedSession {
  sessionId: string;
  brokerId?: string;
  orgId?: string;
  clientLabel?: string;
  profile?: ClientProfileInput;
}

/** Patient-side (anonymous): resolve a token to its session, or null if invalid/expired. */
export async function resolvePatientIntake(token: string): Promise<ResolvedSession | null> {
  if (supabaseMode()) {
    const svc = serviceClient();
    const { data } = await svc
      .from("sessions")
      .select("id,broker_id,org_id,client_label,intake_token_expires_at")
      .eq("intake_token", token)
      .maybeSingle();
    if (!data) return null;
    if (data.intake_token_expires_at && new Date(data.intake_token_expires_at).getTime() < Date.now()) return null;
    const { data: p } = await svc.from("profiles").select("data").eq("session_id", data.id).maybeSingle();
    logAccess({ actor: "patient", action: "intake.resolve", sessionId: data.id as string });
    return {
      sessionId: data.id as string,
      brokerId: data.broker_id as string,
      orgId: data.org_id as string,
      clientLabel: (data.client_label as string | null) ?? undefined,
      profile: (p?.data as ClientProfileInput) ?? undefined,
    };
  }
  const s = await (await getSessionStore()).get(token);
  return s ? { sessionId: s.id, clientLabel: s.clientLabel, profile: s.profile } : null;
}

export type PatientSubmitResult =
  | { ok: true }
  | { ok: false; status: number; error: string; validation?: ReturnType<typeof validateIntake> };

/** Patient-side (anonymous): validate the token + facts, then write the one profile. */
export async function submitPatientIntake(token: string, values: IntakeFormValues): Promise<PatientSubmitResult> {
  const resolved = await resolvePatientIntake(token);
  if (!resolved) return { ok: false, status: 404, error: "This intake link is invalid or has expired." };

  const validation = validateIntake(values);
  if (!validation.ok) return { ok: false, status: 400, error: "validation failed", validation };
  if (!SMG_SERVICE_AREA_REGION_IDS.has(values.marketRegion)) {
    return { ok: false, status: 400, error: "SMG serves Los Angeles, Orange, and Santa Clara counties only." };
  }

  const db = getDataStore();
  const [drugs, providerSystems] = await Promise.all([db.listDrugs(), db.listProviderSystems()]);
  let profile = toProfileInput(values, {
    profileId: `profile-${resolved.sessionId}`,
    capturedBy: "patient",
    drugs,
    providerSystems,
  });
  if (resolved.profile) profile = mergeProvenance(resolved.profile, profile, "patient");

  if (supabaseMode()) {
    const svc = serviceClient();
    const { error: pErr } = await svc.from("profiles").upsert(
      {
        session_id: resolved.sessionId,
        broker_id: resolved.brokerId,
        org_id: resolved.orgId,
        captured_by: profile.capturedBy,
        data: profile,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    );
    if (pErr) {
      console.error("patient intake profile upsert failed:", pErr);
      return { ok: false, status: 500, error: "Could not save your facts. Please try again." };
    }
    // Mark complete AND burn the capability token (single-use): a leaked or
    // forwarded link can't be replayed to overwrite the profile afterward.
    const { error: sErr } = await svc
      .from("sessions")
      .update({
        status: "intake_complete",
        intake_token: null,
        intake_token_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resolved.sessionId);
    if (sErr) {
      console.error("patient intake session update failed:", sErr);
      return { ok: false, status: 500, error: "Could not save your facts. Please try again." };
    }
    logAccess({ actor: "patient", action: "intake.submit", sessionId: resolved.sessionId });
    return { ok: true };
  }

  await (await getSessionStore()).setProfile(resolved.sessionId, profile);
  return { ok: true };
}
