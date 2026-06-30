/**
 * Recommendation integrity guardrails:
 *  - parseInpatient parses ALL per-day bands (worst-case non-zero), so real
 *    cost-sharing never silently collapses to $0/day (top risk #2).
 *  - clampAnnualCost bounds the headline cost to the plan's own
 *    [premium, premium + OOP-max] envelope (top risk #1).
 */
import { parseInpatient } from "@/lib/data/fixtures/plans";
import { clampAnnualCost } from "@/lib/ai/recommend";
import sourcePlans from "@/lib/data/source/plans-2026.json";

let pass = true;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) pass = false;
};
const eq = (name: string, got: unknown, want: unknown) =>
  ok(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, JSON.stringify(got) === JSON.stringify(want));

console.log("— parseInpatient —");
eq("tiered bands → worst-case non-zero", parseInpatient("$0/day days 1-3; $50/day days 4-7"), { perDay: 50, days: 4 });
eq("'copay per day for days N-M'", parseInpatient("$295 copay per day for days 1-6"), { perDay: 295, days: 6 });
eq("plain 'per day for days'", parseInpatient("$419 per day for days 1-5"), { perDay: 419, days: 5 });
ok("genuine $0 (unlimited) stays 0", parseInpatient("$0 (unlimited)").perDay === 0);
ok("genuine $0/day stays 0", parseInpatient("$0/day").perDay === 0);
ok("deductible spreads to non-zero", parseInpatient("$1,600 deductible per benefit period").perDay > 0);

// Dataset sweep: any inpatient string naming a non-zero "$N per day" must derive perDay > 0.
const plans = (Array.isArray(sourcePlans) ? sourcePlans : (sourcePlans as { plans?: unknown[] }).plans ?? []) as Array<{
  id?: string;
  planId?: string;
  inpatient?: string;
}>;
let sweepFails = 0;
for (const p of plans) {
  const s = p.inpatient ?? "";
  const hasNonZeroPerDay = /\$\s*[1-9][\d,]*\s*(?:copay\s*)?(?:per\s*day|\/\s*day)/i.test(s);
  if (hasNonZeroPerDay && parseInpatient(s).perDay === 0) {
    console.log(`  ✗ ${p.id ?? p.planId}: "${s}" → perDay 0 (expected > 0)`);
    sweepFails++;
  }
}
ok(`dataset sweep: no non-zero-per-day plan collapses to $0 (${plans.length} plans)`, sweepFails === 0);

console.log("— clampAnnualCost —");
eq("clamp above ceil → premium+oop", clampAnnualCost(99999, 50, 5000), 5600);
eq("clamp below floor → annual premium", clampAnnualCost(0, 50, 5000), 600);
eq("in-envelope unchanged", clampAnnualCost(1200, 50, 5000), 1200);
eq("zero-premium floor is 0", clampAnnualCost(0, 0, 4000), 0);

console.log(pass ? "\n✓ recommendation guardrails hold." : "\n✗ guardrail tests FAILED");
process.exit(pass ? 0 : 1);
