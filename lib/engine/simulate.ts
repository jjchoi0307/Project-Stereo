/**
 * Layer 4 — AGENT-BASED simulation (an Aaru-style emulation). The differentiator:
 * a plan is scored not on the client's current state but on how it holds up
 * across many plausible futures.
 *
 * For a profile we generate N seeded *agents* (default 500). Each agent walks a
 * care life-path: events fire from grounded base rates (lib/engine/priors.ts)
 * modulated by the client's normalized risk markers AND by CORRELATION — once an
 * event occurs it shifts the odds of related downstream events, so paths are
 * realistic and correlated rather than independent dice rolls (e.g. a cancer
 * diagnosis pulls up specialist + outpatient + provider-dependency together).
 *
 * The SAME agent cohort is evaluated against every surviving plan, so plans are
 * compared on identical futures — no plan can be advantaged by luck. The cohort
 * is a pure function of the inputs: nothing is retained, and the seed is derived
 * from DE-IDENTIFIED clinical facts only (lib/engine/seed.ts), never patient
 * identity — so identical facts reproduce exactly (audit) and no patient is
 * advantaged by who they are ("no bias for any patient").
 */

import type {
  CareEventType,
  CareJourney,
  ClientProfileInput,
  NormalizedProfile,
  Plan,
} from "@/lib/domain";
import type { RulesContext } from "./rules";
import { CRITICAL_DRUG_CLASSES, SIM_CONFIG } from "./config";
import { BASE_RATE, CORRELATION, EVENT_ORDER, MARKER_WEIGHT, type AgentEventType } from "./priors";
import { mulberry32 } from "./rng";
import { clinicalSeed } from "./seed";

/** The risk marker that drives each event's likelihood for an agent. */
function markerValue(type: AgentEventType, n: NormalizedProfile): number {
  switch (type) {
    case "rising_chronic_med_usage":
      return n.diabetes.value;
    case "cancer_dx_and_treatment":
      return n.oncologyRisk.value;
    case "new_specialist_utilization":
      return n.specialistNeed.value;
    case "higher_outpatient_use":
      return Math.max(n.drugUtilizationIntensity.value, n.specialistNeed.value);
    case "sleep_medicine_continuation":
      return n.mentalHealthUtilization.value;
    case "high_cost_provider_dependency":
      return n.networkSensitivity.value;
  }
}

// ── Agent generation ──────────────────────────────────────────────────────────
/**
 * Build one agent's correlated care life-path. Events are considered in causal
 * order; each fires with p = base + markerWeight·marker + accumulated correlation
 * bumps from earlier events in this same path.
 */
function generateAgent(
  index: number,
  n: NormalizedProfile,
  requiredSystems: string[],
  rng: () => number,
): CareJourney {
  const events: CareJourney["events"] = [];
  const bump: Partial<Record<AgentEventType, number>> = {};

  for (const type of EVENT_ORDER) {
    const p = BASE_RATE[type] + MARKER_WEIGHT[type] * markerValue(type, n) + (bump[type] ?? 0);
    const fires = rng() < Math.min(1, p);
    const intensity = rng(); // drawn unconditionally so the RNG stream is stable
    if (!fires) continue;

    if (type === "rising_chronic_med_usage") {
      const drugIds = ["rx-empagliflozin"];
      if (n.diabetes.value > 0.6 && intensity > 0.6) drugIds.push("rx-insulin-glargine");
      events.push({ type, drugIds, intensity });
    } else if (type === "cancer_dx_and_treatment") {
      events.push({ type, drugIds: ["rx-pembrolizumab"], intensity });
    } else if (type === "sleep_medicine_continuation") {
      events.push({ type, drugIds: ["rx-zolpidem"], intensity });
    } else if (type === "high_cost_provider_dependency") {
      events.push({ type, requiresSystemIds: requiredSystems, intensity });
    } else {
      events.push({ type, intensity });
    }

    // Propagate correlation to downstream events in this agent's path.
    const corr = CORRELATION[type];
    if (corr) {
      for (const target of Object.keys(corr) as AgentEventType[]) {
        bump[target] = (bump[target] ?? 0) + (corr[target] ?? 0);
      }
    }
  }

  if (events.length === 0) events.push({ type: "no_major_event", intensity: 0 });
  return { index, events };
}

