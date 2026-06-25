/**
 * AI-powered plan recommendation — grounded strictly in the 2026 plan files.
 *
 * Two-stage RLM pipeline (decompose → delegate → synthesize):
 *   1. SCREEN  — one fast Claude pass ranks ALL eligible plans (any carrier) by
 *      fit to the member and picks the best few. This is the "which plans fit
 *      best" triage; output is small (ids + a one-line rationale) so it's quick.
 *   2. DEEP    — the top plans each get a PARALLEL detailed Claude call producing
 *      the fit-score sub-components (each with a grounded "why"), the bullet
 *      points, the source citations, and a cost breakdown tied to the member's
 *      expected utilization. Running these concurrently keeps latency low while
 *      every shown top plan is fully written up.
 *   3. SYNTHESIZE — programmatic guardrails: every planId is a real candidate,
 *      every citation points at that plan's own file/page and its quote is present
 *      in the facts, the fit score is recomputed from the sub-scores, and the
 *      deterministic facts (meds-covered rate, MOOP, provider gaps) are attached.
 *
 * The model's only knowledge of any plan is the structured plan-facts pack
 * (lib/ai/planFactsPack.ts) extracted from the carrier PDFs — it can't invent a
 * plan or a figure. Eligibility stays a deterministic gate, so an ineligible plan
 * can never be recommended. (The literal "recursive REPL over near-infinite
 * context" RLM variant isn't used here — the plan facts fit easily in one prompt,
 * so it would only add latency; we use the RLM decompose/delegate/synthesize
 * structure, which is what fits this bounded, grounded task.)
 */

import "server-only";
import type { ClientProfileInput } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { SCORING, ENSEMBLE, TIEBREAK_RULE } from "@/lib/engine/config";
import { SIM_MODEL } from "@/lib/sim/env";
import { newTrajectory, rlmLeaf, rlmParallel, logTrajectory, type RlmTrajectory } from "./rlm";
import {
  buildPlanFactsPack,
  type PlanFacts,
  type PlanFactsPack,
  type RecommendationPatientFacts,
} from "./planFactsPack";

// ── Public result shape (the routes map this into the UI response) ───────────

export type ReasonCategory = "coverage" | "network" | "medication" | "cost" | "supplemental" | "other";

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

/** A grounded one-line explanation of WHY each fit-score component scored as it did. */
export interface AiSubScoreWhy {
  coverageFit: string;
  networkFit: string;
  medicationFit: string;
  mismatchPenalty: string;
  catastrophicDownside: string;
}

/** One line item of the predicted annual cost, tied to the member's expected use. */
export interface AiCostItem {
  label: string; // e.g. "Premium", "Metformin (Tier 1)", "Specialist visits"
  annualEstimate: number; // USD/year
  basis: string; // how it was computed, e.g. "$0/mo × 12" or "$0 copay × 4 visits"
}

export interface AiCostBreakdown {
  items: AiCostItem[];
  estimatedAnnualTotal: number;
}

export interface AiRankedPlan {
  planId: string;
  fitScore: number; // recomputed from sub-scores × weights
  subScores: AiSubScores; // 0..1 each
  subScoreWhy?: AiSubScoreWhy | null; // per-component grounded explanation (deep-written plans)
  confidence: "low" | "moderate" | "high";
  reasons: AiReason[];
  costBreakdown?: AiCostBreakdown | null; // predicted cost, tied to expected utilization (deep plans)
  estAnnualCost: number; // = costBreakdown.estimatedAnnualTotal when present
  catastrophicExposure: number; // 0..1 likelihood of approaching the MOOP ceiling
  // Deterministic facts attached during synthesize (NOT model-produced):
  medsCoveredRate: number;
  annualOOPMax: number;
  topUncoveredDrugs: string[];
  providerGaps: string[];
  /** True when this plan got the full parallel deep write-up (top picks). */
  deepWritten: boolean;
  /** How many of the ensemble runs placed this plan in the top 3 (confidence). */
  topThreeVotes: number;
}

export interface AiRecommendation {
  model: string;
  topPlanId: string | null;
  ranked: AiRankedPlan[];
  excluded: { planId: string; name: string; reasons: string[] }[];
  /** The exact grounding inputs, kept for the audit record (reproducibility by record). */
  groundingPackSignature: string;
  /** Ensemble: number of screen runs the top-3 frequency was voted across. */
  ensembleRuns: number;
}

// How many top plans get the full parallel deep write-up (the prominent cards).
const DEEP_COUNT = 3;

// ── Stage 1: SCREEN ──────────────────────────────────────────────────────────

