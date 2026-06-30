import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/store";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";
import { logAccess } from "@/lib/security/accessLog";
import { getBrokerContext } from "@/lib/supabase/auth";
import { DATA_VERSION, ENGINE_VERSION } from "@/lib/version";
import { verifyAuditRecordHmac } from "@/lib/audit/integrity";

/**
 * Reproducibility check: re-run the engine from the stored profile snapshot and
 * confirm the seed and ranking match the record. This is the compliance proof
 * that a recommendation can be reproduced exactly.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = (await getBrokerContext()) ?? undefined;
  const record = await (await getAuditStore(ctx)).get(id);
  if (!record) return NextResponse.json({ error: "audit record not found" }, { status: 404 });

  // PHI read: verify re-runs the engine over the stored profileSnapshot, so it
  // touches ePHI. Record the access (PHI-free) on the persisted path. The
  // AccessAction union has no dedicated "audit.verify"; "audit.read" is the
  // closest existing label for this read-of-PHI event.
  if (ctx) {
    const sessionId = record.profileSnapshot.id.replace(/^profile-/, "");
    logAccess({ actor: ctx.brokerId, action: "audit.read", sessionId });
  }

  const run = await runEngine(record.profileSnapshot, getDataStore(), {
    preferenceWeighting: record.preferenceWeightingEnabled,
  });
  const actualRanking = run.scoring.ranked.map((s) => s.planId);

  const seedMatch = run.sim.seed === record.scenarioSeed;
  const rankingMatch =
    actualRanking.length === record.ranking.length &&
    actualRanking.every((p, i) => p === record.ranking[i]);

  // The reproducibility proof is only valid against the dataset + engine the
  // record was created under. A live re-run after a DATA_VERSION/ENGINE_VERSION
  // bump can diverge for a record that was perfectly valid at creation — so a
  // version mismatch is surfaced as its own signal (not a tamper "did not
  // reproduce"). Legacy records with no pinned version are treated as matching.
  const dataVersionMatch = !record.dataVersion || record.dataVersion === DATA_VERSION;
  const engineVersionMatch = !record.engineVersion || record.engineVersion === ENGINE_VERSION;
  const sameVersion = dataVersionMatch && engineVersionMatch;

  // Content integrity (independent of the engine re-run): detects tampering of the
  // stored payload — AI recommendation, citations, PHI snapshot — that wouldn't
  // change the deterministic ranking. true = intact, false = altered, null =
  // unsigned/no key (then it doesn't affect the verdict).
  const contentIntact = verifyAuditRecordHmac(record);

  return NextResponse.json({
    // "reproduced exactly" means same-version, same-seed, same-ranking, and — when
    // the record is signed — content that hasn't been tampered with.
    reproduced: sameVersion && seedMatch && rankingMatch && contentIntact !== false,
    seedMatch,
    rankingMatch,
    dataVersionMatch,
    engineVersionMatch,
    contentIntact,
    recordedVersions: { data: record.dataVersion ?? null, engine: record.engineVersion ?? null },
    currentVersions: { data: DATA_VERSION, engine: ENGINE_VERSION },
    expectedRanking: record.ranking,
    actualRanking,
  });
}
