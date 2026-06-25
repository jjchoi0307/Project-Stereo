/**
 * Plan-facts pack — the grounding context for the AI recommendation.
 *
 * The AI recommendation must reason "in a vacuum": its only knowledge of plans is
 * the 2026 carrier files (already extracted into lib/data, every figure tagged
 * with sourceFile + sourcePage). This module turns a client profile into:
 *
 *   1. patient — the de-identified clinical + coverage-relevant facts the model
 *      may reason about (age, conditions, meds, provider requirements, region).
 *   2. candidates — one compact, structured PlanFacts block per ELIGIBLE plan,
 *      carrying every benefit figure the model is allowed to cite, each already
 *      bound to a source file + page.
 *   3. excluded — plans the deterministic eligibility gate removed, with reasons.
 *
 * Eligibility (region / must-keep network / critical-drug formulary) stays a
 * deterministic pass over the files (lib/engine/rules.ts): those are pass/fail
 * FACTS, and gating first means the AI can never recommend a plan the client is
 * categorically ineligible for. Everything judgmental (ranking, fit, reasons,
 * bullets) is left to the AI — see lib/ai/recommend.ts.
 *
 * server-only via the rules context / data store it consumes.
 */

import "server-only";
import type { ClientProfileInput, DrugTier, Plan } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { applyRules, buildRulesContext, providerGapsFor, type RulesContext } from "@/lib/engine/rules";

/** A single sourced benefit figure the model may cite. */
export interface SourcedFigure {
  label: string;
  value: string; // printed/verbatim where available, else a formatted number
}

/** One eligible plan, reduced to the facts the AI may reason over + cite. */
export interface PlanFacts {
  planId: string;
  name: string;
  carrier: string;
  planType: string; // HMO / PPO / …
  kind: "MA" | "C-SNP" | "D-SNP"; // member-facing plan kind
  snpType: string;
  snpConditions?: string[] | null;
  dsnpDualEligibility?: string | null;
  /** Provenance for EVERY figure below — the model cites these. */
  sourceFile: string;
  sourcePage: number;

  // Core cost figures (numbers the model may cite verbatim).
  monthlyPremium: number;
  annualOOPMax: number;
  annualOOPMaxOutOfNetwork?: number | null;
  partCDeductible?: number | null;
  pcpCopay: number;
  specialistCopay: number;
  inpatientPerDay: number;
  inpatientDays: number;
  mentalHealthOutpatientCopay: number;
  acupunctureVisitsPerYear: number;
  acupunctureCopay: number;
  insulinMonthlyCap?: number;

  /** Per-tier drug cost share, with the verbatim PDF language. */
  drugTiers: { tier: DrugTier; costShare: number; display: string | null }[];

  /** Supplemental benefits, verbatim as printed (null when the plan omits it). */
  supplemental: Record<string, string | null>;

  /** Network access this plan grants (system names from the file). */
  networkSystems: string[];

  /**
   * This client's medications vs THIS plan's formulary — a grounded fact set:
   * which of the client's current meds are covered, and at what tier.
   */
  medicationCoverage: {
    covered: { name: string; tier?: DrugTier }[];
    notCovered: string[]; // current meds absent / not covered on this formulary
  };

  /**
   * Hard "must-keep" providers this plan still drops (should be [] for eligible
   * plans, since those are excluded — kept for completeness/verification).
   */
  providerGaps: string[];
}

/** Patient facts the recommendation model may reason over (no direct identifiers). */
export interface RecommendationPatientFacts {
  age: number;
  gender?: string;
  conditions: string[];
  conditionsCount: number;
  medications: string[]; // normalized names only
  /** Hard provider/system requirements, as human names (facts that drive fit). */
  mustKeepProviders: string[];
  marketRegionName: string;
  familyHistory: { condition: string; status: string; affectedRelativesCount?: number }[];
  utilization?: {
    acupunctureVisits12mo?: number;
    specialistVisits12mo?: number;
    priorYearInpatientEvents?: number;
  };
  /** Self-reported lifestyle facts (advisory; low-weight, must not drive the projection). */
  lifestyle?: {
    avgDailySteps?: number;
    sleepHoursPerNight?: number;
    sleepQuality?: string;
    selfRatedHealth?: number;
  };
}

export interface PlanFactsPack {
  patient: RecommendationPatientFacts;
  candidates: PlanFacts[];
  excluded: { planId: string; name: string; reasons: string[] }[];
}

const KIND = (p: Plan): PlanFacts["kind"] =>
  p.snpType === "D-SNP" ? "D-SNP" : p.snpType === "C-SNP" ? "C-SNP" : "MA";