const SYSTEM_SCREEN = `You are a Medicare Advantage plan-fit analyst for Seoul Medical Group brokers. You are screening which plans best fit a prospective member.

ABSOLUTE GROUNDING RULE: your only knowledge of any plan is the structured PLAN FACTS provided (extracted verbatim from 2026 carrier documents). Never invent plans or figures, and never reference a plan not in the list.

Rank ALL the provided eligible plans best-first for THIS member. For each, return only:
- planId (exactly as given)
- fit: an integer 0–100 (how well it fits this member's conditions, medications, providers, and cost needs)

Rank purely on fit to the member's facts — no carrier bias. Consider any plan; the best fit may be from any carrier. Keep output minimal (ids + fit only) — the detailed write-ups happen in a later step.`;

const SCREEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ranked"],
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["planId", "fit"],
        properties: {
          planId: { type: "string" },
          fit: { type: "integer" },
        },
      },
    },
  },
} as const;

/** Compact facts for the screen — enough to judge fit, small enough to be fast. */
function screenPack(candidates: PlanFacts[]) {
  return candidates.map((c) => ({
    planId: c.planId,
    name: c.name,
    carrier: c.carrier,
    kind: c.kind,
    monthlyPremium: c.monthlyPremium,
    annualOOPMax: c.annualOOPMax,
    pcpCopay: c.pcpCopay,
    specialistCopay: c.specialistCopay,
    networkSystems: c.networkSystems,
    medsCovered: `${c.medicationCoverage.covered.length}/${c.medicationCoverage.covered.length + c.medicationCoverage.notCovered.length}`,
    supplementalCount: Object.values(c.supplemental).filter((v) => v != null).length,
  }));
}

interface ScreenItem {
  planId: string;
  fit: number;
}

// RLM leaf: one screen sub-call (ranks all plans). Decompose step of the ensemble.
async function callScreen(
  traj: RlmTrajectory,
  patient: RecommendationPatientFacts,
  candidates: PlanFacts[],
): Promise<ScreenItem[]> {
  const user = [
    "MEMBER FACTS (de-identified):",
    JSON.stringify(patient, null, 2),
    "",
    "ELIGIBLE PLANS (the only plans you may rank):",
    JSON.stringify(screenPack(candidates), null, 2),
    "",
    "Rank ALL of these plans best-first for this member.",
  ].join("\n");
  const parsed = await rlmLeaf<{ ranked?: ScreenItem[] }>(traj, {
    label: "screen",
    system: SYSTEM_SCREEN,
    user,
    schema: SCREEN_SCHEMA,
  });
  return Array.isArray(parsed.ranked) ? parsed.ranked : [];
}

// ── Stage 2: DEEP write-up (one plan, full detail) ───────────────────────────

const SYSTEM_DEEP = `You are a Medicare Advantage plan-fit analyst for Seoul Medical Group brokers. You are writing the detailed recommendation for ONE plan for a prospective member.

ABSOLUTE GROUNDING RULE: your only knowledge of this plan is the PLAN FACTS provided (extracted verbatim from the 2026 carrier document). Every dollar amount, copay, benefit, or coverage claim MUST appear in those facts. Never invent a figure.

Produce, for this single plan and this member:
- subScores: five values in [0,1] (1 = ideal): coverageFit (non-drug benefits & OOP protection vs needs), networkFit (keeps required + likely providers), medicationFit (covers the member's current/likely meds), mismatchPenalty (expected coverage gaps & cost — HIGHER = worse), catastrophicDownside (worst-case exposure — HIGHER = worse).
- subScoreWhy: for EACH of the five sub-scores, one concrete sentence explaining WHY it scored that way, referencing the member's facts and this plan's figures (e.g. "Medication fit is high: both metformin and atorvastatin are $0 Tier 1.").
- confidence: "low" | "moderate" | "high".
- reasons: 3–5 plain-language bullet points (strengths, plus any caveats) a broker would show the member. Each references an actual figure from the facts. Mark positive true/false and categorize: coverage|network|medication|cost|supplemental|other.
- For EVERY reason, a citation { sourceFile, sourcePage, quote } using THIS plan's own provenance and an exact figure/phrase from the facts.
- costBreakdown: a predicted ANNUAL out-of-pocket cost for THIS member, built bottom-up and tied to their expected utilization. Provide line items, each { label, annualEstimate (USD), basis }, e.g. premium ($/mo × 12), each current medication (tier cost-share × ~12 fills), specialist visits (copay × the member's specialist visits/yr), and any cost their conditions make likely. estimatedAnnualTotal = the sum. Ground every figure in the plan facts + the member's utilization.
- catastrophicExposure: a value in [0,1], the likelihood this member approaches the plan's out-of-pocket maximum.`;

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

