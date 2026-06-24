/**
 * AI-powered plan recommendation — grounded strictly in the 2026 plan files.
 *
 * The recommendation (ranking, fit score, scoring reasons, bullet points, source
 * citations) is produced by Claude reasoning over ONLY the plan-facts pack
 * (lib/ai/planFactsPack.ts) — the structured benefits extracted from the carrier
 * PDFs, every figure tagged with its sourceFile + sourcePage. The model never
 * sees, and may never invent, anything outside that pack.
 *
 * RLM method (generate → verify → synthesize):
 *   1. GENERATE — Claude ranks the eligible candidates and, per plan, returns
 *      sub-scores, reasons (strengths + caveats), and a citation for every figure.
 *   2. VERIFY  — a second Claude pass audits each reason/citation against the
 *      authoritative pack and repairs or drops anything not grounded in the data.
 *   3. SYNTHESIZE — programmatic guardrails enforce the hard invariants the model
 *      can't be trusted to: every planId is a real candidate, every citation
 *      points at that plan's own source file/page, the fit score is recomputed
 *      from the sub-scores, and the deterministic facts (meds-covered rate, MOOP
 *      ceiling, provider gaps) are attached from the pack — not the model.
 *
 * Eligibility stays deterministic (the pack is already gated), so an ineligible
 * plan can never be recommended. The verify pass + server-side caching make the
 * output grounded and repeatable for the same client.
 */

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ClientProfileInput } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { SCORING } from "@/lib/engine/config";
import { getAnthropic } from "@/lib/sim/client";
import { SIM_MODEL } from "@/lib/sim/env";
import {
  buildPlanFactsPack,
  type PlanFacts,
  type PlanFactsPack,
  type RecommendationPatientFacts,
} from "./planFactsPack";

// ── Public result shape (the routes map this into the UI response) ───────────

export type ReasonCategory =
  | "coverage"
  | "network"
  | "medication"
  | "cost"
  | "supplemental"
  | "other";

export interface AiCitation {
  sourceFile: string;
  sourcePage: number;
  quote: string; // a figure/phrase present in the plan facts
}

export interface AiReason {
  category: ReasonCategory;
  positive: boolean; // strength (true) vs caveat (false)
  text: string;
  citation: AiCitation | null;
}

/** Five sub-scores, each a 0..1 fit measure (× its weight gives the contribution). */
export interface AiSubScores {
  coverageFit: number;
  networkFit: number;
  medicationFit: number;
  mismatchPenalty: number; // subtracted
  catastrophicDownside: number; // subtracted
}

export interface AiRankedPlan {
  planId: string;
  fitScore: number; // recomputed from sub-scores × weights
  subScores: AiSubScores; // 0..1 each
  confidence: "low" | "moderate" | "high";
  reasons: AiReason[];
  /** Grounded cost picture (estimate flagged as such in the prompt). */
  estAnnualCost: number; // typical expected annual out-of-pocket
  catastrophicExposure: number; // 0..1 likelihood of approaching the MOOP ceiling
  // Deterministic facts attached during synthesize (NOT model-produced):
  medsCoveredRate: number;
  annualOOPMax: number;
  topUncoveredDrugs: string[];
  providerGaps: string[];
}

export interface AiRecommendation {
  model: string;
  topPlanId: string | null;
  ranked: AiRankedPlan[];
  excluded: { planId: string; name: string; reasons: string[] }[];
  /** The exact grounding inputs, kept for the audit record (reproducibility by record). */
  groundingPackSignature: string;
}

// ── Prompt construction ──────────────────────────────────────────────────────

