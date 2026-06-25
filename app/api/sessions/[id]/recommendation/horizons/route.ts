import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { recommendHorizons } from "@/lib/ai/horizonRecommend";
import { planMeta, shapeRankedPlan } from "@/lib/ai/toResponse";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { simConfigured, SIM_MODEL } from "@/lib/sim/env";
import { DATA_VERSION } from "@/lib/version";
import { getSessionStore } from "@/lib/session/store";
import { getBrokerContext } from "@/lib/supabase/auth";
import { getInputImportance, guidanceFromConfig } from "@/lib/config/orgSettings";

export const dynamic = "force-dynamic";
// One grounded Claude call projects the member's future + recommends per horizon.
export const maxDuration = 120;

/**
 * AI-powered across-horizon recommendation (5y / 10y). One grounded Claude call
 * projects the member's likely future health AND recommends the best plan for
 * that projected member at each horizon — fit score, reasons, bullets, citations,
 * all sourced strictly from the 2026 plan files (lib/ai/horizonRecommend.ts).
 * Cached per facts-version + model + data-version.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });
  const profile = session.profile;

  // Admin-configurable input importance feeds the projection; fold it into the key.
  const ctx = await getBrokerContext();
  const config = await getInputImportance(ctx?.orgId);
  const cfgSig = Object.values(config).map((v) => (v === "high" ? "H" : "L")).join("");

  const cacheKey = `aihorizon:${id}:${profile.capturedAt}:${SIM_MODEL}:${DATA_VERSION}:${cfgSig}`;
  const cached = await getHorizonPayload(cacheKey);
  if (cached) return NextResponse.json(cached);

  if (!simConfigured()) {
    return NextResponse.json(
      { error: "not configured", detail: "The AI horizon recommendation is opt-in. Set ANTHROPIC_API_KEY to enable it." },
      { status: 503 },
    );
  }

  try {
    const db = getDataStore();
    const plans = await db.listPlans();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const mustKeep = profile.providerConstraints.some((c) => c.hardRequirement);

    // Today's top pick (for the "changes vs today" flag), read from the cached
    // Today recommendation when available — avoids recomputing it here.
    const todayCache = (await getHorizonPayload(
      `airec:${id}:${profile.capturedAt}:${SIM_MODEL}:${DATA_VERSION}`,
    )) as { topPlanId?: string | null } | null;
    const todayTopPlanId = todayCache?.topPlanId ?? null;

    const rec = await recommendHorizons(profile, db, todayTopPlanId, guidanceFromConfig(config));

    const horizons = rec.horizons.map((h) => {
      const recommended = h.recommended ? planById.get(h.recommended.planId) : undefined;
      return {
        years: h.years,
        changedVsToday: h.changedVsToday,
        projection: h.projection,
        recommended:
          h.recommended && recommended
            ? shapeRankedPlan(h.recommended, recommended, mustKeep)
            : null,
        distribution: h.ranked
          .map((r) => {
            const p = planById.get(r.planId);
            return p ? { plan: planMeta(p), fitScore: r.fitScore } : null;
          })
          .filter((x): x is { plan: ReturnType<typeof planMeta>; fitScore: number } => x !== null),
      };
    });

    const payload = {
      model: rec.model,
      aiPowered: true,
      todayTopPlanId: rec.todayTopPlanId,
      todayTopPlanName: rec.todayTopPlanId ? planById.get(rec.todayTopPlanId)?.name ?? null : null,
      horizons,
    };
    await setHorizonPayload(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (e) {
    const err = e as Error;
    console.error("AI horizon recommendation failed:", err?.name, err?.message);
    return NextResponse.json({ error: "horizon recommendation failed", detail: err?.message }, { status: 502 });
  }
}
