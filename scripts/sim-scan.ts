/**
 * Honest SCAN win-rate sweep. Generates a broad, neutral set of synthetic
 * patients and runs each through the REAL engine (same code the app uses).
 * Counts how often a SCAN plan is the #1 recommendation — both with the
 * product's bounded preference weighting ON and with pure fit (OFF).
 *
 * Nothing here favors SCAN: provider must-keeps are spread evenly across ALL
 * systems, ~half of patients have none, and conditions/meds/region/age are
 * sampled uniformly. The pure-fit (preference OFF) numbers are the fact-based proof.
 *
 * Run: npx tsx scripts/sim-scan.ts
 */
import { getDataStore } from "@/lib/data";
import { buildEngineCatalog, runEngine } from "@/lib/engine/pipeline";
import { toProfileInput } from "@/lib/intake/toProfile";
import { drugs as DRUGS, providerSystems as SYSTEMS } from "@/lib/data/fixtures";
import { emptyIntakeValues, type IntakeFormValues } from "@/lib/intake/types";
import type { ConditionFlag } from "@/lib/domain";

// Deterministic RNG so the sweep is reproducible.
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(Number(process.env.SEED) || 20260624);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
const chance = (p: number) => rnd() < p;

const REGIONS = ["reg-la", "reg-oc", "reg-santaclara"];
const AGES = [66, 68, 70, 72, 74, 76, 78, 80, 83];
// Even spread across every provider system; "none" weighted ~50% (realistic — most
// clients don't hard-require a system). No system here advantages SCAN.
const SYSTEM_IDS = SYSTEMS.map((s) => s.id);

const COND_SETS: ConditionFlag[][] = [
  ["diabetes", "hypertension", "hyperlipidemia"],
  ["hypertension"],
  ["diabetes", "ckd"],
  ["copd"],
  ["chf", "cad", "hypertension"],
  ["cancer_active"],
  ["cancer_history", "hypertension"],
  ["depression", "anxiety"],
  ["osteoarthritis", "obesity"],
  ["sleep_disorder"],
  ["diabetes", "hypertension", "hyperlipidemia", "cad", "ckd"],
  [],
];
const MED_FOR: Partial<Record<ConditionFlag, string[]>> = {
  diabetes: ["Metformin", "Empagliflozin", "Insulin glargine"],
  hypertension: ["Lisinopril"],
  hyperlipidemia: ["Atorvastatin"],
  depression: ["Sertraline"],
  anxiety: ["Sertraline"],
  sleep_disorder: ["Zolpidem"],
  copd: ["Albuterol"],
  chf: ["Lisinopril"],
  cancer_active: ["Pembrolizumab"],
};

function makeValues(): IntakeFormValues {
  const v = emptyIntakeValues();
  v.age = String(pick(AGES));
  v.marketRegion = pick(REGIONS);
  v.gender = chance(0.5) ? "female" : "male";
  const conds = pick(COND_SETS);
  v.conditions = conds;
  const meds = new Set<string>();
  for (const c of conds) for (const m of MED_FOR[c] ?? []) if (chance(0.7)) meds.add(m);
  v.medications = meds.size ? [...meds] : [""];
  // ~50% no hard provider requirement; otherwise one system chosen uniformly.
  if (chance(0.5)) v.mustKeepSystemIds = [pick(SYSTEM_IDS)];
  v.heightCm = String(160 + Math.floor(rnd() * 25));
  v.weightKg = String(60 + Math.floor(rnd() * 45));
  v.specialistVisits12mo = String(Math.floor(rnd() * 5));
  v.acupunctureVisits12mo = chance(0.3) ? String(Math.floor(rnd() * 12)) : "0";
  v.priorYearInpatientEvents = chance(0.15) ? "1" : "0";
  return v;
}

async function main() {
  const N = Number(process.env.N) || 500;
  const COUNT = Number(process.env.COUNT) || 300; // sim scenarios per run
  const db = getDataStore();
  const catalog = await buildEngineCatalog(db);
  const planById = new Map(catalog.plans.map((p) => [p.id, p]));

  type Tally = {
    top1Scan: number; top3Scan: number; eligScan: number;
    noneEligible: number; carrierTop1: Record<string, number>;
  };
  const fresh = (): Tally => ({ top1Scan: 0, top3Scan: 0, eligScan: 0, noneEligible: 0, carrierTop1: {} });
  const on = fresh(), off = fresh();
  const scanTop1Plans: Record<string, number> = {};

  for (let i = 0; i < N; i++) {
    const profile = toProfileInput(makeValues(), {
      profileId: `sim-${i}`, capturedBy: "broker", drugs: DRUGS, providerSystems: SYSTEMS,
    });
    for (const [pref, t] of [["on", on], ["off", off]] as const) {
      const { scoring } = await runEngine(profile, db, {
        preferenceWeighting: pref === "on", count: COUNT, catalog,
      });
      const ranked = scoring.ranked;
      if (!ranked.length) { t.noneEligible++; continue; }
      const top = planById.get(ranked[0].planId)!;
      t.carrierTop1[top.carrier] = (t.carrierTop1[top.carrier] ?? 0) + 1;
      if (top.isScan) { t.top1Scan++; if (pref === "off") scanTop1Plans[top.name] = (scanTop1Plans[top.name] ?? 0) + 1; }
      if (ranked.slice(0, 3).some((r) => planById.get(r.planId)?.isScan)) t.top3Scan++;
      if (ranked.some((r) => planById.get(r.planId)?.isScan)) t.eligScan++;
    }
  }

  const pctn = (n: number) => `${n} (${((100 * n) / N).toFixed(1)}%)`;
  const report = (label: string, t: Tally) => {
    console.log(`\n── ${label} ──`);
    console.log(`  SCAN is #1 recommendation : ${pctn(t.top1Scan)}`);
    console.log(`  SCAN in top 3             : ${pctn(t.top3Scan)}`);
    console.log(`  SCAN eligible (any rank)  : ${pctn(t.eligScan)}`);
    console.log(`  no eligible plan          : ${pctn(t.noneEligible)}`);
    const carriers = Object.entries(t.carrierTop1).sort((a, b) => b[1] - a[1]);
    console.log(`  #1 by carrier:`);
    for (const [c, n] of carriers) console.log(`     ${c.padEnd(26)} ${pctn(n)}`);
  };

  console.log(`SCAN win-rate sweep — ${N} synthetic patients · ${COUNT} sim scenarios/run · seed 20260624`);
  console.log(`Methodology: age/region/conditions/meds sampled uniformly; provider must-keep`);
  console.log(`spread evenly across all ${SYSTEM_IDS.length} systems with ~50% having none. Nothing favors SCAN.`);
  report("Preference weighting ON (product default: bounded +1 SCAN tiebreak, logged)", on);
  report("Preference weighting OFF (PURE FIT — the fact-based proof)", off);
  console.log(`\nWhich SCAN plans win #1 on pure fit:`);
  for (const [name, n] of Object.entries(scanTop1Plans).sort((a, b) => b[1] - a[1]))
    console.log(`  ${name.padEnd(40)} ${n}`);
}

main();
