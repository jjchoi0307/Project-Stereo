import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";
import { describeReason, POSITIVE_REASONS, type ReasonFacts } from "@/lib/engine/reasons";
import { getSessionStore } from "@/lib/session/store";
import type { ClientProfileInput, Plan } from "@/lib/domain";
import type { RulesContext } from "@/lib/engine/rules";
import type { PlanSimulationSummary } from "@/lib/engine/simulate";

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

/** Build the specific-reason facts for a plan from its benefits, sim summary, the client profile, and cross-plan context. */
const buildReasonFacts = (
  plan: Plan,
  summary: PlanSimulationSummary,
  profile: ClientProfileInput,
  ctx: RulesContext,
  cross: { isLowestCatastrophic: boolean; eligibleCount: number },
): ReasonFacts => {
  const medNames = profile.medications
    .map((m) => m.name ?? m.raw)
    .filter((n): n is string => Boolean(n));
  const requiredProviderNames = profile.providerConstraints
    .filter((c) => c.hardRequirement)
    .map((c) => (c.systemId ? ctx.systemsById.get(c.systemId)?.name ?? c.label : c.label));
  return {
    currentMedNames: medNames,
    currentMedCount: profile.medications.length,
    specialistCopay: plan.benefits.specialistCopay,
    mentalHealthOutpatientCopay: plan.benefits.mentalHealthOutpatientCopay,
    acupunctureVisitsPerYear: plan.benefits.acupunctureVisitsPerYear,
    requiredProviderNames,
    specialistVisits12mo: profile.utilization?.specialistVisits12mo,
    acupunctureVisits12mo: profile.utilization?.acupunctureVisits12mo,
    medCoverageRate: summary.medCoverageRate,
    networkGapRate: summary.networkGapRate,
    catastrophicRate: summary.catastrophicRate,
    topUncoveredDrug: summary.topUncoveredDrugs[0],
    isLowestCatastrophic: cross.isLowestCatastrophic,
    eligibleCount: cross.eligibleCount,
  };
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const url = new URL(req.url);
  const preferenceWeighting = url.searchParams.get("preference") !== "off";
  const count = Number(url.searchParams.get("count")) || undefined;

  const db = getDataStore();
  const { plans, ctx, sim, scoring: result, nearMiss } = await runEngine(session.profile, db, {
    preferenceWeighting,
    count,
  });
  const profile = session.profile;
  const planById = new Map(plans.map((p) => [p.id, p]));
  const summaryById = new Map(sim.perPlan.map((s) => [s.planId, s]));

  // Cross-plan context for "lowest catastrophic exposure" claims: the minimum
  // catastrophicRate among the plans in this ranking (presentation only).
  const crossContext = (
    rankedScores: typeof result.ranked,
    summaries: Map<string, PlanSimulationSummary>,
  ) => {
    const rates = rankedScores
      .map((ps) => summaries.get(ps.planId)?.catastrophicRate)
      .filter((r): r is number => r != null);
    return { minCatastrophicRate: rates.length ? Math.min(...rates) : null, eligibleCount: rankedScores.length };
  };

  const shapeRanked = (
    ps: (typeof result.ranked)[number],
    summaries: Map<string, PlanSimulationSummary>,
    cross: { minCatastrophicRate: number | null; eligibleCount: number },
    providerGaps?: string[],
  ) => {
    const s = summaries.get(ps.planId)!;
    const facts = buildReasonFacts(planById.get(ps.planId)!, s, profile, ctx, {
      isLowestCatastrophic:
        cross.minCatastrophicRate != null && s.catastrophicRate === cross.minCatastrophicRate,
      eligibleCount: cross.eligibleCount,
    });
    return {
      ...ps,
      plan: meta(planById.get(ps.planId)!),
      providerGaps: providerGaps ?? [],
      reasons: ps.reasonCodes.map((code) => ({
        code,
        text: describeReason(code, facts),
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

  const rankedCross = crossContext(result.ranked, summaryById);
  const ranked = result.ranked.map((ps) => shapeRanked(ps, summaryById, rankedCross));

  // When nothing survived but relaxing the provider requirement helps, surface
  // the closest plans (each labelled with which required provider it drops).
  let nearMissPayload: unknown = null;
  if (nearMiss) {
    const nmSummaries = new Map(nearMiss.sim.perPlan.map((s) => [s.planId, s]));
    const nmCross = crossContext(nearMiss.scoring.ranked, nmSummaries);
    nearMissPayload = {
      reason: nearMiss.reason,
      requiredProviders: nearMiss.requiredProviders,
      regionName: nearMiss.regionName,
      ranked: nearMiss.scoring.ranked.map((ps) =>
        shapeRanked(ps, nmSummaries, nmCross, nearMiss.providerGapsByPlan[ps.planId]),
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