const DEEP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subScores", "subScoreWhy", "confidence", "reasons", "costBreakdown", "catastrophicExposure"],
  properties: {
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
    subScoreWhy: {
      type: "object",
      additionalProperties: false,
      required: ["coverageFit", "networkFit", "medicationFit", "mismatchPenalty", "catastrophicDownside"],
      properties: {
        coverageFit: { type: "string" },
        networkFit: { type: "string" },
        medicationFit: { type: "string" },
        mismatchPenalty: { type: "string" },
        catastrophicDownside: { type: "string" },
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
    costBreakdown: {
      type: "object",
      additionalProperties: false,
      required: ["items", "estimatedAnnualTotal"],
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "annualEstimate", "basis"],
            properties: {
              label: { type: "string" },
              annualEstimate: { type: "number" },
              basis: { type: "string" },
            },
          },
        },
        estimatedAnnualTotal: { type: "number" },
      },
    },
    catastrophicExposure: { type: "number" },
  },
} as const;

interface DeepResult {
  subScores: AiSubScores;
  subScoreWhy: AiSubScoreWhy;
  confidence: "low" | "moderate" | "high";
  reasons: AiReason[];
  costBreakdown: AiCostBreakdown;
  catastrophicExposure: number;
}

/** Full facts for a single plan (the deep call sees everything for one plan). */
function deepPlanFacts(c: PlanFacts) {
  return {
    planId: c.planId,
    name: c.name,
    carrier: c.carrier,
    planType: c.planType,
    kind: c.kind,
    snpType: c.snpType,
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
  };
}

// RLM leaf: the deep write-up sub-call for ONE plan (delegate step).
async function callDeep(
  traj: RlmTrajectory,
  patient: RecommendationPatientFacts,
  facts: PlanFacts,
): Promise<DeepResult> {
  const user = [
    "MEMBER FACTS (de-identified):",
    JSON.stringify(patient, null, 2),
    "",
    "PLAN FACTS (the only plan you may describe; cite figures from here):",
    JSON.stringify(deepPlanFacts(facts), null, 2),
    "",
    "Write the detailed recommendation for this plan and this member.",
  ].join("\n");
  return rlmLeaf<DeepResult>(traj, {
    label: `deep:${facts.planId}`,
    system: SYSTEM_DEEP,
    user,
    schema: DEEP_SCHEMA,
  });
}

// ── Scoring + grounding helpers ──────────────────────────────────────────────

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

const medsRateOf = (c: PlanFacts) => {
  const total = c.medicationCoverage.covered.length + c.medicationCoverage.notCovered.length;
  return total > 0 ? c.medicationCoverage.covered.length / total : 1;
};

/** Heuristic sub-scores for the "other eligible" tail (no LLM detail needed there). */
function heuristicSubScores(c: PlanFacts, mustKeep: boolean, maxPremium: number, maxMoop: number, medCount: number): AiSubScores {
  const moopN = maxMoop > 0 ? c.annualOOPMax / maxMoop : 0;
  const premN = maxPremium > 0 ? c.monthlyPremium / maxPremium : 0;
  const suppScore = Math.min(1, Object.values(c.supplemental).filter((v) => v != null).length / 8);
  const notCoveredShare = medCount > 0 ? c.medicationCoverage.notCovered.length / medCount : 0;
  return {
    coverageFit: clamp01(0.5 * (1 - moopN) + 0.5 * suppScore),
    networkFit: c.providerGaps.length > 0 ? 0.2 : mustKeep ? 0.95 : 0.85,
    medicationFit: clamp01(medsRateOf(c)),
    mismatchPenalty: clamp01(0.5 * premN + 0.5 * notCoveredShare),
    catastrophicDownside: clamp01(moopN),
  };
}

const groundTokens = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A citation's quote must actually appear in that plan's facts (anti-hallucination). */
function citationIsGrounded(quote: string, factsHaystack: string): boolean {
  const tokens = groundTokens(quote).split(" ").filter((t) => t.length >= 2);
  return tokens.length > 0 && tokens.every((t) => factsHaystack.includes(t));
}

