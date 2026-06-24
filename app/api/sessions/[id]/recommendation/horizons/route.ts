import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { recommendAcrossHorizons } from "@/lib/engine/horizonRecommendation";
import { POSITIVE_REASONS, REASON_TEXT } from "@/lib/engine/reasons";
import { getSessionStore } from "@/lib/session/store";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import type { ConditionFlag, Plan } from "@/lib/domain";

export const dynamic = "force-dynamic";
// Two nested simulations (futures × financial scenarios) per horizon.
export const maxDuration = 120;

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

const condLabel = (c: ConditionFlag) =>
  CONDITION_OPTIONS.find((o) => o.value === c)?.label ?? c;

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

  const db = getDataStore();
  const result = await recommendAcrossHorizons(session.profile, db);
  const planById = new Map((await db.listPlans()).map((p) => [p.id, p]));
  const nameOf = (pid: string | null) => (pid ? planById.get(pid)?.name ?? pid : null);
  const metaOf = (pid: string) => {
    const p = planById.get(pid);
    return p ? meta(p) : null;
  };

  const horizons = result.horizons.map((h) => {
    const recMeta = h.recommendedPlanId ? metaOf(h.recommendedPlanId) : null;
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
              text: REASON_TEXT[code],
              positive: POSITIVE_REASONS.has(code),
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

  return NextResponse.json({
    todayTopPlanId: result.todayTopPlanId,
    todayTopPlanName: nameOf(result.todayTopPlanId),
    horizons,
  });
}
