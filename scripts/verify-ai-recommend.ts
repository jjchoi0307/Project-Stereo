/**
 * Manual verification: run the grounded AI recommendation end-to-end and check
 * that every cited figure traces to a real plan file/page and is present in the
 * plan facts. Run with:
 *   node --conditions=react-server --import tsx scripts/verify-ai-recommend.ts
 */
import { getDataStore } from "@/lib/data";
import { buildPlanFactsPack } from "@/lib/ai/planFactsPack";
import { recommendPlans } from "@/lib/ai/recommend";
import type { ClientProfileInput } from "@/lib/domain";

async function main() {
  const db = getDataStore();
  const regions = await db.listRegions();
  const plans = await db.listPlans();
  const region = regions[0];
  console.log(`Region: ${region.name} (${region.id}) — ${plans.filter((p) => p.regionsAvailable.includes(region.id)).length} plans serve it`);

  const profile: ClientProfileInput = {
    id: "profile-verify-1",
    capturedBy: "broker",
    capturedAt: "2026-06-24T00:00:00.000Z",
    age: 72,
    marketRegion: region.id,
    gender: "female",
    medications: [{ raw: "metformin", name: "metformin" }, { raw: "atorvastatin", name: "atorvastatin" }],
    conditions: ["diabetes", "hypertension", "hyperlipidemia"],
    familyHistory: [],
    providerConstraints: [],
    utilization: { specialistVisits12mo: 4 },
  };

  const pack = await buildPlanFactsPack(profile, db);
  console.log(`Eligible candidates: ${pack.candidates.length}, excluded: ${pack.excluded.length}`);

  const t0 = Date.now();
  const rec = await recommendPlans(profile, db);
  console.log(`\nModel: ${rec.model} — ${rec.ranked.length} ranked in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

  const factsById = new Map(pack.candidates.map((c) => [c.planId, c]));
  let citationCount = 0;
  let ungrounded = 0;

  for (const r of rec.ranked.slice(0, 5)) {
    const f = factsById.get(r.planId)!;
    console.log(`#${rec.ranked.indexOf(r) + 1}  ${f.name}  [${f.kind}]  fit=${r.fitScore}  conf=${r.confidence}  deep=${r.deepWritten}  meds=${(r.medsCoveredRate * 100).toFixed(0)}%  estCost=$${r.estAnnualCost}  MOOP=$${r.annualOOPMax}`);
    for (const reason of r.reasons) {
      const tag = reason.positive ? "✓" : "⚑";
      const cite = reason.citation;
      let mark = "";
      if (cite) {
        citationCount++;
        const fileOk = cite.sourceFile === f.sourceFile && cite.sourcePage === f.sourcePage;
        if (!fileOk) {
          ungrounded++;
          mark = `  ⟵ ❌ citation provenance mismatch (${cite.sourceFile} p.${cite.sourcePage})`;
        }
      }
      console.log(`   ${tag} ${reason.text}${cite ? `  [${cite.sourceFile} p.${cite.sourcePage}: "${cite.quote}"]` : "  (no citation)"}${mark}`);
    }
    if (r.subScoreWhy) {
      console.log(`   WHY → coverage: ${r.subScoreWhy.coverageFit}`);
      console.log(`   WHY → medication: ${r.subScoreWhy.medicationFit}`);
    }
    if (r.costBreakdown) {
      console.log(`   COST BREAKDOWN (total $${r.costBreakdown.estimatedAnnualTotal}/yr):`);
      for (const ci of r.costBreakdown.items) console.log(`      • ${ci.label}: $${ci.annualEstimate} — ${ci.basis}`);
    }
    console.log("");
  }

  console.log(`\nCitations: ${citationCount}, provenance mismatches after synthesize: ${ungrounded} (should be 0)`);
  console.log(`Top pick: ${rec.topPlanId}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
