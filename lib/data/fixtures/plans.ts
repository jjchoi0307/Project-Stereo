import type {
  DataSource,
  DrugTier,
  Plan,
  PlanBenefits,
  PlanType,
  SnpType,
  SupplementalBenefits,
} from "@/lib/domain";
import { COUNTY_TO_REGION } from "./regions";
import source from "../source/plans-2026.json";

/**
 * Real 2026 SMG-supported plans, built from the faithful source extraction in
 * lib/data/source/plans-2026.json (one object per carrier PDF). The source holds
 * verbatim plan language; this module DERIVES the numeric fields the engine reads
 * (lib/engine/simulate.ts etc.) with the documented assumptions below, and keeps
 * the original strings on `supplemental` / `drugTierDisplay` for faithful display.
 *
 * Coinsurance → estimated copay: the SBs state several tiers as a percentage. To
 * give the cost simulation a dollar figure we multiply the percentage by an
 * assumed monthly drug cost per tier. These are transparent placeholders, not
 * carrier-published copays — calibrate against claims data later.
 */
const ASSUMED_MONTHLY_DRUG_COST: Record<DrugTier, number> = {
  1: 15, // preferred generic
  2: 40, // generic
  3: 300, // preferred brand
  4: 250, // non-preferred
  5: 1500, // specialty
  6: 15, // select care
};

interface SourcePlan {
  id: string;
  name: string;
  carrier: string;
  planType: string;
  cmsId: string | null;
  snpType: string;
  snpConditions: string[] | null;
  dsnpDualEligibility?: string | null;
  counties: string[];
  networkId: string;
  formularyId: string;
  dataSource: string;
  sourceFile: string;
  sourcePage: number;
  premium: number;
  partBGiveback?: number; // $/mo Part B premium give-back (0/absent = none)
  moopInNetwork: number | null;
  moopOutOfNetwork: number | null;
  partCDeductible: number | null;
  pcp: string;
  specialist: string;
  inpatient: string;
  emergency: string;
  urgentCare: string;
  ambulance: string;
  mentalHealth: string | null;
  acupunctureVisits: number | null;
  acupuncture: string | null;
  otc: string | null;
  dental: string | null;
  vision: string | null;
  hearing: string | null;
  flex: string | null;
  transportation: string | null;
  ssbciGrocery: string | null;
  fitness: string | null;
  telehealth: string | null;
  partDDeductible: string | null;
  partDOop: string | null;
  drugTiers: Record<string, string | null>;
  insulinCap: string | null;
}

// ── Parse helpers (string → number) ───────────────────────────────────────────
const dollars = (s: string): number[] =>
  [...s.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));

/** First flat dollar amount; 0 if none (covers "$0 copay", "0%-20% referral"). */
function parseCopay(s: string | null): number {
  if (!s) return 0;
  const d = dollars(s);
  return d.length ? Math.round(d[0]) : 0;
}

/**
 * Inpatient per-day share + the number of days it applies before $0.
 *
 * Parses EVERY per-day band (plans commonly tier them, e.g. "$0/day days 1-3;
 * $50/day days 4-7" or "$295 copay per day for days 1-6") and returns the
 * worst-case NON-ZERO per-day share with the days that band applies. Tolerates
 * "copay", "for", and "/day" phrasings. Earlier this matched only the first band
 * in a strict format, so tiered/`for days` plans silently collapsed to $0/day —
 * understating catastrophic exposure and feeding the AI a citeable-but-wrong $0.
 */
export function parseInpatient(s: string): { perDay: number; days: number } {
  const bands = [
    ...s.matchAll(
      /\$\s*([\d,]+)\s*(?:copay\s*)?(?:per\s*day|\/\s*day)(?:\s*(?:for\s*)?days?\s*(\d+)\s*-\s*(\d+))?/gi,
    ),
  ].map((m) => ({
    perDay: Number(m[1].replace(/,/g, "")),
    days: m[2] && m[3] ? Number(m[3]) - Number(m[2]) + 1 : null,
  }));
  const nonZero = bands.filter((b) => b.perDay > 0);
  if (nonZero.length) {
    // Worst-case per-day the member can face, with the days that band applies.
    const worst = nonZero.reduce((a, b) => (b.perDay > a.perDay ? b : a));
    return { perDay: Math.round(worst.perDay), days: Math.max(1, Math.min(worst.days ?? 5, 10)) };
  }
  if (bands.length) return { perDay: 0, days: 5 }; // explicitly "$0/day"
  const deductible = s.match(/\$\s*([\d,]+)\s*deductible/i);
  if (deductible) {
    // Spread the benefit-period deductible across a 5-day reference stay.
    return { perDay: Math.round(Number(deductible[1].replace(/,/g, "")) / 5), days: 5 };
  }
  return { perDay: 0, days: 5 }; // "$0 (unlimited)", "Medicare-covered", etc.
}

/** OTC dollars normalized to a quarterly figure. */
function parseOtcQuarterly(s: string | null): number {
  if (!s) return 0;
  const perMonth = s.match(/\$\s*([\d,]+)\s*\/?\s*month/i) ?? s.match(/\$\s*([\d,]+)\s*per month/i);
  if (perMonth) return Number(perMonth[1].replace(/,/g, "")) * 3;
  const perQuarter = s.match(/\$\s*([\d,]+)\s*\/?\s*quarter/i);
  if (perQuarter) return Number(perQuarter[1].replace(/,/g, ""));
  return 0;
}

