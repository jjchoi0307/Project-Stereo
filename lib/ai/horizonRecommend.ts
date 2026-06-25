/**
 * AI-powered across-horizon recommendation (3-year / 5-year).
 *
 * The member's health legitimately evolves, and that projection does NOT come
 * from the plan files (the user's point: a patient's future health can't be read
 * out of a plan PDF). So this does two grounded things in ONE Claude call (kept to
 * one call for latency — nested per-horizon calls were the source of the "stuck
 * loading" problem):
 *
 *   - PROJECT the member's likely future facts at 3 and 5 years (added
 *     conditions / medications with a plain-language likelihood), grounded in the
 *     member's CURRENT facts (age, conditions, meds, family history).
 *   - RECOMMEND, at each horizon, the best plan for that projected member — fit
 *     score, reasons, bullets, and citations — grounded STRICTLY in the same 2026
 *     plan-facts pack as today's recommendation (lib/ai/planFactsPack.ts).
 *
 * Then a programmatic synthesize pass enforces the hard invariants (real plan,
 * real citations) and attaches the deterministic facts, exactly like the Today
 * path (lib/ai/recommend.ts). Cached per facts-version.
 */

import "server-only";
import type { ClientProfileInput } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { SIM_MODEL } from "@/lib/sim/env";
import { HORIZON_REC, SCORING, importanceGuidance } from "@/lib/engine/config";
import { newTrajectory, rlmLeaf, rlmParallel, logTrajectory } from "./rlm";
import {
  buildPlanFactsPack,
  type PlanFacts,
  type RecommendationPatientFacts,
} from "./planFactsPack";
import { callDeep, deepToRanked, type AiRankedPlan, type AiSubScores } from "./recommend";

const HORIZONS = HORIZON_REC.horizonsYears; // [3, 5]

export type Likelihood = "low" | "moderate" | "high";

export interface HorizonProjection {
  headline: string;
  summary: string;
  conditions: { label: string; likelihood: Likelihood }[];
  medications: { name: string; likelihood: Likelihood }[];
}

export interface AiHorizon {
  years: number;
  changedVsToday: boolean;
  projection: HorizonProjection;
  recommended: AiRankedPlan | null;
  /** A short ranked set for the win-style distribution (top few). */
  ranked: AiRankedPlan[];
}

export interface AiHorizonRecommendation {
  model: string;
  todayTopPlanId: string | null;
  horizons: AiHorizon[];
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM = `You are a Medicare Advantage plan-fit analyst for Seoul Medical Group brokers. You think about how a prospective member's plan fit changes as their health evolves.

You are given the member's CURRENT de-identified facts and the structured PLAN FACTS for every ELIGIBLE plan (extracted verbatim from the 2026 carrier documents). The user message specifies ONE horizon (a number of years from now). Do TWO things for THAT horizon:

1) PROJECT the member's likely future health at that horizon, grounded ONLY in their current facts (age, conditions, medications, family history, utilization). Give a one-line headline, a short plain-language summary a layperson understands, and the conditions / medications they are most likely to ADD by then, each with a likelihood "low" | "moderate" | "high". Be clinically reasonable and non-alarming. This projection is about the PERSON, not the plans.

2) SCREEN the eligible plans for that PROJECTED member: score EACH provided plan with five sub-scores in [0,1] (coverageFit, networkFit, medicationFit, mismatchPenalty[higher=worse], catastrophicDownside[higher=worse]), reasoning about how well it fits the projected member's needs. Order "ranked" best-fit first. Do NOT write reasons or citations here — this is the ranking pass; the top picks get a full write-up separately.

ABSOLUTE GROUNDING RULE: use ONLY the provided PLAN FACTS. Never invent a plan or a figure. Rank purely on fit to the projected member — no carrier bias.`;

function packForPrompt(candidates: PlanFacts[]) {
  return candidates.map((c) => ({
    planId: c.planId,
    name: c.name,
    carrier: c.carrier,
    planType: c.planType,
    kind: c.kind,
    source: { sourceFile: c.sourceFile, sourcePage: c.sourcePage },
    monthlyPremium: c.monthlyPremium,
    annualOOPMax: c.annualOOPMax,
    pcpCopay: c.pcpCopay,
    specialistCopay: c.specialistCopay,
    mentalHealthOutpatientCopay: c.mentalHealthOutpatientCopay,
    acupuncture: { visitsPerYear: c.acupunctureVisitsPerYear, copay: c.acupunctureCopay },
    insulinMonthlyCap: c.insulinMonthlyCap ?? undefined,
    drugTiers: c.drugTiers.map((t) => ({ tier: t.tier, costShare: t.costShare, printed: t.display ?? undefined })),
    supplemental: Object.fromEntries(Object.entries(c.supplemental).filter(([, v]) => v != null)),
    networkSystems: c.networkSystems,
    medicationCoverage: c.medicationCoverage,
  }));
}

function userMessage(patient: RecommendationPatientFacts, candidates: PlanFacts[], years: number, guidanceText?: string): string {
  return [
    "MEMBER CURRENT FACTS (de-identified):",
    JSON.stringify(patient, null, 2),
    "",
    `For the HEALTH PROJECTION part: ${guidanceText ?? importanceGuidance()}`,
    "",
    "ELIGIBLE PLAN FACTS — the ONLY plans you may score:",
    JSON.stringify(packForPrompt(candidates), null, 2),
    "",
    `Produce the projection + a best-fit-first ranking (sub-scores only) for the ${years}-year horizon (${years} years from now).`,
  ].join("\n");
}

// ── Schema ───────────────────────────────────────────────────────────────────

const LIKELIHOOD = { type: "string", enum: ["low", "moderate", "high"] } as const;

// A screen item — planId + the five sub-scores. The screen pass RANKS the plans
// for the projected member; the top picks then get a full deep write-up (reasons,
// citations, per-component why, cost breakdown) via the SAME machinery as Today,
// run in parallel. This keeps each model call small (a screen, or one plan's
// write-up) so the horizon never serializes three write-ups into one slow call.
const SCREEN_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["planId", "subScores"],
  properties: {
    planId: { type: "string" },
    subScores: {
      type: "object",
      additionalProperties: false,
      required: ["coverageFit", "networkFit", "medicationFit", "mismatchPenalty", "catastrophicDownside"],
      properties: {
        coverageFit: { type: "number" },
        networkFit: { type: "number" },
        medicationFit: { type: "number" },
        mismatchPenalty: { type: "number" },
        catastrophicDownside: { type: "number" },
      },
    },
  },
} as const;

