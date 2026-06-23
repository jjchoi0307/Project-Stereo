import type { Formulary } from "@/lib/domain";

/**
 * Two formularies covering the tracked drug set. The carrier Summaries of
 * Benefits give per-TIER cost share (carried on each plan's
 * benefits.drugTierCostShare) but not drug-by-drug placement, so tier placement
 * here uses standard 2026 MA placement for these common drugs and is shared
 * across plans; the dollar cost a member pays still comes from the plan's own
 * tier cost-share. All tracked drugs are covered (these are comprehensive MA
 * plans) — `form-standard` layers on the utilization-management seen on
 * narrower carriers; `form-broad` is the open formulary used by the C-SNP /
 * D-SNP and Clever Care plans.
 */
const TIER_PLACEMENT = {
  "rx-metformin": 1,
  "rx-atorvastatin": 1,
  "rx-lisinopril": 1,
  "rx-sertraline": 1,
  "rx-zolpidem": 2,
  "rx-albuterol": 2,
  "rx-empagliflozin": 3,
  "rx-insulin-glargine": 3,
  "rx-pembrolizumab": 5,
} as const;

type Restriction = "prior_auth" | "step_therapy" | "quantity_limit";

const BROAD_RESTRICTIONS: Record<string, Restriction[]> = {
  // Specialty oncology still carries prior auth even on the open formulary.
  "rx-pembrolizumab": ["prior_auth"],
};

const STANDARD_RESTRICTIONS: Record<string, Restriction[]> = {
  "rx-empagliflozin": ["step_therapy"],
  "rx-pembrolizumab": ["prior_auth"],
  "rx-zolpidem": ["quantity_limit"],
};

function buildEntries(restrictions: Record<string, Restriction[]>) {
  return Object.entries(TIER_PLACEMENT).map(([drugId, tier]) => ({
    drugId,
    covered: true,
    tier: tier as 1 | 2 | 3 | 4 | 5 | 6,
    ...(restrictions[drugId] ? { restrictions: restrictions[drugId] } : {}),
  }));
}

export const formularies: Formulary[] = [
  { id: "form-broad", name: "Open Formulary (C-SNP / Clever Care)", entries: buildEntries(BROAD_RESTRICTIONS) },
  { id: "form-standard", name: "Standard Formulary (managed UM)", entries: buildEntries(STANDARD_RESTRICTIONS) },
];
