/**
 * AI health-future projection — the one LLM-powered feature, deliberately OUTSIDE
 * the recommendation data path (ARCHITECTURE.md invariant #6).
 *
 * How it works:
 *   1. The deterministic Monte-Carlo engine (lib/engine/healthSim.ts) projects the
 *      patient into N seeded synthetic replicas at the 5- and 10-year horizons and
 *      reports incidence rates, complexity, and stable/severe shares. This is the
 *      reproducible, auditable quantitative backbone.
 *   2. Claude reasons OVER those statistics + the de-identified clinical facts to
 *      produce a clinically-grounded narrative for each horizon.
 *
 * The model interprets the numbers; it does not invent them. Its output never
 * feeds the scoring engine and is not part of the audit record.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ClientProfileInput, Drug } from "@/lib/domain";
import { normalizeProfile } from "@/lib/engine/normalize";
import {
  HEALTH_OUTCOME_LABEL,
  simulateHealthFutures,
  type HealthFutures,
} from "@/lib/engine/healthSim";
import { DATA_VERSION, ENGINE_VERSION } from "@/lib/version";
import { getAnthropic } from "./client";
import { deidentifyForSim, type DeidentifiedFacts } from "./deidentify";
import { SIM_MODEL } from "./env";
import type {
  DeterministicDigest,
  HealthFutureProjection,
  HealthFutureResult,
} from "./types";

const HORIZONS = [5, 10] as const;

/** Trim a full HealthFutures run down to a prompt-sized digest. */
function digest(hf: HealthFutures): DeterministicDigest {
  return {
    years: hf.horizonYears,
    replicas: hf.replicas,
    seed: hf.seed,
    stableRate: round(hf.stableRate),
    severeRate: round(hf.severeRate),
    meanComplexity: hf.meanComplexity,
    outcomeIncidence: hf.outcomeIncidence.map((o) => ({
      outcome: o.outcome,
      label: HEALTH_OUTCOME_LABEL[o.outcome],
      rate: round(o.rate),
    })),
    perYearIncidence: hf.perYearIncidence,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

const SYSTEM_PROMPT = `You are a clinical-actuarial reasoning assistant for a Medicare Advantage broker tool at Seoul Medical Group. You are given (a) a prospective member's DE-IDENTIFIED clinical facts and (b) the output of a deterministic Monte-Carlo simulation that projected this member's clinical trajectory across many seeded synthetic copies at the 5- and 10-year horizons.

Your job: interpret that simulation into a clear, clinically-grounded narrative of where this person's health is most likely headed at 5 and 10 years.

Hard rules:
- GROUND every claim in either a provided clinical fact or a provided simulation statistic. Do NOT invent probabilities, rates, or risks the data doesn't support. When you cite likelihood, refer to the simulation's incidence rates rather than making up numbers.
- This is an educational projection to inform plan selection, NOT medical advice, diagnosis, or a treatment plan. Never tell the member what to do clinically.
- Stay factual and non-alarming. No identity inferences — you have only clinical facts.
- "planConsiderations" are discussion points about what these health trajectories could mean for coverage needs (e.g. drug coverage, specialist access, out-of-pocket exposure). They are NOT plan recommendations — a separate deterministic engine produces the actual recommendation.
- Calibrate "confidence" to how strongly the facts + simulation support the horizon's narrative (sparse facts or low event rates => lower confidence).`;

function buildUserMessage(facts: DeidentifiedFacts, digests: DeterministicDigest[]): string {
  return [
    "DE-IDENTIFIED CLINICAL FACTS:",
    JSON.stringify(facts, null, 2),
    "",
    "DETERMINISTIC SIMULATION RESULTS (one block per horizon):",
    JSON.stringify(digests, null, 2),
    "",
    "Produce a projection for each horizon (5 and 10 years), grounded in the above.",
  ].join("\n");
}

/** JSON Schema for the structured output (no min/max-length; all props required). */
const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overallCaveat", "horizons"],
  properties: {
    overallCaveat: { type: "string" },
    horizons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["years", "headline", "narrative", "watchItems", "careOutlook", "planConsiderations", "confidence"],
        properties: {
          years: { type: "integer", enum: [5, 10] },
          headline: { type: "string" },
          narrative: { type: "string" },
          watchItems: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["event", "rationale", "groundedIn"],
              properties: {
                event: { type: "string" },
                rationale: { type: "string" },
                groundedIn: { type: "string" },
              },
            },
          },
          careOutlook: { type: "string" },
          planConsiderations: { type: "array", items: { type: "string" } },
          confidence: { type: "string", enum: ["low", "moderate", "high"] },
        },
      },
    },
  },
} as const;