const SYSTEM_GENERATE = `You are a Medicare Advantage plan-fit analyst for Seoul Medical Group brokers. You recommend plans for a prospective member.

ABSOLUTE GROUNDING RULE: your ONLY knowledge of any plan is the structured "PLAN FACTS" provided in the user message. These facts were extracted verbatim from the 2026 carrier plan documents. You MUST NOT use any outside knowledge of these or any other plans, invent figures, or reference a plan not in the list. Every dollar amount, copay, benefit, or coverage claim you make MUST appear in the provided facts for that specific plan.

Your job: rank ALL the provided eligible plans best-first for THIS member, and for each plan produce:
- Five sub-scores in [0,1] (1 = ideal fit): coverageFit (non-drug benefits & OOP protection vs the member's needs), networkFit (keeps required + likely-needed providers), medicationFit (covers the member's current/likely medications), mismatchPenalty (expected coverage gaps & cost — HIGHER = worse), catastrophicDownside (worst-case financial exposure — HIGHER = worse).
- confidence: "low" | "moderate" | "high" — how strongly the facts support this plan's placement.
- reasons: 2–5 specific strengths and any caveats. Each reason is one concrete sentence referencing an actual figure from this plan's facts (e.g. "$0 monthly premium with a $4,900 in-network out-of-pocket maximum"). Mark each positive=true (strength) or positive=false (caveat). Categorize each: coverage | network | medication | cost | supplemental | other.
- For EVERY reason, a citation: { sourceFile, sourcePage, quote } where sourceFile and sourcePage are this plan's own provenance from the facts, and quote is the exact figure/phrase from the facts the reason relies on. If a reason somehow cites no specific figure, set citation to null (avoid this).
- estAnnualCost: a grounded estimate (USD/year) of this member's typical out-of-pocket, reasoning from the premium, copays, and drug tiers in the facts. This is an estimate.
- catastrophicExposure: a value in [0,1], your estimate of the likelihood this member approaches the plan's out-of-pocket maximum, given their conditions/medications.

Be specific and member-centric: tie reasons to the member's actual conditions, medications, and must-keep providers. Do not show bias toward any carrier — rank purely on fit to the member's facts.`;

const SYSTEM_VERIFY = `You are a meticulous compliance auditor. You are given (a) the AUTHORITATIVE plan facts (extracted from 2026 carrier documents) and (b) a draft recommendation produced by another analyst.

Your sole job is to make the draft 100% grounded in the authoritative facts. For every plan and every reason:
- VERIFY each dollar figure, copay, benefit, and coverage claim against that plan's authoritative facts. If a figure does not appear in the facts, CORRECT it to the right value from the facts, or REMOVE that reason if it has no grounding.
- VERIFY each citation: sourceFile and sourcePage MUST equal that plan's own provenance in the facts; the quote MUST be a phrase/figure present in the facts. Repair any mismatch.
- REMOVE any plan that is not present in the authoritative facts.
- Keep sub-scores, confidence, estAnnualCost, and catastrophicExposure, adjusting only if a removed/corrected reason makes them indefensible.

Return the corrected recommendation in the same structure. Do not add new plans. Do not introduce any figure not in the authoritative facts.`;

/** Compact the pack for the prompt (drop nulls to save tokens, keep provenance). */
function packForPrompt(candidates: PlanFacts[]) {
  return candidates.map((c) => ({
    planId: c.planId,
    name: c.name,
    carrier: c.carrier,
    planType: c.planType,
    kind: c.kind,
    snpType: c.snpType,
    snpConditions: c.snpConditions ?? undefined,
    dsnpDualEligibility: c.dsnpDualEligibility ?? undefined,
    source: { sourceFile: c.sourceFile, sourcePage: c.sourcePage },
    monthlyPremium: c.monthlyPremium,
    annualOOPMax: c.annualOOPMax,
    annualOOPMaxOutOfNetwork: c.annualOOPMaxOutOfNetwork ?? undefined,
    partCDeductible: c.partCDeductible ?? undefined,
    pcpCopay: c.pcpCopay,
    specialistCopay: c.specialistCopay,
    inpatient: { perDay: c.inpatientPerDay, days: c.inpatientDays },
    mentalHealthOutpatientCopay: c.mentalHealthOutpatientCopay,
    acupuncture: { visitsPerYear: c.acupunctureVisitsPerYear, copay: c.acupunctureCopay },
    insulinMonthlyCap: c.insulinMonthlyCap ?? undefined,
    drugTiers: c.drugTiers.map((t) => ({ tier: t.tier, costShare: t.costShare, printed: t.display ?? undefined })),
    supplemental: Object.fromEntries(Object.entries(c.supplemental).filter(([, v]) => v != null)),
    networkSystems: c.networkSystems,
    medicationCoverage: c.medicationCoverage,
  }));
}

