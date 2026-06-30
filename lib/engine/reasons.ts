import type { ReasonCode } from "@/lib/domain";

/**
 * Reason-code helpers for the engine output. The recommendation is now
 * AI-powered (lib/ai/recommend.ts produces the reason bullets + citations
 * directly from the model), so the former deterministic text renderer
 * (describeReason/REASON_TEXT) and footnote builder (citationFor) were removed
 * as dead code. The ReasonCode vocabulary and this positive/caveat grouping
 * remain live: scoring.ts emits the codes and the UI groups them.
 */

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
