/**
 * Health-futures checks. Run: npm run test:health
 *   - reproducible (seeded): two runs of the same profile are identical
 *   - replicas/horizon respected
 *   - the diabetic profile shows meaningful diabetes progression and is more
 *     clinically complex than the low-risk (hyperlipidemia-only) profile
 */

import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import { simulateHealthFutures } from "@/lib/engine/healthSim";

const pct = (n: number) => Math.round(n * 100) + "%";

async function main() {
  const db = getDataStore();
  const [drugs, profiles] = await Promise.all([db.listDrugs(), db.listExampleProfiles()]);
  const errors: string[] = [];
  const expect = (c: boolean, m: string) => !c && errors.push(m);

  const diabetic = profiles.find((p) => p.id === "profile-diabetic-specialist")!;
  const lowRisk = profiles.find((p) => p.id === "profile-ucla-required")!;

  const dn = normalizeProfile(diabetic, drugs);
  const a = simulateHealthFutures(diabetic, dn);
  const b = simulateHealthFutures(diabetic, dn);

  console.log(`\n${diabetic.id} — ${a.replicas} replicas · ${a.horizonYears}-yr · seed ${a.seed}`);
  console.log(`  stable ${pct(a.stableRate)} · severe ${pct(a.severeRate)} · mean complexity ${a.meanComplexity}`);
  for (const o of a.outcomeIncidence) console.log(`  ${pct(o.rate).padStart(4)}  ${o.outcome}`);

  expect(a.replicas === 250 && a.horizonYears === 5, "defaults should be 250 replicas / 5 years");
  expect(
    JSON.stringify(a.outcomeIncidence) === JSON.stringify(b.outcomeIncidence) && a.meanComplexity === b.meanComplexity,
    "two runs must be identical (seeded)",
  );
  const insulin = a.outcomeIncidence.find((o) => o.outcome === "insulin_initiation");
  expect(!!insulin && insulin.rate > 0.05, "diabetic profile should show some insulin initiation");
  expect(a.outcomeIncidence.some((o) => o.outcome === "diabetes_intensified"), "expected diabetes intensification");

  const ln = normalizeProfile(lowRisk, drugs);
  const low = simulateHealthFutures(lowRisk, ln);
  console.log(`\n${lowRisk.id} — mean complexity ${low.meanComplexity} · stable ${pct(low.stableRate)}`);
  expect(a.meanComplexity > low.meanComplexity, "diabetic profile should be more complex than low-risk profile");

  // small horizon respected
  const short = simulateHealthFutures(diabetic, dn, { years: 2, replicas: 100 });
  expect(short.horizonYears === 2 && short.replicas === 100, "custom replicas/years not respected");

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ health futures are reproducible and condition-driven.");
}

main();