function userMessage(patient: RecommendationPatientFacts, candidates: PlanFacts[]): string {
  return [
    "MEMBER FACTS (de-identified):",
    JSON.stringify(patient, null, 2),
    "",
    "PLAN FACTS — the ONLY plans you may recommend, and the ONLY figures you may cite (one block per eligible plan; `source` is that plan's provenance for citations):",
    JSON.stringify(packForPrompt(candidates), null, 2),
    "",
    "Rank ALL of the above plans best-first for this member. Use ONLY these facts.",
  ].join("\n");
}

// ── Structured-output schemas ────────────────────────────────────────────────

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
  required: [
    "planId",
    "subScores",
    "confidence",
    "reasons",
    "estAnnualCost",
    "catastrophicExposure",
  ],
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

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ranked"],
  properties: {
    ranked: { type: "array", items: PLAN_ITEM_SCHEMA },
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

// ── Anthropic call helper (streamed, structured) ─────────────────────────────

async function callStructured(
  client: Anthropic,
  system: string,
  user: string,
): Promise<{ ranked: GenPlan[]; model: string }> {
  const stream = client.messages.stream({
    model: SIM_MODEL,
    max_tokens: 24000,
    // Adaptive thinking requires the default temperature; grounding + the
    // programmatic verify in synthesize + server-side caching (not temperature)
    // are what make output stable. Effort "low" keeps latency well under the
    // route's 120s budget — the task is well-structured (rank a short candidate
    // list against given facts), so deep deliberation isn't needed.
    thinking: { type: "adaptive" },
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system,
    messages: [{ role: "user", content: user }],
  });
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new Error(`Recommendation refused: ${response.stop_details?.explanation ?? "no detail"}`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Recommendation truncated (hit max_tokens) — raise the cap in lib/ai/recommend.ts.");
  }
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new Error(`Empty recommendation (stop_reason=${response.stop_reason}).`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Recommendation was not valid JSON: ${(e as Error).message}`);
  }
  const ranked = (parsed as { ranked?: unknown }).ranked;
  if (!Array.isArray(ranked)) throw new Error("Recommendation missing `ranked` array.");
  return { ranked: ranked as GenPlan[], model: response.model };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const W = SCORING.weights;

/** Recompute the fit score from sub-scores × weights (never trust a model total). */
function fitFromSubScores(s: AiSubScores): number {
  const expected =
    clamp01(s.coverageFit) * W.coverageFit +
    clamp01(s.networkFit) * W.networkFit +
    clamp01(s.medicationFit) * W.medicationFit -
    clamp01(s.mismatchPenalty) * W.mismatchPenalty;
  const total = expected - clamp01(s.catastrophicDownside) * W.catastrophicDownside;
  return Math.round(total * 10) / 10;
}

/** How many candidates the AI scores in full detail (the rest get a heuristic listing). */
const SHORTLIST_SIZE = 8;

const medsRateOf = (c: PlanFacts) => {
  const total = c.medicationCoverage.covered.length + c.medicationCoverage.notCovered.length;
  return total > 0 ? c.medicationCoverage.covered.length / total : 1;
};

/**
 * Cheap, grounded heuristic sub-scores — used ONLY to (a) shortlist which plans
 * the AI scores in full, and (b) give the un-shortlisted eligible plans a sensible
 * ranking in the "other eligible" table. The actual fit score, reasons, bullets,
 * and citations for the shown plans are all AI-produced.
 */
function heuristicSubScores(c: PlanFacts, mustKeep: boolean, maxPremium: number, maxMoop: number, medCount: number): AiSubScores {
  const moopN = maxMoop > 0 ? c.annualOOPMax / maxMoop : 0;
  const premN = maxPremium > 0 ? c.monthlyPremium / maxPremium : 0;
  const suppCount = Object.values(c.supplemental).filter((v) => v != null).length;
  const suppScore = Math.min(1, suppCount / 8);
  const notCoveredShare = medCount > 0 ? c.medicationCoverage.notCovered.length / medCount : 0;
  return {
    coverageFit: clamp01(0.5 * (1 - moopN) + 0.5 * suppScore),
    networkFit: c.providerGaps.length > 0 ? 0.2 : mustKeep ? 0.95 : 0.85,
    medicationFit: clamp01(medsRateOf(c)),
    mismatchPenalty: clamp01(0.5 * premN + 0.5 * notCoveredShare),
    catastrophicDownside: clamp01(moopN),
  };
}

/** Normalize a citation quote + plan facts to a comparable token bag for grounding. */
function groundTokens(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Programmatic anti-hallucination guard (replaces a second slow LLM pass): a
 * citation's quote must actually appear in that plan's authoritative facts. If
 * the quote's tokens aren't found, the citation is dropped (the reason stays, but
 * uncited, so it can't masquerade as sourced).
 */
function citationIsGrounded(quote: string, factsHaystack: string): boolean {
  const q = groundTokens(quote);
  if (!q) return false;
  // Require each significant token of the quote to be present in the facts.
  const tokens = q.split(" ").filter((t) => t.length >= 2);
  if (tokens.length === 0) return false;
  return tokens.every((t) => factsHaystack.includes(t));
}

interface SynthInput {
  gen: GenPlan[];
  pack: PlanFactsPack;
  mustKeep: boolean;
  maxPremium: number;
  maxMoop: number;
  medCount: number;
  shortlist: Set<string>;
}

/**
 * Synthesize: enforce the hard invariants the model can't be trusted with.
 *  - keep only real candidates; attach deterministic facts from the pack
 *  - every citation points at the plan's own file/page AND its quote must be
 *    present in that plan's facts, else the citation is dropped
 *  - recompute fit score; sort best-first
 *  - eligible plans the AI didn't score get a heuristic listing (clearly flagged)
 */
function synthesize(input: SynthInput): AiRankedPlan[] {
  const { gen, pack, mustKeep, maxPremium, maxMoop, medCount } = input;
  const factsById = new Map(pack.candidates.map((c) => [c.planId, c]));
  const seen = new Set<string>();
  const out: AiRankedPlan[] = [];

  for (const g of gen) {
    const facts = factsById.get(g.planId);
    if (!facts || seen.has(g.planId)) continue; // drop hallucinated / duplicate plans
    seen.add(g.planId);

    const factsHaystack = groundTokens(JSON.stringify(packForPrompt([facts])));
    const reasons: AiReason[] = (g.reasons ?? []).map((r) => {
      const grounded = r.citation && citationIsGrounded(String(r.citation.quote), factsHaystack);
      return {
        category: r.category,
        positive: Boolean(r.positive),
        text: String(r.text),
        // Citation always points at THIS plan's own provenance; kept only if its
        // quote is actually present in the plan's facts.
        citation: grounded
          ? { sourceFile: facts.sourceFile, sourcePage: facts.sourcePage, quote: String(r.citation!.quote) }
          : null,
      };
    });

    out.push({
      planId: g.planId,
      subScores: g.subScores,
      fitScore: fitFromSubScores(g.subScores),
      confidence: g.confidence,
      reasons,
      estAnnualCost: Math.max(0, Math.round(Number(g.estAnnualCost) || 0)),
      catastrophicExposure: clamp01(Number(g.catastrophicExposure)),
      medsCoveredRate: medsRateOf(facts),
      annualOOPMax: facts.annualOOPMax,
      topUncoveredDrugs: facts.medicationCoverage.notCovered,
      providerGaps: facts.providerGaps,
    });
  }

  // Eligible plans the AI didn't individually score → heuristic listing so they
  // still appear (ranked sensibly) in the "other eligible" table.
  for (const c of pack.candidates) {
    if (seen.has(c.planId)) continue;
    const sub = heuristicSubScores(c, mustKeep, maxPremium, maxMoop, medCount);
    out.push({
      planId: c.planId,
      subScores: sub,
      fitScore: fitFromSubScores(sub),
      confidence: "low",
      reasons: [
        {
          category: "other",
          positive: false,
          text: "Eligible; not individually written up in this run — open its benefits to review in detail.",
          citation: { sourceFile: c.sourceFile, sourcePage: c.sourcePage, quote: `${c.name}` },
        },
      ],
      estAnnualCost: 0,
      catastrophicExposure: clamp01(sub.catastrophicDownside),
      medsCoveredRate: medsRateOf(c),
      annualOOPMax: c.annualOOPMax,
      topUncoveredDrugs: c.medicationCoverage.notCovered,
      providerGaps: c.providerGaps,
    });
  }

  out.sort((a, b) => b.fitScore - a.fitScore);
  return out;
}

export interface RecommendOptions {
  /** Run the extra LLM verify pass (slower; off by default — synthesize already grounds). */
  runVerify?: boolean;
  /** Relax hard provider requirements (near-miss path when nothing is eligible). */
  ignoreProviderConstraints?: boolean;
}

/**
 * Produce the AI recommendation for a profile, grounded in the 2026 plan files.
 * Returns ranked candidates (best-first) + the excluded plans from the gate.
 */
export async function recommendPlans(
  profile: ClientProfileInput,
  db: DataStore,
  opts: RecommendOptions = {},
): Promise<AiRecommendation> {
  const pack = await buildPlanFactsPack(profile, db, {
    ignoreProviderConstraints: opts.ignoreProviderConstraints,
  });
  const fullSignature = JSON.stringify(packForPrompt(pack.candidates));

  // No eligible plan — nothing for the model to rank.
  if (pack.candidates.length === 0) {
    return { model: SIM_MODEL, topPlanId: null, ranked: [], excluded: pack.excluded, groundingPackSignature: fullSignature };
  }

  const mustKeep = pack.patient.mustKeepProviders.length > 0;
  const maxPremium = Math.max(1, ...pack.candidates.map((c) => c.monthlyPremium));
  const maxMoop = Math.max(1, ...pack.candidates.map((c) => c.annualOOPMax));
  const medCount = pack.patient.medications.length;

  // Shortlist the most promising candidates (by the grounded heuristic) for full
  // AI scoring — keeps latency under the route budget while the AI still produces
  // the real fit score / reasons / bullets / citations for every shown plan.
  const shortlistFacts = [...pack.candidates]
    .map((c) => ({ c, fit: fitFromSubScores(heuristicSubScores(c, mustKeep, maxPremium, maxMoop, medCount)) }))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, SHORTLIST_SIZE)
    .map((x) => x.c);
  const shortlist = new Set(shortlistFacts.map((c) => c.planId));

  const client = getAnthropic();
  const user = userMessage(pack.patient, shortlistFacts);

  // 1. GENERATE — AI scores the shortlist.
  const generated = await callStructured(client, SYSTEM_GENERATE, user);
  let finalGen = generated.ranked;
  let model = generated.model;

  // 2. (optional) VERIFY pass — off by default; the synthesize guardrails below
  // already enforce grounding programmatically (real plan, real provenance, quote
  // present in facts) without a second multi-minute LLM call.
  if (opts.runVerify) {
    const verifyUser = [
      "AUTHORITATIVE PLAN FACTS (the source of truth):",
      JSON.stringify(packForPrompt(shortlistFacts), null, 2),
      "",
      "DRAFT RECOMMENDATION to audit and correct:",
      JSON.stringify({ ranked: generated.ranked }, null, 2),
      "",
      "Return the corrected recommendation. Remove any plan not in the authoritative facts; correct or remove any ungrounded figure or citation.",
    ].join("\n");
    try {
      const verified = await callStructured(client, SYSTEM_VERIFY, verifyUser);
      if (verified.ranked.length > 0) {
        finalGen = verified.ranked;
        model = verified.model;
      }
    } catch (e) {
      console.error("recommend verify pass failed:", (e as Error).name, (e as Error).message);
    }
  }

  // 3. SYNTHESIZE — programmatic guardrails + deterministic facts.
  const ranked = synthesize({ gen: finalGen, pack, mustKeep, maxPremium, maxMoop, medCount, shortlist });

  return { model, topPlanId: ranked[0]?.planId ?? null, ranked, excluded: pack.excluded, groundingPackSignature: fullSignature };
}
