/**
 * De-identification boundary checks. Run: npm run test:deidentify
 *
 * The AI health-future projection is the only thing that sends client data off
 * the server, and it must send CLINICAL FACTS ONLY (lib/sim/deidentify.ts). This
 * test plants identity sentinels in every identity field and asserts none of
 * them survive into the payload — a whitelist guard against future leaks.
 */

import { deidentifyForSim } from "@/lib/sim/deidentify";
import type { ClientProfileInput } from "@/lib/domain";

const ALLOWED_KEYS = new Set([
  "age",
  "conditions",
  // conditionsFreeText is intentionally NOT allowed: de-identify DROPS the
  // free-text field (it can carry identifiers), and the test enforces that drop.
  "medications",
  "heightCm",
  "weightKg",
  "bmi",
  "familyHistory",
  "utilization",
  // lifestyle: measurable self-reported markers (steps, sleep, self-rated health) —
  // clinical/aggregate facts, no identifiers; feeds the projection only.
  "lifestyle",
]);

async function main() {
  const errors: string[] = [];
  const expect = (c: boolean, m: string) => !c && errors.push(m);

  // Every identity field carries a distinctive sentinel we can search for.
  const profile: ClientProfileInput = {
    id: "profile-IDENTITYSENTINEL",
    capturedBy: "patient",
    capturedAt: "2026-01-02T03:04:05.000Z",
    age: 67,
    marketRegion: "reg-REGIONSENTINEL",
    gender: "female",
    zip: "ZIPSENTINEL",
    county: "COUNTYSENTINEL",
    medications: [{ raw: "Lipitor 80mg RAWMEDSENTINEL", drugId: "rx-atorvastatin", name: "atorvastatin" }],
    conditions: ["diabetes", "hypertension"],
    conditionsFreeText: ["mild neuropathy FREETEXTSENTINEL"],
    heightCm: 170,
    weightKg: 95,
    bmi: 32.9,
    familyHistory: [{ condition: "diabetes", status: "yes", affectedRelativesCount: 2 }],
    providerConstraints: [{ systemId: "sys-PROVIDERSENTINEL", label: "Must keep Dr. NAMESENTINEL", hardRequirement: true }],
    utilization: { specialistVisits12mo: 6, acupunctureVisits12mo: 4, priorYearInpatientEvents: 0 },
    fieldProvenance: { age: "patient" },
  };

  const out = deidentifyForSim(profile);
  const json = JSON.stringify(out);

  // No identity sentinel may survive.
  const sentinels = [
    "IDENTITYSENTINEL", "REGIONSENTINEL", "ZIPSENTINEL", "COUNTYSENTINEL",
    "RAWMEDSENTINEL", "PROVIDERSENTINEL", "NAMESENTINEL", "2026-01-02", "female",
    "FREETEXTSENTINEL",
  ];
  for (const s of sentinels) {
    expect(!json.includes(s), `identity value "${s}" leaked into the de-identified payload`);
  }

  // Only whitelisted keys may appear.
  for (const k of Object.keys(out)) {
    expect(ALLOWED_KEYS.has(k), `unexpected key "${k}" in de-identified payload`);
  }

  // Clinical facts must be preserved.
  expect(out.age === 67, "age should be preserved");
  expect(out.conditions.includes("diabetes"), "conditions should be preserved");
  expect(out.medications.includes("atorvastatin"), "medication name should be preserved");
  expect(out.bmi === 32.9, "bmi should be preserved");
  expect(out.familyHistory.length === 1, "family history should be preserved");

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("✓ de-identification leaks no identity fields; clinical facts preserved.");
}

main();
