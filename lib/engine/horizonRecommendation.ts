/**
 * Across-futures horizon recommendation — the time dimension of the recommendation.
 *
 * The deterministic health simulation (healthSim.ts) replicates the client into
 * many seeded synthetic FUTURES at a horizon, each with its own acquired
 * conditions/medications. This module projects the client's profile forward into
 * each of those futures (advance age, add the acquired facts) and runs the SAME
 * `runEngine()` on each — then recommends the plan that wins the most futures.
 *
 * Fully deterministic and inside the one computation path (invariant #1): every
 * per-future pick is a real `runEngine()` result, just on a projected profile.
 * No LLM is involved — the AI projection (lib/sim/) only narrates this.
 */

import type {
  ClientProfileInput,
  ConditionFlag,
  Drug,
  DrugId,
  ReasonCode,
} from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { DATA_VERSION, ENGINE_VERSION } from "@/lib/version";
import { HORIZON_REC } from "./config";
import { simulateReplicas, type ProfileReplica } from "./healthSim";
import { normalizeProfile } from "./normalize";
import { buildEngineCatalog, runEngine, type EngineCatalog } from "./pipeline";

/** Resolution of the nested simulation. Overridable for A/B; defaults from config. */
interface HorizonResolution {
  replicas: number;
  scenarioCount: number;
}

export interface HorizonPlanShare {
  planId: string;
  count: number;
  share: number; // 0..1
}

export interface HorizonExposure {
  mean: number;
  worst: number;
  medCoverageRate: number;
  catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}

export interface HorizonRecommendation {
  years: number;
  replicas: number;
  scenarioCount: number;
  /** Plan that won the most simulated futures (null if most futures had none eligible). */
  recommendedPlanId: string | null;
  /** Share of futures the recommended plan won (0..1). */
  winShare: number;
  /** Share of futures in which NO plan survived the hard rules. */
  noneEligibleRate: number;
  /** Win share per plan, best-first (capped at HORIZON_REC.maxDistribution). */
  distribution: HorizonPlanShare[];
  /** Reason codes from a representative future where the recommended plan won. */
  representativeReasonCodes: ReasonCode[];
  representativeExposure: HorizonExposure | null;
  /** What the futures assumed had changed about the client by this horizon. */
  projectedAssumptions: {
    conditions: { flag: ConditionFlag; incidence: number }[];
    medications: { name: string; incidence: number }[];
  };
}

export interface HorizonsResult {
  /** Today's delivered top pick, for the "what changed" comparison. */
  todayTopPlanId: string | null;
  horizons: HorizonRecommendation[];
}

/** Project the client into one simulated future: advance age, add acquired facts. */
function projectProfile(
  profile: ClientProfileInput,
  replica: ProfileReplica,
  years: number,
  drugsById: Map<DrugId, Drug>,
): ClientProfileInput {
  const acquiredMeds = replica.acquiredDrugIds.map((id) => {
    const name = drugsById.get(id)?.name ?? id;
    return { raw: name, drugId: id, name };
  });
  return {
    ...profile,
    age: profile.age + years,
    conditions: [...new Set([...profile.conditions, ...replica.acquiredConditions])],
    medications: [...profile.medications, ...acquiredMeds],
  };
}

export interface ExpectedProjection {
  /** The member's facts advanced to the horizon (age + likely-acquired conditions/meds). */
  profile: ClientProfileInput;
  /** What was added, for display (each with the share of futures it appeared in). */
  addedConditions: { flag: ConditionFlag; incidence: number }[];
  addedMedications: { name: string; drugId: DrugId; incidence: number }[];
}

/**
 * Build the single EXPECTED projected profile for a horizon: the member's current
 * facts plus every condition/medication that appears in ≥ `assumptionIncidence` of
 * the seeded synthetic futures (drug ids preserved, so formulary matching still
 * works downstream). Deterministic (seeded off the de-identified facts), so it's
 * stable per facts-version.
 *
 * The AI horizon path runs Today's EXACT recommendation pipeline (`recommendPlans`)
 * on this profile — so "3-year / 5-year" is just Today's recommendation applied to
 * the member's likely future, no bespoke scoring path.
 */
