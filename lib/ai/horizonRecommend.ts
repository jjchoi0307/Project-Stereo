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
import { HORIZON_REC, importanceGuidance } from "@/lib/engine/config";
import { newTrajectory, rlmLeaf, rlmParallel, logTrajectory } from "./rlm";
import {
  buildPlanFactsPack,
  type PlanFacts,
  type RecommendationPatientFacts,
} from "./planFactsPack";
import { callDeep, deepToRanked, type AiRankedPlan } from "./recommend";

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

const SYSTEM = `You are a clinical-actuarial reasoning assistant for a Medicare Advantage broker tool at Seoul Medical Group. You think about how a prospective member's health is likely to evolve.

You are given the member's CURRENT de-identified facts. The user message specifies ONE horizon (a number of years from now). PROJECT the member's likely future health at that horizon, grounded ONLY in their current facts (age, conditions, medications, family history, utilization):
- a one-line "headline",
- a short plain-language "summary" a layperson understands,
- the "conditions" and "medications" they are most likely to ADD by then, each with a likelihood "low" | "moderate" | "high".

Be clinically reasonable and non-alarming. This projection is about the PERSON, not any insurance plan. Never invent conditions or medications the current facts do not support; sparse facts → fewer, lower-likelihood additions.`;

// Projection prompt: member facts ONLY (no plan pack). The projection is about
// the person, so omitting the plan facts keeps the input small → faster call.
function projectionMessage(patient: RecommendationPatientFacts, years: number, guidanceText?: string): string {
  return [
    "MEMBER CURRENT FACTS (de-identified):",
    JSON.stringify(patient, null, 2),
    "",
    guidanceText ?? importanceGuidance(),
    "",
    `Produce the health projection for the ${years}-year horizon (${years} years from now).`,
  ].join("\n");
}

// ── Schema ───────────────────────────────────────────────────────────────────

const LIKELIHOOD = { type: "string", enum: ["low", "moderate", "high"] } as const;

// Single-horizon PROJECTION output — just the member's projected health. Plan
// selection is deterministic (the shortlist) and the full plan write-ups run via
// the SAME deep machinery as Today, in parallel — so no model call here serializes
// plan scoring + projection together (that was the horizon's redundant slow step).
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["projection"],
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
  },
} as const;

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

  // Deterministic candidate shortlist (instant). The top-3 get the full deep
  // write-up; the deep write-ups produce the real fit scores that decide the final
  // order. This replaces the old LLM "screen" pass (which re-scored every plan only
  // to throw it away when the deep write-up re-scored the same plans) — removing a
  // serial ~8s model call from the horizon's critical path.
  const medsRate = (c: PlanFacts) => {
    const t = c.medicationCoverage.covered.length + c.medicationCoverage.notCovered.length;
    return t > 0 ? c.medicationCoverage.covered.length / t : 1;
  };
  const topIds = [...pack.candidates]
    .sort((a, b) =>
      a.providerGaps.length - b.providerGaps.length ||
      medsRate(b) - medsRate(a) ||
      a.annualOOPMax - b.annualOOPMax ||
      a.monthlyPremium - b.monthlyPremium,
    )
    .slice(0, DEEP_COUNT)
    .map((c) => c.planId);

  const emptyProjection: HorizonProjection = { headline: "", summary: "", conditions: [], medications: [] };
  const factsById = new Map(pack.candidates.map((c) => [c.planId, c]));
  const traj = newTrajectory("horizon-projection");

  // RLM DECOMPOSE → DELEGATE: one pipeline PER horizon, the two horizons run in
  // PARALLEL. Within each horizon: a cheap PROJECTION call (member facts only — no
  // plan pack, so small + fast), then the deterministic top-3 get the SAME full
  // deep write-up as Today, reasoning over the PROJECTED member, run in PARALLEL
  // (one plan per call). So no horizon serializes three write-ups, and the only
  // serial step is the small projection. A failed horizon degrades to an empty card.
  const horizons = await rlmParallel(traj, "horizons", [...HORIZONS], HORIZONS.length, async (years): Promise<AiHorizon> => {
    try {
      const proj = await rlmLeaf<{ projection?: HorizonProjection }>(traj, {
        label: `horizon-project:${years}`,
        system: SYSTEM,
        user: projectionMessage(pack.patient, years, guidanceText),
        schema: OUTPUT_SCHEMA,
        maxTokens: 1500, // projection narrative only — small, fast
      });
      const projection = proj.projection ?? emptyProjection;

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
