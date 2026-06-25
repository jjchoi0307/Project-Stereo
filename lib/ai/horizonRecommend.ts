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
import Anthropic from "@anthropic-ai/sdk";
import type { ClientProfileInput } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { getAnthropic } from "@/lib/sim/client";
import { SIM_MODEL } from "@/lib/sim/env";
import { HORIZON_REC, SCORING, importanceGuidance } from "@/lib/engine/config";
import {
  buildPlanFactsPack,
  type PlanFacts,
  type PlanFactsPack,
  type RecommendationPatientFacts,
} from "./planFactsPack";
import type { AiRankedPlan, AiReason, AiSubScores } from "./recommend";

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

You are given the member's CURRENT de-identified facts and the structured PLAN FACTS for every ELIGIBLE plan (extracted verbatim from the 2026 carrier documents).

Do TWO things for EACH requested horizon (the specific years are given in the user message):

1) PROJECT the member's likely future health, grounded ONLY in their current facts (age, conditions, medications, family history, utilization). Give a one-line headline, a short plain-language summary a layperson understands, and the conditions / medications they are most likely to ADD by that horizon, each with a likelihood of "low" | "moderate" | "high". Be clinically reasonable and non-alarming. This projection is about the PERSON, not the plans.

2) RECOMMEND, for that PROJECTED member, the best 1–3 plans from the provided eligible plans. For each, exactly as in the standard recommendation: five sub-scores in [0,1] (coverageFit, networkFit, medicationFit, mismatchPenalty[higher=worse], catastrophicDownside[higher=worse]); confidence; 2–5 specific reasons each citing a real figure from THAT plan's facts; and for every reason a citation {sourceFile, sourcePage, quote} using that plan's own provenance. Also estAnnualCost (USD/yr estimate) and catastrophicExposure [0,1].

ABSOLUTE GROUNDING RULE for the plan recommendation: use ONLY the provided PLAN FACTS. Never invent a plan, a figure, or a benefit. Every cited number must appear in that plan's facts. Rank purely on fit to the projected member — no carrier bias.

Order each horizon's "ranked" best-first; the first is the recommended plan for that horizon.`;

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

function userMessage(patient: RecommendationPatientFacts, candidates: PlanFacts[], guidanceText?: string): string {
  return [
    "MEMBER CURRENT FACTS (de-identified):",
    JSON.stringify(patient, null, 2),
    "",
    `For the HEALTH PROJECTION part: ${guidanceText ?? importanceGuidance()}`,
    "",
    "ELIGIBLE PLAN FACTS — the ONLY plans you may recommend and the ONLY figures you may cite:",
    JSON.stringify(packForPrompt(candidates), null, 2),
    "",
    `Produce a projection + plan recommendation for EACH of these horizons (years from now): ${HORIZONS.join(", ")}.`,
  ].join("\n");
}

// ── Schema (reuses the recommend.ts plan-item shape) ─────────────────────────

const CITATION_SCHEMA = {
  type: ["object", "null"],
  additionalProperties: false,
  required: ["sourceFile", "sourcePage", "quote"],
  properties: {
    sourceFile: { type: "string" },
    sourcePage: { type: "integer" },
    quote: { type: "string" },
  },
} as const;

const PLAN_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["planId", "subScores", "confidence", "reasons", "estAnnualCost", "catastrophicExposure"],
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
    confidence: { type: "string", enum: ["low", "moderate", "high"] },
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "positive", "text", "citation"],
        properties: {
          category: { type: "string", enum: ["coverage", "network", "medication", "cost", "supplemental", "other"] },
          positive: { type: "boolean" },
          text: { type: "string" },
          citation: CITATION_SCHEMA,
        },
      },
    },
    estAnnualCost: { type: "number" },
    catastrophicExposure: { type: "number" },
  },
} as const;

const LIKELIHOOD = { type: "string", enum: ["low", "moderate", "high"] } as const;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["horizons"],
  properties: {
    horizons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["years", "projection", "ranked"],
        properties: {
          years: { type: "integer" },
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
          ranked: { type: "array", items: PLAN_ITEM_SCHEMA },
        },
      },
    },
  },
} as const;

interface GenPlan {
  planId: string;
  subScores: AiSubScores;
  confidence: "low" | "moderate" | "high";
  reasons: AiReason[];
  estAnnualCost: number;
  catastrophicExposure: number;
}
interface GenHorizon {
  years: number;
  projection: HorizonProjection;
  ranked: GenPlan[];
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

/** Synthesize one generated plan against the authoritative pack (same guardrails as recommend.ts). */
function synthPlan(g: GenPlan, pack: PlanFactsPack): AiRankedPlan | null {
  const facts = pack.candidates.find((c) => c.planId === g.planId);
  if (!facts) return null;
  const total = facts.medicationCoverage.covered.length + facts.medicationCoverage.notCovered.length;
  const reasons: AiReason[] = (g.reasons ?? []).map((r) => ({
    category: r.category,
    positive: Boolean(r.positive),
    text: String(r.text),
    citation: r.citation
      ? { sourceFile: facts.sourceFile, sourcePage: facts.sourcePage, quote: String(r.citation.quote) }
      : null,
  }));
  return {
    planId: g.planId,
    subScores: g.subScores,
    fitScore: fitFromSubScores(g.subScores),
    confidence: g.confidence,
    reasons,
    estAnnualCost: Math.max(0, Math.round(Number(g.estAnnualCost) || 0)),
    catastrophicExposure: clamp01(Number(g.catastrophicExposure)),
    medsCoveredRate: total > 0 ? facts.medicationCoverage.covered.length / total : 1,
    annualOOPMax: facts.annualOOPMax,
    topUncoveredDrugs: facts.medicationCoverage.notCovered,
    providerGaps: facts.providerGaps,
    deepWritten: true,
    topThreeVotes: 0, // horizons aren't ensembled — votes apply only to the "today" path
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
    .slice(0, 10);

  const client = getAnthropic();
  const stream = client.messages.stream({
    model: SIM_MODEL,
    max_tokens: 28000,
    // No extended thinking — it dominated latency; temperature 0 keeps the
    // projection + grounded recommendation stable. Synthesize enforces grounding.
    temperature: 0,
    output_config: { effort: "low", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage(pack.patient, shortlist, guidanceText) }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error(`Horizon recommendation refused: ${response.stop_details?.explanation ?? "no detail"}`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Horizon recommendation truncated (hit max_tokens).");
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error(`Empty horizon recommendation (stop_reason=${response.stop_reason}).`);
  const parsed = JSON.parse(text) as { horizons?: GenHorizon[] };
  const genHorizons = Array.isArray(parsed.horizons) ? parsed.horizons : [];

  const byYear = new Map(genHorizons.map((h) => [h.years, h]));
  const horizons: AiHorizon[] = HORIZONS.map((years) => {
    const g = byYear.get(years);
    const ranked = (g?.ranked ?? [])
      .map((p) => synthPlan(p, pack))
      .filter((x): x is AiRankedPlan => x !== null)
      .sort((a, b) => b.fitScore - a.fitScore);
    const recommended = ranked[0] ?? null;
    return {
      years,
      changedVsToday: Boolean(recommended && todayTopPlanId && recommended.planId !== todayTopPlanId),
      projection: g?.projection ?? { headline: "", summary: "", conditions: [], medications: [] },
      recommended,
      ranked,
    };
  });

  return { model: response.model, todayTopPlanId, horizons };
}
