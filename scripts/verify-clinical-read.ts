/**
 * Manual verification: run the AI clinical read end-to-end against the live API
 * and print the markers + futures + latency. Run with:
 *   set -a && . ./.env.local && set +a && \
 *     node --conditions=react-server --import tsx scripts/verify-clinical-read.ts
 */
import { aiClinicalRead } from "@/lib/ai/clinicalRead";
import type { ClientProfileInput } from "@/lib/domain";

async function main() {
  const profile: ClientProfileInput = {
    id: "profile-clinical-verify-1",
    capturedBy: "broker",
    capturedAt: "2026-06-24T00:00:00.000Z",
    age: 72,
    marketRegion: "region-1",
    gender: "female",
    medications: [
      { raw: "metformin 500mg", name: "metformin" },
      { raw: "atorvastatin", name: "atorvastatin" },
    ],
    conditions: ["diabetes", "hypertension", "hyperlipidemia"],
    familyHistory: [
      { condition: "cad", status: "yes", affectedRelativesCount: 1 },
      { condition: "cancer_history", status: "yes" },
    ],
    providerConstraints: [],
    utilization: { specialistVisits12mo: 4, priorYearInpatientEvents: 0 },
  };

  const t0 = Date.now();
  const read = await aiClinicalRead(profile);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nModel: ${read.model} — ${secs}s\n`);

  console.log("RISK MARKERS:");
  for (const m of read.markers) {
    console.log(`  · ${m.label} [${m.band} ${m.score}] (${m.key})`);
    console.log(`      why: ${m.why}`);
  }

  console.log("\nHEALTH FUTURES:");
  for (const h of read.futures.horizons) {
    console.log(`  ${h.years}-year — ${h.outlook.toUpperCase()} — ${h.headline}`);
    console.log(`      ${h.summary}`);
  }
  console.log("\n  Outcomes:");
  for (const o of read.futures.outcomes) {
    console.log(`    · [${o.likelihood}] ${o.label} — ${o.why}`);
  }
  console.log(`\n  Caveat: ${read.futures.caveat}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
