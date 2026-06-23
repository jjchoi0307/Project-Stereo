import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";
import { SCENARIOS } from "@/lib/engine/scenarios";
import { getSessionStore } from "@/lib/session/store";

/**
 * Scenario perturbation: re-run the SAME pipeline on the baseline profile and on
 * each "what-if" transform, and report whether the recommended plan holds up.
 * Deterministic + zero-retention — each run is a pure function of its facts.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionStore().get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const url = new URL(req.url);
  const preferenceWeighting = url.searchParams.get("preference") !== "off";
  const count = Number(url.searchParams.get("count")) || undefined;
  const db = getDataStore();

  const baseRun = await runEngine(session.profile, db, { preferenceWeighting, count });
  const planName = new Map(baseRun.plans.map((p) => [p.id, p.name]));
  const baseTopId = baseRun.scoring.topPlanId;
  const nameOf = (pid: string | null) => (pid ? planName.get(pid) ?? null : null);

  const scenarios = [];
  for (const sc of SCENARIOS) {
    const run = await runEngine(sc.apply(session.profile), db, { preferenceWeighting, count });
    const ranked = run.scoring.ranked;
    const top = ranked[0] ?? null;
    const baseIdx = baseTopId ? ranked.findIndex((r) => r.planId === baseTopId) : -1;
    scenarios.push({
      id: sc.id,
      label: sc.label,
      description: sc.description,
      topPlanId: run.scoring.topPlanId,
      topPlanName: nameOf(run.scoring.topPlanId),
      topTotal: top?.total ?? null,
      changed: (run.scoring.topPlanId ?? null) !== (baseTopId ?? null),
      eligibleCount: ranked.length,
      // How the baseline's #1 pick fares under this scenario (the robustness signal).
      baselineTop: {
        planId: baseTopId,
        planName: nameOf(baseTopId),
        rankUnderScenario: baseIdx >= 0 ? baseIdx + 1 : null, // null = now ineligible
        totalUnderScenario: baseIdx >= 0 ? ranked[baseIdx].total : null,
      },
    });
  }

  return NextResponse.json({
    baseline: { topPlanId: baseTopId, topPlanName: nameOf(baseTopId), topTotal: baseRun.scoring.ranked[0]?.total ?? null },
    scenarios,
  });
}
