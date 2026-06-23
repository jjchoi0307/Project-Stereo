import { getDataStore } from "@/lib/data";
import { SMG_SERVICE_AREA_REGION_IDS } from "@/lib/data/fixtures/regions";
import { CONDITION_OPTIONS, FAMILY_HISTORY_CONDITIONS } from "./options";
import type { IntakeReference } from "./types";

/** Build the reference data the intake form needs, from the data layer. */
export async function getIntakeReference(): Promise<IntakeReference> {
  const db = getDataStore();
  const [regions, systems, drugs] = await Promise.all([
    db.listRegions(),
    db.listProviderSystems(),
    db.listDrugs(),
  ]);
  return {
    // Restrict to SMG's real service area — a broker can only place an SMG client
    // where SMG actually has affiliated providers (LA, Orange, Santa Clara).
    regions: regions
      .filter((r) => SMG_SERVICE_AREA_REGION_IDS.has(r.id))
      .map((r) => ({ id: r.id, name: r.name })),
    providerSystems: systems.map((s) => ({ id: s.id, name: s.name })),
    conditionOptions: CONDITION_OPTIONS,
    familyHistoryConditions: FAMILY_HISTORY_CONDITIONS,
    drugNames: drugs.map((d) => d.name),
  };
}
