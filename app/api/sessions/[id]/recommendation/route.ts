import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { getSessionStore } from "@/lib/session/store";
import { recommendPlans } from "@/lib/ai/recommend";
import { planMeta, shapeRankedPlan } from "@/lib/ai/toResponse";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { simConfigured } from "@/lib/sim/env";
import { recCacheKey } from "@/lib/engine/factsSignature";
import { getBrokerContext } from "@/lib/supabase/auth";
import { recordEvent } from "@/lib/audit/eventStore";

export const dynamic = "force-dynamic";
// Ensemble screen runs (parallel) + 3 deep write-ups; can run a while on first compute.
export const maxDuration = 300;

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
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });
  const profile = session.profile;

  // Cache keyed by the CONTENT of the intake (recCacheKey) — editing facts changes
  // the key, so "continue" after a correction always recomputes; unchanged facts
  // are served from cache. `?refresh=1` forces a fresh ensemble run (explicit refresh).
  const cacheKey = recCacheKey(id, profile);
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  if (!refresh) {
    const cached = await getHorizonPayload(cacheKey);
    if (cached) return NextResponse.json(cached);
  }

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

    // DEGRADED: no grounded deep write-up succeeded, so every row is an ungrounded
    // heuristic. Do NOT present it as an authoritative recommendation and do NOT
    // cache it — surface a retryable failure (mirrors the not-configured path) so
    // the next load recomputes instead of freezing a bad result into cache + audit.
    if (rec.degraded) {
      await recordEvent(await getBrokerContext(), {
        action: "recommendation.surface",
        sessionId: id,
        metadata: { degraded: true, eligibleCount: rec.ranked.length },
        outcome: "error",
      });
      return NextResponse.json(
        {
          error: "recommendation temporarily unavailable",
          detail: "The recommendation couldn't be fully generated just now. Please try again in a moment.",
        },
        { status: 503 },
      );
    }

    // Shape a model ranking into the response, dropping any planId not in the
    // catalog. Used for both the primary result and the relaxed near-miss.
    const shapeRanked = (items: typeof rec.ranked) =>
      items
        .map((item) => {
          const plan = planById.get(item.planId);
          return plan ? shapeRankedPlan(item, plan, mustKeep) : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

    const ranked = shapeRanked(rec.ranked);

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
      const nmRanked = shapeRanked(relaxed.ranked);
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
      // model id intentionally omitted from the client payload (stealth — don't
      // expose the exact provider model); it stays in the immutable audit record.
      aiPowered: true,
      ensembleRuns: rec.ensembleRuns,
      preferenceWeightingEnabled: false,
      preferenceChangedTop: false,
      topPlanId: rec.topPlanId,
      ranked,
      excluded,
      nearMiss,
    };
    await setHorizonPayload(cacheKey, payload);

    // Audit trail: record which plan was surfaced to which session (PHI-free).
    const topName = ranked.find((r) => r.planId === rec.topPlanId)?.plan.name ?? null;
    await recordEvent(await getBrokerContext(), {
      action: "recommendation.surface",
      sessionId: id,
      metadata: { topPlanId: rec.topPlanId, topPlanName: topName, model: rec.model, eligibleCount: ranked.length },
    });

    return NextResponse.json(payload);
  } catch (e) {
    const err = e as Error;
    console.error("AI recommendation failed:", err?.name, err?.message);
    // Audit the FAILURE too, so the trail's outcome column reflects reality
    // (ok vs error), not a constant "ok". PHI-free: error message only.
    await recordEvent(await getBrokerContext(), {
      action: "recommendation.surface",
      sessionId: id,
      metadata: { error: err?.message ?? "unknown" },
      outcome: "error",
    });
    // Generic client message only — the internal detail is already in the
    // server log + audit event above (stealth: never echo internals to clients).
    return NextResponse.json({ error: "recommendation failed" }, { status: 502 });
  }
}
