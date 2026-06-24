import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { recommendAcrossHorizons } from "@/lib/engine/horizonRecommendation";
import { citationFor, describeReason, POSITIVE_REASONS, type ReasonFacts } from "@/lib/engine/reasons";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { DATA_VERSION, ENGINE_VERSION } from "@/lib/version";
import { buildRulesContext } from "@/lib/engine/rules";
import { getSessionStore } from "@/lib/session/store";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import type { ClientProfileInput, ConditionFlag, Plan } from "@/lib/domain";
import type { RulesContext } from "@/lib/engine/rules";
import type { HorizonExposure } from "@/lib/engine/horizonRecommendation";

export const dynamic = "force-dynamic";
// Two nested simulations (futures × financial scenarios) per horizon.
export const maxDuration = 120;

const meta = (p: Plan) => ({
  id: p.id,
  name: p.name,
  carrier: p.carrier,
  planType: p.planType,
  snpType: p.snpType,
  smgSupported: p.smgSupported,
  isScan: p.isScan,
  isCompetitor: p.isCompetitor,
  monthlyPremium: p.benefits.monthlyPremium,
  annualOOPMax: p.benefits.annualOOPMax,
});

const condLabel = (c: ConditionFlag) =>
  CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;

/**
 * Build specific-reason facts at a horizon: plan benefits + the horizon's
 * representative exposure + the client profile. Cross-plan "lowest catastrophic"
 * context isn't meaningful across-futures, so it's left undefined (describeReason
 * falls back gracefully).
 */
const buildHorizonFacts = (
  plan: Plan,
  exposure: HorizonExposure | null,
  profile: ClientProfileInput,
  ctx: RulesContext,
): ReasonFacts => {
  const medNames = profile.medications
    .map((m) => m.name ?? m.raw)
    .filter((n): n is string => Boolean(n));
  const requiredProviderNames = profile.providerConstraints
    .filter((c) => c.hardRequirement)
    .map((c) => (c.systemId ? ctx.systemsById.get(c.systemId)?.name ?? c.label : c.label));
  const drugTierSummary = ([1, 2, 3, 4, 5, 6] as const)
    .map((t) => ({ t, d: plan.benefits.drugTierDisplay[t] }))
    .filter((x) => Boolean(x.d))
    .map((x) => `T${x.t} ${x.d}`)
    .join(" · ");
  return {
    currentMedNames: medNames,
    currentMedCount: profile.medications.length,
    specialistCopay: plan.benefits.specialistCopay,
    mentalHealthOutpatientCopay: plan.benefits.mentalHealthOutpatientCopay,
    acupunctureVisitsPerYear: plan.benefits.acupunctureVisitsPerYear,
    requiredProviderNames,
    specialistVisits12mo: profile.utilization?.specialistVisits12mo,
    acupunctureVisits12mo: profile.utilization?.acupunctureVisits12mo,
    medCoverageRate: exposure?.medCoverageRate,
    networkGapRate: undefined,
    catastrophicRate: exposure?.catastrophicRate,
    topUncoveredDrug: exposure?.topUncoveredDrugs[0],
    sourceFile: plan.sourceFile,
    sourcePage: plan.sourcePage,
    annualOOPMax: plan.benefits.annualOOPMax,
    drugTierSummary: drugTierSummary || undefined,
  };
};

/**
 * Across-futures recommendation at each horizon (5y, 10y): the plan that holds up
 * best as the client's health evolves. Deterministic — every per-future pick is a
 * real runEngine() result on a projected profile. The AI narrative is separate
 * (…/health-future/projection); this route never calls an LLM.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const profile = session.profile;

  // Deterministic + keyed by facts/version → serve the persisted result instantly
  // (survives serverless cold starts, unlike the in-memory cache). Session was
  // already authorized above, and the key is namespaced by this session id.
  const cacheKey = `horizon:${id}:${profile.capturedAt}:${ENGINE_VERSION}:${DATA_VERSION}`;
  const cached = await getHorizonPayload(cacheKey);
  if (cached) return NextResponse.json(cached);

  const db = getDataStore();
  const [result, ctx] = await Promise.all([
    recommendAcrossHorizons(profile, db),
    buildRulesContext(db),
  ]);
  const planById = new Map((await db.listPlans()).map((p) => [p.id, p]));
  const nameOf = (pid: string | null) => (pid ? planById.get(pid)?.name ?? pid : null);
  const metaOf = (pid: string) => {
    const p = planById.get(pid);
    return p ? meta(p) : null;
  };

  const horizons = result.horizons.map((h) => {
    const recPlan = h.recommendedPlanId ? planById.get(h.recommendedPlanId) ?? null : null;
    const recMeta = h.recommendedPlanId ? metaOf(h.recommendedPlanId) : null;
    const facts = recPlan
      ? buildHorizonFacts(recPlan, h.representativeExposure, profile, ctx)
      : {};
    return {
      years: h.years,
      replicas: h.replicas,
      scenarioCount: h.scenarioCount,
      winShare: h.winShare,
      noneEligibleRate: h.noneEligibleRate,
      changedVsToday: h.recommendedPlanId !== result.todayTopPlanId,
      recommended: recMeta
        ? {
            plan: recMeta,
            winShare: h.winShare,
            reasons: h.representativeReasonCodes.map((code) => ({
              code,
              text: describeReason(code, facts),
              positive: POSITIVE_REASONS.has(code),
              citation: citationFor(code, facts),
            })),
            exposure: h.representativeExposure,
          }
        : null,
      distribution: h.distribution
        .map((d) => {
          const p = metaOf(d.planId);
          return p ? { plan: p, share: d.share } : null;
        })
        .filter((x): x is { plan: ReturnType<typeof meta>; share: number } => x !== null),
      projectedAssumptions: {
        conditions: h.projectedAssumptions.conditions.map((c) => ({
          label: condLabel(c.flag),
          incidence: c.incidence,
        })),
        medications: h.projectedAssumptions.medications,
      },
    };
  });

  const payload = {
    todayTopPlanId: result.todayTopPlanId,
    todayTopPlanName: nameOf(result.todayTopPlanId),
    horizons,
  };
  await setHorizonPayload(cacheKey, payload);
  return NextResponse.json(payload);
}
