import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";
import { simConfigured, SIM_MODEL } from "@/lib/sim/env";
import { aiClinicalRead } from "@/lib/ai/clinicalRead";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { getBrokerContext } from "@/lib/supabase/auth";
import { getInputImportance, guidanceFromConfig } from "@/lib/config/orgSettings";
import { factsSignature } from "@/lib/engine/factsSignature";

export const dynamic = "force-dynamic";
// Adaptive thinking over the clinical read can take 30-50s.
export const maxDuration = 120;

/**
 * AI clinical read — Claude produces the risk markers + 5/10-year health-futures
 * narrative, grounded in the member's de-identified clinical facts.
 *
 * Outside the recommendation data path (ARCHITECTURE.md invariant #6): the result
 * is presentational only — it never feeds scoring and is not part of the audit.
 * The deterministic markers (/normalized) and health futures (/health-futures)
 * remain available as a graceful fallback when the AI is unconfigured.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  // Admin-configurable input importance feeds the projection — load it and fold a
  // compact signature into the cache key so changing the weights regenerates.
  const ctx = await getBrokerContext();
  const config = await getInputImportance(ctx?.orgId);
  const cfgSig = Object.values(config).map((v) => (v === "high" ? "H" : "L")).join("");

  // Cache keyed by facts-version + model + config: it auto-runs when the clinical
  // read opens, so without this every page view would be a ~30-50s Claude call + cost.
  const cacheKey = `clinicalread:${id}:${factsSignature(session.profile)}:${SIM_MODEL}:${cfgSig}`;
  const cached = await getHorizonPayload(cacheKey);
  if (cached) return NextResponse.json(cached);

  if (!simConfigured()) {
    return NextResponse.json(
      {
        error: "not configured",
        detail: "The AI clinical read is opt-in. Set ANTHROPIC_API_KEY to enable it.",
      },
      { status: 503 },
    );
  }

  try {
    const result = await aiClinicalRead(session.profile, guidanceFromConfig(config));
    await setHorizonPayload(cacheKey, result);
    return NextResponse.json(result);
  } catch (e) {
    // PHI-free: log the error name/message only, never the profile.
    const err = e as Error;
    console.error("clinical read failed:", err?.name, err?.message);
    return NextResponse.json({ error: "clinical read failed" }, { status: 502 });
  }
}
