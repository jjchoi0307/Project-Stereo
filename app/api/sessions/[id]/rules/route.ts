import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { applyRules, buildRulesContext } from "@/lib/engine/rules";
import { getSessionStore } from "@/lib/session/store";
import type { ExclusionLogEntry, Plan } from "@/lib/domain";

const trim = (p: Plan) => ({
  id: p.id,
  name: p.name,
  carrier: p.carrier,
  planType: p.planType,
  smgSupported: p.smgSupported,
  isScan: p.isScan,
  isCompetitor: p.isCompetitor,
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  try {
    const db = getDataStore();
    const [plans, ctx] = await Promise.all([db.listPlans(), buildRulesContext(db)]);
    const result = applyRules(session.profile, plans, ctx);

    const byId = new Map(plans.map((p) => [p.id, p]));
    const entriesFor = (planId: string, severity: ExclusionLogEntry["severity"]) =>
      result.log.filter((e) => e.planId === planId && e.severity === severity);

    const surviving = result.survivingPlanIds.map((pid) => ({
      plan: trim(byId.get(pid)!),
      flags: entriesFor(pid, "flag"),
    }));
    const excluded = result.excludedPlanIds.map((pid) => ({
      plan: trim(byId.get(pid)!),
      reasons: entriesFor(pid, "exclude"),
    }));

    return NextResponse.json({ total: plans.length, surviving, excluded });
  } catch (e) {
    console.error("rules failed:", (e as Error)?.name, (e as Error)?.message);
    return NextResponse.json({ error: "rules failed" }, { status: 500 });
  }
}
