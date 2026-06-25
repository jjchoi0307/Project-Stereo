/**
 * Central engine tunables. Everything a reviewer might want to calibrate lives
 * here, not scattered through the logic. Step 6 adds the scoring weights below.
 */

/**
 * Ensemble voting for the recommendation ranking. The model isn't perfectly
 * deterministic and fit scores can cluster, so a single run's top pick is unstable.
 * We run the cheap SCREEN (ranking) step `runs` times and present the plans that
 * appear in the top 3 most often — frequency, not one run's score, decides the
 * ranking. `runs` is configurable (env ENSEMBLE_RUNS); start ~16 and tune for
 * cost/latency. Only the screen is ensembled — the expensive deep write-ups run
 * ONCE for the voted winners. `concurrency` bounds parallel model calls (Anthropic
 * rate limits); see lib/ai/recommend.ts for the 500-broker load notes.
 */
export const ENSEMBLE = {
  runs: Math.max(1, Number(process.env.ENSEMBLE_RUNS) || 16),
  concurrency: Math.max(1, Number(process.env.ENSEMBLE_CONCURRENCY) || 8),
} as const;

/**
 * Tiebreak rule (named business rule — auditable). When plans are EFFECTIVELY
 * TIED on top-3 votes (within `tieBandVotes`), order is decided purely by MEMBER
 * BENEFIT: lower out-of-pocket max, then lower premium, then plan id. There is NO
 * carrier preference — ties never favor a specific plan/carrier. (A carrier
 * tiebreak was considered and rejected: undisclosed steering is a compliance risk
 * and contradicts the tool's unbiased positioning.)
 */
export const TIEBREAK_RULE = {
  name: "neutral_member_benefit_v1",
  tieBandVotes: Math.max(0, Number(process.env.TIE_BAND_VOTES) || 2),
  order: ["topThreeVotes_desc", "annualOOPMax_asc", "monthlyPremium_asc", "planId_asc"] as const,
} as const;

/**
 * Relative importance of each intake input to the recommendation/projection.
 * Centralized (not hardcoded in logic) so it can later be admin-exposed.
 *
 * Family history + hard clinical inputs (diagnosed conditions, medications, dual
 * eligibility, provider requirements) are PRIMARY — they are facts that should
 * drive eligibility and fit. Self-reported lifestyle is low-weight/advisory
 * context only: it adds color but must never override or drive the projection.
 */
export const INPUT_IMPORTANCE = {
  familyHistory: "high",
  diagnosedConditions: "high",
  medications: "high",
  dualEligibility: "high",
  providerRequirements: "high",
  lifestyle: "low", // self-reported; advisory context only, must not drive the projection
} as const;

/**
 * Build the input-weighting guidance the AI health-future projection consumes,
 * derived from INPUT_IMPORTANCE so it stays in sync with the (admin-configurable)
 * config rather than being hardcoded in each prompt.
 */
export function importanceGuidance(): string {
  const high = Object.entries(INPUT_IMPORTANCE).filter(([, v]) => v === "high").map(([k]) => k);
  const low = Object.entries(INPUT_IMPORTANCE).filter(([, v]) => v === "low").map(([k]) => k);
  return (
    `INPUT WEIGHTING (configurable): weight HIGH-importance inputs heavily — ${high.join(", ")} — as the primary drivers. ` +
    `Treat LOW-importance, self-reported inputs — ${low.join(", ")} (e.g. steps, sleep, self-rated health) — as light advisory context only: ` +
    `they may add color but a single self-reported value must NOT drive or swing the projection.`
  );
}

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
  // Resolution of the nested simulation. Lowered from 120/500 after a stability
  // A/B (scripts/ab-horizon.ts): 64/300 reproduced the 120/500 top pick on 100% of
  // 78 patients across both horizons (max win-share drift 2.2%) at ~2.2× the speed.
  // The horizon's per-future runs AND its internal "today baseline" use this SAME
  // count, so "changes vs today" stays driven by clinical change, not sampling noise.
  replicas: 64, // number of simulated futures per horizon
  scenarioCount: 300, // engine's inner financial loop, per future
  assumptionIncidence: 0.2,
  maxDistribution: 5, // plans shown in the win-share distribution
} as const;

/**
 * Scoring weights (step 6). The PlanScore formula is:
 *
 *   expectedFit  = coverageFit + networkFit + medicationFit − mismatchPenalty
 *   downsideRisk = catastrophicDownside
 *   total        = expectedFit − downsideRisk
 *
 * Each component is a 0..1 sub-score × its weight here, so tuning lives in one
 * place. Ranking is 100% pure fit — there is NO carrier/plan preference: every
 * plan is scored purely on how it fits the client's facts, with no SMG/SCAN bias.
 */
export const SCORING = {
  weights: {
    coverageFit: 25, // non-drug benefit alignment (acupuncture, mental health, specialist cost, OOP)
    networkFit: 20, // required + likely-needed providers stay in network
    medicationFit: 30, // current + likely-future Rx coverage across scenarios
    mismatchPenalty: 25, // expected coverage gaps + expected cost
    catastrophicDownside: 40, // worst-case financial exposure
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
