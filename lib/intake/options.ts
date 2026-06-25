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
  { value: "stroke", label: "Stroke" },
  { value: "dementia", label: "Alzheimer's / dementia" },
  { value: "osteoporosis", label: "Osteoporosis" },
  { value: "thyroid_disorder", label: "Thyroid disorder" },
];

/** Family-history conditions we ask about (yes / no / unknown). */
export const FAMILY_HISTORY_CONDITIONS: { value: ConditionFlag; label: string }[] = [
  { value: "diabetes", label: "Diabetes" },
  { value: "cad", label: "Heart disease" },
  { value: "stroke", label: "Stroke" },
  { value: "cancer_history", label: "Cancer" },
  { value: "hypertension", label: "High blood pressure" },
  { value: "hyperlipidemia", label: "High cholesterol" },
  { value: "ckd", label: "Kidney disease" },
  { value: "copd", label: "Lung disease / COPD" },
  { value: "depression", label: "Mental health condition" },
  { value: "dementia", label: "Alzheimer's / dementia" },
  { value: "osteoporosis", label: "Osteoporosis" },
];

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
];

export const SLEEP_QUALITY_OPTIONS: { value: "poor" | "fair" | "good"; label: string }[] = [
  { value: "poor", label: "Poor" },
  { value: "fair", label: "Fair" },
  { value: "good", label: "Good" },
];

export const SELF_RATED_HEALTH_OPTIONS: { value: "1" | "2" | "3" | "4" | "5"; label: string }[] = [
  { value: "1", label: "1 — Poor" },
  { value: "2", label: "2 — Fair" },
  { value: "3", label: "3 — Good" },
  { value: "4", label: "4 — Very good" },
  { value: "5", label: "5 — Excellent" },
];
