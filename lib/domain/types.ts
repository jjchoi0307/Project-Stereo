/**
 * SMG Broker Engagement Tool — domain data model (single source of truth).
 *
 * Organized in the five-layer order from the brief:
 *   1. Geography, providers, drugs, plans   → the seeded plan data (this step)
 *   2. Client profile intake                → captured facts (this step; UI in step 2)
 *   3-6. Engine I/O contracts               → SHAPES ONLY here; logic in later steps
 *
 * Everything the recommendation traces back to lives in 1-2. The engine types
 * (3-6) are included so the full contract can be reviewed up front, but their
 * producing logic is built in steps 3-8.
 */

// ───────────────────────────────────────────────────────────────────────────
// 0. ID aliases (plain strings in v1; kept named so intent reads clearly)
// ───────────────────────────────────────────────────────────────────────────
export type RegionId = string;
export type ProviderId = string;
export type ProviderSystemId = string;
export type NetworkId = string;
export type FormularyId = string;
export type DrugId = string; // synthetic RxNorm-like code
export type PlanId = string;
export type ProfileId = string;

// ───────────────────────────────────────────────────────────────────────────
// 1a. Geography
// ───────────────────────────────────────────────────────────────────────────
export interface Region {
  id: RegionId;
  name: string;
  counties: string[]; // county-based market region
}

// ───────────────────────────────────────────────────────────────────────────
// 1b. Providers & networks
// ───────────────────────────────────────────────────────────────────────────
export type ProviderType = "hospital" | "physician_group" | "system";

/** A health system / brand a client may need to keep (e.g. "UCLA Health"). */
export interface ProviderSystem {
  id: ProviderSystemId;
  name: string;
}

export interface Provider {
  id: ProviderId;
  name: string;
  type: ProviderType;
  systemId?: ProviderSystemId; // parent system, if any
  regionIds: RegionId[];
}

/** The set of systems/providers a plan gives access to. */
export interface Network {
  id: NetworkId;
  name: string;
  systemIds: ProviderSystemId[];
  providerIds: ProviderId[];
}

// ───────────────────────────────────────────────────────────────────────────
// 1c. Drugs & formulary
// ───────────────────────────────────────────────────────────────────────────
/** MA Part D tiers. Tier 6 ("Select Care") appears on several real 2026 plans. */
export type DrugTier = 1 | 2 | 3 | 4 | 5 | 6;

export interface Drug {
  id: DrugId; // synthetic normalized code
  name: string; // generic/display name, e.g. "metformin"
  therapeuticClass: string; // e.g. "biguanide", "statin", "SSRI", "oncology"
}

export interface FormularyEntry {
  drugId: DrugId;
  covered: boolean;
  tier?: DrugTier;
  /** Utilization-management restrictions that affect access/cost. */
  restrictions?: ("prior_auth" | "step_therapy" | "quantity_limit")[];
}

export interface Formulary {
  id: FormularyId;
  name: string;
  entries: FormularyEntry[];
}

// ───────────────────────────────────────────────────────────────────────────
// 1d. Plans & benefits
// ───────────────────────────────────────────────────────────────────────────
export type PlanType = "HMO" | "PPO" | "HMO-POS" | "HMO-SNP";

/** Special-needs designation. Base medical type stays in `planType`. */
export type SnpType = "none" | "C-SNP" | "D-SNP";

/** Which carrier document a plan's data came from (provenance for fidelity). */
export type DataSource = "benefit-highlights" | "summary-of-benefits" | "rollout-deck";

/**
 * Verbatim plan language for benefits that are richer than a single number.
 * These come straight from the carrier PDFs (see lib/data/source/) and are for
 * faithful display + audit; the engine reads the numeric fields on PlanBenefits.
 */
export interface SupplementalBenefits {
  otc: string | null; // OTC allowance, as printed
  dental: string | null;
  vision: string | null;
  hearing: string | null;
  flexAllowance: string | null; // FLEX / spending-card allowances
  transportation: string | null;
  ssbciGrocery: string | null; // special supplemental benefits for chronically ill
  fitness: string | null;
  telehealth: string | null;
  emergency: string | null;
  urgentCare: string | null;
  ambulance: string | null;
  inpatient: string | null; // full per-day schedule as printed
  partDDeductible: string | null;
  partDOopThreshold: string | null;
  insulinCap: string | null;
}

/**
 * The benefit attributes the simulation and output actually read. Dollar values
 * are USD; copays are per-visit unless noted.
 *
 * Numeric fields are DERIVED from the verbatim source strings by
 * lib/data/fixtures/plans.ts (coinsurance → an estimated copay using documented
 * assumed drug costs). `*Display` / `supplemental` hold the faithful text.
 */
