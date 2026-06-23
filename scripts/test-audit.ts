/**
 * Audit-record checks. Run: npm run test:audit
 *   - the record captures inputs, normalized profile, exclusion log, seed,
 *     per-plan scores (with preferenceContribution), ranking, and preference flags
 *   - it is REPRODUCIBLE: re-running the engine from the snapshot yields the
 *     identical seed and ranking
 */

import { buildAuditRecord } from "@/lib/audit/record";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";

async function main() {
  const db = getDataStore();
  const profiles = await db.listExampleProfiles();
  const errors: string[] = [];
  const expect = (c: boolean, m: string) => !c && errors.push(m);

  const profile = profiles.find((p) => p.id === "profile-diabetic-specialist")!;

  const run1 = await runEngine(profile, db, { preferenceWeighting: true });
  const record = buildAuditRecord(profile, run1);

  console.log(`audit ${record.id}`);
  console.log(`  seed ${record.scenarioSeed} · ${record.scenarioCount} scenarios · ranking [${record.ranking.length}]`);
  console.log(`  preferenceWeightingEnabled=${record.preferenceWeightingEnabled} changedTop=${record.preferenceChangedTop}`);

  expect(!!record.profileSnapshot && record.profileSnapshot.id === profile.id, "missing profile snapshot");
  expect(!!record.normalizedProfile, "missing normalized profile");
  expect(record.perPlanScores.length === record.ranking.length, "scores/ranking length mismatch");
  expect(record.perPlanScores.every((s) => "preferenceContribution" in s), "scores missing preferenceContribution");
  expect(record.ranking.length > 0, "empty ranking");
  expect(typeof record.preferenceWeightingEnabled === "boolean", "missing preference flag");

  // Reproducibility: re-run from the SNAPSHOT and compare.
  const run2 = await runEngine(record.profileSnapshot, db, {
    preferenceWeighting: record.preferenceWeightingEnabled,
  });
  const ranking2 = run2.scoring.ranked.map((s) => s.planId);
  expect(run2.sim.seed === record.scenarioSeed, "seed not reproduced");
  expect(
    ranking2.length === record.ranking.length && ranking2.every((p, i) => p === record.ranking[i]),
    "ranking not reproduced",
  );
  console.log(`  reproduced: seed ${run2.sim.seed === record.scenarioSeed ? "✓" : "✗"}, ranking ${ranking2.every((p, i) => p === record.ranking[i]) ? "✓" : "✗"}`);

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ audit record is complete and reproducible.");
}

main();