export async function projectExpectedProfile(
  profile: ClientProfileInput,
  db: DataStore,
  years: number,
): Promise<ExpectedProjection> {
  const catalog = await buildEngineCatalog(db);
  const drugsById = catalog.ctx.drugsById;
  const normalized = normalizeProfile(profile, [...drugsById.values()]);
  const { replicas } = simulateReplicas(profile, normalized, { years, replicas: HORIZON_REC.replicas });
  const total = replicas.length || 1;

  const condCount = new Map<ConditionFlag, number>();
  const drugCount = new Map<DrugId, number>();
  for (const rep of replicas) {
    rep.acquiredConditions.forEach((c) => condCount.set(c, (condCount.get(c) ?? 0) + 1));
    rep.acquiredDrugIds.forEach((id) => drugCount.set(id, (drugCount.get(id) ?? 0) + 1));
  }
  const over = (n: number) => n / total >= HORIZON_REC.assumptionIncidence;
  const haveCond = new Set(profile.conditions);
  const haveDrug = new Set(profile.medications.map((m) => m.drugId).filter(Boolean));

  const addedConditions = [...condCount.entries()]
    .filter(([flag, c]) => over(c) && !haveCond.has(flag))
    .map(([flag, c]) => ({ flag, incidence: c / total }))
    .sort((a, b) => b.incidence - a.incidence);
  const addedMedications = [...drugCount.entries()]
    .filter(([id, c]) => over(c) && !haveDrug.has(id))
    .map(([id, c]) => ({ name: drugsById.get(id)?.name ?? id, drugId: id, incidence: c / total }))
    .sort((a, b) => b.incidence - a.incidence);

  const projected: ClientProfileInput = {
    ...profile,
    age: profile.age + years,
    conditions: [...new Set([...profile.conditions, ...addedConditions.map((c) => c.flag)])],
    medications: [
      ...profile.medications,
      ...addedMedications.map((m) => ({ raw: m.name, name: m.name, drugId: m.drugId })),
    ],
  };
  return { profile: projected, addedConditions, addedMedications };
}

async function recommendOneHorizon(
  profile: ClientProfileInput,
  db: DataStore,
  catalog: EngineCatalog,
  normalized: ReturnType<typeof normalizeProfile>,
  years: number,
  res: HorizonResolution,
): Promise<HorizonRecommendation> {
  const drugsById = catalog.ctx.drugsById;
  const { replicas } = simulateReplicas(profile, normalized, { years, replicas: res.replicas });

  // One record per simulated future — lets us pick a representative (median-acuity)
  // future for the recommended plan, not the arbitrary first one it happened to win.
  interface FutureRun {
    complexity: number;
    topPlanId: string | null;
    reasonCodes: ReasonCode[];
    exposure: HorizonExposure | null;
  }
  const runs: FutureRun[] = [];
  const winCount = new Map<string, number>();
  const condCount = new Map<ConditionFlag, number>();
  const drugCount = new Map<DrugId, number>();
  let none = 0;

  for (const rep of replicas) {
    rep.acquiredConditions.forEach((c) => condCount.set(c, (condCount.get(c) ?? 0) + 1));
    rep.acquiredDrugIds.forEach((id) => drugCount.set(id, (drugCount.get(id) ?? 0) + 1));

    const projected = projectProfile(profile, rep, years, drugsById);
    const run = await runEngine(projected, db, {
      preferenceWeighting: true,
      count: res.scenarioCount,
      catalog,
    });

    const topId = run.scoring.topPlanId;
    if (!topId) {
      none++;
      runs.push({ complexity: rep.complexityScore, topPlanId: null, reasonCodes: [], exposure: null });
      continue;
    }
    winCount.set(topId, (winCount.get(topId) ?? 0) + 1);

    const ps = run.scoring.ranked.find((r) => r.planId === topId);
    const s = run.sim.perPlan.find((p) => p.planId === topId);
    runs.push({
      complexity: rep.complexityScore,
      topPlanId: topId,
      reasonCodes: ps?.reasonCodes ?? [],
      exposure: s
        ? {
            mean: s.meanExposure,
            worst: s.worstExposure,
            medCoverageRate: s.medCoverageRate,
            catastrophicRate: s.catastrophicRate,
            topUncoveredDrugs: s.topUncoveredDrugs,
          }
        : null,
    });
  }

  const total = replicas.length;
  const distribution: HorizonPlanShare[] = [...winCount.entries()]
    .map(([planId, count]) => ({ planId, count, share: count / total }))
    // Stable order: win count desc, then planId for a deterministic tiebreak.
    .sort((a, b) => b.count - a.count || a.planId.localeCompare(b.planId))
    .slice(0, HORIZON_REC.maxDistribution);

  const recommendedPlanId = distribution[0]?.planId ?? null;

  // Representative explanation = the MEDIAN-acuity future the recommended plan won,
  // so the surfaced exposure isn't skewed low by an easy early future (#4).
  let representativeReasonCodes: ReasonCode[] = [];
  let representativeExposure: HorizonExposure | null = null;
  if (recommendedPlanId) {
    const won = runs
      .filter((r) => r.topPlanId === recommendedPlanId)
      .sort((a, b) => a.complexity - b.complexity);
    const median = won[Math.floor(won.length / 2)];
    if (median) {
      representativeReasonCodes = median.reasonCodes;
      representativeExposure = median.exposure;
    }
  }

  const overIncidence = (n: number) => n / total >= HORIZON_REC.assumptionIncidence;
  const conditions = [...condCount.entries()]
    .filter(([, c]) => overIncidence(c))
    .map(([flag, c]) => ({ flag, incidence: c / total }))
    .sort((a, b) => b.incidence - a.incidence);
  const medications = [...drugCount.entries()]
    .filter(([, c]) => overIncidence(c))
    .map(([id, c]) => ({ name: drugsById.get(id)?.name ?? id, incidence: c / total }))
    .sort((a, b) => b.incidence - a.incidence);

  return {
    years,
    replicas: total,
    scenarioCount: res.scenarioCount,
    recommendedPlanId,
    winShare: distribution[0]?.share ?? 0,
    noneEligibleRate: none / total,
    distribution,
    representativeReasonCodes,
    representativeExposure,
    projectedAssumptions: { conditions, medications },
  };
}