// Single-horizon SCREEN output — projection + a ranked list of plans (sub-scores
// only). One call per horizon, the two horizons run in parallel (RLM decompose).
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projection", "ranked"],
  properties: {
    projection: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "summary", "conditions", "medications"],
      properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        conditions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "likelihood"],
            properties: { label: { type: "string" }, likelihood: LIKELIHOOD },
          },
        },
        medications: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "likelihood"],
            properties: { name: { type: "string" }, likelihood: LIKELIHOOD },
          },
        },
      },
    },
    ranked: { type: "array", items: SCREEN_ITEM_SCHEMA },
  },
} as const;

interface ScreenItem {
  planId: string;
  subScores: AiSubScores;
}
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const W = SCORING.weights;
function fitFromSubScores(s: AiSubScores): number {
  const expected =
    clamp01(s.coverageFit) * W.coverageFit +
    clamp01(s.networkFit) * W.networkFit +
    clamp01(s.medicationFit) * W.medicationFit -
    clamp01(s.mismatchPenalty) * W.mismatchPenalty;
  return Math.round((expected - clamp01(s.catastrophicDownside) * W.catastrophicDownside) * 10) / 10;
}

// How many plans get the full deep write-up per horizon — matches the Today path,
// so the horizon's top-3 cards carry the same detail (reasons, citations,
// per-component why, cost breakdown).
const DEEP_COUNT = 3;

/**
 * Fold the projection's likely-to-ADD conditions/medications into the member's
 * facts to build the PROJECTED member the deep write-up reasons about. Only
 * moderate/high-likelihood additions are merged (low-likelihood items are too
 * speculative to drive a recommendation), and each is tagged "(projected)" so the
 * write-up is honest that these are anticipated, not current, facts.
 */
function buildProjectedPatient(
  patient: RecommendationPatientFacts,
  projection: HorizonProjection,
  years: number,
): RecommendationPatientFacts {
  const keep = (l: Likelihood) => l === "moderate" || l === "high";
  const addedConditions = (projection.conditions ?? [])
    .filter((c) => keep(c.likelihood))
    .map((c) => `${c.label} (projected ${years}yr, ${c.likelihood} likelihood)`);
  const addedMeds = (projection.medications ?? [])
    .filter((m) => keep(m.likelihood))
    .map((m) => `${m.name} (projected ${years}yr, ${m.likelihood} likelihood)`);
  return {
    ...patient,
    age: patient.age + years,
    conditions: [...patient.conditions, ...addedConditions],
    conditionsCount: patient.conditions.length + addedConditions.length,
    medications: [...patient.medications, ...addedMeds],
  };
}

