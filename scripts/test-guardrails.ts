/**
 * Recommendation integrity guardrails:
 *  - parseInpatient parses ALL per-day bands (worst-case non-zero), so real
 *    cost-sharing never silently collapses to $0/day (top risk #2).
 *  - computeAnnualCost derives the headline cost deterministically from grounded
 *    facts + the member's own utilization — never the model (top risk #1, RLM
 *    cost calculation). Covered cost-share caps at the OOP-max; uncovered
 *    (off-formulary) exposure is added uncapped so catastrophic cost isn't hidden.
 */
import { parseInpatient } from "@/lib/data/fixtures/plans";
import { computeAnnualCost } from "@/lib/ai/costCalc";
import type { PlanFacts, RecommendationPatientFacts } from "@/lib/ai/planFactsPack";
import { SIM_CONFIG } from "@/lib/engine/config";
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

console.log("— computeAnnualCost (grounded) —");
const BASE: PlanFacts = {
  planId: "p1", name: "Test", carrier: "C", planType: "HMO", kind: "MA", snpType: "none",
  sourceFile: "f.pdf", sourcePage: 1,
  monthlyPremium: 20, annualOOPMax: 5000, pcpCopay: 0, specialistCopay: 40,
  inpatientPerDay: 100, inpatientDays: 5, mentalHealthOutpatientCopay: 0,
  acupunctureVisitsPerYear: 12, acupunctureCopay: 0,
  drugTiers: [
    { tier: 1, costShare: 0, display: null },
    { tier: 3, costShare: 45, display: null },
  ],
  supplemental: {}, networkSystems: [],
  medicationCoverage: { covered: [], notCovered: [] }, providerGaps: [],
};
const facts = (o: Partial<PlanFacts> = {}): PlanFacts => ({ ...BASE, ...o });
const BASE_PT: RecommendationPatientFacts = {
  age: 70, conditions: [], conditionsCount: 0, medications: [], mustKeepProviders: [], familyHistory: [],
};
const pt = (utilization?: RecommendationPatientFacts["utilization"]): RecommendationPatientFacts => ({ ...BASE_PT, utilization });

const D = SIM_CONFIG.uncoveredDrugAnnualCost.default;
eq("premium only", computeAnnualCost(facts(), pt()).estimatedAnnualTotal, 240);
eq(
  "covered tier-3 med ($45 × 12)",
  computeAnnualCost(facts({ medicationCoverage: { covered: [{ name: "x", tier: 3 }], notCovered: [] } }), pt()).estimatedAnnualTotal,
  240 + 540,
);
eq("reported specialist visits (4 × $40)", computeAnnualCost(facts(), pt({ specialistVisits12mo: 4 })).estimatedAnnualTotal, 240 + 160);
eq(
  "covered cost-share capped at OOP-max",
  computeAnnualCost(facts({ annualOOPMax: 100, medicationCoverage: { covered: [{ name: "x", tier: 3 }], notCovered: [] } }), pt()).estimatedAnnualTotal,
  240 + 100,
);
ok(
  "uncovered drug exposure is UNCAPPED (exceeds premium+OOP-max)",
  computeAnnualCost(facts({ annualOOPMax: 100, medicationCoverage: { covered: [], notCovered: ["y"] } }), pt()).estimatedAnnualTotal === 240 + D,
);

console.log(pass ? "\n✓ recommendation guardrails hold." : "\n✗ guardrail tests FAILED");
process.exit(pass ? 0 : 1);
