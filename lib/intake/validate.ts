import type { IntakeFormValues } from "./types";

export interface IntakeValidation {
  ok: boolean;
  fields: Partial<Record<keyof IntakeFormValues, string>>;
  form?: string;
}

const isInt = (s: string) => /^\d+$/.test(s.trim());

/**
 * Shared client + server validation. Required by the brief: age, region, and at
 * least one of {medications, conditions}. Everything else is optional so the
 * form never stalls adoption — but anything provided must be well-formed.
 */
export function validateIntake(v: IntakeFormValues): IntakeValidation {
  const fields: IntakeValidation["fields"] = {};

  // age — required
  if (!v.age.trim()) {
    fields.age = "Age is required.";
  } else if (!isInt(v.age) || Number(v.age) < 18 || Number(v.age) > 120) {
    fields.age = "Enter an age between 18 and 120.";
  }

  // region — required
  if (!v.marketRegion) fields.marketRegion = "Select the client's market region.";

  // at least one of meds / conditions
  const hasMeds = v.medications.some((m) => m.trim().length > 0);
  const hasConditions = v.conditions.length > 0 || v.conditionsFreeText.trim().length > 0;
  let form: string | undefined;
  if (!hasMeds && !hasConditions) {
    form = "Enter at least one medication or one diagnosed condition.";
  }

  // optional-but-must-be-valid
  if (v.heightCm.trim() && (!isInt(v.heightCm) || Number(v.heightCm) < 80 || Number(v.heightCm) > 250)) {
    fields.heightCm = "Height in cm (80–250).";
  }
  if (v.weightKg.trim() && (!isInt(v.weightKg) || Number(v.weightKg) < 25 || Number(v.weightKg) > 400)) {
    fields.weightKg = "Weight in kg (25–400).";
  }
  for (const k of ["acupunctureVisits12mo", "specialistVisits12mo", "priorYearInpatientEvents"] as const) {
    if (v[k].trim() && !isInt(v[k])) fields[k] = "Whole number only.";
  }

  return { ok: Object.keys(fields).length === 0 && !form, fields, form };
}
