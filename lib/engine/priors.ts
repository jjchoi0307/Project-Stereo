/**
 * Clinical priors for the AGENT-BASED simulation (an Aaru-style emulation).
 *
 * Each simulated future is an *agent* whose care life-path is generated from
 * these grounded base rates, modulated by (a) the client's normalized risk
 * markers and (b) CORRELATION — once an event occurs in an agent's path it
 * shifts the odds of related downstream events. So agents produce realistic,
 * correlated life-paths instead of independent dice rolls, while staying fully
 * deterministic: no patient data is retained, and identical facts always produce
 * the identical agent cohort.
 *
 * Like the dollar figures in config.ts, these are transparent, plausible
 * placeholders to be calibrated against real actuarial / claims / epidemiological
 * data. Keeping them here (not inline in the generator) makes that calibration a
 * one-file change and keeps the "grounding" auditable.
 */

import type { CareEventType } from "@/lib/domain";

/** Every care event except the "nothing happened" sentinel. */
export type AgentEventType = Exclude<CareEventType, "no_major_event">;

/** Annual base incidence for each event, before markers + correlations. */
export const BASE_RATE: Record<AgentEventType, number> = {
  rising_chronic_med_usage: 0.15,
  cancer_dx_and_treatment: 0.02,
  new_specialist_utilization: 0.1,
  higher_outpatient_use: 0.1,
  sleep_medicine_continuation: 0.05,
  high_cost_provider_dependency: 0.05,
};

/** How strongly the driving risk marker raises each event's probability. */
export const MARKER_WEIGHT: Record<AgentEventType, number> = {
  rising_chronic_med_usage: 0.6,
  cancer_dx_and_treatment: 0.5,
  new_specialist_utilization: 0.5,
  higher_outpatient_use: 0.4,
  sleep_medicine_continuation: 0.3,
  high_cost_provider_dependency: 0.5,
};

/**
 * Correlation matrix: when the SOURCE event occurs in an agent's path, add the
 * given amount to each TARGET event's probability later in the same path. This
 * is what makes journeys correlated — e.g. a cancer diagnosis pulls up specialist
 * use, outpatient use, and provider dependency together, the way real care does.
 * Only forward (downstream) edges, applied in EVENT_ORDER, so generation is a
 * single deterministic pass.
 */
export const CORRELATION: Partial<Record<AgentEventType, Partial<Record<AgentEventType, number>>>> = {
  cancer_dx_and_treatment: {
    new_specialist_utilization: 0.4,
    higher_outpatient_use: 0.3,
    high_cost_provider_dependency: 0.25,
  },
  rising_chronic_med_usage: {
    new_specialist_utilization: 0.15,
    higher_outpatient_use: 0.12,
    high_cost_provider_dependency: 0.08,
  },
  new_specialist_utilization: {
    higher_outpatient_use: 0.1,
  },
};

/**
 * Causal processing order: diagnoses / chronic escalation first, then the
 * downstream utilization they drive. Correlation edges only ever point forward
 * in this order, so one pass per agent suffices.
 */
export const EVENT_ORDER: AgentEventType[] = [
  "rising_chronic_med_usage",
  "cancer_dx_and_treatment",
  "new_specialist_utilization",
  "higher_outpatient_use",
  "sleep_medicine_continuation",
  "high_cost_provider_dependency",
];