export interface PlanBenefits {
  monthlyPremium: number;
  annualOOPMax: number; // in-network MOOP
  annualOOPMaxOutOfNetwork?: number | null;
  partCDeductible?: number | null;
  pcpCopay: number;
  specialistCopay: number;
  inpatientCostSharePerDay: number;
  inpatientCostShareDays: number; // days the per-day share applies before $0
  mentalHealthOutpatientCopay: number;
  acupunctureVisitsPerYear: number; // 0 = Medicare-only; 999 ≈ unlimited routine
  acupunctureCopay: number;
  otcAllowanceQuarterly: number;
  dentalAllowanceAnnual: number;
  insulinMonthlyCap?: number; // $ cap per insulin/month (e.g. 35)
  /** Member cost share per drug tier (flat copay $, or derived from coinsurance). */
  drugTierCostShare: Record<DrugTier, number>;
  /** Verbatim per-tier language as printed (e.g. "33% coinsurance", "$30"). */
  drugTierDisplay: Record<DrugTier, string | null>;
}

export interface Plan {
  id: PlanId;
  name: string;
  carrier: string;
  planType: PlanType;
  cmsId?: string | null; // CMS contract/PBP (e.g. "H3815-008")
  snpType: SnpType;
  snpConditions?: string[] | null; // qualifying chronic conditions for a C-SNP
  dsnpDualEligibility?: string | null; // dual-eligibility note for a D-SNP
  dataSource: DataSource;
  sourceFile: string; // source health-plan PDF filename (UI footnote citation)

  // Sourcing / preference flags (read by the bounded, logged preferenceWeight).
  smgSupported: boolean; // SMG sells/partners on this plan (all real plans here)
  isScan: boolean; // SCAN Health Plan specifically (called out in the brief)
  isCompetitor: boolean; // retained for engine compat; false for all SMG plans

  counties: string[]; // verbatim counties served, from the source PDF
  regionsAvailable: RegionId[]; // counties mapped to market regions
  networkId: NetworkId;
  formularyId: FormularyId;
  benefits: PlanBenefits;
  supplemental: SupplementalBenefits;
}

// ───────────────────────────────────────────────────────────────────────────
// 2. Client profile intake (FACTS ONLY — never opinions/sentiment)
// ───────────────────────────────────────────────────────────────────────────
export type CaptureSource = "patient" | "broker";
export type YesNoUnknown = "yes" | "no" | "unknown";
export type Gender = "male" | "female";

/** Common chronic flags as a controlled vocab; free text captured separately. */
export type ConditionFlag =
  | "diabetes"
  | "prediabetes"
  | "hypertension"
  | "hyperlipidemia"
  | "ckd"
  | "copd"
  | "chf"
  | "cad"
  | "cancer_active"
  | "cancer_history"
  | "depression"
  | "anxiety"
  | "obesity"
  | "osteoarthritis"
  | "sleep_disorder";

export interface Medication {
  raw: string; // exactly as entered
  drugId?: DrugId; // normalized code where we can map it
  name?: string; // normalized display name
}

export interface ProviderConstraint {
  /** What must be kept. Reference a system (e.g. UCLA) or a specific provider. */
  systemId?: ProviderSystemId;
  providerId?: ProviderId;
  label: string; // human label as entered/displayed ("must keep UCLA")
  hardRequirement: boolean; // true = real requirement (drives hard exclusion)
}

export interface FamilyHistoryFlag {
  condition: ConditionFlag;
  status: YesNoUnknown;
  affectedRelativesCount?: number;
}

export interface UtilizationFacts {
  acupunctureVisits12mo?: number;
  specialistVisits12mo?: number;
  priorYearInpatientEvents?: number;
}

export interface ClientProfileInput {
  id: ProfileId;
  capturedBy: CaptureSource; // which path created the profile
  capturedAt: string; // ISO timestamp

  // Required: age, marketRegion, and at least one of {medications, conditions}.
  age: number;
  marketRegion: RegionId;
  gender?: Gender;
  zip?: string;
  county?: string;

  medications: Medication[];
  conditions: ConditionFlag[];
  conditionsFreeText?: string[];

  heightCm?: number;
  weightKg?: number;
  bmi?: number; // computed from height/weight when both present

  familyHistory: FamilyHistoryFlag[];
  providerConstraints: ProviderConstraint[];
  utilization?: UtilizationFacts;

  /** Per-field provenance so we can later compare patient- vs broker-entered accuracy. */
  fieldProvenance?: Partial<Record<keyof ClientProfileInput, CaptureSource>>;
}

// ───────────────────────────────────────────────────────────────────────────
// 3. Normalized profile  (SHAPE ONLY — produced in step 3)
// ───────────────────────────────────────────────────────────────────────────
export type RiskBand = "low" | "moderate" | "high" | "very_high";