// Deterministic output → cache by profile facts-version + engine/data version +
// resolution. Instant 5y↔10y switches and revisits; auto-invalidates when facts
// change (capturedAt) or the engine/data version bumps. Bounded, no TTL needed.
const horizonCache = new Map<string, HorizonsResult>();
const HORIZON_CACHE_MAX = 200;

export async function recommendAcrossHorizons(
  profile: ClientProfileInput,
  db: DataStore,
  opts: { horizonsYears?: readonly number[]; replicas?: number; scenarioCount?: number } = {},
): Promise<HorizonsResult> {
  const res: HorizonResolution = {
    replicas: opts.replicas ?? HORIZON_REC.replicas,
    scenarioCount: opts.scenarioCount ?? HORIZON_REC.scenarioCount,
  };
  const years = opts.horizonsYears ?? HORIZON_REC.horizonsYears;

  const cacheKey = [
    profile.id,
    profile.capturedAt,
    ENGINE_VERSION,
    DATA_VERSION,
    res.replicas,
    res.scenarioCount,
    years.join("-"),
  ].join("|");
  const cached = horizonCache.get(cacheKey);
  if (cached) return cached;

  const catalog = await buildEngineCatalog(db);
  const drugs = [...catalog.ctx.drugsById.values()];
  const normalized = normalizeProfile(profile, drugs);

  // Today's pick at the SAME scenario count as the futures, so "changes vs today"
  // reflects clinical change, not sampling noise from a different resolution (#1).
  const today = await runEngine(profile, db, {
    preferenceWeighting: true,
    count: res.scenarioCount,
    catalog,
  });

  // Horizons are independent — run concurrently (yields at each runEngine await).
  const horizons = await Promise.all(
    years.map((y) => recommendOneHorizon(profile, db, catalog, normalized, y, res)),
  );

  const result: HorizonsResult = { todayTopPlanId: today.scoring.topPlanId, horizons };

  if (horizonCache.size >= HORIZON_CACHE_MAX) horizonCache.delete(horizonCache.keys().next().value!);
  horizonCache.set(cacheKey, result);
  return result;
}