// ── Per-journey plan evaluation ─────────────────────────────────────────────
export interface JourneyOutcome {
  journeyIndex: number;
  annualExposure: number;
  uncoveredDrugs: string[];
  networkGaps: string[];
  catastrophic: boolean;
  coveredAll: boolean;
}

function evaluate(
  plan: Plan,
  journey: CareJourney,
  ctx: RulesContext,
  // The profile-derived base sets are identical for every journey × plan in a
  // run, so they're computed once in simulate() and cloned per call (the event
  // additions below are what differ). Cloning preserves insertion order, so the
  // outcome is byte-identical to building them inline here.
  baseNeededDrugs: ReadonlySet<string>,
  baseRequiredSystems: ReadonlySet<string>,
): JourneyOutcome {
  const b = plan.benefits;
  const formulary = ctx.formularies.get(plan.formularyId);
  const network = ctx.networks.get(plan.networkId);

  const neededDrugs = new Set(baseNeededDrugs);
  const requiredSystems = new Set(baseRequiredSystems);

  let specialistVisits = 0;
  let outpatientVisits = 0;
  let inpatientDays = 0;
  let mhVisits = 0;
  for (const e of journey.events) {
    e.drugIds?.forEach((d) => neededDrugs.add(d));
    e.requiresSystemIds?.forEach((s) => requiredSystems.add(s));
    switch (e.type) {
      case "new_specialist_utilization":
        specialistVisits += Math.round(2 + 6 * e.intensity);
        break;
      case "higher_outpatient_use":
        outpatientVisits += Math.round(3 + 9 * e.intensity);
        break;
      case "cancer_dx_and_treatment":
        inpatientDays += b.inpatientCostShareDays;
        specialistVisits += Math.round(4 + 8 * e.intensity);
        break;
      case "rising_chronic_med_usage":
        specialistVisits += Math.round(1 + 3 * e.intensity);
        break;
      case "sleep_medicine_continuation":
        mhVisits += Math.round(1 + 3 * e.intensity);
        break;
    }
  }

  let coveredCostShare = 0;
  let uncoveredExposure = 0;
  const uncoveredDrugs: string[] = [];
  let criticalUncovered = false;

  for (const drugId of neededDrugs) {
    const entry = formulary?.entries.find((e) => e.drugId === drugId);
    const drug = ctx.drugsById.get(drugId);
    if (entry?.covered) {
      const tier = entry.tier ?? 3;
      coveredCostShare += (b.drugTierCostShare[tier] ?? SIM_CONFIG.defaultTierCostShare) * SIM_CONFIG.monthlyFillsPerYear;
    } else {
      const cls = drug?.therapeuticClass ?? "default";
      uncoveredExposure += SIM_CONFIG.uncoveredDrugAnnualCost[cls] ?? SIM_CONFIG.uncoveredDrugAnnualCost.default;
      uncoveredDrugs.push(drug?.name ?? drugId);
      if (CRITICAL_DRUG_CLASSES.has(cls)) criticalUncovered = true;
    }
  }

  coveredCostShare +=
    specialistVisits * b.specialistCopay +
    outpatientVisits * b.pcpCopay +
    inpatientDays * b.inpatientCostSharePerDay +
    mhVisits * b.mentalHealthOutpatientCopay;
  // In-network covered cost share is capped by the plan's OOP max.
  coveredCostShare = Math.min(coveredCostShare, b.annualOOPMax);

  const networkGaps: string[] = [];
  for (const sys of requiredSystems) {
    if (!network?.systemIds.includes(sys)) {
      networkGaps.push(ctx.systemsById.get(sys)?.name ?? sys);
      uncoveredExposure += SIM_CONFIG.outOfNetworkPenalty; // uncapped tail
    }
  }

  const annualExposure = b.monthlyPremium * 12 + coveredCostShare + uncoveredExposure;
  return {
    journeyIndex: journey.index,
    annualExposure: Math.round(annualExposure),
    uncoveredDrugs,
    networkGaps,
    catastrophic: criticalUncovered || uncoveredExposure >= SIM_CONFIG.catastrophicThreshold,
    coveredAll: uncoveredDrugs.length === 0,
  };
}

