/**
 * Health-futures simulation. Replicates a client into N seeded synthetic copies
 * and projects each copy's CLINICAL trajectory over a multi-year horizon, given
 * their diagnosed conditions and inferred risk markers — disease progression,
 * complications, and new diagnoses. Distinct from the per-plan financial
 * simulation in `simulate.ts`: this answers "what could happen to this person?",
 * which can then inform which plan holds up.
 *
 * Deterministic (seeded from de-identified clinical facts, not patient identity;
 * see lib/engine/seed.ts), so the projection is reproducible and identity-neutral.
 *
 * The per-year transition rates below are SYNTHETIC, clinically-plausible
 * placeholders, not actuarial values — calibrate against real data later.
 */

import type {
  ClientProfileInput,
  ConditionFlag,
  DrugId,
  NormalizedProfile,
  ProfileId,
} from "@/lib/domain";
import { HEALTH_SIM } from "./config";
import { mulberry32 } from "./rng";
import { clinicalSeed } from "./seed";

export type HealthOutcome =
  | "stable"
  | "diabetes_intensified"
  | "insulin_initiation"
  | "ckd_onset"
  | "ckd_progression"
  | "cardiac_event"
  | "cad_progression"
  | "cancer_diagnosis"
  | "mental_health_escalation"
  | "mobility_decline"
  | "hospitalization";

export interface HealthEvent {
  year: number;
  outcome: HealthOutcome;
  detail: string;
  addsDrugIds?: DrugId[];
  addsConditions?: ConditionFlag[];
}

export interface ProfileReplica {
  index: number;
  events: HealthEvent[];
  acquiredConditions: ConditionFlag[];
  acquiredDrugIds: DrugId[];
  complexityScore: number; // 0..1 end-state acuity
}

export interface HealthFutures {
  profileId: ProfileId;
  seed: number;
  replicas: number;
  horizonYears: number;
  outcomeIncidence: { outcome: HealthOutcome; rate: number }[]; // share of replicas with ≥1
  perYearIncidence: { year: number; meanNewEvents: number }[];
  stableRate: number; // replicas with no major clinical event
  severeRate: number; // replicas ending above the severe-complexity threshold
  meanComplexity: number;
  sampleTrajectories: ProfileReplica[]; // a high / mid / low spread, for transparency
}

const HUMAN: Record<HealthOutcome, string> = {
  stable: "No major change",
  diabetes_intensified: "Diabetes therapy intensified",
  insulin_initiation: "Started on insulin",
  ckd_onset: "Chronic kidney disease onset",
  ckd_progression: "Kidney disease progressed",
  cardiac_event: "Cardiac event",
  cad_progression: "Coronary disease progressed",
  cancer_diagnosis: "Cancer diagnosis",
  mental_health_escalation: "Mental-health escalation",
  mobility_decline: "Mobility decline",
  hospitalization: "Hospitalization",
};

const ageFactor = (age: number) => Math.min(1, Math.max(0, (age - 65) / 20));

// Acuity each event adds to the running complexity score.
const COMPLEXITY_WEIGHT: Partial<Record<HealthOutcome, number>> = {
  diabetes_intensified: 0.05,
  insulin_initiation: 0.2,
  ckd_onset: 0.2,
  ckd_progression: 0.1,
  cardiac_event: 0.25,
  cad_progression: 0.1,
  cancer_diagnosis: 0.35,
  mental_health_escalation: 0.1,
  mobility_decline: 0.1,
  hospitalization: 0.05,
};

