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
 * The per-year transition rates live in CLINICAL_PROGRESSION below — LITERATURE-
 * ANCHORED annual estimates for a Medicare-age (65+) cohort, each with its source.
 * They are population-level estimates to make the projection defensible, NOT a
 * substitute for an actuarial table or a clinician's judgment; a clinician/actuary
 * should validate each value (they're centralized + cited precisely so that review
 * is one file, not a hunt through the logic).
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

/**
 * Annual clinical transition probabilities (PER YEAR). Literature-anchored
 * estimates for a 65+ cohort; `marker`/`d`/`onc`/`mh` terms (0..1) scale a rate up
 * with the member's measured risk, and `af` is the age factor (0 at 65 → 1 at 85+).
 * Each rate cites the body of evidence it is anchored to. These are population
 * estimates for an educational projection — validate with a clinician/actuary
 * before any clinical use.
 */
export const CLINICAL_PROGRESSION = {
  // T2DM therapy intensification: ~50% of patients need treatment escalation within
  // ~3 yrs (UKPDS 49; ADA Standards of Care) → ~6–28%/yr scaled by diabetes burden.
  diabetesIntensify: { base: 0.06, perMarker: 0.22 },
  // Progression to insulin among T2DM on oral agents: ~5–12%/yr (ADA Standards of
  // Care; UKPDS). CKD raises insulin reliance (fewer oral options, renal clearance).
  insulinStart: { base: 0.04, perMarker: 0.2, ckdAddon: 0.05 },
  // Incident CKD in diabetes/hypertension: ~2–4%/yr (USRDS Annual Data Report; KDIGO).
  ckdOnset: { base: 0.02, perMarker: 0.1, perAge: 0.05 },
  // CKD stage progression (eGFR decline a stage): ~7%/yr (USRDS; CRIC cohort).
  ckdProgress: 0.07,
  // ASCVD events: ~2–3%/yr primary prevention in older high-risk adults, ~5–7%/yr
  // with established CAD (ACC/AHA Pooled Cohort Equations; secondary-prevention trials).
  cardiac: { base: 0.015, cadEstablished: 0.06, cadPrimary: 0.03, obesityAddon: 0.02, perAge: 0.04 },
  // Incident invasive cancer, age 65+: ~1.8–2.3%/yr (NCI SEER incidence), higher
  // with elevated risk markers / first-degree family history.
  cancer: { base: 0.012, perMarker: 0.05, perAge: 0.02, familyAddon: 0.008 },
  // Mental-health escalation among those with a diagnosis or high prior utilization.
  mentalHealth: { base: 0.04, perMarker: 0.18 },
  // Functional / mobility decline, 65+ with osteoarthritis / obesity: ~3–6%/yr.
  mobility: { base: 0.03, perAge: 0.05 },
  // Inpatient hospitalization scales with accrued acuity. Medicare 65+ baseline
  // ~25–30 admissions / 100 enrollees / yr (MedPAC); rises sharply with comorbidity.
  hospitalization: { base: 0.02, perComplexity: 0.15 },
} as const;

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

  const P = CLINICAL_PROGRESSION;
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
      const di = P.diabetesIntensify;
      const ins = P.insulinStart;
      if (!intensified && occur(di.base + di.perMarker * d)) {
        intensified = true;
        push("diabetes_intensified", "Added an oral agent (e.g. SGLT2 inhibitor)", { drugs: ["rx-empagliflozin"] });
      } else if (intensified && !onInsulin && occur(ins.base + ins.perMarker * d + (conditions.has("ckd") ? ins.ckdAddon : 0))) {
        onInsulin = true;
        push("insulin_initiation", "Progressed to insulin therapy", { drugs: ["rx-insulin-glargine"] });
      }
    }

    // Renal
    const renalRisk = conditions.has("diabetes") || conditions.has("hypertension");
    if (renalRisk) {
      if (!conditions.has("ckd")) {
        if (occur(P.ckdOnset.base + P.ckdOnset.perMarker * d + P.ckdOnset.perAge * af))
          push("ckd_onset", "Developed chronic kidney disease", { conditions: ["ckd"] });
      } else if (occur(P.ckdProgress)) {
        push("ckd_progression", "Kidney function declined a stage");
      }
    }

    // Cardiac
    const cardiacRisk = conditions.has("hypertension") || conditions.has("hyperlipidemia") || conditions.has("cad") || conditions.has("obesity");
    if (cardiacRisk) {
      const c = P.cardiac;
      const base = c.base + (conditions.has("cad") ? c.cadEstablished : c.cadPrimary) + (conditions.has("obesity") ? c.obesityAddon : 0) + c.perAge * af;
      if (occur(base)) {
        if (!conditions.has("cad")) push("cardiac_event", "Acute cardiac event", { conditions: ["cad"] });
        else push("cad_progression", "Coronary disease advanced");
      }
    }

    // Oncology (everyone, marker- and age-scaled)
    if (!cancerDx && occur(P.cancer.base + P.cancer.perMarker * onc + P.cancer.perAge * af + (familyCancer ? P.cancer.familyAddon : 0))) {
      cancerDx = true;
      push("cancer_diagnosis", "New cancer diagnosis entering treatment", {
        drugs: ["rx-pembrolizumab"],
        conditions: ["cancer_active"],
      });
    }

    // Mental health
    if ((conditions.has("depression") || conditions.has("anxiety") || mh > 0.3) && occur(P.mentalHealth.base + P.mentalHealth.perMarker * mh)) {
      push("mental_health_escalation", "Mental-health needs escalated");
    }

    // Mobility
    if ((conditions.has("osteoarthritis") || conditions.has("obesity") || age >= 75) && occur(P.mobility.base + P.mobility.perAge * af)) {
      push("mobility_decline", "Functional / mobility decline");
    }

    // Hospitalization — driven by accumulated acuity
    if (occur(P.hospitalization.base + P.hospitalization.perComplexity * complexity)) push("hospitalization", "Inpatient hospitalization");
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
