/**
 * De-identification boundary for the health-future LLM call.
 *
 * Only CLINICAL FACTS leave the process — the same boundary the simulation seed
 * uses (lib/engine/seed.ts). Identity fields (profile/session id, ZIP, county,
 * gender, market region, capture source/timestamp, free-text provider labels)
 * are NEVER sent to the API. Two patients with identical clinical facts produce
 * an identical payload, so nothing about who they are leaks into the prompt.
 */

import type { ClientProfileInput } from "@/lib/domain";

export interface DeidentifiedFacts {
  age: number;
  conditions: string[];
  medications: string[]; // normalized names only (no raw free-text the patient typed)
  /**
   * Health systems / providers the member requires to stay in network (hard
   * requirements only). These drive the NETWORK-SENSITIVITY marker — without them
   * the clinical read can't tell there's a constraint narrowing the plans. Same
   * facts the recommendation model already receives (planFactsPack.mustKeepProviders).
   */
  mustKeepProviders: string[];
  heightCm?: number;
  weightKg?: number;
  bmi?: number;
  familyHistory: { condition: string; status: string; affectedRelativesCount?: number }[];
  utilization?: {
    acupunctureVisits12mo?: number;
    specialistVisits12mo?: number;
    priorYearInpatientEvents?: number;
  };
  /** Self-reported lifestyle facts (advisory; no identifiers). */
  lifestyle?: {
    avgDailySteps?: number;
    sleepHoursPerNight?: number;
    sleepQuality?: string;
    selfRatedHealth?: number;
  };
}

/**
 * Build the clinical-facts-only payload that may be sent to the LLM.
 *
 * `systemNames` maps a controlled provider-system id (e.g. "sys-smg") to its
 * canonical name ("Seoul Medical Group"). We send the RESOLVED canonical name —
 * never the patient-entered `label` (free text that can carry a person's name)
 * and never the raw id. A hard requirement with no resolvable system collapses to
 * the generic token "a required provider" so the network-sensitivity signal still
 * fires without leaking who/where.
 */
export function deidentifyForSim(
  profile: ClientProfileInput,
  systemNames?: Map<string, string>,
): DeidentifiedFacts {
  const mustKeepProviders = Array.from(
    new Set(
      profile.providerConstraints
        .filter((c) => c.hardRequirement)
        .map((c) => (c.systemId && systemNames?.get(c.systemId)) || "a required provider"),
    ),
  );
  return {
    age: profile.age,
    conditions: [...profile.conditions].sort(),
    // conditionsFreeText is deliberately NOT sent: it's unconstrained patient-typed
    // text that can carry identifiers (provider names, places, dates). The
    // structured `conditions` controlled vocab already carries the clinical signal.
    // name only — the raw `m.raw` string is what the patient typed and may carry
    // dosing notes / identifiers, so we drop it.
    medications: profile.medications.map((m) => m.name ?? m.drugId ?? "").filter(Boolean),
    mustKeepProviders,
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    bmi: profile.bmi,
    familyHistory: profile.familyHistory.map((f) => ({
      condition: f.condition,
      status: f.status,
      affectedRelativesCount: f.affectedRelativesCount,
    })),
    utilization: profile.utilization,
    lifestyle: profile.lifestyle,
  };
}
