import type { ReasonCode } from "@/lib/domain";

/** Broker-friendly text for each reason code (rendered in the recommendation UI). */
export const REASON_TEXT: Record<ReasonCode, string> = {
  covers_all_current_meds: "Covers all of the client's current medications.",
  covers_likely_future_meds: "Holds up across likely future prescriptions, not just today's.",
  keeps_required_providers: "Keeps every provider the client requires.",
  strong_specialist_access: "Low-cost specialist access for a client who sees specialists often.",
  low_catastrophic_exposure: "Strong protection against worst-case costs.",
  acupuncture_well_covered: "Covers the acupuncture the client already uses.",
  mental_health_well_covered: "Affordable mental-health coverage.",
  med_coverage_gap: "Leaves a medication coverage gap.",
  network_gap_risk: "Risk of a needed provider falling out of network.",
  high_catastrophic_exposure: "Exposed to high worst-case costs in some scenarios.",
};

/** Codes that argue FOR a plan (vs. caveats), for UI grouping. */
export const POSITIVE_REASONS: ReadonlySet<ReasonCode> = new Set<ReasonCode>([
  "covers_all_current_meds",
  "covers_likely_future_meds",
  "keeps_required_providers",
  "strong_specialist_access",
  "low_catastrophic_exposure",
  "acupuncture_well_covered",
  "mental_health_well_covered",
]);
