/**
 * AI clinical read — risk markers + health-futures narrative, grounded in the
 * member's DE-IDENTIFIED clinical facts. One Claude call returns BOTH the markers
 * and the futures (lower latency + cost than two calls).
 *
 * This sits OUTSIDE the recommendation data path (ARCHITECTURE.md invariant #6):
 * the output is presentational and never feeds the deterministic scoring engine
 * or the audit record. Only de-identified clinical facts (lib/sim/deidentify.ts)
 * are sent to the model — no identity fields ever leave the process.
 */
import "server-only";

import type { ClientProfileInput } from "@/lib/domain";
import { deidentifyForSim, type DeidentifiedFacts } from "@/lib/sim/deidentify";
import { SIM_MODEL } from "@/lib/sim/env";
import { importanceGuidance } from "@/lib/engine/config";
import { newTrajectory, rlmLeaf, logTrajectory } from "./rlm";

export interface AiMarker {
  key: string;
  label: string;
  band: "low" | "moderate" | "high" | "very_high";
  /** 0..100 */
  score: number;
  /** layperson explanation, grounded in the captured facts */
  why: string;
}

export interface AiOutcome {
  label: string;
  likelihood: "unlikely" | "possible" | "likely";
  why: string;
}

export interface ClinicalRead {
  model: string;
  /**
   * ~6 markers spanning diabetes/metabolic, cardiovascular, network sensitivity,
   * specialist need, drug utilization, mental health, oncology — only the ones
   * the facts support.
   */
  markers: AiMarker[];
  futures: {
    horizons: {
      years: 3 | 5;
      headline: string;
      summary: string;
      outlook: "stable" | "watch" | "elevated";
    }[];
    /** grounded in the patient's conditions / age / family history */
    outcomes: AiOutcome[];
    /** "educational projection, not medical advice" */
    caveat: string;
  };
}

const SYSTEM_PROMPT = `You are a clinical-actuarial reasoning assistant for a Medicare Advantage broker tool at Seoul Medical Group. You are given a prospective member's DE-IDENTIFIED clinical facts (age, conditions, medications, BMI, family history, recent utilization).

Your job: produce (a) a set of plain-language RISK MARKERS and (b) a 3- and 5-year HEALTH-FUTURES read for this person.

Hard rules:
- GROUND every marker and every outcome in a SPECIFIC provided clinical fact (e.g. "the diagnosed diabetes", "metformin in the medication list", "family history of cardiovascular disease", "age 72", a BMI value). Never invent conditions, medications, probabilities, or risks the facts do not support.
- Write for a layperson. Plain, clear language — no jargon, no diagnosis codes.
- Stay factual and NON-ALARMING. This is an educational projection to inform plan selection, NOT medical advice, a diagnosis, or a treatment plan. Never tell the member what to do clinically.
- No identity inferences — you have only clinical facts.
- MARKERS: choose ~6 markers from this set, keeping only the ones the facts actually support: diabetes / metabolic, cardiovascular, network sensitivity, specialist need, drug utilization, mental health, oncology. Use a stable lowercase "key" (e.g. "diabetes_metabolic", "cardiovascular", "network_sensitivity", "specialist_need", "drug_utilization", "mental_health", "oncology"). Set "score" 0..100 and a "band" consistent with it (roughly: 0-24 low, 25-49 moderate, 50-74 high, 75-100 very_high). The "why" must reference the grounding fact.
- FUTURES: give exactly two horizons (years 3 and 5). "headline" is a short phrase; "summary" is 1-3 plain sentences about where this person's health is most likely headed; "outlook" reflects overall trajectory (stable / watch / elevated). "outcomes" are ~3-5 specific clinically-grounded possibilities with a calibrated likelihood (unlikely / possible / likely) and a "why" tied to the facts. "caveat" must state this is an educational projection, not medical advice.
- Calibrate likelihood and band to how strongly the facts support them (sparse facts => lower scores / "unlikely"/"possible", stable outlook).`;

function buildUserMessage(facts: DeidentifiedFacts, guidanceText?: string): string {
  return [
    "DE-IDENTIFIED CLINICAL FACTS:",
    JSON.stringify(facts, null, 2),
    "",
    guidanceText ?? importanceGuidance(),
    "",
    "Produce the risk markers and the 3- and 5-year health-futures read, grounded in the above facts.",
  ].join("\n");
}