export async function recommendHorizons(
  profile: ClientProfileInput,
  db: DataStore,
  todayTopPlanId: string | null,
  guidanceText?: string,
): Promise<AiHorizonRecommendation> {
  const pack = await buildPlanFactsPack(profile, db);
  if (pack.candidates.length === 0) {
    return {
      model: SIM_MODEL,
      todayTopPlanId,
      horizons: HORIZONS.map((years) => ({
        years,
        changedVsToday: false,
        projection: { headline: "", summary: "", conditions: [], medications: [] },
        recommended: null,
        ranked: [],
      })),
    };
  }

  // Shallow→deep, same as the Today path: shortlist the most promising candidates
  // by a cheap grounded heuristic so the model reasons over a focused set (keeps
  // latency under the route budget). Synthesize still validates against the full
  // pack, so a shortlisted plan can never be ungrounded.
  const medsRate = (c: PlanFacts) => {
    const t = c.medicationCoverage.covered.length + c.medicationCoverage.notCovered.length;
    return t > 0 ? c.medicationCoverage.covered.length / t : 1;
  };
  const shortlist = [...pack.candidates]
    .sort((a, b) =>
      a.providerGaps.length - b.providerGaps.length ||
      medsRate(b) - medsRate(a) ||
      a.annualOOPMax - b.annualOOPMax ||
      a.monthlyPremium - b.monthlyPremium,
    )
    // Only the single recommended plan + a short comparison bar surface, so a
    // smaller candidate set means less input + faster reasoning. Synthesize still
    // validates against the FULL pack, so a shortlisted plan can never be ungrounded.
    .slice(0, 6);

  const emptyProjection: HorizonProjection = { headline: "", summary: "", conditions: [], medications: [] };
  const factsById = new Map(pack.candidates.map((c) => [c.planId, c]));
  const traj = newTrajectory("horizon-projection");

  // RLM DECOMPOSE → DELEGATE: one focused pipeline PER horizon, the two horizons
  // run in PARALLEL. Within each horizon: a cheap SCREEN call (project the member +
  // rank the plans by sub-scores), then the top-3 get the SAME full deep write-up
  // as Today — run in PARALLEL, one plan per call. So no horizon ever serializes
  // three write-ups into one slow generation; wall-clock ≈ screen + one write-up.
  // A failed horizon degrades to an empty card, not a failed projection.
  const horizons = await rlmParallel(traj, "horizons", [...HORIZONS], HORIZONS.length, async (years): Promise<AiHorizon> => {
    try {
      const screen = await rlmLeaf<{ projection?: HorizonProjection; ranked?: ScreenItem[] }>(traj, {
        label: `horizon-screen:${years}`,
        system: SYSTEM,
        user: userMessage(pack.patient, shortlist, years, guidanceText),
        schema: OUTPUT_SCHEMA,
        maxTokens: 3000, // projection + sub-scores only — small, fast
      });
      const projection = screen.projection ?? emptyProjection;

      // Rank the screened plans by the same weighted fit as Today, take the top 3.
      const topIds = (screen.ranked ?? [])
        .filter((r) => factsById.has(r.planId))
        .sort((a, b) => fitFromSubScores(b.subScores) - fitFromSubScores(a.subScores))
        .slice(0, DEEP_COUNT)
        .map((r) => r.planId);

      // Full deep write-up for each top pick, reasoning about the PROJECTED member,
      // run in parallel (reuses the Today machinery → identical card detail).
      const projectedPatient = buildProjectedPatient(pack.patient, projection, years);
      const deep = await rlmParallel(traj, `horizon-deep:${years}`, topIds, DEEP_COUNT, async (planId) => {
        const facts = factsById.get(planId)!;
        try {
          const d = await callDeep(traj, projectedPatient, facts);
          return deepToRanked(facts, d, 0); // horizons aren't ensembled → 0 votes
        } catch (e) {
          console.error(`horizon deep ${planId} failed:`, (e as Error).message);
          return null;
        }
      });

      const ranked = deep.filter((x): x is AiRankedPlan => x !== null).sort((a, b) => b.fitScore - a.fitScore);
      const recommended = ranked[0] ?? null;
      return {
        years,
        changedVsToday: Boolean(recommended && todayTopPlanId && recommended.planId !== todayTopPlanId),
        projection,
        recommended,
        ranked,
      };
    } catch (e) {
      console.error("horizon projection failed:", (e as Error).message);
      return { years, changedVsToday: false, projection: emptyProjection, recommended: null, ranked: [] };
    }
  });

  logTrajectory(traj);
  return { model: SIM_MODEL, todayTopPlanId, horizons };
}