/** Build the AiRankedPlan for a deep-written top plan, with grounding guardrails. */
function deepToRanked(facts: PlanFacts, d: DeepResult, topThreeVotes: number): AiRankedPlan {
  const haystack = groundTokens(JSON.stringify(deepPlanFacts(facts)));
  const reasons: AiReason[] = (d.reasons ?? []).map((r) => {
    const grounded = r.citation && citationIsGrounded(String(r.citation.quote), haystack);
    return {
      category: r.category,
      positive: Boolean(r.positive),
      text: String(r.text),
      citation: grounded
        ? { sourceFile: facts.sourceFile, sourcePage: facts.sourcePage, quote: String(r.citation!.quote) }
        : null,
    };
  });
  const cost = d.costBreakdown;
  const total = cost ? Math.max(0, Math.round(Number(cost.estimatedAnnualTotal) || 0)) : 0;
  return {
    planId: facts.planId,
    subScores: d.subScores,
    subScoreWhy: d.subScoreWhy ?? null,
    fitScore: fitFromSubScores(d.subScores),
    confidence: d.confidence ?? "moderate",
    reasons,
    costBreakdown: cost
      ? {
          items: (cost.items ?? []).map((i) => ({
            label: String(i.label),
            annualEstimate: Math.max(0, Math.round(Number(i.annualEstimate) || 0)),
            basis: String(i.basis),
          })),
          estimatedAnnualTotal: total,
        }
      : null,
    estAnnualCost: total,
    catastrophicExposure: clamp01(Number(d.catastrophicExposure)),
    medsCoveredRate: medsRateOf(facts),
    annualOOPMax: facts.annualOOPMax,
    topUncoveredDrugs: facts.medicationCoverage.notCovered,
    providerGaps: facts.providerGaps,
    deepWritten: true,
    topThreeVotes,
  };
}

/** Heuristic-only entry for the "other eligible" tail (table row; no bullets needed). */
function heuristicToRanked(c: PlanFacts, sub: AiSubScores, topThreeVotes = 0): AiRankedPlan {
  return {
    planId: c.planId,
    subScores: sub,
    subScoreWhy: null,
    fitScore: fitFromSubScores(sub),
    confidence: "low",
    reasons: [
      {
        category: "other",
        positive: false,
        text: "Eligible; not among the top picks written up in detail — open its benefits to review.",
        citation: { sourceFile: c.sourceFile, sourcePage: c.sourcePage, quote: `${c.name}` },
      },
    ],
    costBreakdown: null,
    estAnnualCost: 0,
    catastrophicExposure: clamp01(sub.catastrophicDownside),
    medsCoveredRate: medsRateOf(c),
    annualOOPMax: c.annualOOPMax,
    topUncoveredDrugs: c.medicationCoverage.notCovered,
    providerGaps: c.providerGaps,
    deepWritten: false,
    topThreeVotes,
  };
}

export interface RecommendOptions {
  /** Relax hard provider requirements (near-miss path when nothing is eligible). */
  ignoreProviderConstraints?: boolean;
}

/**
 * Produce the AI recommendation for a profile, grounded in the 2026 plan files.
 * Screen → parallel deep write-ups for the top picks → synthesize.
 */