/** JSON Schema for the structured output (all props required, no min/max length). */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["markers", "futures"],
  properties: {
    markers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "band", "score", "why"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          band: { type: "string", enum: ["low", "moderate", "high", "very_high"] },
          score: { type: "integer" },
          why: { type: "string" },
        },
      },
    },
    futures: {
      type: "object",
      additionalProperties: false,
      required: ["horizons", "outcomes", "caveat"],
      properties: {
        horizons: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["years", "headline", "summary", "outlook"],
            properties: {
              years: { type: "integer", enum: [3, 5] },
              headline: { type: "string" },
              summary: { type: "string" },
              outlook: { type: "string", enum: ["stable", "watch", "elevated"] },
            },
          },
        },
        outcomes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "likelihood", "why"],
            properties: {
              label: { type: "string" },
              likelihood: { type: "string", enum: ["unlikely", "possible", "likely"] },
              why: { type: "string" },
            },
          },
        },
        caveat: { type: "string" },
      },
    },
  },
} as const;

/**
 * Produce the AI clinical read for a profile. ONE Claude call over the
 * de-identified facts, returning both markers and futures. Throws on
 * refusal / max_tokens / empty / malformed output.
 */
export async function aiClinicalRead(profile: ClientProfileInput, guidanceText?: string): Promise<ClinicalRead> {
  const facts = deidentifyForSim(profile);

  // RLM leaf: the clinical read is a single grounded sub-call (small, bounded
  // context — no decomposition needed), run through the shared orchestrator so it
  // shares the same config + trajectory logging as the other AI systems.
  const traj = newTrajectory("clinical-read");
  const parsed = await rlmLeaf<unknown>(traj, {
    label: "clinical-read",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(facts, guidanceText),
    schema: OUTPUT_SCHEMA,
  });
  logTrajectory(traj);

  const read = validateRead(parsed);
  return { model: SIM_MODEL, ...read };
}

/**
 * Minimal runtime shape check. The json_schema output config constrains the
 * happy path, but a refusal-with-text or schema-cache edge could slip through —
 * validate before the UI trusts the shape.
 */
function validateRead(o: unknown): Omit<ClinicalRead, "model"> {
  const bad = (m: string): never => {
    throw new Error(`Clinical read had an unexpected shape: ${m}`);
  };
  const isBand = (v: unknown): v is AiMarker["band"] =>
    v === "low" || v === "moderate" || v === "high" || v === "very_high";
  const isLikelihood = (v: unknown): v is AiOutcome["likelihood"] =>
    v === "unlikely" || v === "possible" || v === "likely";
  const isOutlook = (v: unknown) => v === "stable" || v === "watch" || v === "elevated";

  if (!o || typeof o !== "object") bad("not an object");
  const p = o as Record<string, unknown>;

  if (!Array.isArray(p.markers) || p.markers.length === 0) bad("missing markers");
  for (const m of p.markers as Record<string, unknown>[]) {
    if (typeof m.key !== "string" || typeof m.label !== "string" || typeof m.why !== "string") {
      bad("marker missing key/label/why");
    }
    if (!isBand(m.band)) bad("marker has invalid band");
    if (typeof m.score !== "number") bad("marker missing score");
  }

  if (!p.futures || typeof p.futures !== "object") bad("missing futures");
  const f = p.futures as Record<string, unknown>;
  if (typeof f.caveat !== "string") bad("futures missing caveat");
  if (!Array.isArray(f.horizons) || f.horizons.length === 0) bad("futures missing horizons");
  for (const h of f.horizons as Record<string, unknown>[]) {
    if (h.years !== 5 && h.years !== 10) bad("horizon has invalid years");
    if (typeof h.headline !== "string" || typeof h.summary !== "string") bad("horizon missing text");
    if (!isOutlook(h.outlook)) bad("horizon has invalid outlook");
  }
  if (!Array.isArray(f.outcomes) || f.outcomes.length === 0) bad("futures missing outcomes");
  for (const oc of f.outcomes as Record<string, unknown>[]) {
    if (typeof oc.label !== "string" || typeof oc.why !== "string") bad("outcome missing label/why");
    if (!isLikelihood(oc.likelihood)) bad("outcome has invalid likelihood");
  }

  return o as Omit<ClinicalRead, "model">;
}
