/**
 * Scoring NEUTRALITY proof. Run: npm run test:neutrality
 *
 * A reviewer should be able to run this and confidently conclude the recommendation
 * is carrier-UNBIASED and grounded in facts. It proves three things:
 *
 *   A. CARRIER-BLIND MODEL INPUT — the live (AI) recommendation never receives a
 *      plan's carrier, brand name, source-file, or carrier-revealing planId. The
 *      model ranks/writes against opaque tokens, so it CANNOT favor a carrier.
 *   B. NO PREFERENCE APPLIED — the deterministic engine (audit backbone) adds zero
 *      carrier/SMG/SCAN preference; the `preferenceWeighting` flag is a no-op.
 *   C. CARRIER-INVARIANCE — relabeling every plan's carrier/name/flags (benefits
 *      unchanged) leaves the ranking and every score byte-identical.
 *
 * Offline + deterministic — no LLM call (it inspects the exact model INPUT and the
 * deterministic engine). Run via the server-only shim so the AI module can load.
 */
import { getDataStore } from "@/lib/data";
import { FixtureDataStore } from "@/lib/data/fixtureStore";
import { runEngine } from "@/lib/engine/pipeline";
import { buildPlanFactsPack } from "@/lib/ai/planFactsPack";
import { screenPack, deepFactsForModel } from "@/lib/ai/recommend";
import type { DataStore } from "@/lib/data";

/** Same fixtures, but every plan's brand identity scrambled (benefits untouched). */
class CarrierRelabeledStore extends FixtureDataStore {
  async listPlans() {
    const real = await super.listPlans();
    return real.map((p, i) => ({
      ...p,
      carrier: `Relabeled Carrier ${i % 3}`,
      name: `Relabeled Plan ${i}`,
      isScan: !p.isScan,
      smgSupported: !p.smgSupported,
      isCompetitor: !p.isCompetitor,
    }));
  }
}

async function main() {
  const errors: string[] = [];
  const expect = (cond: boolean, msg: string) => !cond && errors.push(msg);

  const db = getDataStore();
  const profiles = await db.listExampleProfiles();
  const profile = profiles.find((p) => p.id === "profile-diabetic-specialist") ?? profiles[0];

  // ── A. The AI model input is carrier-blind ────────────────────────────────
  const pack = await buildPlanFactsPack(profile, db);
  const tokenById = new Map(pack.candidates.map((c, i) => [c.planId, `plan-${i + 1}`]));
  const modelInput =
    JSON.stringify(screenPack(pack.candidates, tokenById)) +
    "\n" +
    pack.candidates.map((c) => JSON.stringify(deepFactsForModel(c, tokenById.get(c.planId)!))).join("\n");

  for (const c of pack.candidates) {
    for (const ident of [c.planId, c.name, c.carrier, c.sourceFile]) {
      if (ident && modelInput.includes(ident)) {
        errors.push(`carrier identity "${ident}" leaked into the model input`);
      }
    }
  }
  // The opaque tokens MUST be what the model sees instead.
  expect(modelInput.includes("plan-1"), "model input should identify plans by opaque tokens");

  // ── B. Deterministic engine applies no preference ─────────────────────────
  const run = await runEngine(profile, db, { preferenceWeighting: true });
  expect(run.scoring.preferenceWeightingEnabled === false, "preferenceWeightingEnabled must always be false");
  expect(run.scoring.preferenceChangedTop === false, "preference must never change the top pick");
  for (const s of run.scoring.ranked) {
    expect(s.preferenceContribution === 0, `plan ${s.planId} has non-zero preferenceContribution`);
    expect(s.breakdown.preference === 0, `plan ${s.planId} has non-zero preference in breakdown`);
  }
  // The flag is a no-op: on vs off produce identical rankings.
  const off = await runEngine(profile, db, { preferenceWeighting: false });
  expect(
    JSON.stringify(run.scoring.ranked) === JSON.stringify(off.scoring.ranked),
    "preferenceWeighting must be a no-op (on === off)",
  );

  // ── C. Carrier-invariance: relabel carriers → identical ranking + scores ───
  const relabeled: DataStore = new CarrierRelabeledStore();
  const relRun = await runEngine(profile, relabeled, { preferenceWeighting: false });
  const totalsOf = (r: typeof run) => r.scoring.ranked.map((s) => `${s.planId}:${s.total}:${s.expectedFit}:${s.downsideRisk}`);
  expect(
    JSON.stringify(totalsOf(off)) === JSON.stringify(totalsOf(relRun)),
    "relabeling carriers/names/flags must NOT change the ranking or any score",
  );

  if (errors.length) {
    console.error(`\n✗ ${errors.length} neutrality problem(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(
    `✓ scoring is carrier-UNBIASED: model input is carrier-blind (${pack.candidates.length} plans, tokens only), ` +
      `deterministic engine applies zero preference, and relabeling carriers leaves the ranking byte-identical.`,
  );
}

main().catch((e) => {
  console.error("neutrality test failed:", e);
  process.exit(1);
});