export async function recommendPlans(
  profile: ClientProfileInput,
  db: DataStore,
  opts: RecommendOptions = {},
): Promise<AiRecommendation> {
  const pack = await buildPlanFactsPack(profile, db, { ignoreProviderConstraints: opts.ignoreProviderConstraints });
  const fullSignature = JSON.stringify(pack.candidates.map((c) => c.planId).sort());

  if (pack.candidates.length === 0) {
    return { model: SIM_MODEL, topPlanId: null, ranked: [], excluded: pack.excluded, groundingPackSignature: fullSignature, ensembleRuns: 0 };
  }

  const factsById = new Map(pack.candidates.map((c) => [c.planId, c]));
  const mustKeep = pack.patient.mustKeepProviders.length > 0;
  const maxPremium = Math.max(1, ...pack.candidates.map((c) => c.monthlyPremium));
  const maxMoop = Math.max(1, ...pack.candidates.map((c) => c.annualOOPMax));
  const medCount = pack.patient.medications.length;

  const traj = newTrajectory("today-recommendation");

  // TODAY's plan-fit is grounded in the 2026 plan files + the member's HARD
  // clinical needs (conditions, meds, providers, dual eligibility, region). Family
  // history and self-reported lifestyle are projection inputs only — they must NOT
  // steer which plan fits today — so they're withheld from the screen/deep prompts.
  const todayPatient: RecommendationPatientFacts = { ...pack.patient, familyHistory: [], lifestyle: undefined };

  // 1. ENSEMBLE SCREEN — run the cheap ranking N times and VOTE on top-3 frequency.
  // The model isn't perfectly deterministic and fit scores cluster, so one run's
  // top pick is a coin flip; voting across runs makes the shown top-3 stable.
  //
  // CONCURRENCY / LOAD (≈500 brokers, many patients each): this fan-out is the
  // dominant per-patient model-call multiplier. The route caches the whole result
  // by facts-version (one ensemble per patient unless intake changes / explicit
  // refresh), and ENSEMBLE.concurrency bounds parallel calls to respect Anthropic
  // rate limits. Raising ENSEMBLE.runs multiplies spend + latency linearly, and at
  // high broker concurrency the cache table (horizon_cache) write throughput may
  // warrant a higher Supabase tier — see supabase/migrations/0006.
  const screens = await rlmParallel(
    traj,
    "screen-ensemble",
    Array.from({ length: ENSEMBLE.runs }, (_, i) => i),
    ENSEMBLE.concurrency,
    async () => {
      try {
        return await callScreen(traj, todayPatient, pack.candidates);
      } catch {
        return null;
      }
    },
  );
  const okScreens = screens.filter((s): s is ScreenItem[] => !!s && s.length > 0);
  const ensembleRuns = okScreens.length;

  // Each run's top 3 (by that run's fit) earns the plan one top-3 "vote".
  const votes = new Map<string, number>();
  for (const items of okScreens) {
    const top3 = [...items]
      .filter((it) => factsById.has(it.planId))
      .sort((a, b) => b.fit - a.fit)
      .slice(0, DEEP_COUNT);
    for (const it of top3) votes.set(it.planId, (votes.get(it.planId) ?? 0) + 1);
  }

  // Rank by top-3 frequency, then the NEUTRAL member-benefit tiebreak (named rule
  // TIEBREAK_RULE — auditable in config): plans within tieBandVotes are "effectively
  // tied" and ordered by lower OOP max → lower premium → plan id. NO carrier bias.
  const band = TIEBREAK_RULE.tieBandVotes;
  const voteBand = (id: string) => Math.floor((votes.get(id) ?? 0) / (band + 1));
  const orderedIds = [...pack.candidates]
    .sort((a, b) => {
      if (voteBand(b.planId) !== voteBand(a.planId)) return voteBand(b.planId) - voteBand(a.planId);
      if (a.annualOOPMax !== b.annualOOPMax) return a.annualOOPMax - b.annualOOPMax;
      if (a.monthlyPremium !== b.monthlyPremium) return a.monthlyPremium - b.monthlyPremium;
      return a.planId.localeCompare(b.planId);
    })
    .map((c) => c.planId);

  const topIds = orderedIds.slice(0, DEEP_COUNT);

  // 2. DEEP — parallel detailed write-ups for the voted winners (delegate step).
  const deepResults = await rlmParallel(traj, "deep-writeups", topIds, Math.max(1, topIds.length), async (id) => {
    try {
      const facts = factsById.get(id)!;
      const result = await callDeep(traj, todayPatient, facts);
      return { id, ranked: deepToRanked(facts, result, votes.get(id) ?? 0) };
    } catch (e) {
      console.error("deep write-up failed for", id, (e as Error).message);
      return null;
    }
  });

  const deepOk = deepResults.filter((x): x is { id: string; ranked: AiRankedPlan } => x !== null);
  const model = SIM_MODEL;
  const deepById = new Map(deepOk.map((d) => [d.id, d.ranked]));

  // 3. SYNTHESIZE — the three SHOWN plans are SELECTED by top-3 vote frequency
  // (stability), but DISPLAYED in descending fit order so the headline numbers read
  // monotonically (#1 ≥ #2 ≥ #3). Each card still carries its own vote confidence.
  const topRanked = topIds
    .map((id) => deepById.get(id))
    .filter((x): x is AiRankedPlan => Boolean(x))
    .sort((a, b) => b.fitScore - a.fitScore);

  const topSet = new Set(topRanked.map((r) => r.planId));
  const tail: AiRankedPlan[] = [];
  for (const id of orderedIds) {
    if (topSet.has(id)) continue;
    const c = factsById.get(id);
    if (!c) continue;
    tail.push(heuristicToRanked(c, heuristicSubScores(c, mustKeep, maxPremium, maxMoop, medCount), votes.get(id) ?? 0));
  }

  // Keep displayed fit monotonic across the card→table boundary (the tail is a
  // rough table; the deep top picks are the authoritative cards).
  let prev = topRanked.length ? Math.min(...topRanked.map((r) => r.fitScore)) : Infinity;
  for (const t of tail) {
    if (t.fitScore >= prev) t.fitScore = Math.max(0, Math.round((prev - 0.1) * 10) / 10);
    prev = t.fitScore;
  }

  const ranked = [...topRanked, ...tail];
  logTrajectory(traj);
  return {
    model,
    topPlanId: ranked[0]?.planId ?? null,
    ranked,
    excluded: pack.excluded,
    groundingPackSignature: fullSignature,
    ensembleRuns,
  };
}