function simulateReplica(
  index: number,
  profile: ClientProfileInput,
  n: NormalizedProfile,
  years: number,
  rng: () => number,
): ProfileReplica {
  const conditions = new Set<ConditionFlag>(profile.conditions);
  const baselineConditions = new Set(conditions);
  const baselineDrugs = new Set<DrugId>(profile.medications.map((m) => m.drugId).filter((d): d is DrugId => !!d));
  const acquiredConditions = new Set<ConditionFlag>();
  const acquiredDrugIds = new Set<DrugId>();
  const events: HealthEvent[] = [];

  let age = profile.age;
  let intensified = false;
  let onInsulin = false;
  let cancerDx = false;
  let complexity = 0;

  const d = n.diabetes.value;
  const onc = n.oncologyRisk.value;
  const mh = n.mentalHealthUtilization.value;
  const familyCancer = profile.familyHistory.some((f) => f.condition === "cancer_history" && f.status === "yes");

  const push = (outcome: HealthOutcome, detail: string, adds?: { drugs?: DrugId[]; conditions?: ConditionFlag[] }) => {
    events.push({ year: age - profile.age, outcome, detail, addsDrugIds: adds?.drugs, addsConditions: adds?.conditions });
    adds?.conditions?.forEach((c) => { conditions.add(c); acquiredConditions.add(c); });
    adds?.drugs?.forEach((dr) => acquiredDrugIds.add(dr));
    complexity = Math.min(1, complexity + (COMPLEXITY_WEIGHT[outcome] ?? 0));
  };
  const occur = (p: number) => rng() < p;

  for (let y = 1; y <= years; y++) {
    age++;
    const af = ageFactor(age);

    // Diabetes pathway
    const diabetic = conditions.has("diabetes") || d > 0.4;
    if (diabetic) {
      if (!intensified && occur(0.05 + 0.25 * d)) {
        intensified = true;
        push("diabetes_intensified", "Added an oral agent (e.g. SGLT2 inhibitor)", { drugs: ["rx-empagliflozin"] });
      } else if (intensified && !onInsulin && occur(0.04 + 0.25 * d + (conditions.has("ckd") ? 0.05 : 0))) {
        onInsulin = true;
        push("insulin_initiation", "Progressed to insulin therapy", { drugs: ["rx-insulin-glargine"] });
      }
    }

    // Renal
    const renalRisk = conditions.has("diabetes") || conditions.has("hypertension");
    if (renalRisk) {
      if (!conditions.has("ckd")) {
        if (occur(0.02 + 0.12 * d + 0.05 * af)) push("ckd_onset", "Developed chronic kidney disease", { conditions: ["ckd"] });
      } else if (occur(0.08)) {
        push("ckd_progression", "Kidney function declined a stage");
      }
    }

    // Cardiac
    const cardiacRisk = conditions.has("hypertension") || conditions.has("hyperlipidemia") || conditions.has("cad") || conditions.has("obesity");
    if (cardiacRisk) {
      const base = 0.015 + 0.06 * (conditions.has("cad") ? 1 : 0.5) + 0.03 * (conditions.has("obesity") ? 1 : 0) + 0.04 * af;
      if (occur(base)) {
        if (!conditions.has("cad")) push("cardiac_event", "Acute cardiac event", { conditions: ["cad"] });
        else push("cad_progression", "Coronary disease advanced");
      }
    }

    // Oncology (everyone, marker- and age-scaled)
    if (!cancerDx && occur(0.004 + 0.06 * onc + 0.02 * af + (familyCancer ? 0.01 : 0))) {
      cancerDx = true;
      push("cancer_diagnosis", "New cancer diagnosis entering treatment", {
        drugs: ["rx-pembrolizumab"],
        conditions: ["cancer_active"],
      });
    }

    // Mental health
    if ((conditions.has("depression") || conditions.has("anxiety") || mh > 0.3) && occur(0.04 + 0.2 * mh)) {
      push("mental_health_escalation", "Mental-health needs escalated");
    }

    // Mobility
    if ((conditions.has("osteoarthritis") || conditions.has("obesity") || age >= 75) && occur(0.03 + 0.05 * af)) {
      push("mobility_decline", "Functional / mobility decline");
    }

    // Hospitalization — driven by accumulated acuity
    if (occur(0.02 + 0.15 * complexity)) push("hospitalization", "Inpatient hospitalization");
  }

  // Keep only genuinely-acquired (not baseline) items.
  return {
    index,
    events,
    acquiredConditions: [...acquiredConditions].filter((c) => !baselineConditions.has(c)),
    acquiredDrugIds: [...acquiredDrugIds].filter((dr) => !baselineDrugs.has(dr)),
    complexityScore: Math.round(complexity * 100) / 100,
  };
}