// ── Aggregation across journeys (per plan) ──────────────────────────────────
export interface PlanSimulationSummary {
  planId: string;
  meanExposure: number;
  p90Exposure: number;
  worstExposure: number;
  stdExposure: number;
  medCoverageRate: number; // fraction of journeys with zero uncovered drugs
  networkGapRate: number;
  catastrophicRate: number;
  topUncoveredDrugs: { name: string; rate: number }[];
}

function summarize(planId: string, outcomes: JourneyOutcome[]): PlanSimulationSummary {
  const n = outcomes.length;
  const ex = outcomes.map((o) => o.annualExposure).sort((a, b) => a - b);
  const mean = ex.reduce((s, x) => s + x, 0) / n;
  const std = Math.sqrt(ex.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const freq = new Map<string, number>();
  for (const o of outcomes) for (const d of o.uncoveredDrugs) freq.set(d, (freq.get(d) ?? 0) + 1);
  return {
    planId,
    meanExposure: Math.round(mean),
    p90Exposure: ex[Math.min(n - 1, Math.floor(0.9 * n))],
    worstExposure: ex[n - 1],
    stdExposure: Math.round(std),
    medCoverageRate: outcomes.filter((o) => o.coveredAll).length / n,
    networkGapRate: outcomes.filter((o) => o.networkGaps.length > 0).length / n,
    catastrophicRate: outcomes.filter((o) => o.catastrophic).length / n,
    topUncoveredDrugs: [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, rate: count / n })),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
export interface SimulationResult {
  seed: number;
  count: number;
  journeyTypeDistribution: Record<CareEventType, number>;
  perPlan: PlanSimulationSummary[];
  /** Per-plan full journey outcomes — kept for step-6 scoring; not for the wire. */
  outcomesByPlan: Map<string, JourneyOutcome[]>;
}

export function simulate(
  profile: ClientProfileInput,
  normalized: NormalizedProfile,
  survivingPlans: Plan[],
  ctx: RulesContext,
  opts: { seed?: number; count?: number } = {},
): SimulationResult {
  const count = Math.max(
    SIM_CONFIG.minScenarios,
    Math.min(SIM_CONFIG.maxScenarios, opts.count ?? SIM_CONFIG.defaultScenarioCount),
  );
  const seed = opts.seed ?? clinicalSeed(profile);
  const rng = mulberry32(seed);

  const requiredSystems = profile.providerConstraints
    .filter((c) => c.hardRequirement && c.systemId)
    .map((c) => c.systemId!);

  // Base profile-derived sets, computed once and reused across every journey ×
  // plan via evaluate() (which clones + layers each journey's events on top).
  const baseNeededDrugs = new Set<string>();
  for (const m of profile.medications) if (m.drugId) baseNeededDrugs.add(m.drugId);
  const baseRequiredSystems = new Set<string>(requiredSystems);

  // Generate the shared agent cohort once (same futures for every plan).
  const journeys: CareJourney[] = [];
  for (let i = 0; i < count; i++) journeys.push(generateAgent(i, normalized, requiredSystems, rng));

  const journeyTypeDistribution = {} as Record<CareEventType, number>;
  for (const j of journeys)
    for (const e of j.events)
      journeyTypeDistribution[e.type] = (journeyTypeDistribution[e.type] ?? 0) + 1;

  const perPlan: PlanSimulationSummary[] = [];
  const outcomesByPlan = new Map<string, JourneyOutcome[]>();
  for (const plan of survivingPlans) {
    const outcomes = journeys.map((j) => evaluate(plan, j, ctx, baseNeededDrugs, baseRequiredSystems));
    outcomesByPlan.set(plan.id, outcomes);
    perPlan.push(summarize(plan.id, outcomes));
  }

  return { seed, count, journeyTypeDistribution, perPlan, outcomesByPlan };
}
