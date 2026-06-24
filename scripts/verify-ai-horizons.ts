/**
 * Manual verification of the AI across-horizon recommendation (5y/10y).
 *   node --conditions=react-server --import tsx scripts/verify-ai-horizons.ts
 */
import { getDataStore } from "@/lib/data";
import { recommendHorizons } from "@/lib/ai/horizonRecommend";
import type { ClientProfileInput } from "@/lib/domain";

async function main() {
  const db = getDataStore();
  const regions = await db.listRegions();
  const profile: ClientProfileInput = {
    id: "profile-verify-h",
    capturedBy: "broker",
    capturedAt: "2026-06-24T00:00:00.000Z",
    age: 68,
    marketRegion: regions[0].id,
    gender: "male",
    medications: [{ raw: "metformin", name: "metformin" }],
    conditions: ["prediabetes", "hypertension"],
    familyHistory: [{ condition: "diabetes", status: "yes", affectedRelativesCount: 1 }],
    providerConstraints: [],
    utilization: { specialistVisits12mo: 2 },
  };

  const t0 = Date.now();
  const rec = await recommendHorizons(profile, db, null);
  console.log(`Model ${rec.model} — ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  for (const h of rec.horizons) {
    console.log(`=== ${h.years} years ===`);
    console.log(`Projection: ${h.projection.headline}`);
    console.log(`  ${h.projection.summary}`);
    console.log(`  +conditions: ${h.projection.conditions.map((c) => `${c.label}(${c.likelihood})`).join(", ") || "—"}`);
    console.log(`  +meds: ${h.projection.medications.map((m) => `${m.name}(${m.likelihood})`).join(", ") || "—"}`);
    if (h.recommended) {
      console.log(`Recommended: ${h.recommended.planId} fit=${h.recommended.fitScore} conf=${h.recommended.confidence}`);
      for (const r of h.recommended.reasons) {
        console.log(`   ${r.positive ? "✓" : "⚑"} ${r.text}${r.citation ? `  [${r.citation.sourceFile} p.${r.citation.sourcePage}]` : "  (uncited)"}`);
      }
    } else console.log("Recommended: none");
    console.log("");
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
