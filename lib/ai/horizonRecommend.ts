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
 * The two horizons run concurrently with each other; the client starts the whole
 * horizon request only after Today has finished, so Today and the horizons never
 * overlap (firing them alongside Today tripped per-minute rate limits and made the
 * request appear to hang).
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
import type { ClinicalRead } from "./clinicalRead";

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
  narrative?: { headline: string; summary: string } | null,
): HorizonProjection {
  const conditions = added.conditions.map((c) => ({ label: condLabel(c.flag), likelihood: likelihoodOf(c.incidence) }));
  const medications = added.medications.map((m) => ({ name: m.name, likelihood: likelihoodOf(m.incidence) }));

  // Prefer the Health Futures (clinical read) narrative for THIS horizon, so the
  // recommendation's projection and the Health Futures card read identically (they
  // share the same underlying deterministic projection). Fall back to a plain
  // template if the clinical read isn't available.
  if (narrative?.headline && narrative?.summary) {
    return { headline: narrative.headline, summary: narrative.summary, conditions, medications };
  }
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
  clinicalRead?: ClinicalRead | null,
): Promise<AiHorizonRecommendation> {
  const horizons = await Promise.all(
    HORIZONS.map(async (years): Promise<AiHorizon> => {
      try {
        // 1) Deterministic expected future profile (instant, seeded, grounded) — the
        // SAME projection the Health Futures card narrates.
        const projected = await projectExpectedProfile(profile, db, years);
        const narrative = clinicalRead?.futures?.horizons?.find((h) => h.years === years) ?? null;
        const projection = buildProjectionDisplay(
          { conditions: projected.addedConditions, medications: projected.addedMedications },
          years,
          narrative,
        );

        // 2) Today's EXACT recommendation pipeline on the projected member.
        const rec = await recommendPlans(projected.profile, db);
        // Full ranked list (top-3 deep-written cards + the heuristic tail), exactly
        // like Today — the UI shows the top 3 as cards and the rest as a table.
        const ranked = rec.ranked;
        const recommended = ranked.find((r) => r.deepWritten) ?? ranked[0] ?? null;

        return {
          years,
          changedVsToday: Boolean(recommended && todayTopPlanId && recommended.planId !== todayTopPlanId),
          projection,
          recommended,
          ranked,
        };
      } catch (e) {
        console.error(`horizon ${years}yr failed:`, (e as Error).message);
        return { years, changedVsToday: false, projection: EMPTY_PROJECTION, recommended: null, ranked: [] };
      }
    }),
  );

  return { model: SIM_MODEL, todayTopPlanId, horizons };
}
