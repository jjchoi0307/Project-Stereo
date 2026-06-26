/**
 * Content signature of a client profile's recommendation-relevant facts.
 *
 * AI results (recommendation, horizons, clinical read) are cached so the same
 * member isn't re-run on every view. Keying that cache on the CONTENT of the
 * intake — not a timestamp — means a broker editing the facts always gets a fresh
 * result (the signature changes), while re-opening unchanged facts is served from
 * cache. This is the "cache keyed to intake inputs" the architecture calls for.
 *
 * Volatile/non-clinical fields (id, capturedAt, capturedBy, fieldProvenance) are
 * excluded so they don't churn the key.
 */
import type { ClientProfileInput } from "@/lib/domain";
import { SIM_MODEL } from "@/lib/sim/env";
import { DATA_VERSION, AI_VERSION } from "@/lib/version";
import { ENSEMBLE, TIEBREAK_RULE } from "@/lib/engine/config";

/**
 * Signature of the env-tunable knobs that change the RANKING output: the ensemble
 * size and the tiebreak band. Any AI cache key that holds a ranking must include
 * this, so changing ENSEMBLE_RUNS or TIE_BAND_VOTES at deploy time regenerates
 * (without relying on a manual AI_VERSION bump). Shared by the Today and horizon
 * keys so the two can never drift on these inputs.
 */
export function aiScoringSig(): string {
  return `e${ENSEMBLE.runs}:t${TIEBREAK_RULE.tieBandVotes}`;
}

/**
 * Canonical cache key for the "today" AI recommendation. Shared by the
 * recommendation route (writes it) and the audit route (reads the delivered
 * result back), so they never drift.
 */
export function recCacheKey(id: string, p: ClientProfileInput): string {
  return `airec:${id}:${factsSignature(p)}:${SIM_MODEL}:${DATA_VERSION}:${AI_VERSION}:${aiScoringSig()}`;
}

export function factsSignature(p: ClientProfileInput): string {
  const relevant = {
    age: p.age,
    gender: p.gender ?? null,
    region: p.marketRegion,
    conditions: [...p.conditions].sort(),
    conditionsFreeText: [...(p.conditionsFreeText ?? [])].map((s) => s.trim()).sort(),
    meds: p.medications.map((m) => `${m.drugId ?? ""}|${(m.name ?? m.raw ?? "").toLowerCase()}`).sort(),
    height: p.heightCm ?? null,
    weight: p.weightKg ?? null,
    bmi: p.bmi ?? null,
    family: p.familyHistory
      .map((f) => `${f.condition}:${f.status}:${f.affectedRelativesCount ?? ""}`)
      .sort(),
    providers: p.providerConstraints
      .map((c) => `${c.systemId ?? c.providerId ?? c.label}:${c.hardRequirement}`)
      .sort(),
    utilization: p.utilization ?? null,
    dualEligible: p.dualEligible ?? false,
    lifestyle: p.lifestyle ?? null,
  };
  const json = JSON.stringify(relevant);
  // djb2 string hash → compact base-36 key segment (no crypto dependency).
  let h = 5381;
  for (let i = 0; i < json.length; i++) h = ((h << 5) + h + json.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