function planToFacts(plan: Plan, profile: ClientProfileInput, ctx: RulesContext): PlanFacts {
  const network = ctx.networks.get(plan.networkId);
  const networkSystems = (network?.systemIds ?? [])
    .map((sid) => ctx.systemsById.get(sid)?.name ?? sid)
    .sort();

  const formulary = ctx.formularies.get(plan.formularyId);
  const covered: { name: string; tier?: DrugTier }[] = [];
  const notCovered: string[] = [];
  for (const med of profile.medications) {
    const name = med.name ?? med.raw;
    if (!med.drugId) {
      // Can't verify an unnormalized med against the formulary — report as unknown
      // (treated as not-confirmed-covered so the model never claims coverage it
      // can't see).
      notCovered.push(name);
      continue;
    }
    const entry = formulary?.entries.find((e) => e.drugId === med.drugId);
    if (entry?.covered === true) covered.push({ name, tier: entry.tier });
    else notCovered.push(name);
  }

  const drugTiers = ([1, 2, 3, 4, 5, 6] as const)
    .map((t) => ({
      tier: t,
      costShare: plan.benefits.drugTierCostShare[t],
      display: plan.benefits.drugTierDisplay[t],
    }))
    .filter((x) => x.display != null || x.costShare != null);

  return {
    planId: plan.id,
    name: plan.name,
    carrier: plan.carrier,
    planType: plan.planType,
    kind: KIND(plan),
    snpType: plan.snpType,
    snpConditions: plan.snpConditions ?? null,
    dsnpDualEligibility: plan.dsnpDualEligibility ?? null,
    sourceFile: plan.sourceFile,
    sourcePage: plan.sourcePage,
    monthlyPremium: plan.benefits.monthlyPremium,
    annualOOPMax: plan.benefits.annualOOPMax,
    annualOOPMaxOutOfNetwork: plan.benefits.annualOOPMaxOutOfNetwork ?? null,
    partCDeductible: plan.benefits.partCDeductible ?? null,
    pcpCopay: plan.benefits.pcpCopay,
    specialistCopay: plan.benefits.specialistCopay,
    inpatientPerDay: plan.benefits.inpatientCostSharePerDay,
    inpatientDays: plan.benefits.inpatientCostShareDays,
    mentalHealthOutpatientCopay: plan.benefits.mentalHealthOutpatientCopay,
    acupunctureVisitsPerYear: plan.benefits.acupunctureVisitsPerYear,
    acupunctureCopay: plan.benefits.acupunctureCopay,
    insulinMonthlyCap: plan.benefits.insulinMonthlyCap,
    drugTiers,
    supplemental: { ...plan.supplemental },
    networkSystems,
    medicationCoverage: { covered, notCovered },
    providerGaps: providerGapsFor(plan, profile, ctx),
  };
}

/** De-identified patient facts the recommendation model may reason over. */
function patientFacts(profile: ClientProfileInput, ctx: RulesContext): RecommendationPatientFacts {
  const mustKeepProviders = profile.providerConstraints
    .filter((c) => c.hardRequirement)
    .map((c) => (c.systemId ? ctx.systemsById.get(c.systemId)?.name ?? c.label : c.label));
  return {
    age: profile.age,
    gender: profile.gender,
    conditions: [...profile.conditions].sort(),
    conditionsCount: profile.conditions.length,
    medications: profile.medications.map((m) => m.name ?? m.raw).filter(Boolean),
    mustKeepProviders,
    marketRegionName: ctx.regionsById.get(profile.marketRegion)?.name ?? profile.marketRegion,
    familyHistory: profile.familyHistory.map((f) => ({
      condition: f.condition,
      status: f.status,
      affectedRelativesCount: f.affectedRelativesCount,
    })),
    utilization: profile.utilization,
    lifestyle: profile.lifestyle,
  };
}

/**
 * Build the grounding pack for a profile: eligibility-gated candidates + their
 * sourced facts + the patient facts. Pure read over the data store.
 */
export async function buildPlanFactsPack(
  profile: ClientProfileInput,
  db: DataStore,
  opts: { ignoreProviderConstraints?: boolean } = {},
): Promise<PlanFactsPack> {
  const [plans, ctx] = await Promise.all([db.listPlans(), buildRulesContext(db)]);
  const { survivingPlanIds, log } = applyRules(profile, plans, ctx, opts);
  const planById = new Map(plans.map((p) => [p.id, p]));

  const candidates = survivingPlanIds
    .map((pid) => planById.get(pid))
    .filter((p): p is Plan => Boolean(p))
    .map((p) => planToFacts(p, profile, ctx));

  // Group exclusion reasons per excluded plan.
  const excludedReasons = new Map<string, string[]>();
  for (const e of log) {
    if (e.severity !== "exclude") continue;
    const list = excludedReasons.get(e.planId) ?? [];
    list.push(e.detail);
    excludedReasons.set(e.planId, list);
  }
  const excluded = [...excludedReasons.entries()].map(([pid, reasons]) => ({
    planId: pid,
    name: planById.get(pid)?.name ?? pid,
    reasons,
  }));

  return { patient: patientFacts(profile, ctx), candidates, excluded };
}

/** A stable digest of the pack's plan-data identity, for cache keys. */
export function packDataSignature(pack: PlanFactsPack): string {
  return pack.candidates
    .map((c) => c.planId)
    .sort()
    .join(",");
}
