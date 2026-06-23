export * from "./types";

/** BMI from height (cm) and weight (kg). Returned rounded to 1 decimal. */
export function computeBmi(heightCm: number, weightKg: number): number {
  const m = heightCm / 100;
  return Math.round((weightKg / (m * m)) * 10) / 10;
}
