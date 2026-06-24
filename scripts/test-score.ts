/**
 * Scoring checks. Run: npm run test:score
 *   - total = expectedFit − downsideRisk (pure fit; NO carrier preference)
 *   - preferenceContribution is 0 for every plan (SMG/SCAN included) — no bias
 *   - the ranking is identical whether or not preference weighting is requested
 *   - the top plan carries at least one positive reason
 */

import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import { POSITIVE_REASONS } from "@/lib/engine/reasons";
import { applyRules, buildRulesContext } from "@/lib/engine/rules";
import { score } from "@/lib/engine/scoring";
import { simulate } from "@/lib/engine/simulate";

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
  const rules = applyRules(profile, plans, ctx);
  const survivingPlans = plans.filter((p) => rules.survivingPlanIds.includes(p.id));
  const sim = simulate(profile, normalized, survivingPlans, ctx);

  const common = {
    profile,
    normalized,
    survivingPlans,
    simSummaries: sim.perPlan,
    rulesLog: rules.log,
    excluded: rules.log.filter((e) => e.severity === "exclude"),
  };
  const on = score({ ...common, preferenceWeighting: true });
  const off = score({ ...common, preferenceWeighting: false });

  console.log("\nRanked (pure fit):");
  for (const ps of on.ranked) {
    const plan = plans.find((p) => p.id === ps.planId)!;
    console.log(
      `  ${(planName.get(ps.planId) ?? ps.planId).padEnd(34)} total ${String(ps.total).padStart(6)} ` +
        `(fit ${ps.expectedFit} − risk ${ps.downsideRisk})` +
        `${plan.smgSupported ? "  [SMG]" : ""}`,
    );
  }

  // consistency: total = expectedFit − downsideRisk, no preference term
  for (const ps of on.ranked) {
    expect(
      Math.abs(ps.total - (ps.expectedFit - ps.downsideRisk)) < 0.05,
      `${ps.planId}: total != expectedFit - downsideRisk`,
    );
    // NO carrier preference: every plan (SMG/SCAN included) gets exactly 0.
    expect(ps.preferenceContribution === 0, `${ps.planId}: a preference was applied (should be 0)`);
  }

  // requesting "preference weighting" must NOT change the ranking — it's pure fit.
  expect(
    on.ranked.map((p) => p.planId).join(",") === off.ranked.map((p) => p.planId).join(","),
    "preference weighting changed the ranking (should be a no-op — pure fit)",
  );
  expect(on.preferenceChangedTop === false, "preferenceChangedTop should always be false (no preference)");

  // top plan has a positive reason
  expect(
    on.ranked[0].reasonCodes.some((c) => POSITIVE_REASONS.has(c)),
    "top plan has no positive reason code",
  );

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ scoring is consistent and purely fit-based (no carrier preference).");
}

main();
