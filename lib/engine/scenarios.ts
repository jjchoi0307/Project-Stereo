/**
 * Scenario perturbation (Aaru-style "test what-if scenarios").
 *
 * A scenario is a PURE transform of the client's clinical facts — "what if their
 * diabetes escalates to insulin?". Because the engine is a pure function of
 * clinical facts and the agent cohort is seeded from those facts
 * (lib/engine/seed.ts), running a scenario is just: transform(profile) → re-run
 * the SAME pipeline → compare to baseline. Nothing is retained; each scenario is
 * deterministic and reproducible like the baseline.
 *
 * The result is a robustness check: does today's recommended plan hold up if the
 * client's trajectory changes, or does a different plan take over?
 *
 * Adding a scenario = add one entry to SCENARIOS with a pure `apply`.
 */

import type { ClientProfileInput, ConditionFlag, Medication } from "@/lib/domain";

export interface Scenario {
  id: string;
  label: string;
  description: string;
  /** Pure: returns a new profile, never mutates the input. */
  apply: (profile: ClientProfileInput) => ClientProfileInput;
}

function withMed(meds: Medication[], drugId: string, name: string): Medication[] {
  if (meds.some((m) => m.drugId === drugId)) return meds;
  return [...meds, { raw: `${name} (scenario)`, drugId, name }];
}

/** What if the client's diabetes escalates and they start insulin therapy? */
const diabetesEscalation: Scenario = {
  id: "diabetes_escalation",
  label: "Diabetes escalates to insulin",
  description:
    "The client's diabetes progresses: they add a long-acting insulin and an SGLT2 inhibitor. Raises diabetes severity and drug-utilization, so more agents escalate chronic medications and specialist use.",
  apply: (p) => {
    const diabetes: ConditionFlag = "diabetes";
    const conditions = p.conditions.includes(diabetes) ? p.conditions : [...p.conditions, diabetes];
    let meds = p.medications;
    meds = withMed(meds, "rx-insulin-glargine", "insulin glargine");
    meds = withMed(meds, "rx-empagliflozin", "empagliflozin");
    return { ...p, conditions, medications: meds };
  },
};

/**
 * Active scenarios surfaced in the UI/API. Extensible — e.g. a new-cardiac,
 * cancer-diagnosis, higher-utilization, or relocate scenario is one entry each.
 */
export const SCENARIOS: Scenario[] = [diabetesEscalation];

export function getScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
