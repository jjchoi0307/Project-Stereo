import type { ClientProfileInput } from "@/lib/domain";
import { emptyIntakeValues, type IntakeFormValues } from "./types";

/** Reverse of toProfileInput — hydrate the form for a broker correction. */
export function profileToValues(profile: ClientProfileInput): IntakeFormValues {
  const base = emptyIntakeValues();
  const meds = profile.medications.map((m) => m.raw);
  return {
    ...base,
    age: String(profile.age),
    gender: profile.gender ?? "",
    marketRegion: profile.marketRegion,
    zip: profile.zip ?? "",
    county: profile.county ?? "",
    medications: meds.length ? meds : [""],
    conditions: profile.conditions,
    conditionsFreeText: (profile.conditionsFreeText ?? []).join(", "),
    heightCm: profile.heightCm != null ? String(profile.heightCm) : "",
    weightKg: profile.weightKg != null ? String(profile.weightKg) : "",
    familyHistory: profile.familyHistory,
    mustKeepSystemIds: profile.providerConstraints
      .map((c) => c.systemId)
      .filter((x): x is string => !!x),
    acupunctureVisits12mo: profile.utilization?.acupunctureVisits12mo?.toString() ?? "",
    specialistVisits12mo: profile.utilization?.specialistVisits12mo?.toString() ?? "",
    priorYearInpatientEvents: profile.utilization?.priorYearInpatientEvents?.toString() ?? "",
    dualEligible: profile.dualEligible ?? false,
  };
}
