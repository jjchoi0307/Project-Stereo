/**
 * AI-powered across-horizon recommendation (3-year / 5-year).
 *
 * "Same architecture as Today, applied to the member's likely FUTURE." Rather than
 * a bespoke horizon scoring path, each horizon:
 *   1) PROJECTS the member's expected future profile deterministically — current
 *      facts plus the conditions/medications that show up in ≥ a threshold of the
 *      seeded synthetic futures (lib/engine/horizonRecommendation.projectExpectedProfile).
 *   2) Runs Today's EXACT recommendation pipeline (`recommendPlans`) on that
 *      projected profile — same ensemble screen, same carrier-diversity cap, same
 *      parallel deep write-ups, same grounding/citation guardrails.
 *
 * The horizons run SEQUENTIALLY (and the client only starts them after Today has
 * finished) so the total number of concurrent Anthropic calls never exceeds what a
 * single Today run — which is proven to work — already uses. Firing them alongside
 * Today tripped per-minute rate limits and made the request appear to hang.
 *
 * Cached per facts-version by the route.
 */

import "server-only";
import type { ClientProfileInput, ConditionFlag } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { SIM_MODEL } from "@/lib/sim/env";
import { HORIZON_REC } from "@/lib/engine/config";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import { projectExpectedProfile } from "@/lib/engine/horizonRecommendation";
import { recommendPlans, type AiRankedPlan } from "./recommend";

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
  /** The full-detail top picks for this horizon (same shape as Today's top cards). */
  ranked: AiRankedPlan[];
}

export interface AiHorizonRecommendation {
  model: string;
  todayTopPlanId: string | null;
  horizons: AiHorizon[];
}

const CONDITION_LABEL = new Map(CONDITION_OPTIONS.map((o) => [o.value, o.label] as const));
const condLabel = (flag: ConditionFlag) => CONDITION_LABEL.get(flag) ?? flag;

/** Share-of-futures → plain likelihood band (every added item is already ≥ the threshold). */
const likelihoodOf = (incidence: number): Likelihood =>
  incidence >= 0.6 ? "high" : incidence >= 0.35 ? "moderate" : "low";

const EMPTY_PROJECTION: HorizonProjection = { headline: "", summary: "", conditions: [], medications: [] };

function buildProjectionDisplay(
  added: { conditions: { flag: ConditionFlag; incidence: number }[]; medications: { name: string; incidence: number }[] },
  years: number,
): HorizonProjection {
  const conditions = added.conditions.map((c) => ({ label: condLabel(c.flag), likelihood: likelihoodOf(c.incidence) }));
  const medications = added.medications.map((m) => ({ name: m.name, likelihood: likelihoodOf(m.incidence) }));
  if (conditions.length === 0 && medications.length === 0) {
    return {
      headline: `Stable outlook at ${years} years`,
      summary: `No major new conditions are projected within ${years} years, so the recommendation is expected to track today's.`,
      conditions,
      medications,
    };
  }
  const condText = conditions.map((c) => c.label.toLowerCase()).join(", ");
  return {
    headline: `Likely changes by year ${years}`,
    summary:
      `Over the next ${years} years, this member is most likely to develop ${condText || "new medication needs"}. ` +
      `The plans below are today's recommendation re-run on that projected profile.`,
    conditions,
    medications,
  };
}

/**
 * Recommend across horizons by running Today's pipeline on each horizon's projected
 * profile. Sequential by design (see file header) — reliability over a few seconds.
 */
export async function recommendHorizons(
  profile: ClientProfileInput,
  db: DataStore,
  todayTopPlanId: string | null,
  _guidanceText?: string,
): Promise<AiHorizonRecommendation> {
  const horizons: AiHorizon[] = [];

  for (const years of HORIZONS) {
    try {
      // 1) Deterministic expected future profile (instant, seeded, grounded).
      const projected = await projectExpectedProfile(profile, db, years);
      const projection = buildProjectionDisplay(
        { conditions: projected.addedConditions, medications: projected.addedMedications },
        years,
      );

      // 2) Today's EXACT recommendation pipeline on the projected member.
      const rec = await recommendPlans(projected.profile, db);
      // Show the full-detail top picks (the deep-written cards), exactly like Today.
      const ranked = rec.ranked.filter((r) => r.deepWritten);
      const cards = ranked.length > 0 ? ranked : rec.ranked.slice(0, 3);
      const recommended = cards[0] ?? null;

      horizons.push({
        years,
        changedVsToday: Boolean(recommended && todayTopPlanId && recommended.planId !== todayTopPlanId),
        projection,
        recommended,
        ranked: cards,
      });
    } catch (e) {
      console.error(`horizon ${years}yr failed:`, (e as Error).message);
      horizons.push({ years, changedVsToday: false, projection: EMPTY_PROJECTION, recommended: null, ranked: [] });
    }
  }

  return { model: SIM_MODEL, todayTopPlanId, horizons };
}
