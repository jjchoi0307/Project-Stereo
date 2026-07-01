/**
 * Grounded annual-cost calculation for the recommendation.
 *
 * RLM principle: the model ORCHESTRATES and NARRATES; it must never compute a
 * dollar figure. So the member's predicted annual out-of-pocket cost is decomposed
 * here into grounded components — premium, covered-drug cost-share, reported-visit
 * cost-share, inpatient, and uncovered-drug exposure — and each leaf is computed
 * deterministically from the plan's parsed facts + the member's OWN reported
 * utilization. Every dollar traces to a plan figure or a member input; nothing is
 * invented. This is the integrity fix for "headline cost shown with no grounding."
 *
 * Cost model (mirrors lib/engine/simulate.ts so the displayed number and the
 * simulation agree): COVERED cost-share is capped at the plan's in-network OOP
 * maximum; UNCOVERED (off-formulary) drug exposure is added uncapped (it does not
 * count toward the MOOP), so a genuine catastrophic exposure is shown, not hidden.
 *
 * server-only via the PlanFacts types it consumes.
 */
import "server-only";
import { SIM_CONFIG } from "@/lib/engine/config";
import type { PlanFacts, RecommendationPatientFacts } from "./planFactsPack";

export interface GroundedCostItem {
  label: string;
  annualEstimate: number;
  basis: string;
}
export interface GroundedCost {
  items: GroundedCostItem[];
  estimatedAnnualTotal: number;
}

const round = (n: number) => Math.max(0, Math.round(n || 0));

export function computeAnnualCost(facts: PlanFacts, patient: RecommendationPatientFacts): GroundedCost {
  const items: GroundedCostItem[] = [];
  const fills = SIM_CONFIG.monthlyFillsPerYear;

  // 1. Premium — always paid.
  const premium = round(facts.monthlyPremium * 12);
  items.push({ label: "Plan premium", annualEstimate: premium, basis: `$${facts.monthlyPremium}/mo × 12` });

  // 2. Covered medications — tier cost-share × annual fills (capped below by OOP-max).
  const tierShare = (tier?: number): number => {
    const fromTier = tier != null ? facts.drugTiers.find((t) => t.tier === tier)?.costShare : undefined;
    return fromTier ?? SIM_CONFIG.defaultTierCostShare;
  };
  let coveredShare = 0;
  for (const med of facts.medicationCoverage.covered) {
    const annual = round(tierShare(med.tier) * fills);
    coveredShare += annual;
    if (annual > 0) {
      items.push({
        label: `${med.name} (covered)`,
        annualEstimate: annual,
        basis: `Tier ${med.tier ?? "?"} cost-share $${tierShare(med.tier)} × ${fills} fills`,
      });
    }
  }

  // 3. Reported specialist visits × this plan's specialist copay.
  const specVisits = patient.utilization?.specialistVisits12mo ?? 0;
  if (specVisits > 0 && facts.specialistCopay > 0) {
    const annual = round(specVisits * facts.specialistCopay);
    coveredShare += annual;
    items.push({
      label: "Specialist visits",
      annualEstimate: annual,
      basis: `${specVisits} reported visits/yr × $${facts.specialistCopay} copay`,
    });
  }

  // 4. Reported acupuncture visits, capped at the plan's covered allowance.
  const acuUsed = patient.utilization?.acupunctureVisits12mo ?? 0;
  const acuCovered = Math.min(acuUsed, facts.acupunctureVisitsPerYear);
  if (acuCovered > 0 && facts.acupunctureCopay > 0) {
    const annual = round(acuCovered * facts.acupunctureCopay);
    coveredShare += annual;
    items.push({
      label: "Acupuncture visits",
      annualEstimate: annual,
      basis: `${acuCovered} covered visits × $${facts.acupunctureCopay} copay`,
    });
  }

  // 5. Reported inpatient stays — per-day share × days, per stay.
  const inpatientEvents = patient.utilization?.priorYearInpatientEvents ?? 0;
  if (inpatientEvents > 0 && facts.inpatientPerDay > 0) {
    const annual = round(inpatientEvents * facts.inpatientPerDay * facts.inpatientDays);
    coveredShare += annual;
    items.push({
      label: "Inpatient stays",
      annualEstimate: annual,
      basis: `${inpatientEvents} stay(s) × $${facts.inpatientPerDay}/day × ${facts.inpatientDays} days`,
    });
  }

  // Covered cost-share is capped at the plan's in-network OOP maximum.
  const oopMax = round(facts.annualOOPMax);
  const cappedCovered = Math.min(round(coveredShare), oopMax);
  if (round(coveredShare) > oopMax) {
    items.push({
      label: "In-network out-of-pocket maximum reached",
      annualEstimate: 0,
      basis: `Covered cost-share capped at this plan's $${oopMax} in-network OOP max`,
    });
  }

  // 6. Uncovered (off-formulary) current meds — paid in full, NOT capped by the
  // MOOP. Surfaced so a real catastrophic exposure is shown, not hidden.
  let uncovered = 0;
  for (const name of facts.medicationCoverage.notCovered) {
    const annual = SIM_CONFIG.uncoveredDrugAnnualCost.default;
    uncovered += annual;
    items.push({
      label: `${name} (not on formulary)`,
      annualEstimate: annual,
      basis: `Assumed out-of-pocket — not covered by this plan; does not count toward the OOP max`,
    });
  }

  // 7. Part B premium give-back — real money returned to the member each month,
  // so it lowers their true annual cost. Shown as a credit line and netted against
  // the total (floored at $0 so a give-back that exceeds modeled spend doesn't
  // display as a negative headline cost).
  const giveback = round((facts.partBGivebackMonthly ?? 0) * 12);
  if (giveback > 0) {
    items.push({
      label: "Part B premium give-back",
      annualEstimate: -giveback,
      basis: `−$${facts.partBGivebackMonthly}/mo returned to the member × 12`,
    });
  }

  const total = Math.max(0, round(premium + cappedCovered + uncovered - giveback));
  return { items, estimatedAnnualTotal: total };
}
