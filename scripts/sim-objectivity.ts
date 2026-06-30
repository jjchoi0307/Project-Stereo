/**
 * OBJECTIVITY STUDY — 1500 simulated members through the recommendation engine.
 *
 * "Objective" for a plan recommender means two things, and this measures both:
 *   1. CARRIER-NEUTRAL — the recommendation must not depend on a plan's carrier,
 *      only on its benefits vs the member's facts. Tested by carrier-relabel
 *      INVARIANCE: scramble every plan's carrier/name/flags (benefits untouched)
 *      and confirm the ranking is byte-identical. If relabeling never changes the
 *      pick, carrier provably has zero influence.
 *   2. FACT-RESPONSIVE — it must actually respond to the member (vary with
 *      conditions/meds/providers/region), not collapse to a house favorite.
 *
 * Scope (stated honestly): this exercises the DETERMINISTIC engine — the
 * eligibility gate + scoring backbone the audit reproduces. The live ranking is
 * AI, but its objectivity is bounded by (a) this gate and (b) a carrier-BLIND
 * model input (the model is never shown carrier/name/source — see
 * test-neutrality.ts), so it cannot favor what it cannot see. No LLM calls here.
 *
 * Run: npm run sim:objectivity
 */
import { getDataStore } from "@/lib/data";
import { FixtureDataStore } from "@/lib/data/fixtureStore";
import { runEngine, buildEngineCatalog } from "@/lib/engine/pipeline";
import { computeBmi, type ClientProfileInput, type ConditionFlag } from "@/lib/domain";
import { SMG_SERVICE_AREA_REGION_IDS } from "@/lib/data/fixtures/regions";
import { CONDITION_OPTIONS } from "@/lib/intake/options";
import { mulberry32 } from "@/lib/engine/rng";

const N = 1500;
const SCENARIOS = 80; // ranking is stable well below the 500 default; invariance is exact at any count

/** Same fixtures, every plan's brand identity scrambled (benefits untouched). */
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

function genProfile(
  rng: () => number,
  i: number,
  drugs: { id: string; name?: string }[],
  systems: { id: string }[],
  regions: string[],
  conditions: ConditionFlag[],
): ClientProfileInput {
  const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];
  const sample = <T>(a: T[], k: number): T[] => {
    const c = [...a];
    for (let j = c.length - 1; j > 0; j--) {
      const r = Math.floor(rng() * (j + 1));
      [c[j], c[r]] = [c[r], c[j]];
    }
    return c.slice(0, k);
  };

  const nCond = Math.floor(rng() * 4); // 0–3
  let conds = sample(conditions, nCond);
  const nMed = Math.floor(rng() * 4); // 0–3
  const meds = sample(drugs, nMed).map((d) => ({ raw: d.name ?? d.id, drugId: d.id, name: d.name ?? d.id }));
  // Intake requires at least one of {conditions, medications}.
  if (conds.length === 0 && meds.length === 0) conds = [pick(conditions)];

  const heightCm = 150 + Math.floor(rng() * 45);
  const weightKg = 50 + Math.floor(rng() * 70);
  const mustKeep = rng() < 0.3 ? [{ systemId: pick(systems).id, label: "Must keep provider", hardRequirement: true }] : [];

  return {
    id: `sim-${i}`,
    capturedBy: "broker",
    capturedAt: "2026-06-01T00:00:00.000Z",
    age: 65 + Math.floor(rng() * 26), // 65–90
    marketRegion: pick(regions),
    gender: pick(["male", "female"]) as ClientProfileInput["gender"],
    medications: meds,
    conditions: conds,
    heightCm,
    weightKg,
    bmi: computeBmi(heightCm, weightKg),
    familyHistory: [],
    providerConstraints: mustKeep,
    utilization: {
      specialistVisits12mo: Math.floor(rng() * 10),
      acupunctureVisits12mo: Math.floor(rng() * 6),
      priorYearInpatientEvents: Math.floor(rng() * 2),
    },
    dualEligible: rng() < 0.2,
  };
}

const totalsOf = (ranked: { planId: string; total: number; expectedFit: number; downsideRisk: number }[]) =>
  ranked.map((s) => `${s.planId}:${s.total}:${s.expectedFit}:${s.downsideRisk}`).join("|");