export interface ProjectOptions {
  /** Replica count for the deterministic backbone (defaults to engine config). */
  replicas?: number;
}

/**
 * Project the member's health future. Runs the deterministic backbone at 5y and
 * 10y, then has Claude interpret it. `drugs` is the reference catalog used to
 * normalize the profile (same as the engine routes).
 */
export async function projectHealthFuture(
  profile: ClientProfileInput,
  drugs: Drug[],
  opts: ProjectOptions = {},
): Promise<HealthFutureResult> {
  const normalized = normalizeProfile(profile, drugs);
  const digests = HORIZONS.map((years) =>
    digest(simulateHealthFutures(profile, normalized, { years, replicas: opts.replicas })),
  );

  const facts = deidentifyForSim(profile);
  const client = getAnthropic();

  // Stream + a generous cap: adaptive thinking on a two-horizon projection can run
  // a while, and thinking tokens count against max_tokens, so a non-streaming 16K
  // call risked an HTTP timeout or a truncated JSON body. Streaming removes the
  // timeout concern and 32K leaves ample room for thinking + the structured output.
  // (max_tokens is the LLM's output budget — independent of the deterministic
  // simulation count, which costs no tokens.)
  const stream = client.messages.stream({
    model: SIM_MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserMessage(facts, digests) }],
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(
      `Health-future projection refused: ${response.stop_details?.explanation ?? "no detail"}`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Health-future projection was truncated (hit max_tokens) — raise the cap in lib/sim/healthFutureAgent.ts.");
  }

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  if (!text.trim()) {
    throw new Error(`Empty projection (stop_reason=${response.stop_reason}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Projection was not valid JSON: ${(e as Error).message}`);
  }
  const projection = validateProjection(parsed);

  return {
    profileId: profile.id,
    model: response.model,
    dataVersion: DATA_VERSION,
    engineVersion: ENGINE_VERSION,
    deterministic: digests,
    projection,
    notForAudit: true,
  };
}

/**
 * Minimal runtime shape check on the model output. The json_schema output config
 * constrains the happy path, but a refusal-with-text or schema-cache edge could
 * still slip through — validate before downstream code trusts the shape.
 */
function validateProjection(o: unknown): HealthFutureProjection {
  const bad = (m: string): never => {
    throw new Error(`Projection had an unexpected shape: ${m}`);
  };
  if (!o || typeof o !== "object") bad("not an object");
  const p = o as Record<string, unknown>;
  if (typeof p.overallCaveat !== "string") bad("missing overallCaveat");
  if (!Array.isArray(p.horizons) || p.horizons.length === 0) bad("missing horizons");
  for (const h of p.horizons as Record<string, unknown>[]) {
    if (typeof h.years !== "number") bad("horizon missing years");
    if (typeof h.headline !== "string" || typeof h.narrative !== "string") bad("horizon missing text");
    if (typeof h.careOutlook !== "string") bad("horizon missing careOutlook");
    if (h.confidence !== "low" && h.confidence !== "moderate" && h.confidence !== "high") {
      bad("horizon has invalid confidence");
    }
    if (!Array.isArray(h.watchItems)) bad("horizon missing watchItems");
    for (const w of h.watchItems as Record<string, unknown>[]) {
      if (typeof w.event !== "string" || typeof w.rationale !== "string" || typeof w.groundedIn !== "string") {
        bad("watchItem missing event/rationale/groundedIn");
      }
    }
    if (!Array.isArray(h.planConsiderations)) bad("horizon missing planConsiderations");
  }
  return o as HealthFutureProjection;
}
