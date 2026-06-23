/**
 * Layer 5 — scoring & aggregation. Turns the simulation summaries into a ranked
 * recommendation. Implements the brief's PlanScore formula (weights in config):
 *
 *   expectedFit  = coverageFit + networkFit + medicationFit − mismatchPenalty
 *   downsideRisk = catastrophicDownside
 *   total        = expectedFit − downsideRisk + preferenceContribution
 *
 * `preferenceContribution` is a small, bounded, LOGGED tiebreaker for
 * SMG-supported / SCAN plans. It is capped at `SCORING.preference.max`, so it can
 * only reorder plans whose fit is already within that many points — it can never
 * lift a clearly worse-fit plan above a clearly better one. We also rank by pure
 * fit (preference off) and report whether preference changed the top pick, so a
 * reviewer can see both side by side.
 */

import type {
  ClientProfileInput,
  ExclusionLogEntry,
  NormalizedProfile,
  Plan,
  PlanScore,
  ReasonCode,
} from "@/lib/domain";
import type { PlanSimulationSummary } from "./simulate";
import { SCORING } from "./config";

const RANK: Record<string, number> = { low: 0, moderate: 1, high: 2, very_high: 3 };

function minMax(xs: number[]): [number, number] {
  return [Math.min(...xs), Math.max(...xs)];
}
const norm = (x: number, lo: number, hi: number) => (hi === lo ? 0 : (x - lo) / (hi - lo));

export interface ScoringResult {
  profileId: string;
  ranked: PlanScore[]; // by total desc (preference applied if enabled)
  excluded: ExclusionLogEntry[];
  topPlanId: string | null;
  preferenceWeightingEnabled: boolean;
  preferenceChangedTop: boolean; // top pick differs from the pure-fit top
}

