/**
 * Map the AI recommendation (lib/ai/recommend.ts) into the response shape the
 * recommendation UI already consumes — so the AI becomes the SOURCE of the
 * ranking, fit score, reasons, bullets, and citations without a UI rewrite.
 *
 * The fit-score breakdown bars are the AI's five sub-scores × their weights; the
 * exposure stats are a mix of deterministic file facts (MOOP ceiling, meds-covered
 * rate) and the AI's grounded estimates (typical/worst cost). Every cited figure
 * traces to a plan PDF + page.
 */

import type { Plan } from "@/lib/domain";
import { SCORING } from "@/lib/engine/config";
import type { Citation } from "@/components/ui/Citation";
import type { AiRankedPlan, AiReason } from "./recommend";

const W = SCORING.weights;

export const planMeta = (p: Plan) => ({
  id: p.id,
  name: p.name,
  carrier: p.carrier,
  planType: p.planType,
  snpType: p.snpType,
  smgSupported: p.smgSupported,
  isScan: p.isScan,
  isCompetitor: p.isCompetitor,
  monthlyPremium: p.benefits.monthlyPremium,
  annualOOPMax: p.benefits.annualOOPMax,
});

const confidenceNum = (c: AiRankedPlan["confidence"]) =>
  c === "high" ? 85 : c === "moderate" ? 55 : 20;

const toCitation = (r: AiReason): Citation | null =>
  r.citation
    ? { sourceFile: r.citation.sourceFile, page: r.citation.sourcePage, quote: r.citation.quote, kind: "document" }
    : null;

/** "in network" | "gap risk" | "keeps required" — derived from the deterministic facts. */
export type NetworkStatus = "in" | "gap" | "keeps";

/**
 * Shape one AI-ranked plan into the route's ranked-item contract. `mustKeep`
 * indicates the member had a hard provider requirement (drives "keeps required").
 */
export function shapeRankedPlan(item: AiRankedPlan, plan: Plan, mustKeep: boolean) {
  const s = item.subScores;
  const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
  const why = item.subScoreWhy;
  const breakdown = {
    coverageFit: { value: clamp01(s.coverageFit) * W.coverageFit, max: W.coverageFit, why: why?.coverageFit ?? null },
    networkFit: { value: clamp01(s.networkFit) * W.networkFit, max: W.networkFit, why: why?.networkFit ?? null },
    medicationFit: { value: clamp01(s.medicationFit) * W.medicationFit, max: W.medicationFit, why: why?.medicationFit ?? null },
    mismatchPenalty: { value: clamp01(s.mismatchPenalty) * W.mismatchPenalty, max: W.mismatchPenalty, why: why?.mismatchPenalty ?? null },
    catastrophicDownside: { value: clamp01(s.catastrophicDownside) * W.catastrophicDownside, max: W.catastrophicDownside, why: why?.catastrophicDownside ?? null },
    preference: 0,
  };
  const expectedFit =
    breakdown.coverageFit.value + breakdown.networkFit.value + breakdown.medicationFit.value - breakdown.mismatchPenalty.value;

  const networkStatus: NetworkStatus =
    item.providerGaps.length > 0 ? "gap" : mustKeep ? "keeps" : "in";

  // Comparable feature matrix for the side-by-side top-3 ("includes / does not
  // include"). Values are verbatim from the plan file; null supplemental = not offered.
  const sup = plan.supplemental;
  const ben = plan.benefits;
  const feat = (label: string, value: string | null) => ({ label, value: value ?? null, included: value != null });
  const features = [
    { label: "Monthly premium", value: ben.monthlyPremium === 0 ? "$0" : `$${ben.monthlyPremium}`, included: true },
    { label: "Out-of-pocket max", value: `$${ben.annualOOPMax.toLocaleString()}`, included: true },
    {
      label: "Your medications covered",
      value: `${Math.round(item.medsCoveredRate * 100)}% covered`,
      included: item.medsCoveredRate >= 0.999,
    },
    feat("Dental", sup.dental),
    feat("Vision", sup.vision),
    feat("Hearing", sup.hearing),
    feat("OTC / flex allowance", sup.otc ?? sup.flexAllowance),
    feat("Transportation", sup.transportation),
    feat("Fitness", sup.fitness),
  ];

  return {
    planId: item.planId,
    plan: planMeta(plan),
    total: item.fitScore,
    topThreeVotes: item.topThreeVotes,
    features,
    expectedFit: Math.round(expectedFit * 10) / 10,
    downsideRisk: Math.round(breakdown.catastrophicDownside.value * 10) / 10,
    confidence: confidenceNum(item.confidence),
    preferenceContribution: 0,
    networkStatus,
    providerGaps: item.providerGaps,
    reasons: item.reasons.map((r, i) => ({
      code: `r${i}`,
      text: r.text,
      positive: r.positive,
      citation: toCitation(r),
    })),
    breakdown,
    costBreakdown: item.costBreakdown ?? null,
    deepWritten: item.deepWritten,
    exposure: {
      mean: item.estAnnualCost,
      worst: item.annualOOPMax,
      medCoverageRate: item.medsCoveredRate,
      catastrophicRate: item.catastrophicExposure,
      topUncoveredDrugs: item.topUncoveredDrugs.map((name) => ({ name, rate: 1 })),
    },
  };
}
