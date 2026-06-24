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

/**
 * Inputs `describeReason` reads to turn a generic reason code into a specific
 * sentence. All fields are optional: when a fact needed for a given code is
 * absent, `describeReason` falls back to the generic `REASON_TEXT[code]`.
 *
 * This is presentation only — these values are surfaced verbatim from the
 * engine's own outputs (plan benefits, simulation summaries, the client
 * profile, cross-plan ranking context). Nothing here feeds scoring.
 */
export interface ReasonFacts {
  /** Display names of the client's current medications (normalized where known). */
  currentMedNames?: string[];
  /** Count of current medications (may exceed currentMedNames length). */
  currentMedCount?: number;

  /** Plan benefit figures. */
  specialistCopay?: number;
  mentalHealthOutpatientCopay?: number;
  acupunctureVisitsPerYear?: number;

  /** Display names of providers the client marked as a hard requirement. */
  requiredProviderNames?: string[];

  /** Client utilization. */
  specialistVisits12mo?: number;
  acupunctureVisits12mo?: number;

  /** Simulation summary rates (fractions 0..1). */
  medCoverageRate?: number;
  networkGapRate?: number;
  catastrophicRate?: number;
  /** Most-frequently-uncovered drug across simulated futures, if any. */
  topUncoveredDrug?: { name: string; rate: number };

  /** Cross-plan context (may be unavailable, e.g. in horizon view). */
  isLowestCatastrophic?: boolean;
  eligibleCount?: number;
}

const pct = (frac: number) => `${Math.round(frac * 100)}%`;
const money = (n: number) => `$${Math.round(n)}`;

/** Join up to `cap` names, then "+N more". */
function nameList(names: string[], cap = 3): string {
  if (names.length <= cap) return names.join(", ");
  const shown = names.slice(0, cap).join(", ");
  return `${shown} +${names.length - cap} more`;
}

/**
 * Turn a reason code into a SPECIFIC broker-facing sentence, citing real
 * numbers and names from `facts`. Falls back to the generic `REASON_TEXT`
 * for that code whenever the specifics it needs aren't present.
 */
export function describeReason(code: ReasonCode, facts: ReasonFacts = {}): string {
  const generic = REASON_TEXT[code];
  switch (code) {
    case "covers_all_current_meds": {
      const count = facts.currentMedCount ?? facts.currentMedNames?.length;
      if (!count) return generic;
      const names = facts.currentMedNames ?? [];
      const med = count === 1 ? "medication" : "medications";
      const tail = names.length ? ` (${nameList(names)})` : "";
      return `Covers all ${count} current ${med}${tail}.`;
    }
    case "covers_likely_future_meds": {
      if (facts.medCoverageRate == null) return generic;
      return `Holds up across likely future prescriptions — ${pct(
        facts.medCoverageRate,
      )} covered across simulated futures.`;
    }
    case "keeps_required_providers": {
      const names = facts.requiredProviderNames ?? [];
      if (!names.length) return generic;
      return `Keeps ${nameList(names)} in network (a hard requirement).`;
    }
    case "strong_specialist_access": {
      if (facts.specialistCopay == null) return generic;
      const visits = facts.specialistVisits12mo;
      if (visits == null) {
        return `${money(facts.specialistCopay)} specialist copay.`;
      }
      const visitWord = visits === 1 ? "visit" : "visits";
      return `${money(facts.specialistCopay)} specialist copay for a client with ${visits} specialist ${visitWord}/yr.`;
    }
    case "low_catastrophic_exposure": {
      if (facts.catastrophicRate == null) return generic;
      const base = `${pct(facts.catastrophicRate)} catastrophic-cost risk`;
      if (facts.isLowestCatastrophic && facts.eligibleCount) {
        return `${base}, the lowest among the ${facts.eligibleCount} eligible plans.`;
      }
      return `${base}.`;
    }
    case "acupuncture_well_covered": {
      if (facts.acupunctureVisitsPerYear == null) return generic;
      const visits =
        facts.acupunctureVisitsPerYear >= 999
          ? "unlimited"
          : String(facts.acupunctureVisitsPerYear);
      const used =
        facts.acupunctureVisits12mo != null
          ? ` (client used ${facts.acupunctureVisits12mo})`
          : "";
      return `Covers ${visits} acupuncture visits/yr${used}.`;
    }
    case "mental_health_well_covered": {
      if (facts.mentalHealthOutpatientCopay == null) return generic;
      return `${money(facts.mentalHealthOutpatientCopay)} mental-health visit copay.`;
    }
    case "med_coverage_gap": {
      if (!facts.topUncoveredDrug) return generic;
      return `Medication gap: ${facts.topUncoveredDrug.name} uncovered in ${pct(
        facts.topUncoveredDrug.rate,
      )} of futures.`;
    }
    case "network_gap_risk": {
      if (facts.networkGapRate == null) return generic;
      return `${pct(facts.networkGapRate)} risk a needed provider falls out of network.`;
    }
    case "high_catastrophic_exposure": {
      if (facts.catastrophicRate == null) return generic;
      return `${pct(
        facts.catastrophicRate,
      )} chance of catastrophic out-of-pocket cost in some futures.`;
    }
    default:
      return generic;
  }
}
