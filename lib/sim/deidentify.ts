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
  conditionsFreeText?: string[];
  medications: string[]; // normalized names only (no raw free-text the patient typed)
  heightCm?: number;
  weightKg?: number;
  bmi?: number;
  familyHistory: { condition: string; status: string; affectedRelativesCount?: number }[];
  utilization?: {
    acupunctureVisits12mo?: number;
    specialistVisits12mo?: number;
    priorYearInpatientEvents?: number;
  };
}

/** Build the clinical-facts-only payload that may be sent to the LLM. */
export function deidentifyForSim(profile: ClientProfileInput): DeidentifiedFacts {
  return {
    age: profile.age,
    conditions: [...profile.conditions].sort(),
    conditionsFreeText: profile.conditionsFreeText?.length ? profile.conditionsFreeText : undefined,
    // name only — the raw `m.raw` string is what the patient typed and may carry
    // dosing notes / identifiers, so we drop it.
    medications: profile.medications.map((m) => m.name ?? m.drugId ?? "").filter(Boolean),
    heightCm: profile.heightCm,
    weightKg: profile.weightKg,
    bmi: profile.bmi,
    familyHistory: profile.familyHistory.map((f) => ({
      condition: f.condition,
      status: f.status,
      affectedRelativesCount: f.affectedRelativesCount,
    })),
    utilization: profile.utilization,
  };
}
