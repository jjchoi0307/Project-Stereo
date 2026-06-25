import {
  computeBmi,
  type CaptureSource,
  type ClientProfileInput,
  type Drug,
  type ProviderConstraint,
  type ProviderSystem,
} from "@/lib/domain";
import { normalizeMedications } from "./normalize";
import type { IntakeFormValues } from "./types";

const intOrUndef = (s: string): number | undefined => {
  const t = s.trim();
  return t && /^\d+$/.test(t) ? Number(t) : undefined;
};

/** Top-level profile fields we track provenance for. */
const PROVENANCE_FIELDS: (keyof ClientProfileInput)[] = [
  "age", "gender", "marketRegion", "zip", "county", "medications", "conditions",
  "conditionsFreeText", "heightCm", "weightKg", "bmi", "familyHistory",
  "providerConstraints", "utilization", "dualEligible",
];

export function toProfileInput(
  values: IntakeFormValues,
  opts: {
    profileId: string;
    capturedBy: CaptureSource;
    drugs: Drug[];
    providerSystems: ProviderSystem[];
  },
): ClientProfileInput {
  const { profileId, capturedBy, drugs, providerSystems } = opts;

  const height = intOrUndef(values.heightCm);
  const weight = intOrUndef(values.weightKg);
  const bmi = height && weight ? computeBmi(height, weight) : undefined;

  const constraints: ProviderConstraint[] = values.mustKeepSystemIds.map((sysId) => {
    const sys = providerSystems.find((s) => s.id === sysId);
    return {
      systemId: sysId,
      label: `Must keep ${sys?.name ?? sysId}`,
      hardRequirement: true,
    };
  });

  const utilization = {
    acupunctureVisits12mo: intOrUndef(values.acupunctureVisits12mo),
    specialistVisits12mo: intOrUndef(values.specialistVisits12mo),
    priorYearInpatientEvents: intOrUndef(values.priorYearInpatientEvents),
  };
  const hasUtilization = Object.values(utilization).some((x) => x !== undefined);

  const conditionsFreeText = values.conditionsFreeText
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const profile: ClientProfileInput = {
    id: profileId,
    capturedBy,
    capturedAt: new Date().toISOString(),
    age: Number(values.age),
    marketRegion: values.marketRegion as ClientProfileInput["marketRegion"],
    gender: values.gender || undefined,
    zip: values.zip.trim() || undefined,
    county: values.county.trim() || undefined,
    medications: normalizeMedications(values.medications, drugs),
    conditions: values.conditions,
    conditionsFreeText: conditionsFreeText.length ? conditionsFreeText : undefined,
    heightCm: height,
    weightKg: weight,
    bmi,
    familyHistory: values.familyHistory,
    providerConstraints: constraints,
    utilization: hasUtilization ? utilization : undefined,
    dualEligible: values.dualEligible || undefined,
  };

  // Provenance: every populated field is attributed to whoever submitted it.
  const provenance: ClientProfileInput["fieldProvenance"] = {};
  for (const field of PROVENANCE_FIELDS) {
    const val = profile[field];
    const populated = Array.isArray(val) ? val.length > 0 : val !== undefined && val !== "";
    if (populated) provenance[field] = capturedBy;
  }
  profile.fieldProvenance = provenance;

  return profile;
}

/**
 * Merge a correction submit over an existing profile: keep the ORIGINAL
 * `capturedBy` (so we still know the facts originated patient- vs broker-side),
 * and attribute only the changed fields to the corrector.
 */
export function mergeProvenance(
  existing: ClientProfileInput,
  next: ClientProfileInput,
  corrector: CaptureSource,
): ClientProfileInput {
  const provenance = { ...(existing.fieldProvenance ?? {}) };
  for (const field of PROVENANCE_FIELDS) {
    if (JSON.stringify(existing[field]) !== JSON.stringify(next[field])) {
      provenance[field] = corrector;
    }
  }
  return { ...next, capturedBy: existing.capturedBy, fieldProvenance: provenance };
}
