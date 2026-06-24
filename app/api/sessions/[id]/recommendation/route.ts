import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { getSessionStore } from "@/lib/session/store";
import { recommendPlans } from "@/lib/ai/recommend";
import { planMeta, shapeRankedPlan } from "@/lib/ai/toResponse";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { simConfigured, SIM_MODEL } from "@/lib/sim/env";
import { DATA_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";
// Two grounded Claude passes (generate + verify) over the eligible candidates.
export const maxDuration = 120;

/**
 * AI-powered recommendation for "today" — Claude ranks the eligible plans and
 * produces the fit score, scoring reasons, bullets, and source citations,
 * reasoning ONLY over the 2026 plan files (lib/ai/recommend.ts). Eligibility
 * stays a deterministic gate so an ineligible plan can never be recommended.
 *
 * Cached per facts-version + model + data-version: one Claude run per client,
 * instant + stable thereafter (also keeps the same client → same recommendation,
 * which the broker needs, and survives serverless cold starts).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });
  const profile = session.profile;

  const cacheKey = `airec:${id}:${profile.capturedAt}:${SIM_MODEL}:${DATA_VERSION}`;
  const cached = await getHorizonPayload(cacheKey);
  if (cached) return NextResponse.json(cached);

  if (!simConfigured()) {
    return NextResponse.json(
      {
        error: "not configured",
        detail:
          "The AI recommendation is opt-in. Set ANTHROPIC_API_KEY to enable the grounded, file-sourced recommendation.",
      },
      { status: 503 },
    );
  }

  try {
    const db = getDataStore();
    const plans = await db.listPlans();
    const planById = new Map(plans.map((p) => [p.id, p]));
    const mustKeep = profile.providerConstraints.some((c) => c.hardRequirement);

    const rec = await recommendPlans(profile, db);

    const ranked = rec.ranked
      .map((item) => {
        const plan = planById.get(item.planId);
        return plan ? shapeRankedPlan(item, plan, mustKeep) : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const excluded = rec.excluded
      .map((e) => {
        const plan = planById.get(e.planId);
        return plan ? { plan: planMeta(plan), reasons: e.reasons.map((detail) => ({ detail })) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // No eligible plan but the member has a hard provider requirement → near-miss:
    // re-rank with the provider constraint relaxed and label what each plan drops.
    let nearMiss: unknown = null;
    if (ranked.length === 0 && mustKeep) {
      const relaxed = await recommendPlans(profile, db, { ignoreProviderConstraints: true });
      const nmRanked = relaxed.ranked
        .map((item) => {
          const plan = planById.get(item.planId);
          return plan ? shapeRankedPlan(item, plan, mustKeep) : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
      nearMiss = {
        reason: "provider_relaxed",
        requiredProviders: profile.providerConstraints.filter((c) => c.hardRequirement).map((c) => c.label),
        regionName: (await db.listRegions()).find((r) => r.id === profile.marketRegion)?.name ?? profile.marketRegion,
        ranked: nmRanked,
      };
    }

    const payload = {
      seed: 0,
      scenarioCount: 0,
      model: rec.model,
      aiPowered: true,
      preferenceWeightingEnabled: false,
      preferenceChangedTop: false,
      topPlanId: rec.topPlanId,
      ranked,
      excluded,
      nearMiss,
    };
    await setHorizonPayload(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (e) {
    const err = e as Error;
    console.error("AI recommendation failed:", err?.name, err?.message);
    return NextResponse.json({ error: "recommendation failed", detail: err?.message }, { status: 502 });
  }
}
