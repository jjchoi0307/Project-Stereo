/**
 * Layer 3 — hard rules engine. Runs BEFORE any scoring to drop plans that are
 * categorically wrong for the client's facts, and records why. Three rules:
 *
 *   1. Region        — plan not offered in the client's market region → exclude
 *   2. Provider      — a hard "must-keep" provider/system out of network → exclude
 *   3. Medication    — a current med off the plan's formulary → exclude if the
 *                      drug is critical (insulin, oncology), otherwise flag
 *
 * A plan with any "exclude" entry is removed; "flag" entries stay with a
 * surviving plan and feed the downside later (and explain a low score). Every
 * decision is logged so the recommendation and audit record can explain it.
 */

import type {
  ClientProfileInput,
  DrugId,
  ExclusionLogEntry,
  Formulary,
  FormularyId,
  Network,
  NetworkId,
  Plan,
  PlanId,
  ProviderSystemId,
  RegionId,
  Drug,
  ProviderSystem,
  Region,
} from "@/lib/domain";
import type { DataStore } from "@/lib/data";
import { CRITICAL_DRUG_CLASSES } from "./config";

export interface RulesContext {
  networks: Map<NetworkId, Network>;
  formularies: Map<FormularyId, Formulary>;
  drugsById: Map<DrugId, Drug>;
  systemsById: Map<ProviderSystemId, ProviderSystem>;
  regionsById: Map<RegionId, Region>;
}

export interface RulesResult {
  survivingPlanIds: PlanId[];
  excludedPlanIds: PlanId[];
  log: ExclusionLogEntry[]; // exclude entries for removed plans + flag entries for survivors
}

export async function buildRulesContext(db: DataStore): Promise<RulesContext> {
  const [networks, formularies, drugs, systems, regions] = await Promise.all([
    db.listNetworks(),
    db.listFormularies(),
    db.listDrugs(),
    db.listProviderSystems(),
    db.listRegions(),
  ]);
  return {
    networks: new Map(networks.map((n) => [n.id, n])),
    formularies: new Map(formularies.map((f) => [f.id, f])),
    drugsById: new Map(drugs.map((d) => [d.id, d])),
    systemsById: new Map(systems.map((s) => [s.id, s])),
    regionsById: new Map(regions.map((r) => [r.id, r])),
  };
}

/**
 * Map a plan's printed C-SNP qualifying-condition phrases to the controlled
 * ConditionFlag vocab the intake captures. A member qualifies for a C-SNP only if
 * they have at least one mapped condition. Keyword-based so it tolerates the
 * varied wording across carrier documents ("Diabetes Mellitus", "CHF", etc.).
 */
const CSNP_KEYWORD_FLAGS: { kw: string; flags: string[] }[] = [
  { kw: "diabet", flags: ["diabetes"] },
  { kw: "heart failure", flags: ["chf"] },
  { kw: "chf", flags: ["chf"] },
  { kw: "cardiovascular", flags: ["cad", "chf"] },
  { kw: "cardiac", flags: ["cad"] },
  { kw: "coronary", flags: ["cad"] },
  { kw: "kidney", flags: ["ckd"] },
  { kw: "renal", flags: ["ckd"] },
  { kw: "ckd", flags: ["ckd"] },
  { kw: "lung", flags: ["copd"] },
  { kw: "pulmonary", flags: ["copd"] },
  { kw: "copd", flags: ["copd"] },
  { kw: "asthma", flags: ["copd"] },
  { kw: "bronchitis", flags: ["copd"] },
  { kw: "emphysema", flags: ["copd"] },
];

/** Qualifying ConditionFlags for a plan's C-SNP conditions (deduped). */
function csnpQualifyingFlags(snpConditions: string[]): Set<string> {
  const flags = new Set<string>();
  for (const c of snpConditions) {
    const lc = c.toLowerCase();
    for (const { kw, flags: fs } of CSNP_KEYWORD_FLAGS) {
      if (lc.includes(kw)) fs.forEach((f) => flags.add(f));
    }
  }
  return flags;
}

/**
 * Special-needs-plan eligibility (decisive, like region):
 *  - D-SNP: dual Medicare + Medi-Cal eligibility required → exclude unless the
 *    member is marked dual-eligible (a dual-only plan can't go to a non-dual member).
 *  - C-SNP: a qualifying chronic condition required → exclude unless the member
 *    has one of the plan's qualifying conditions.
 * Returns the exclusion entry, or null if the plan is SNP-eligible (or not a SNP).
 */
