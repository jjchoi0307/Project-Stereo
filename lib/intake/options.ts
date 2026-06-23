import type { ConditionFlag, Gender } from "@/lib/domain";

/** Diagnosed-condition checklist — facts, never "do you care about X". */
export const CONDITION_OPTIONS: { value: ConditionFlag; label: string }[] = [
  { value: "diabetes", label: "Diabetes (Type 2)" },
  { value: "prediabetes", label: "Prediabetes" },
  { value: "hypertension", label: "High blood pressure" },
  { value: "hyperlipidemia", label: "High cholesterol" },
  { value: "ckd", label: "Chronic kidney disease" },
  { value: "copd", label: "COPD" },
  { value: "chf", label: "Congestive heart failure" },
  { value: "cad", label: "Coronary artery disease" },
  { value: "cancer_active", label: "Cancer (in treatment)" },
  { value: "cancer_history", label: "Cancer (history)" },
  { value: "depression", label: "Depression" },
  { value: "anxiety", label: "Anxiety" },
  { value: "obesity", label: "Obesity" },
  { value: "osteoarthritis", label: "Osteoarthritis" },
  { value: "sleep_disorder", label: "Sleep disorder" },
];

/** Family-history conditions we ask about (yes / no / unknown). */
export const FAMILY_HISTORY_CONDITIONS: { value: ConditionFlag; label: string }[] = [
  { value: "diabetes", label: "Diabetes" },
  { value: "cancer_history", label: "Cancer" },
  { value: "cad", label: "Heart disease" },
  { value: "depression", label: "Mental health condition" },
];

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];
