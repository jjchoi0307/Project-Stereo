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
