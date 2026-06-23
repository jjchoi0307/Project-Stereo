/**
 * The full recommendation pipeline in one place: normalize → rules → simulate →
 * score. Both the live recommendation endpoint and the audit record run through
 * THIS function, so what's shown to the broker and what's stored for compliance
 * are guaranteed to be the same computation.
 */

import type { ClientProfileInput, NormalizedProfile, Plan } from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { normalizeProfile } from "./normalize";
import { applyRules, buildRulesContext, providerGapsFor, type RulesContext, type RulesResult } from "./rules";
import { simulate, type SimulationResult } from "./simulate";
import { score, type ScoringResult } from "./scoring";

/**
 * When the hard rules exclude EVERY plan, we don't just show nothing. If the
 * dead-end is caused by "must-keep" provider requirements (the common case — a
 * multimorbid client naming several established providers that no single plan
 * keeps together, or a provider not sold in their region), we re-run the engine
 * with provider constraints relaxed and surface the closest plans, each labelled
 * with which required provider(s) it would drop. Region and critical-medication
 * exclusions are NOT relaxed — those are genuinely disqualifying.
 */
export interface NearMiss {
  reason: "provider_constraints";
  requiredProviders: string[];
  regionName: string;
  survivingPlans: Plan[];
  sim: SimulationResult;
  scoring: ScoringResult;
  providerGapsByPlan: Record<string, string[]>;
}

export interface EngineRun {
  plans: Plan[];
  ctx: RulesContext;
  normalized: NormalizedProfile;
  rules: RulesResult;
  survivingPlans: Plan[];
  sim: SimulationResult;
  scoring: ScoringResult;
  /** Set only when the primary run excluded every plan and a relaxed pass helps. */
  nearMiss?: NearMiss | null;
}

export async function runEngine(
  profile: ClientProfileInput,
  db: DataStore,
  opts: { preferenceWeighting: boolean; count?: number },
): Promise<EngineRun> {
  const [plans, ctx] = await Promise.all([db.listPlans(), buildRulesContext(db)]);
  const drugs = [...ctx.drugsById.values()];

  const normalized = normalizeProfile(profile, drugs);
  const rules = applyRules(profile, plans, ctx);
  const survivingPlans = plans.filter((p) => rules.survivingPlanIds.includes(p.id));
  const sim = simulate(profile, normalized, survivingPlans, ctx, { count: opts.count });
  const scoring = score({
    profile,
    normalized,
    survivingPlans,
    simSummaries: sim.perPlan,
    rulesLog: rules.log,
    excluded: rules.log.filter((e) => e.severity === "exclude"),
    preferenceWeighting: opts.preferenceWeighting,
  });

  // Near-miss: only when nothing survived AND the client has hard provider
  // requirements (otherwise relaxing them changes nothing).
  let nearMiss: NearMiss | null = null;
  const hardProviders = profile.providerConstraints.filter((c) => c.hardRequirement);
  if (survivingPlans.length === 0 && hardProviders.length > 0) {
    const relaxedRules = applyRules(profile, plans, ctx, { ignoreProviderConstraints: true });
    const relaxedSurvivors = plans.filter((p) => relaxedRules.survivingPlanIds.includes(p.id));
    if (relaxedSurvivors.length > 0) {
      const relaxedSim = simulate(profile, normalized, relaxedSurvivors, ctx, { count: opts.count });
      const relaxedScoring = score({
        profile,
        normalized,
        survivingPlans: relaxedSurvivors,
        simSummaries: relaxedSim.perPlan,
        rulesLog: relaxedRules.log,
        excluded: relaxedRules.log.filter((e) => e.severity === "exclude"),
        preferenceWeighting: opts.preferenceWeighting,
      });
      const providerGapsByPlan: Record<string, string[]> = {};
      for (const p of relaxedSurvivors) providerGapsByPlan[p.id] = providerGapsFor(p, profile, ctx);
      nearMiss = {
        reason: "provider_constraints",
        requiredProviders: [
          ...new Set(
            hardProviders.map((c) =>
              c.systemId ? ctx.systemsById.get(c.systemId)?.name ?? c.label : c.label,
            ),
          ),
        ],
        regionName: ctx.regionsById.get(profile.marketRegion)?.name ?? profile.marketRegion,
        survivingPlans: relaxedSurvivors,
        sim: relaxedSim,
        scoring: relaxedScoring,
        providerGapsByPlan,
      };
    }
  }

  return { plans, ctx, normalized, rules, survivingPlans, sim, scoring, nearMiss };
}
