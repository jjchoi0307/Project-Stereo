import { computeBmi, type ClientProfileInput } from "@/lib/domain";

/**
 * Example broker client profiles for testing the flow end to end. Facts only.
 * These exercise the two demonstrative paths from the brief:
 *   - diabetic / overweight / specialist-heavy  → medication + utilization paths
 *   - must-keep-UCLA                              → hard network exclusion path
 */
export const exampleProfiles: ClientProfileInput[] = [
  {
    id: "profile-diabetic-specialist",
    capturedBy: "patient",
    capturedAt: "2026-06-12T17:00:00.000Z",
    age: 67,
    marketRegion: "reg-la",
    gender: "male",
    county: "Los Angeles",
    medications: [
      { raw: "Metformin 1000mg", drugId: "rx-metformin", name: "metformin" },
      { raw: "atorvastatin 40", drugId: "rx-atorvastatin", name: "atorvastatin" },
      { raw: "lisinopril 20mg", drugId: "rx-lisinopril", name: "lisinopril" },
    ],
    conditions: ["diabetes", "hyperlipidemia", "hypertension", "obesity"],
    heightCm: 170,
    weightKg: 95,
    bmi: computeBmi(170, 95),
    familyHistory: [
      { condition: "diabetes", status: "yes", affectedRelativesCount: 2 },
      { condition: "cancer_history", status: "unknown" },
    ],
    providerConstraints: [],
    utilization: { specialistVisits12mo: 6, acupunctureVisits12mo: 4, priorYearInpatientEvents: 0 },
  },
  {
    id: "profile-ucla-required",
    capturedBy: "broker",
    capturedAt: "2026-06-12T17:05:00.000Z",
    age: 71,
    marketRegion: "reg-la",
    gender: "female",
    county: "Los Angeles",
    medications: [{ raw: "atorvastatin 20mg", drugId: "rx-atorvastatin", name: "atorvastatin" }],
    conditions: ["hyperlipidemia"],
    familyHistory: [],
    providerConstraints: [
      {
        systemId: "sys-ucla",
        label: "Must keep UCLA Health (established oncologist)",
        hardRequirement: true,
      },
    ],
    utilization: { specialistVisits12mo: 3, priorYearInpatientEvents: 0 },
  },
];