export function score(input: {
  profile: ClientProfileInput;
  normalized: NormalizedProfile;
  survivingPlans: Plan[];
  simSummaries: PlanSimulationSummary[];
  rulesLog: ExclusionLogEntry[]; // flags carried by survivors (e.g. med off-formulary)
  excluded: ExclusionLogEntry[]; // hard-exclusion entries for removed plans
  preferenceWeighting: boolean;
}): ScoringResult {
  const { profile, normalized, survivingPlans, simSummaries, rulesLog, excluded, preferenceWeighting } = input;

  if (survivingPlans.length === 0) {
    return {
      profileId: profile.id,
      ranked: [],
      excluded,
      topPlanId: null,
      preferenceWeightingEnabled: preferenceWeighting,
      preferenceChangedTop: false,
    };
  }

  const summaryById = new Map(simSummaries.map((s) => [s.planId, s]));
  const W = SCORING.weights;
  const T = SCORING.thresholds;

  // Cross-plan ranges for min-max normalization (so components are comparable).
  const [meanLo, meanHi] = minMax(simSummaries.map((s) => s.meanExposure));
  const [worstLo, worstHi] = minMax(simSummaries.map((s) => s.worstExposure));
  const [stdLo, stdHi] = minMax(simSummaries.map((s) => s.stdExposure));
  const [oopLo, oopHi] = minMax(survivingPlans.map((p) => p.benefits.annualOOPMax));
  const [specLo, specHi] = minMax(survivingPlans.map((p) => p.benefits.specialistCopay));
  const [mhLo, mhHi] = minMax(survivingPlans.map((p) => p.benefits.mentalHealthOutpatientCopay));

  const usesAcupuncture = (profile.utilization?.acupunctureVisits12mo ?? 0) > 0;
  const mhMatters = RANK[normalized.mentalHealthUtilization.band] >= RANK.moderate;
  const specMatters = RANK[normalized.specialistNeed.band] >= RANK.moderate;
  const hasHardProviders = profile.providerConstraints.some((c) => c.hardRequirement);

  const scores: (PlanScore & { pureTotal: number })[] = survivingPlans.map((plan) => {
    const s = summaryById.get(plan.id)!;
    const b = plan.benefits;
    const hasMedFlag = rulesLog.some((e) => e.planId === plan.id && e.reason === "medication_off_formulary");

    // coverageFit — non-drug benefit alignment to THIS client's needs.
    const subs: number[] = [1 - norm(b.annualOOPMax, oopLo, oopHi)]; // OOP protection always counts
    if (usesAcupuncture) {
      const client = profile.utilization!.acupunctureVisits12mo!;
      subs.push(Math.min(1, b.acupunctureVisitsPerYear / Math.max(1, client)));
    }
    if (mhMatters) subs.push(1 - norm(b.mentalHealthOutpatientCopay, mhLo, mhHi));
    if (specMatters) subs.push(1 - norm(b.specialistCopay, specLo, specHi));
    const coverageFit01 = subs.reduce((a, x) => a + x, 0) / subs.length;

    const medicationFit01 = s.medCoverageRate;
    const networkFit01 = 1 - s.networkGapRate;
    const mismatch01 = 0.5 * (1 - s.medCoverageRate) + 0.5 * norm(s.meanExposure, meanLo, meanHi);
    const catastrophic01 = 0.6 * s.catastrophicRate + 0.4 * norm(s.worstExposure, worstLo, worstHi);
    const confidence01 = 1 - norm(s.stdExposure, stdLo, stdHi);

    const coverageFit = coverageFit01 * W.coverageFit;
    const networkFit = networkFit01 * W.networkFit;
    const medicationFit = medicationFit01 * W.medicationFit;
    const mismatchPenalty = mismatch01 * W.mismatchPenalty;
    const catastrophicDownside = catastrophic01 * W.catastrophicDownside;

    const expectedFit = coverageFit + networkFit + medicationFit - mismatchPenalty;
    const downsideRisk = catastrophicDownside;

    let preferenceContribution = 0;
    if (preferenceWeighting && plan.smgSupported) {
      preferenceContribution = Math.min(
        SCORING.preference.max,
        SCORING.preference.smgSupported + (plan.isScan ? SCORING.preference.scanBonus : 0),
      );
    }

    // Round components first, then derive totals from the rounded values so the
    // arithmetic a broker (or auditor) sees adds up exactly.
    const expectedFitR = round(expectedFit);
    const downsideRiskR = round(downsideRisk);
    const pureTotal = round(expectedFitR - downsideRiskR);
    const total = round(expectedFitR - downsideRiskR + preferenceContribution);

    // Reason codes (positives first, then caveats).
    const reasonCodes: ReasonCode[] = [];
    if (!hasMedFlag) reasonCodes.push("covers_all_current_meds");
    if (s.medCoverageRate >= T.futureMedCoverageStrong) reasonCodes.push("covers_likely_future_meds");
    if (hasHardProviders && s.networkGapRate === 0) reasonCodes.push("keeps_required_providers");
    if (specMatters && b.specialistCopay <= T.lowSpecialistCopay) reasonCodes.push("strong_specialist_access");
    if (s.catastrophicRate <= T.lowCatastrophicRate) reasonCodes.push("low_catastrophic_exposure");
    if (usesAcupuncture && b.acupunctureVisitsPerYear >= (profile.utilization?.acupunctureVisits12mo ?? 0))
      reasonCodes.push("acupuncture_well_covered");
    if (mhMatters && b.mentalHealthOutpatientCopay <= T.lowMentalHealthCopay)
      reasonCodes.push("mental_health_well_covered");
    if (hasMedFlag || s.medCoverageRate < T.medGapRate) reasonCodes.push("med_coverage_gap");
    if (s.networkGapRate > 0) reasonCodes.push("network_gap_risk");
    if (s.catastrophicRate >= T.highCatastrophicRate) reasonCodes.push("high_catastrophic_exposure");

    return {
      planId: plan.id,
      expectedFit: expectedFitR,
      downsideRisk: downsideRiskR,
      confidence: round(confidence01 * 100),
      preferenceContribution,
      total,
      reasonCodes,
      pureTotal,
    };
  });

  const ranked = [...scores].sort((a, b) => b.total - a.total);
  const pureTop = [...scores].sort((a, b) => b.pureTotal - a.pureTotal)[0];

  const strip = ({ pureTotal: _pure, ...rest }: PlanScore & { pureTotal: number }): PlanScore => rest;

  return {
    profileId: profile.id,
    ranked: ranked.map(strip),
    excluded,
    topPlanId: ranked[0]?.planId ?? null,
    preferenceWeightingEnabled: preferenceWeighting,
    preferenceChangedTop: preferenceWeighting && ranked[0]?.planId !== pureTop?.planId,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
