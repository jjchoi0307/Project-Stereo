/**
 * Fixture integrity + brief-requirement checks. Run: npm run validate:fixtures
 *
 * Verifies the synthetic data is internally consistent (every reference
 * resolves) and that it can demonstrate the paths the brief calls for
 * (UCLA in/out of network, off-formulary metformin, SMG/SCAN flags, competitors,
 * the two example profiles).
 */

import { getDataStore } from "@/lib/data";
import { SMG_SERVICE_AREA_REGION_IDS } from "@/lib/data/fixtures/regions";

async function main() {
  const db = getDataStore();
  const [plans, regions, providers, systems, drugs, profiles] = await Promise.all([
    db.listPlans(),
    db.listRegions(),
    db.listProviders(),
    db.listProviderSystems(),
    db.listDrugs(),
    db.listExampleProfiles(),
  ]);

  const errors: string[] = [];
  const note = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };

  const regionIds = new Set(regions.map((r) => r.id));
  const systemIds = new Set(systems.map((s) => s.id));
  const providerIds = new Set(providers.map((p) => p.id));
  const drugIds = new Set(drugs.map((d) => d.id));

  // Referential integrity ----------------------------------------------------
  for (const p of providers) {
    if (p.systemId) note(systemIds.has(p.systemId), `provider ${p.id}: bad systemId ${p.systemId}`);
    for (const r of p.regionIds) note(regionIds.has(r), `provider ${p.id}: bad regionId ${r}`);
  }

  const uclaPlans: string[] = [];
  for (const plan of plans) {
    const net = await db.getNetwork(plan.networkId);
    note(!!net, `plan ${plan.id}: bad networkId ${plan.networkId}`);
    const form = await db.getFormulary(plan.formularyId);
    note(!!form, `plan ${plan.id}: bad formularyId ${plan.formularyId}`);
    for (const r of plan.regionsAvailable) note(regionIds.has(r), `plan ${plan.id}: bad region ${r}`);
    if (net) {
      for (const s of net.systemIds) note(systemIds.has(s), `network ${net.id}: bad systemId ${s}`);
      for (const pr of net.providerIds) note(providerIds.has(pr), `network ${net.id}: bad providerId ${pr}`);
      if (net.systemIds.includes("sys-ucla")) uclaPlans.push(plan.id);
    }
    if (form) {
      for (const e of form.entries) note(drugIds.has(e.drugId), `formulary ${form.id}: bad drugId ${e.drugId}`);
    }
  }

  // Real-data requirements ----------------------------------------------------
  // The dataset is the real 2026 SMG-supported universe (see lib/data/source/).
  note(plans.length >= 40, `expected the full 2026 plan set, found ${plans.length}`);
  note(uclaPlans.length >= 1, "need at least one plan WITH UCLA access (UHC UCLA Health MA)");
  note(plans.length - uclaPlans.length >= 1, "need at least one plan WITHOUT UCLA access");
  note(plans.some((p) => p.isScan && p.smgSupported), "need a SCAN plan flagged smgSupported");
  note(plans.every((p) => p.smgSupported), "every plan in the SMG folder must be smgSupported");
  note(!plans.some((p) => p.isCompetitor), "no plan should be flagged isCompetitor (all are SMG-supported)");

  // All five real carriers present.
  for (const carrier of ["Alignment Health Plan", "Clever Care Health Plan", "Anthem Blue Cross", "UnitedHealthcare", "SCAN Health Plan"]) {
    note(plans.some((p) => p.carrier === carrier), `missing carrier: ${carrier}`);
  }

  // SNP coverage exists (C-SNP and D-SNP both represented).
  note(plans.some((p) => p.snpType === "C-SNP"), "expected at least one C-SNP plan");
  note(plans.some((p) => p.snpType === "D-SNP"), "expected at least one D-SNP plan");

  // Provenance: every plan carries a dataSource and maps its counties to regions.
  for (const p of plans) {
    note(!!p.dataSource, `plan ${p.id}: missing dataSource`);
    note(p.counties.length > 0, `plan ${p.id}: no counties listed`);
    note(p.regionsAvailable.length > 0, `plan ${p.id}: counties did not map to any region`);
  }

  // SMG service area — the broker can only place clients here, so each SMG region
  // must resolve to a real region and have at least one available plan.
  const smgRegionIds = [...SMG_SERVICE_AREA_REGION_IDS];
  for (const rid of smgRegionIds) {
    note(regionIds.has(rid), `SMG service region ${rid} is not a defined region`);
    note(plans.some((p) => p.regionsAvailable.includes(rid)), `no plan available in SMG region ${rid}`);
  }
  const smgReachable = plans.filter((p) => p.regionsAvailable.some((r) => SMG_SERVICE_AREA_REGION_IDS.has(r)));
  note(smgReachable.length >= 10, `expected a healthy set of SMG-reachable plans, found ${smgReachable.length}`);

  // example profiles
  note(!!profiles.find((p) => p.id === "profile-diabetic-specialist"), "missing diabetic example profile");
  note(!!profiles.find((p) => p.id === "profile-ucla-required"), "missing UCLA-required example profile");
  for (const prof of profiles) {
    note(regionIds.has(prof.marketRegion), `profile ${prof.id}: bad marketRegion ${prof.marketRegion}`);
    for (const m of prof.medications) {
      if (m.drugId) note(drugIds.has(m.drugId), `profile ${prof.id}: bad med drugId ${m.drugId}`);
    }
    for (const c of prof.providerConstraints) {
      if (c.systemId) note(systemIds.has(c.systemId), `profile ${prof.id}: bad constraint systemId ${c.systemId}`);
    }
  }

  // Report --------------------------------------------------------------------
  console.log(`Plans: ${plans.length}  |  UCLA-access plans: ${uclaPlans.length}  |  ` +
    `SMG-supported: ${plans.filter((p) => p.smgSupported).length}  |  ` +
    `competitors: ${plans.filter((p) => p.isCompetitor).length}`);
  console.log(`Regions: ${regions.length}  Providers: ${providers.length}  ` +
    `Systems: ${systems.length}  Drugs: ${drugs.length}  Example profiles: ${profiles.length}`);
  console.log(`SMG service area: ${[...SMG_SERVICE_AREA_REGION_IDS].join(", ")}  |  ` +
    `SMG-reachable plans: ${plans.filter((p) => p.regionsAvailable.some((r) => SMG_SERVICE_AREA_REGION_IDS.has(r))).length}/${plans.length}`);

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ fixtures valid and brief-complete.");
}

main();
