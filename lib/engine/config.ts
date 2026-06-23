/**
 * Central engine tunables. Everything a reviewer might want to calibrate lives
 * here, not scattered through the logic. Step 6 adds the scoring weights below.
 */

/** Drug classes whose absence from a formulary is disqualifying, not just a gap. */
export const CRITICAL_DRUG_CLASSES = new Set([
  "long-acting insulin",
  "oncology immunotherapy",
]);

export const SIM_CONFIG = {
  defaultScenarioCount: 500,
  minScenarios: 100,
  maxScenarios: 500,

  monthlyFillsPerYear: 12,

  /** Uncapped member exposure when a needed drug is NOT on formulary (annual $). */
  uncoveredDrugAnnualCost: {
    "oncology immunotherapy": 120000,
    "long-acting insulin": 6000,
    "SGLT2 inhibitor": 6000,
    biguanide: 1200,
    statin: 600,
    SSRI: 600,
    "sedative-hypnotic": 480,
    default: 3600,
  } as Record<string, number>,

  /** Uncapped exposure when a needed provider/system is out of network (annual $). */
  outOfNetworkPenalty: 15000,

  /** A journey is "catastrophic" if uncapped exposure reaches this (annual $). */
  catastrophicThreshold: 25000,

  /** Fallback drug-tier cost share if a covered entry is missing its tier. */
  defaultTierCostShare: 45,
} as const;

/**
 * Health-futures simulation (profile replication + clinical trajectories).
 * Counts/horizon here; the per-year clinical transition rates live in
 * `healthSim.ts` (synthetic, plausible placeholders — calibrate against real
 * actuarial/clinical data later, like the dollar figures above).
 */
export const HEALTH_SIM = {
  defaultReplicas: 250,
  minReplicas: 100,
  maxReplicas: 1000,
  defaultHorizonYears: 5,
  minYears: 1,
  maxYears: 10,
  severeComplexityThreshold: 0.5,
} as const;

/**
 * Across-futures horizon recommendation (lib/engine/horizonRecommendation.ts).
 * The client is projected into `replicas` simulated futures at each horizon and
 * the engine is scored on each; the plan that wins the most futures is the
 * horizon's recommendation. `replicas` and `scenarioCount` (the engine's inner
 * financial loop, per future) are kept below the live defaults so two nested
 * simulations stay responsive — raise them to trade latency for resolution.
 * `assumptionIncidence` is the share of futures a newly-acquired condition/med
 * must reach to be shown as a projected assumption.
 *
 * `scenarioCount` is kept equal to SIM_CONFIG.defaultScenarioCount (500) so each
 * future is scored at the SAME resolution as today's live recommendation — a
 * lower count would let sampling noise flip the pick and produce spurious
 * "changes vs today" flags.
 */
export const HORIZON_REC = {
  horizonsYears: [5, 10],
  replicas: 120, // number of simulated futures per horizon
  // Single source of truth — MUST equal the live engine default so each future is
  // scored at the same resolution as "today" (else sampling noise → spurious
  // "changes vs today"). Referenced, not copied.
  scenarioCount: SIM_CONFIG.defaultScenarioCount,
  assumptionIncidence: 0.2,
  maxDistribution: 5, // plans shown in the win-share distribution
} as const;

/**
 * Scoring weights (step 6). The PlanScore formula is:
 *
 *   expectedFit  = coverageFit + networkFit + medicationFit − mismatchPenalty
 *   downsideRisk = catastrophicDownside
 *   total        = expectedFit − downsideRisk + preferenceContribution
 *
 * Each component is a 0..1 sub-score × its weight here, so tuning lives in one
 * place. `preference.max` is the hard cap on the SMG/SCAN tiebreaker: because it
 * is small relative to the fit weights, it can only reorder plans whose fit is
 * already within `preference.max` points — it can never lift a clearly worse-fit
 * plan above a clearly better one.
 */
export const SCORING = {
  weights: {
    coverageFit: 25, // non-drug benefit alignment (acupuncture, mental health, specialist cost, OOP)
    networkFit: 20, // required + likely-needed providers stay in network
    medicationFit: 30, // current + likely-future Rx coverage across scenarios
    mismatchPenalty: 25, // expected coverage gaps + expected cost
    catastrophicDownside: 40, // worst-case financial exposure
  },
  preference: {
    max: 5, // hard cap on preferenceContribution
    smgSupported: 4, // SMG-supported plans
    scanBonus: 1, // additional for SCAN (→ 5, still ≤ max)
  },
  thresholds: {
    futureMedCoverageStrong: 0.98, // medCoverageRate ≥ → "covers likely future meds"
    medGapRate: 0.9, // medCoverageRate < → "med coverage gap"
    lowCatastrophicRate: 0.01,
    highCatastrophicRate: 0.1,
    lowSpecialistCopay: 15,
    lowMentalHealthCopay: 20,
  },
} as const;
