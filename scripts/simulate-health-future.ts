/**
 * Exercise the AI health-future projection end to end. Run:
 *   npm run sim:health-future
 *
 * Requires ANTHROPIC_API_KEY (the feature is opt-in). Without it, the script
 * prints how to enable it and exits 0 — it is NOT part of `npm test`, since it
 * makes a live API call and is outside the deterministic engine.
 *
 * The deterministic backbone it reasons over is seeded/reproducible; the AI
 * narrative is interpretive and intentionally not part of the audit record.
 */

import { getDataStore } from "@/lib/data";
import { projectHealthFuture } from "@/lib/sim/healthFutureAgent";
import { simConfigured } from "@/lib/sim/env";

const pct = (n: number) => Math.round(n * 100) + "%";

async function main() {
  if (!simConfigured()) {
    console.log("ANTHROPIC_API_KEY is not set — the health-future sim is opt-in.");
    console.log("Set it in .env.local (see .env.example) and re-run: npm run sim:health-future");
    process.exit(0);
  }

  const db = getDataStore();
  const [drugs, profiles] = await Promise.all([db.listDrugs(), db.listExampleProfiles()]);
  const profile = profiles.find((p) => p.id === "profile-diabetic-specialist") ?? profiles[0];

  console.log(`\nProjecting health future for: ${profile.id}`);
  console.log(`  age ${profile.age} · conditions: ${profile.conditions.join(", ") || "none"}`);

  const result = await projectHealthFuture(profile, drugs);

  console.log(`\nModel: ${result.model}  ·  backbone: ${result.engineVersion} / ${result.dataVersion}`);
  console.log(`Caveat: ${result.projection.overallCaveat}\n`);

  for (const h of result.projection.horizons.sort((a, b) => a.years - b.years)) {
    const det = result.deterministic.find((d) => d.years === h.years);
    console.log("─".repeat(72));
    console.log(`${h.years}-YEAR HORIZON  ·  confidence: ${h.confidence}`);
    if (det) {
      console.log(
        `  deterministic: stable ${pct(det.stableRate)} · severe ${pct(det.severeRate)} · ` +
          `mean complexity ${det.meanComplexity}`,
      );
    }
    console.log(`\n  ${h.headline}`);
    console.log(`  ${h.narrative}\n`);
    console.log("  Watch for:");
    for (const w of h.watchItems) {
      console.log(`   • ${w.event} — ${w.rationale}`);
      console.log(`      grounded in: ${w.groundedIn}`);
    }
    console.log(`\n  Care outlook: ${h.careOutlook}`);
    if (h.planConsiderations.length) {
      console.log("  Plan considerations (not a recommendation):");
      for (const c of h.planConsiderations) console.log(`   • ${c}`);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error("\n✗ " + (e as Error).message);
  process.exit(1);
});