export interface RiskMarker {
  value: number; // 0..1 likelihood or normalized intensity
  band: RiskBand;
  trace: string[]; // which inputs produced this (for self-explanation)
}

export interface NormalizedProfile {
  profileId: ProfileId;
  diabetes: RiskMarker; // likelihood & severity
  oncologyRisk: RiskMarker;
  mentalHealthUtilization: RiskMarker;
  specialistNeed: RiskMarker;
  drugUtilizationIntensity: RiskMarker;
  networkSensitivity: RiskMarker; // driven by hard provider constraints
}

// ───────────────────────────────────────────────────────────────────────────
// 4. Rules engine output  (SHAPE ONLY — produced in step 4)
// ───────────────────────────────────────────────────────────────────────────
export type ExclusionReason =
  | "provider_out_of_network"
  | "medication_off_formulary"
  | "region_unavailable";

export interface ExclusionLogEntry {
  planId: PlanId;
  reason: ExclusionReason;
  detail: string; // e.g. "drops required UCLA access"
  severity: "exclude" | "flag";
}

// ───────────────────────────────────────────────────────────────────────────
// 5. Simulation  (SHAPE ONLY — produced in step 5)
// ───────────────────────────────────────────────────────────────────────────
export type CareEventType =
  | "no_major_event"
  | "rising_chronic_med_usage"
  | "new_specialist_utilization"
  | "cancer_dx_and_treatment"
  | "sleep_medicine_continuation"
  | "higher_outpatient_use"
  | "high_cost_provider_dependency";

export interface CareEvent {
  type: CareEventType;
  drugIds?: DrugId[]; // meds this event implies
  requiresSystemIds?: ProviderSystemId[]; // providers this event implies
  intensity: number; // 0..1
}

export interface CareJourney {
  index: number;
  events: CareEvent[];
}

// ───────────────────────────────────────────────────────────────────────────
// 6. Scoring & recommendation  (SHAPE ONLY — produced in step 6)
// ───────────────────────────────────────────────────────────────────────────
export type ReasonCode =
  | "covers_all_current_meds"
  | "covers_likely_future_meds"
  | "keeps_required_providers"
  | "strong_specialist_access"
  | "low_catastrophic_exposure"
  | "acupuncture_well_covered"
  | "mental_health_well_covered"
  | "med_coverage_gap"
  | "network_gap_risk"
  | "high_catastrophic_exposure";

/** One weighted component of the fit score: its contribution and its max weight. */
export interface ScoreComponent {
  value: number; // weighted contribution (raw; round for display)
  max: number; // the component's weight (max possible contribution)
}

/**
 * Transparent breakdown of how a plan's total was built — the weighted sub-scores
 * the engine already computes, surfaced for brokers and the audit trail. Display
 * arithmetic: expectedFit = coverageFit + networkFit + medicationFit − mismatchPenalty;
 * total = expectedFit − catastrophicDownside + preference. (Components are raw and
 * may differ from the rounded subtotals by display rounding.)
 */
export interface ScoreBreakdown {
  coverageFit: ScoreComponent;
  networkFit: ScoreComponent;
  medicationFit: ScoreComponent;
  mismatchPenalty: ScoreComponent; // subtracted
  catastrophicDownside: ScoreComponent; // subtracted (== downsideRisk)
  preference: number; // added (0..preference.max)
}

export interface PlanScore {
  planId: PlanId;
  expectedFit: number;
  downsideRisk: number;
  confidence: number; // tightness of outcomes across scenarios
  preferenceContribution: number; // bounded tiebreaker, logged
  total: number;
  reasonCodes: ReasonCode[];
  /** Weighted sub-scores that build the total (transparency; see ScoreBreakdown). */
  breakdown: ScoreBreakdown;
}

export interface Recommendation {
  profileId: ProfileId;
  ranked: PlanScore[]; // best-first among surviving plans
  excluded: ExclusionLogEntry[];
  topPlanId: PlanId | null;
}

// ───────────────────────────────────────────────────────────────────────────
// 7. Audit record  (SHAPE ONLY — produced in step 8)
// ───────────────────────────────────────────────────────────────────────────
export interface AuditRecord {
  id: string;
  createdAt: string;
  /** Reference-data version this recommendation was computed against (see lib/version.ts). */
  dataVersion?: string;
  /** Engine/scoring version this recommendation was computed with. */
  engineVersion?: string;
  profileSnapshot: ClientProfileInput;
  normalizedProfile: NormalizedProfile;
  exclusionLog: ExclusionLogEntry[];
  scenarioSeed: number;
  scenarioCount: number;
  perPlanScores: PlanScore[];
  ranking: PlanId[];
  preferenceWeightingEnabled: boolean;
  /** True if preference weighting changed the top pick vs the pure-fit ranking. */
  preferenceChangedTop: boolean;
}
