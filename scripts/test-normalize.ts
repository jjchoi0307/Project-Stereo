/**
 * Normalization checks against the example profiles. Run: npm run test:normalize
 * Verifies markers land in the expected bands and that every marker carries a trace.
 */

import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import type { NormalizedProfile, RiskBand } from "@/lib/domain";

const order: (keyof Omit<NormalizedProfile, "profileId">)[] = [
  "diabetes", "oncologyRisk", "specialistNeed",
  "drugUtilizationIntensity", "mentalHealthUtilization", "networkSensitivity",
];

const RANK: Record<RiskBand, number> = { low: 0, moderate: 1, high: 2, very_high: 3 };

async function main() {
  const db = getDataStore();
  const drugs = await db.listDrugs();
  const profiles = await db.listExampleProfiles();
  const errors: string[] = [];
  const expect = (cond: boolean, msg: string) => !cond && errors.push(msg);

  for (const profile of profiles) {
    const n = normalizeProfile(profile, drugs);
    console.log(`\n${profile.id}`);
    for (const k of order) {
      const m = n[k];
      console.log(`  ${k.padEnd(26)} ${String(Math.round(m.value * 100)).padStart(3)}  ${m.band}`);
      expect(m.trace.length > 0, `${profile.id}.${k}: empty trace`);
    }

    if (profile.id === "profile-diabetic-specialist") {
      expect(RANK[n.diabetes.band] >= RANK.high, "diabetic profile: diabetes should be high+");
      expect(RANK[n.specialistNeed.band] >= RANK.moderate, "diabetic profile: specialist need should be moderate+");
      expect(n.networkSensitivity.band === "low", "diabetic profile: network sensitivity should be low (no hard constraints)");
    }
    if (profile.id === "profile-ucla-required") {
      expect(RANK[n.networkSensitivity.band] >= RANK.high, "UCLA profile: network sensitivity should be high+");
      expect(n.diabetes.band === "low", "UCLA profile: diabetes should be low");
    }
  }

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ normalization produces expected bands with full traces.");
}

main();
