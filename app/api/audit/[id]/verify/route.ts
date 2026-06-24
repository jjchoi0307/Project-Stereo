import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";

/**
 * Reproducibility check: re-run the engine from the stored profile snapshot and
 * confirm the seed and ranking match the record. This is the compliance proof
 * that a recommendation can be reproduced exactly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await (await getAuditStore()).get(id);
  if (!record) return NextResponse.json({ error: "audit record not found" }, { status: 404 });

  const run = await runEngine(record.profileSnapshot, getDataStore(), {
    preferenceWeighting: record.preferenceWeightingEnabled,
  });
  const actualRanking = run.scoring.ranked.map((s) => s.planId);

  const seedMatch = run.sim.seed === record.scenarioSeed;
  const rankingMatch =
    actualRanking.length === record.ranking.length &&
    actualRanking.every((p, i) => p === record.ranking[i]);

  return NextResponse.json({
    reproduced: seedMatch && rankingMatch,
    seedMatch,
    rankingMatch,
    expectedRanking: record.ranking,
    actualRanking,
  });
}
