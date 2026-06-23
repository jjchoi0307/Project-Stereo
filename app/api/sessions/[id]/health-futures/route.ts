import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import { HEALTH_OUTCOME_LABEL, simulateHealthFutures } from "@/lib/engine/healthSim";
import { getSessionStore } from "@/lib/session/store";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const url = new URL(req.url);
  const replicas = Number(url.searchParams.get("replicas")) || undefined;
  const years = Number(url.searchParams.get("years")) || undefined;

  const drugs = await getDataStore().listDrugs();
  const normalized = normalizeProfile(session.profile, drugs);
  const hf = simulateHealthFutures(session.profile, normalized, { replicas, years });

  return NextResponse.json({
    seed: hf.seed,
    replicas: hf.replicas,
    horizonYears: hf.horizonYears,
    stableRate: hf.stableRate,
    severeRate: hf.severeRate,
    meanComplexity: hf.meanComplexity,
    perYearIncidence: hf.perYearIncidence,
    outcomeIncidence: hf.outcomeIncidence.map((o) => ({
      outcome: o.outcome,
      label: HEALTH_OUTCOME_LABEL[o.outcome],
      rate: o.rate,
    })),
    sampleTrajectories: hf.sampleTrajectories.map((r) => ({
      index: r.index,
      complexityScore: r.complexityScore,
      acquiredConditions: r.acquiredConditions,
      acquiredDrugIds: r.acquiredDrugIds,
      events: r.events.map((e) => ({
        year: e.year,
        outcome: e.outcome,
        label: HEALTH_OUTCOME_LABEL[e.outcome],
        detail: e.detail,
      })),
    })),
  });
}
