/**
 * Scoring checks. Run: npm run test:score
 *   - total = expectedFit − downsideRisk + preferenceContribution (consistency)
 *   - preferenceContribution is ≤ cap and 0 for non-SMG plans
 *   - BOUNDED PREFERENCE: the preference-weighted top pick is never more than
 *     `preference.max` below the pure-fit top on pure fit (so preference can't
 *     promote a clearly worse plan)
 *   - the top plan carries at least one positive reason
 */

import { getDataStore } from "@/lib/data";
import { SCORING } from "@/lib/engine/config";
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
  const off = score({ ...common, preferenceWeighting: false }); // total === pure fit

  console.log("\nRanked (preference ON):");
  for (const ps of on.ranked) {
    const plan = plans.find((p) => p.id === ps.planId)!;
    console.log(
      `  ${(planName.get(ps.planId) ?? ps.planId).padEnd(34)} total ${String(ps.total).padStart(6)} ` +
        `(fit ${ps.expectedFit} − risk ${ps.downsideRisk} + pref ${ps.preferenceContribution})` +
        `${plan.smgSupported ? "  [SMG]" : ""}`,
    );
  }
  console.log(`preferenceChangedTop: ${on.preferenceChangedTop}`);

  // consistency
  for (const ps of on.ranked) {
    expect(
      Math.abs(ps.total - (ps.expectedFit - ps.downsideRisk + ps.preferenceContribution)) < 0.05,
      `${ps.planId}: total != expectedFit - downsideRisk + preference`,
    );
    expect(ps.preferenceContribution <= SCORING.preference.max, `${ps.planId}: preference over cap`);
    const plan = plans.find((p) => p.id === ps.planId)!;
    if (!plan.smgSupported) expect(ps.preferenceContribution === 0, `${ps.planId}: non-SMG got preference`);
  }

  // bounded preference: the on-top pick can't be much worse on pure fit
  const pureTopId = off.ranked[0].planId;
  const pureTopFit = off.ranked[0].total;
  const onTopId = on.ranked[0].planId;
  const onTopPureFit = off.ranked.find((p) => p.planId === onTopId)!.total;
  console.log(`\npure-fit top: ${planName.get(pureTopId)} (${pureTopFit})`);
  console.log(`preference top: ${planName.get(onTopId)} (pure fit ${onTopPureFit})`);
  expect(
    onTopPureFit >= pureTopFit - SCORING.preference.max,
    "preference promoted a plan more than the cap below pure-fit top",
  );

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
  console.log("\n✓ scoring is consistent and the preference weight is bounded.");
}

main();
