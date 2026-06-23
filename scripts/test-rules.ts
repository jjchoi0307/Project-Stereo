/**
 * Rules-engine checks against the example profiles. Run: npm run test:rules
 *   - UCLA-required: every survivor's network includes UCLA; ≥1 plan excluded for
 *     dropping UCLA; survivors > 0. (Only the UHC UCLA Health MA plans carry UCLA.)
 *   - diabetic (reg-la): out-of-region plans (NorCal-only, OC-only, SD-only) are
 *     excluded; survivors remain and all current meds are on-formulary (these are
 *     comprehensive MA plans — no fabricated off-formulary gap).
 */

import { getDataStore } from "@/lib/data";
import { applyRules, buildRulesContext } from "@/lib/engine/rules";

async function main() {
  const db = getDataStore();
  const [plans, ctx, profiles] = await Promise.all([
    db.listPlans(),
    buildRulesContext(db),
    db.listExampleProfiles(),
  ]);
  const errors: string[] = [];
  const expect = (c: boolean, m: string) => !c && errors.push(m);

  for (const profile of profiles) {
    const r = applyRules(profile, plans, ctx);
    console.log(`\n${profile.id}: ${r.survivingPlanIds.length} survive, ${r.excludedPlanIds.length} excluded`);
    for (const id of r.excludedPlanIds) {
      const reasons = r.log.filter((e) => e.planId === id && e.severity === "exclude").map((e) => e.detail);
      console.log(`  ✗ ${id}: ${reasons.join("; ")}`);
    }
    const flags = r.log.filter((e) => e.severity === "flag");
    for (const f of flags) console.log(`  ⚑ ${f.planId}: ${f.detail}`);

    expect(r.survivingPlanIds.length > 0, `${profile.id}: no surviving plans`);

    if (profile.id === "profile-ucla-required") {
      for (const id of r.survivingPlanIds) {
        const net = ctx.networks.get(plans.find((p) => p.id === id)!.networkId);
        expect(!!net?.systemIds.includes("sys-ucla"), `${id} survived without UCLA in network`);
      }
      expect(
        r.log.some((e) => e.reason === "provider_out_of_network"),
        "expected at least one plan excluded for dropping UCLA",
      );
    }

    if (profile.id === "profile-diabetic-specialist") {
      expect(
        r.log.some((e) => e.reason === "region_unavailable"),
        "expected some out-of-region exclusions",
      );
      // All of this client's meds (metformin, atorvastatin, lisinopril) are
      // covered generics, so no surviving plan should drop one as critical.
      expect(
        !r.log.some((e) => e.reason === "medication_off_formulary" && e.severity === "exclude"),
        "no current med should be off-formulary on a surviving plan",
      );
    }
  }

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ rules engine excludes and flags as expected.");
}

main();
