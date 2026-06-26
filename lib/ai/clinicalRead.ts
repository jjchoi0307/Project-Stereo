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
import { getDataStore } from "@/lib/data";
import { SIM_MODEL } from "@/lib/sim/env";
import { importanceGuidance, HORIZON_REC } from "@/lib/engine/config";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import { projectExpectedProfile } from "@/lib/engine/horizonRecommendation";
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
- MARKERS: choose ~6 markers from this set, keeping only the ones the facts actually support: diabetes / metabolic, cardiovascular, network sensitivity, specialist need, drug utilization, mental health, oncology. Use a stable lowercase "key" (e.g. "diabetes_metabolic", "cardiovascular", "network_sensitivity", "specialist_need", "drug_utilization", "mental_health", "oncology").
- BAND is the primary output and must be chosen SYSTEMATICALLY from how strongly the facts support that concern — not a vibe:
    • "low" — the facts give little or no indication of this concern (no relevant diagnosis, medication, requirement, or family history).
    • "moderate" — ONE soft or indirect indicator (e.g. age alone, a single family-history item, an elevated BMI without a diagnosis).
    • "high" — ONE clear, directly relevant fact (a diagnosed condition, an active medication treating it, or — for network sensitivity — a hard "must-keep" provider requirement that constrains which plans fit).
    • "very_high" — MULTIPLE compounding facts (e.g. a diagnosed condition PLUS its medication PLUS family history; or a must-keep provider PLUS multiple specialist needs).
  For network sensitivity specifically, decide from the "mustKeepProviders" field of the facts: if it lists ONE provider/system, the band is "high" (it directly narrows the eligible plans); TWO OR MORE, or one plus heavy specialist use, is "very_high"; if it is EMPTY, the band is "low". When it is non-empty you MUST include a network_sensitivity marker and the "why" MUST name the provider(s) from that field verbatim.
- Also set an integer "score" 0..100 used only for internal ordering, consistent with the band (low 0-24, moderate 25-49, high 50-74, very_high 75-100). Brokers see the BAND and the "why", not the number, so the band and the "why" must be self-explanatory on their own.
- The "why" must (a) name the specific grounding fact and (b) explain in one plain sentence WHY that fact lands the marker in its band. For network sensitivity, say plainly that keeping the required provider in network is what raises it (e.g. "Because they want to keep Seoul Medical Group, only plans where that group stays in network fit — which narrows the choices.").
- FUTURES: give exactly two horizons (years 3 and 5). "headline" is a short phrase; "summary" is 1-3 plain sentences about where this person's health is most likely headed; "outlook" reflects overall trajectory (stable / watch / elevated). "outcomes" are ~3-5 specific clinically-grounded possibilities with a calibrated likelihood (unlikely / possible / likely) and a "why" tied to the facts. "caveat" must state this is an educational projection, not medical advice.
- The user message includes a PROJECTED CHANGES block — the specific conditions/medications the member is most likely to ADD by each horizon. This SAME projection is what drives the plan recommendation, so your futures MUST be consistent with it: build the summaries and outcomes around those projected changes (you explain the clinical "why" and likelihood; you must NOT contradict them or introduce a different set). If a horizon projects no new conditions, say the outlook is stable.
- Calibrate likelihood and band to how strongly the facts support them (sparse facts => lower scores / "unlikely"/"possible", stable outlook).`;

function buildUserMessage(facts: DeidentifiedFacts, projectionBlock: string, guidanceText?: string): string {
  return [
    "DE-IDENTIFIED CLINICAL FACTS:",
    JSON.stringify(facts, null, 2),
    "",
    projectionBlock,
    "",
    guidanceText ?? importanceGuidance(),
    "",
    "Produce the risk markers and the 3- and 5-year health-futures read. The futures MUST be consistent with the PROJECTED CHANGES block above.",
  ].join("\n");
}

const CONDITION_LABEL = new Map(CONDITION_OPTIONS.map((o) => [o.value, o.label] as const));

/**
 * The SAME deterministic projection the plan recommendation uses, rendered as text
 * for the clinical-read prompt — so the Health Futures narrative and the 3/5-year
 * plan recommendation are built on ONE projection and always agree.
 */
async function buildProjectionBlock(profile: ClientProfileInput): Promise<string> {
  const db = getDataStore();
  const lines = ["PROJECTED CHANGES (the member's likely added conditions/medications — the plan recommendation uses this SAME projection):"];
  for (const years of HORIZON_REC.horizonsYears) {
    const { addedConditions, addedMedications } = await projectExpectedProfile(profile, db, years);
    const conds = addedConditions.map((c) => CONDITION_LABEL.get(c.flag) ?? c.flag);
    const meds = addedMedications.map((m) => m.name);
    const parts: string[] = [];
    if (conds.length) parts.push(`likely to develop ${conds.join(", ")}`);
    if (meds.length) parts.push(`may start ${meds.join(", ")}`);
    lines.push(`- By year ${years}: ${parts.length ? parts.join("; ") : "no major new conditions projected (stable)"}.`);
  }
  return lines.join("\n");
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
  // Resolve must-keep provider SYSTEM ids → canonical names (e.g. "Seoul Medical
  // Group") so the network-sensitivity marker can ground on the real requirement.
  // De-identify still only emits the canonical name or a generic token — never
  // the patient-entered label.
  const systems = await getDataStore().listProviderSystems();
  const systemNames = new Map(systems.map((s) => [s.id, s.name]));
  const facts = deidentifyForSim(profile, systemNames);

  // The SAME projection the plan recommendation uses — so the Health Futures read
  // and the 3/5-year plan recommendation are built on one projection and agree.
  const projectionBlock = await buildProjectionBlock(profile);

  // RLM leaf: the clinical read is a single grounded sub-call (small, bounded
  // context — no decomposition needed), run through the shared orchestrator so it
  // shares the same config + trajectory logging as the other AI systems.
  const traj = newTrajectory("clinical-read");
  const parsed = await rlmLeaf<unknown>(traj, {
    label: "clinical-read",
    system: SYSTEM_PROMPT,
    user: buildUserMessage(facts, projectionBlock, guidanceText),
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
    if (h.years !== 3 && h.years !== 5) bad("horizon has invalid years");
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
