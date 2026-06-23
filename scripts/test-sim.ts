/**
 * Simulation checks. Run: npm run test:sim
 *   - reproducibility: same profile → identical per-plan results (seeded RNG)
 *   - only surviving plans are simulated; default count = 500
 *   - all current meds are covered on every real plan (comprehensive MA), so med
 *     coverage is 100%; differentiation comes from cost-share / MOOP, which must
 *     produce a real spread between the cheapest and most expensive survivor
 */

import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import { applyRules, buildRulesContext } from "@/lib/engine/rules";
import { simulate } from "@/lib/engine/simulate";

const usd = (n: number) => "$" + n.toLocaleString();

async function main() {
  const db = getDataStore();
  const [plans, ctx, profiles] = await Promise.all([
    db.listPlans(),
    buildRulesContext(db),
    db.listExampleProfiles(),
  ]);
  const drugs = [...ctx.drugsById.values()];
  const planName = new Map(plans.map((p) => [p.id, p.name]));
  const errors: string[] = [];
  const expect = (c: boolean, m: string) => !c && errors.push(m);

  const profile = profiles.find((p) => p.id === "profile-diabetic-specialist")!;
  const normalized = normalizeProfile(profile, drugs);
  const survivors = plans.filter((p) => applyRules(profile, plans, ctx).survivingPlanIds.includes(p.id));

  const a = simulate(profile, normalized, survivors, ctx);
  const b = simulate(profile, normalized, survivors, ctx);

  expect(a.count === 500, `default count should be 500, got ${a.count}`);
  expect(a.perPlan.length === survivors.length, "should simulate exactly the surviving plans");
  expect(
    a.perPlan.every((s, i) => s.meanExposure === b.perPlan[i].meanExposure && s.worstExposure === b.perPlan[i].worstExposure),
    "two runs of the same profile must be identical (seeded)",
  );

  console.log(`\nprofile-diabetic-specialist — ${a.count} scenarios, seed ${a.seed}`);
  console.log("journey mix:", a.journeyTypeDistribution);
  const sorted = [...a.perPlan].sort((x, y) => x.meanExposure - y.meanExposure);
  for (const s of sorted) {
    console.log(
      `  ${(planName.get(s.planId) ?? s.planId).padEnd(34)} mean ${usd(s.meanExposure).padStart(9)} ` +
        `worst ${usd(s.worstExposure).padStart(9)}  meds ${Math.round(s.medCoverageRate * 100)}%  ` +
        `catastrophic ${Math.round(s.catastrophicRate * 100)}%`,
    );
  }

  // Every real plan covers this client's generics → 100% med coverage.
  expect(
    a.perPlan.every((s) => s.medCoverageRate === 1),
    "all current meds are on-formulary on every real plan (expect 100% coverage)",
  );
  // Plans must still differentiate on cost: a real spread between best and worst.
  const means = a.perPlan.map((s) => s.meanExposure);
  expect(
    Math.max(...means) > Math.min(...means),
    "cost-share / MOOP differences should produce a spread in mean exposure",
  );

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ simulation is reproducible and surfaces future coverage gaps.");
}

main();