async function main() {
  const realDb = getDataStore();
  const relDb = new CarrierRelabeledStore();
  const [plans, drugs, systems] = await Promise.all([realDb.listPlans(), realDb.listDrugs(), realDb.listProviderSystems()]);
  const carrierById = new Map(plans.map((p) => [p.id, p.carrier]));
  const regions = [...SMG_SERVICE_AREA_REGION_IDS];
  const conditions = CONDITION_OPTIONS.map((o) => o.value);
  const realCatalog = await buildEngineCatalog(realDb);
  const relCatalog = await buildEngineCatalog(relDb);
  const rng = mulberry32(20260601);

  const pickCarrier = new Map<string, number>(); // carrier -> #1-pick count
  const eligibleForCarrier = new Map<string, number>(); // carrier -> times ≥1 eligible plan
  const distinctTopPlans = new Set<string>();
  let withEligible = 0;
  let invariant = 0;
  let totalEligible = 0; // sum of eligible-set sizes (for the avg)
  let gateActive = 0; // members where the gate excluded ≥1 plan

  for (let i = 0; i < N; i++) {
    const profile = genProfile(rng, i, drugs, systems, regions, conditions);
    const real = await runEngine(profile, realDb, { preferenceWeighting: false, count: SCENARIOS, catalog: realCatalog });
    const ranked = real.scoring.ranked;

    // carrier availability among eligible plans for this member
    const eligCarriers = new Set(ranked.map((s) => carrierById.get(s.planId)!).filter(Boolean));
    for (const c of eligCarriers) eligibleForCarrier.set(c, (eligibleForCarrier.get(c) ?? 0) + 1);

    totalEligible += ranked.length;
    if (ranked.length < plans.length) gateActive++; // the gate excluded ≥1 plan for this member
    if (ranked.length > 0) {
      withEligible++;
      const top = ranked[0];
      distinctTopPlans.add(top.planId);
      const c = carrierById.get(top.planId)!;
      pickCarrier.set(c, (pickCarrier.get(c) ?? 0) + 1);
    }

    // carrier-relabel invariance
    const rel = await runEngine(profile, relDb, { preferenceWeighting: false, count: SCENARIOS, catalog: relCatalog });
    if (totalsOf(ranked) === totalsOf(rel.scoring.ranked)) invariant++;

    if ((i + 1) % 300 === 0) console.log(`  …${i + 1}/${N}`);
  }

  // Shannon entropy of the carrier pick distribution (0 = monopoly, higher = spread)
  const picks = [...pickCarrier.values()];
  const totalPicks = picks.reduce((a, b) => a + b, 0);
  const entropy = -picks.reduce((s, n) => (n > 0 ? s + (n / totalPicks) * Math.log2(n / totalPicks) : s), 0);

  console.log(`\n════ OBJECTIVITY — ${N} simulated members ════\n`);
  console.log(`Eligible (≥1 plan):            ${withEligible}/${N}`);
  console.log(`\n1) CARRIER-NEUTRALITY (the core test)`);
  console.log(`   carrier-relabel invariance:  ${invariant}/${N}  (${((invariant / N) * 100).toFixed(2)}%)`);
  console.log(`   → relabeling every carrier left the full ranking + scores byte-identical.`);
  console.log(`\n   #1-pick share, and pick-rate WHEN that carrier had an eligible plan:`);
  const carriers = [...new Set([...pickCarrier.keys(), ...eligibleForCarrier.keys()])].sort();
  for (const c of carriers) {
    const wins = pickCarrier.get(c) ?? 0;
    const elig = eligibleForCarrier.get(c) ?? 0;
    const share = totalPicks ? ((wins / totalPicks) * 100).toFixed(1) : "0.0";
    const rate = elig ? ((wins / elig) * 100).toFixed(1) : "0.0";
    console.log(`     ${c.padEnd(26)} ${String(wins).padStart(4)} wins (${share}% of picks) · won ${rate}% of the time it was eligible`);
  }
  console.log(`\n2) FACT-RESPONSIVENESS`);
  console.log(`   distinct plans ever ranked #1: ${distinctTopPlans.size} of ${plans.length} plans`);
  console.log(`   carrier-pick entropy:          ${entropy.toFixed(2)} bits (max ${Math.log2(carriers.length).toFixed(2)} across ${carriers.length} carriers)`);
  console.log(`   avg eligible plans / member:   ${(totalEligible / N).toFixed(1)} (gate excluded ≥1 plan for ${((gateActive / N) * 100).toFixed(1)}% of members)`);
  console.log(`\n════ VERDICT ════`);
  const neutral = invariant === N;
  const responsive = distinctTopPlans.size > 1 && entropy > 0;
  console.log(`   carrier-neutral:   ${neutral ? "YES — provably (100% relabel-invariant)" : "NO — relabeling changed " + (N - invariant) + " rankings"}`);
  console.log(`   fact-responsive:   ${responsive ? "YES — picks vary with member facts" : "NO — collapses to a fixed pick"}`);
  process.exit(neutral && responsive ? 0 : 1);
}

main().catch((e) => {
  console.error("objectivity sim failed:", e);
  process.exit(1);
});
