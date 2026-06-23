import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";
import { REASON_TEXT, POSITIVE_REASONS } from "@/lib/engine/reasons";
import { getSessionStore } from "@/lib/session/store";
import type { Plan } from "@/lib/domain";

const meta = (p: Plan) => ({
  id: p.id,
  name: p.name,
  carrier: p.carrier,
  planType: p.planType,
  smgSupported: p.smgSupported,
  isScan: p.isScan,
  isCompetitor: p.isCompetitor,
  monthlyPremium: p.benefits.monthlyPremium,
  annualOOPMax: p.benefits.annualOOPMax,
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionStore().get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const url = new URL(req.url);
  const preferenceWeighting = url.searchParams.get("preference") !== "off";
  const count = Number(url.searchParams.get("count")) || undefined;

  const db = getDataStore();
  const { plans, sim, scoring: result, nearMiss } = await runEngine(session.profile, db, {
    preferenceWeighting,
    count,
  });
  const planById = new Map(plans.map((p) => [p.id, p]));
  const summaryById = new Map(sim.perPlan.map((s) => [s.planId, s]));

  const shapeRanked = (
    ps: (typeof result.ranked)[number],
    summaries: Map<string, (typeof sim.perPlan)[number]>,
    providerGaps?: string[],
  ) => {
    const s = summaries.get(ps.planId)!;
    return {
      ...ps,
      plan: meta(planById.get(ps.planId)!),
      providerGaps: providerGaps ?? [],
      reasons: ps.reasonCodes.map((code) => ({
        code,
        text: REASON_TEXT[code],
        positive: POSITIVE_REASONS.has(code),
      })),
      exposure: {
        mean: s.meanExposure,
        worst: s.worstExposure,
        medCoverageRate: s.medCoverageRate,
        catastrophicRate: s.catastrophicRate,
        topUncoveredDrugs: s.topUncoveredDrugs,
      },
    };
  };

  const ranked = result.ranked.map((ps) => shapeRanked(ps, summaryById));

  // When nothing survived but relaxing the provider requirement helps, surface
  // the closest plans (each labelled with which required provider it drops).
  let nearMissPayload: unknown = null;
  if (nearMiss) {
    const nmSummaries = new Map(nearMiss.sim.perPlan.map((s) => [s.planId, s]));
    nearMissPayload = {
      reason: nearMiss.reason,
      requiredProviders: nearMiss.requiredProviders,
      regionName: nearMiss.regionName,
      ranked: nearMiss.scoring.ranked.map((ps) =>
        shapeRanked(ps, nmSummaries, nearMiss.providerGapsByPlan[ps.planId]),
      ),
    };
  }

  const excludedByPlan = new Map<string, typeof result.excluded>();
  for (const e of result.excluded) {
    const list = excludedByPlan.get(e.planId) ?? [];
    list.push(e);
    excludedByPlan.set(e.planId, list);
  }
  const excluded = [...excludedByPlan.entries()].map(([pid, reasons]) => ({
    plan: meta(planById.get(pid)!),
    reasons,
  }));

  return NextResponse.json({
    seed: sim.seed,
    scenarioCount: sim.count,
    preferenceWeightingEnabled: result.preferenceWeightingEnabled,
    preferenceChangedTop: result.preferenceChangedTop,
    topPlanId: result.topPlanId,
    ranked,
    excluded,
    nearMiss: nearMissPayload,
  });
}
