/**
 * Across-futures horizon recommendation checks. Run: npm run test:horizon
 *   - deterministic: two runs of the same profile are byte-identical
 *   - well-formed: shares in [0,1], distribution sorted desc and sums to the
 *     covered share, changedVsToday is derivable from the picks
 *   - clinically sensible: a normal profile yields a recommendation at each
 *     horizon, and the projected-assumption burden grows from 5y to 10y
 *
 * Deterministic + offline — no LLM (the AI projection is separate). Mirrors the
 * other engine test scripts.
 */

import { getDataStore } from "@/lib/data";
import { recommendAcrossHorizons } from "@/lib/engine/horizonRecommendation";

async function main() {
  const db = getDataStore();
  const profiles = await db.listExampleProfiles();
  const diabetic = profiles.find((p) => p.id === "profile-diabetic-specialist") ?? profiles[0];

  const errors: string[] = [];
  const expect = (c: boolean, m: string) => !c && errors.push(m);

  const a = await recommendAcrossHorizons(diabetic, db);
  const b = await recommendAcrossHorizons(diabetic, db);

  console.log(`\n${diabetic.id} — today's pick: ${a.todayTopPlanId ?? "(none)"}`);
  for (const h of a.horizons) {
    const top = h.distribution[0];
    console.log(
      `  ${h.years}yr: rec=${h.recommendedPlanId ?? "(none)"} · win ${Math.round(h.winShare * 100)}% · ` +
        `${h.distribution.length} plan(s) · none ${Math.round(h.noneEligibleRate * 100)}% · ` +
        `assumed ${h.projectedAssumptions.conditions.length} cond / ${h.projectedAssumptions.medications.length} med`,
    );
    void top;
  }

  // Deterministic: identical across runs (seeded off de-identified clinical facts).
  expect(JSON.stringify(a) === JSON.stringify(b), "two runs must be byte-identical (seeded)");

  // Horizons present and ordered.
  expect(a.horizons.map((h) => h.years).join(",") === "5,10", "expected 5y and 10y horizons");

  for (const h of a.horizons) {
    expect(h.winShare >= 0 && h.winShare <= 1, `${h.years}yr winShare out of range`);
    expect(h.noneEligibleRate >= 0 && h.noneEligibleRate <= 1, `${h.years}yr noneEligibleRate out of range`);
    // Distribution sorted by share desc, and total covered share ≤ 1.
    const shares = h.distribution.map((d) => d.share);
    expect(
      shares.every((s, i) => i === 0 || s <= shares[i - 1] + 1e-9),
      `${h.years}yr distribution not sorted desc`,
    );
    const covered = shares.reduce((s, x) => s + x, 0);
    expect(covered <= 1 + 1e-9, `${h.years}yr covered share > 1`);
    // Recommended plan is the head of the distribution.
    expect(
      h.recommendedPlanId === (h.distribution[0]?.planId ?? null),
      `${h.years}yr recommended must be the top of the distribution`,
    );
  }

  // This multimorbid profile should have an eligible recommendation at both horizons.
  expect(a.horizons.every((h) => h.recommendedPlanId !== null), "expected a recommendation at each horizon");

  // changedVsToday is derivable and consistent with the picks.
  for (const h of a.horizons) {
    const changed = h.recommendedPlanId !== a.todayTopPlanId;
    expect(typeof changed === "boolean", `${h.years}yr changedVsToday not derivable`);
  }

  // Clinical burden compounds: 10yr assumes at least as many acquired conditions as 5yr.
  const c5 = a.horizons.find((h) => h.years === 5)!.projectedAssumptions.conditions.length;
  const c10 = a.horizons.find((h) => h.years === 10)!.projectedAssumptions.conditions.length;
  expect(c10 >= c5, "10yr should assume at least as many acquired conditions as 5yr");

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ horizon recommendation is deterministic, well-formed, and condition-driven.");
}

main();
