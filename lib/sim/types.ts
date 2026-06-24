/**
 * Shapes for the AI health-future projection. The projection is an interpretive
 * layer ON TOP of the deterministic Monte-Carlo backbone (lib/engine/healthSim.ts)
 * — it is NOT part of the reproducible audit record and never feeds the engine.
 */

import type { HealthOutcome } from "@/lib/engine/healthSim";
import type { ProfileId } from "@/lib/domain";

/** Compact, prompt-sized digest of one deterministic HealthFutures run. */
export interface DeterministicDigest {
  years: number;
  replicas: number;
  seed: number;
  stableRate: number;
  severeRate: number;
  meanComplexity: number;
  outcomeIncidence: { outcome: HealthOutcome; label: string; rate: number }[];
  perYearIncidence: { year: number; meanNewEvents: number }[];
}

export interface HealthFutureWatchItem {
  /** The clinical event/outcome to watch for. */
  event: string;
  /** Why this patient is at risk — clinical reasoning. */
  rationale: string;
  /** Which deterministic statistic or clinical fact grounds this claim. */
  groundedIn: string;
}

export interface HealthFutureHorizon {
  years: number; // 5 or 10
  headline: string;
  narrative: string;
  watchItems: HealthFutureWatchItem[];
  careOutlook: string;
  /** Discussion points for plan fit — NOT a recommendation (the engine owns that). */
  planConsiderations: string[];
  confidence: "low" | "moderate" | "high";
}

/** The LLM's structured output. */
export interface HealthFutureProjection {
  overallCaveat: string;
  horizons: HealthFutureHorizon[];
}

/** Full result returned by the agent: deterministic backbone + AI interpretation. */
export interface HealthFutureResult {
  profileId: ProfileId;
  model: string;
  /** Versions of the deterministic backbone the projection was reasoned over. */
  dataVersion: string;
  engineVersion: string;
  /** The quantitative basis, at each horizon, that the projection interprets. */
  deterministic: DeterministicDigest[];
  projection: HealthFutureProjection;
  /** Loud reminder: this is interpretive, not the audit record. */
  notForAudit: true;
}