function snpExclusion(plan: Plan, profile: ClientProfileInput): ExclusionLogEntry | null {
  if (plan.snpType === "D-SNP") {
    if (profile.dualEligible === true) return null;
    return {
      planId: plan.id,
      reason: "snp_ineligible",
      severity: "exclude",
      detail: "D-SNP requires Medicare + Medi-Cal dual eligibility (member not marked dual-eligible)",
    };
  }
  if (plan.snpType === "C-SNP") {
    const conds = plan.snpConditions ?? [];
    if (conds.length === 0) return null; // can't verify → don't over-exclude
    const qualifying = csnpQualifyingFlags(conds);
    const memberHas = profile.conditions.some((c) => qualifying.has(c));
    if (memberHas) return null;
    return {
      planId: plan.id,
      reason: "snp_ineligible",
      severity: "exclude",
      detail: `C-SNP requires a qualifying condition (${conds.join(", ")}); member has none on file`,
    };
  }
  return null;
}

/** Hard "must-keep" provider/system names a plan drops (not in its network). */
export function providerGapsFor(
  plan: Plan,
  profile: ClientProfileInput,
  ctx: RulesContext,
): string[] {
  const network = ctx.networks.get(plan.networkId);
  const gaps: string[] = [];
  for (const c of profile.providerConstraints) {
    if (!c.hardRequirement) continue;
    const sysOk = c.systemId ? !!network?.systemIds.includes(c.systemId) : true;
    const provOk = c.providerId ? !!network?.providerIds.includes(c.providerId) : true;
    if (!sysOk || !provOk) {
      gaps.push(c.systemId ? ctx.systemsById.get(c.systemId)?.name ?? c.systemId : c.providerId ?? "required provider");
    }
  }
  return gaps;
}

export function applyRules(
  profile: ClientProfileInput,
  plans: Plan[],
  ctx: RulesContext,
  opts: { ignoreProviderConstraints?: boolean } = {},
): RulesResult {
  const log: ExclusionLogEntry[] = [];
  const survivingPlanIds: PlanId[] = [];
  const excludedPlanIds: PlanId[] = [];

  for (const plan of plans) {
    // 1. Region — decisive; if the plan isn't sold here nothing else matters.
    if (!plan.regionsAvailable.includes(profile.marketRegion)) {
      const regionName = ctx.regionsById.get(profile.marketRegion)?.name ?? profile.marketRegion;
      log.push({
        planId: plan.id,
        reason: "region_unavailable",
        severity: "exclude",
        detail: `not offered in ${regionName}`,
      });
      excludedPlanIds.push(plan.id);
      continue;
    }

    // 1b. SNP eligibility — decisive (D-SNP dual status / C-SNP qualifying condition).
    const snp = snpExclusion(plan, profile);
    if (snp) {
      log.push(snp);
      excludedPlanIds.push(plan.id);
      continue;
    }

    const entries: ExclusionLogEntry[] = [];
    const network = ctx.networks.get(plan.networkId);

    // 2. Provider — hard "must-keep" requirements only.
    // (Skipped in the relaxed "near-miss" pass used when nothing survives.)
    for (const c of opts.ignoreProviderConstraints ? [] : profile.providerConstraints) {
      if (!c.hardRequirement) continue;
      const sysOk = c.systemId ? !!network?.systemIds.includes(c.systemId) : true;
      const provOk = c.providerId ? !!network?.providerIds.includes(c.providerId) : true;
      if (!sysOk || !provOk) {
        const name = c.systemId
          ? ctx.systemsById.get(c.systemId)?.name ?? c.systemId
          : c.providerId ?? "required provider";
        entries.push({
          planId: plan.id,
          reason: "provider_out_of_network",
          severity: "exclude",
          detail: `drops required ${name} access`,
        });
      }
    }

    // 3. Medications off-formulary — exclude if critical, else flag.
    const formulary = ctx.formularies.get(plan.formularyId);
    for (const med of profile.medications) {
      if (!med.drugId) continue; // can't check an unnormalized med
      const entry = formulary?.entries.find((e) => e.drugId === med.drugId);
      if (entry?.covered === true) continue;
      const drug = ctx.drugsById.get(med.drugId);
      const critical = drug ? CRITICAL_DRUG_CLASSES.has(drug.therapeuticClass) : false;
      entries.push({
        planId: plan.id,
        reason: "medication_off_formulary",
        severity: critical ? "exclude" : "flag",
        detail: `${med.name ?? med.raw} not on formulary${critical ? " (critical medication)" : ""}`,
      });
    }

    if (entries.some((e) => e.severity === "exclude")) {
      // Excluded — keep only the disqualifying reasons.
      const excludeEntries = entries.filter((e) => e.severity === "exclude");
      log.push(...excludeEntries);
      excludedPlanIds.push(plan.id);
    } else {
      // Survives — carry any flags forward.
      log.push(...entries);
      survivingPlanIds.push(plan.id);
    }
  }

  return { survivingPlanIds, excludedPlanIds, log };
}