/** The raw simulated population at a horizon — each replica a projected future. */
export interface ReplicaSet {
  replicas: ProfileReplica[];
  seed: number;
  years: number;
  count: number;
}

/**
 * Replicate the client into N seeded synthetic copies and project each one's
 * clinical trajectory over the horizon. This is the population the across-futures
 * recommendation scores (lib/engine/horizonRecommendation.ts); simulateHealthFutures
 * is the aggregate view over the same population.
 */
export function simulateReplicas(
  profile: ClientProfileInput,
  normalized: NormalizedProfile,
  opts: { replicas?: number; years?: number; seed?: number } = {},
): ReplicaSet {
  const count = clamp(opts.replicas ?? HEALTH_SIM.defaultReplicas, HEALTH_SIM.minReplicas, HEALTH_SIM.maxReplicas);
  const years = clamp(opts.years ?? HEALTH_SIM.defaultHorizonYears, HEALTH_SIM.minYears, HEALTH_SIM.maxYears);
  const seed = opts.seed ?? clinicalSeed(profile, ":health");
  const rng = mulberry32(seed);

  const replicas: ProfileReplica[] = [];
  for (let i = 0; i < count; i++) replicas.push(simulateReplica(i, profile, normalized, years, rng));
  return { replicas, seed, years, count };
}

export function simulateHealthFutures(
  profile: ClientProfileInput,
  normalized: NormalizedProfile,
  opts: { replicas?: number; years?: number; seed?: number } = {},
): HealthFutures {
  const { replicas: all, seed, years, count: replicas } = simulateReplicas(profile, normalized, opts);

  // Outcome incidence (share of replicas with ≥1 of each outcome).
  const outcomes = Object.keys(HUMAN) as HealthOutcome[];
  const outcomeIncidence = outcomes
    .filter((o) => o !== "stable")
    .map((o) => ({ outcome: o, rate: all.filter((r) => r.events.some((e) => e.outcome === o)).length / replicas }))
    .filter((x) => x.rate > 0)
    .sort((a, b) => b.rate - a.rate);

  const perYearIncidence = Array.from({ length: years }, (_, i) => {
    const year = i + 1;
    const total = all.reduce((s, r) => s + r.events.filter((e) => e.year === year).length, 0);
    return { year, meanNewEvents: Math.round((total / replicas) * 100) / 100 };
  });

  const stableRate = all.filter((r) => r.events.length === 0).length / replicas;
  const severeRate = all.filter((r) => r.complexityScore >= HEALTH_SIM.severeComplexityThreshold).length / replicas;
  const meanComplexity = Math.round((all.reduce((s, r) => s + r.complexityScore, 0) / replicas) * 100) / 100;

  // Sample a high / mid / low replica by complexity for transparency.
  const byComplexity = [...all].sort((a, b) => b.complexityScore - a.complexityScore);
  const sampleTrajectories = [
    byComplexity[0],
    byComplexity[Math.floor(byComplexity.length / 2)],
    byComplexity[byComplexity.length - 1],
  ].filter((r, i, arr) => arr.findIndex((x) => x.index === r.index) === i);

  return {
    profileId: profile.id,
    seed,
    replicas,
    horizonYears: years,
    outcomeIncidence,
    perYearIncidence,
    stableRate,
    severeRate,
    meanComplexity,
    sampleTrajectories,
  };
}

export const HEALTH_OUTCOME_LABEL = HUMAN;

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
