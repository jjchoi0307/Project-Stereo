import type { ConditionFlag, YesNoUnknown } from "@/lib/domain";
import { providerSystems } from "@/lib/data/fixtures/providers";
import type { IntakeFormValues } from "./types";
import {
  CONDITION_OPTIONS,
  FAMILY_HISTORY_CONDITIONS,
  GENDER_OPTIONS,
  SELF_RATED_HEALTH_OPTIONS,
  SLEEP_QUALITY_OPTIONS,
} from "./options";

export interface IntakeValidation {
  ok: boolean;
  fields: Partial<Record<keyof IntakeFormValues, string>>;
  form?: string;
}

const isInt = (s: string) => /^\d+$/.test(s.trim());

// Controlled-vocab + bound constants (server-side; the public token endpoint
// must reject arbitrary/huge payloads — storage DoS + junk into engine/LLM).
const CONDITION_VALUES = new Set<string>(CONDITION_OPTIONS.map((o) => o.value));
const FAMILY_CONDITION_VALUES = new Set<string>(FAMILY_HISTORY_CONDITIONS.map((o) => o.value));
const GENDER_VALUES = new Set<string>(GENDER_OPTIONS.map((o) => o.value));
const SLEEP_QUALITY_VALUES = new Set<string>(SLEEP_QUALITY_OPTIONS.map((o) => o.value));
const SELF_RATED_HEALTH_VALUES = new Set<string>(SELF_RATED_HEALTH_OPTIONS.map((o) => o.value));
const YES_NO_UNKNOWN = new Set<YesNoUnknown>(["yes", "no", "unknown"]);
const PROVIDER_SYSTEM_IDS = new Set<string>(providerSystems.map((s) => s.id));

// Length caps.
const MAX_MEDICATIONS = 50;
const MAX_MEDICATION_LEN = 200;
const MAX_CONDITIONS = 40;
const MAX_FAMILY_HISTORY = 40;
const MAX_MUST_KEEP = 20;
const MAX_FREE_TEXT = 2000;
const MAX_ZIP = 10;
const MAX_COUNTY = 80;

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

  // lifestyle & well-being — optional, but must be well-formed if provided
  if (v.avgDailySteps.trim() && (!isInt(v.avgDailySteps) || Number(v.avgDailySteps) < 0 || Number(v.avgDailySteps) > 50000)) {
    fields.avgDailySteps = "Daily steps (0–50000).";
  }
  if (v.sleepHoursPerNight.trim() && (!isInt(v.sleepHoursPerNight) || Number(v.sleepHoursPerNight) < 0 || Number(v.sleepHoursPerNight) > 24)) {
    fields.sleepHoursPerNight = "Hours of sleep (0–24).";
  }
  if (v.sleepQuality !== "" && !SLEEP_QUALITY_VALUES.has(v.sleepQuality as string)) {
    fields.sleepQuality = "Select a valid sleep quality.";
  }
  if (v.selfRatedHealth !== "" && !SELF_RATED_HEALTH_VALUES.has(v.selfRatedHealth as string)) {
    fields.selfRatedHealth = "Select a rating from 1 to 5.";
  }

  // ── Controlled vocabulary + bounds (server-side hardening) ────────────────
  // Defensive guards: the public token endpoint may pass arbitrary JSON, so
  // treat anything non-conforming as invalid rather than trusting the shape.

  // gender — "" or a known Gender
  if (v.gender !== "" && !GENDER_VALUES.has(v.gender as string)) {
    fields.gender = "Select a valid gender.";
  }

  // medications — array, count cap, per-string length cap
  if (!Array.isArray(v.medications)) {
    fields.medications = "Medications must be a list.";
  } else if (v.medications.length > MAX_MEDICATIONS) {
    fields.medications = `Too many medications (max ${MAX_MEDICATIONS}).`;
  } else if (v.medications.some((m) => typeof m !== "string" || m.length > MAX_MEDICATION_LEN)) {
    fields.medications = `Each medication must be ${MAX_MEDICATION_LEN} characters or fewer.`;
  }

  // conditions — array, count cap, known ConditionFlag values only
  if (!Array.isArray(v.conditions)) {
    fields.conditions = "Conditions must be a list.";
  } else if (v.conditions.length > MAX_CONDITIONS) {
    fields.conditions = `Too many conditions (max ${MAX_CONDITIONS}).`;
  } else if (v.conditions.some((c) => !CONDITION_VALUES.has(c as ConditionFlag))) {
    fields.conditions = "Unrecognized condition.";
  }

  // conditionsFreeText — string length cap
  if (typeof v.conditionsFreeText !== "string") {
    fields.conditionsFreeText = "Invalid condition notes.";
  } else if (v.conditionsFreeText.length > MAX_FREE_TEXT) {
    fields.conditionsFreeText = `Condition notes must be ${MAX_FREE_TEXT} characters or fewer.`;
  }

  // familyHistory — array, count cap, each {condition ∈ vocab, status ∈ y/n/u}
  if (!Array.isArray(v.familyHistory)) {
    fields.familyHistory = "Family history must be a list.";
  } else if (v.familyHistory.length > MAX_FAMILY_HISTORY) {
    fields.familyHistory = `Too many family-history entries (max ${MAX_FAMILY_HISTORY}).`;
  } else if (
    v.familyHistory.some(
      (f) =>
        !f ||
        typeof f !== "object" ||
        !FAMILY_CONDITION_VALUES.has(f.condition as ConditionFlag) ||
        !YES_NO_UNKNOWN.has(f.status as YesNoUnknown),
    )
  ) {
    fields.familyHistory = "Invalid family-history entry.";
  }

  // mustKeepSystemIds — array, count cap, known provider-system ids only
  if (!Array.isArray(v.mustKeepSystemIds)) {
    fields.mustKeepSystemIds = "Provider list must be a list.";
  } else if (v.mustKeepSystemIds.length > MAX_MUST_KEEP) {
    fields.mustKeepSystemIds = `Too many required providers (max ${MAX_MUST_KEEP}).`;
  } else if (v.mustKeepSystemIds.some((id) => !PROVIDER_SYSTEM_IDS.has(id as string))) {
    fields.mustKeepSystemIds = "Unrecognized provider system.";
  }

  // dualEligible — boolean only (defensive; public token endpoint may pass arbitrary JSON)
  if (v.dualEligible !== undefined && typeof v.dualEligible !== "boolean") {
    fields.dualEligible = "Dual eligibility must be true or false.";
  }

  // consentAcknowledged — boolean only (defensive), and REQUIRED to be true to submit.
  if (v.consentAcknowledged !== undefined && typeof v.consentAcknowledged !== "boolean") {
    fields.consentAcknowledged = "Consent must be true or false.";
  } else if (v.consentAcknowledged !== true) {
    form = form ?? "Please acknowledge consent to continue.";
  }

  // zip / county — string length caps
  if (typeof v.zip !== "string" || v.zip.length > MAX_ZIP) {
    fields.zip = `ZIP must be ${MAX_ZIP} characters or fewer.`;
  }
  if (typeof v.county !== "string" || v.county.length > MAX_COUNTY) {
    fields.county = `County must be ${MAX_COUNTY} characters or fewer.`;
  }

  return { ok: Object.keys(fields).length === 0 && !form, fields, form };
}
