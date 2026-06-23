import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import { applyRules, buildRulesContext } from "@/lib/engine/rules";
import { simulate } from "@/lib/engine/simulate";
import { getSessionStore } from "@/lib/session/store";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const count = Number(new URL(req.url).searchParams.get("count")) || undefined;

  const db = getDataStore();
  const [plans, ctx] = await Promise.all([db.listPlans(), buildRulesContext(db)]);
  const drugs = [...ctx.drugsById.values()];

  const normalized = normalizeProfile(session.profile, drugs);
  const rules = applyRules(session.profile, plans, ctx);
  const survivors = plans.filter((p) => rules.survivingPlanIds.includes(p.id));
  const planById = new Map(plans.map((p) => [p.id, p]));

  const sim = simulate(session.profile, normalized, survivors, ctx, { count });

  // Shape for the wire: drop the raw per-journey outcomes, enrich with plan meta,
  // and present best-first by mean exposure (provisional — real ranking is step 6).
  const perPlan = sim.perPlan
    .map((s) => {
      const p = planById.get(s.planId)!;
      return {
        planId: s.planId,
        name: p.name,
        smgSupported: p.smgSupported,
        isScan: p.isScan,
        isCompetitor: p.isCompetitor,
        meanExposure: s.meanExposure,
        p90Exposure: s.p90Exposure,
        worstExposure: s.worstExposure,
        medCoverageRate: s.medCoverageRate,
        networkGapRate: s.networkGapRate,
        catastrophicRate: s.catastrophicRate,
        topUncoveredDrugs: s.topUncoveredDrugs,
      };
    })
    .sort((a, b) => a.meanExposure - b.meanExposure);

  return NextResponse.json({
    seed: sim.seed,
    count: sim.count,
    journeyTypeDistribution: sim.journeyTypeDistribution,
    perPlan,
  });
}