/** Annual dental ALLOWANCE (not copay-based dental, which has no allowance). */
function parseDentalAnnual(s: string | null): number {
  if (!s) return 0;
  const hits = [
    ...s.matchAll(/\$\s*([\d,]+)\s*(?:\/year|year max|allowance|toward|combined)/gi),
    ...s.matchAll(/up to \$\s*([\d,]+)/gi),
  ].map((m) => Number(m[1].replace(/,/g, "")));
  return hits.length ? Math.max(...hits) : 0;
}

/** Routine acupuncture visits/year. 999 ≈ unlimited routine; 0 = Medicare-only. */
function parseAcupunctureVisits(visits: number | null, s: string | null): number {
  if (typeof visits === "number") return visits;
  if (s && /unlimited/i.test(s)) return 999; // effectively unlimited (e.g. Clever Care)
  const m = s?.match(/(\d+)\s*routine/i);
  return m ? Number(m[1]) : 0;
}

/** Per-tier member cost share in dollars (coinsurance → assumed-cost estimate). */
function parseTier(display: string | null, tier: DrugTier): number {
  if (!display) return 0;
  const hasPct = /(\d+)%/.test(display);
  const range = display.match(/\$\s*[\d.,]+\s*-\s*\$\s*([\d.,]+)/); // "$0-$12.65 or 25%"
  if (hasPct && range) return Math.round(Number(range[1].replace(/,/g, "")));
  if (hasPct) {
    const pct = Number(display.match(/(\d+)%/)![1]);
    return Math.round((pct / 100) * ASSUMED_MONTHLY_DRUG_COST[tier]);
  }
  const d = dollars(display);
  return d.length ? Math.round(d[0]) : 0;
}

/** Highest dollar named in the insulin language, capped sensibly; default $35. */
function parseInsulinCap(s: string | null): number {
  if (!s) return 35;
  const d = dollars(s);
  if (!d.length) return 35;
  return Math.round(Math.max(...d));
}

const TIERS: DrugTier[] = [1, 2, 3, 4, 5, 6];

function buildBenefits(p: SourcePlan): PlanBenefits {
  const { perDay, days } = parseInpatient(p.inpatient);
  const drugTierCostShare = {} as Record<DrugTier, number>;
  const drugTierDisplay = {} as Record<DrugTier, string | null>;
  for (const t of TIERS) {
    const display = p.drugTiers[String(t)] ?? null;
    drugTierDisplay[t] = display;
    drugTierCostShare[t] = parseTier(display, t);
  }
  return {
    monthlyPremium: p.premium,
    partBGivebackMonthly: p.partBGiveback ?? 0,
    annualOOPMax: p.moopInNetwork ?? 0,
    annualOOPMaxOutOfNetwork: p.moopOutOfNetwork,
    partCDeductible: p.partCDeductible,
    pcpCopay: parseCopay(p.pcp),
    specialistCopay: parseCopay(p.specialist),
    inpatientCostSharePerDay: perDay,
    inpatientCostShareDays: days,
    mentalHealthOutpatientCopay: parseCopay(p.mentalHealth),
    acupunctureVisitsPerYear: parseAcupunctureVisits(p.acupunctureVisits, p.acupuncture),
    acupunctureCopay: 0,
    otcAllowanceQuarterly: parseOtcQuarterly(p.otc),
    dentalAllowanceAnnual: parseDentalAnnual(p.dental),
    insulinMonthlyCap: parseInsulinCap(p.insulinCap),
    drugTierCostShare,
    drugTierDisplay,
  };
}

function buildSupplemental(p: SourcePlan): SupplementalBenefits {
  return {
    otc: p.otc,
    dental: p.dental,
    vision: p.vision,
    hearing: p.hearing,
    flexAllowance: p.flex,
    transportation: p.transportation,
    ssbciGrocery: p.ssbciGrocery,
    fitness: p.fitness,
    telehealth: p.telehealth,
    emergency: p.emergency,
    urgentCare: p.urgentCare,
    ambulance: p.ambulance,
    inpatient: p.inpatient,
    partDDeductible: p.partDDeductible,
    partDOopThreshold: p.partDOop,
    insulinCap: p.insulinCap,
  };
}

function toPlan(p: SourcePlan): Plan {
  return {
    id: p.id,
    name: p.name,
    carrier: p.carrier,
    planType: p.planType as PlanType,
    cmsId: p.cmsId,
    snpType: p.snpType as SnpType,
    snpConditions: p.snpConditions,
    dsnpDualEligibility: p.dsnpDualEligibility ?? null,
    dataSource: p.dataSource as DataSource,
    sourceFile: p.sourceFile,
    sourcePage: p.sourcePage,
    smgSupported: true, // every plan in the SMG folder is SMG-supported
    isScan: p.carrier === "SCAN Health Plan",
    isCompetitor: false, // no competitors in SMG's supported set
    counties: p.counties,
    regionsAvailable: [
      ...new Set(p.counties.map((c) => COUNTY_TO_REGION[c]).filter(Boolean)),
    ],
    networkId: p.networkId,
    formularyId: p.formularyId,
    benefits: buildBenefits(p),
    supplemental: buildSupplemental(p),
  };
}

export const plans: Plan[] = (source.plans as SourcePlan[]).map(toPlan);
