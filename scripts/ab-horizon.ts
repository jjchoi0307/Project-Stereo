/**
 * Statistical-stability A/B for the horizon recommendation resolution.
 *
 * Question: can `recommendAcrossHorizons` use a LOWER resolution (fewer replicas
 * and scenarios) without changing the delivered recommendation?
 *
 * Method: build ~6 patients per realistic archetype (72 total, seeded RNG), and
 * for each profile compare a BASELINE config against one or more CANDIDATE configs.
 * Per horizon (5y, 10y) we measure top-pick agreement and the change in the
 * winner's winShare, and classify any disagreement as a near-tie vs a genuine flip.
 *
 * Measurement only — does NOT touch engine/config files.
 *
 * Run: npx tsx scripts/ab-horizon.ts
 */
import { getDataStore } from "@/lib/data";
import { recommendAcrossHorizons } from "@/lib/engine/horizonRecommendation";
import { toProfileInput } from "@/lib/intake/toProfile";
import { drugs as DRUGS, providerSystems as SYSTEMS } from "@/lib/data/fixtures";
import { emptyIntakeValues, type IntakeFormValues } from "@/lib/intake/types";

// ---- seeded RNG (same generator as sim-scan-segments.ts) -------------------
function mulberry32(seed: number) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(Number(process.env.SEED) || 20260624);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const ageR = (lo: number, hi: number) => String(lo + Math.floor(rnd() * (hi - lo + 1)));
const REGIONS = ["reg-la", "reg-oc", "reg-santaclara"];

function base(): IntakeFormValues {
  const v = emptyIntakeValues();
  v.marketRegion = pick(REGIONS);
  v.gender = chance(0.5) ? "female" : "male";
  v.heightCm = String(160 + Math.floor(rnd() * 25));
  v.weightKg = String(60 + Math.floor(rnd() * 45));
  return v;
}
const meds = (...m: string[]) => m.filter(() => chance(0.85));

// ---- 12 realistic archetype builders (copied from sim-scan-segments.ts) ----
interface Segment { name: string; build: () => IntakeFormValues }
const SEGMENTS: Segment[] = [
  { name: "Healthy active senior", build: () => {
      const v = base(); v.age = ageR(65, 72);
      v.conditions = chance(0.5) ? ["hypertension"] : [];
      v.medications = v.conditions.length ? meds("Lisinopril") : [""];
      v.specialistVisits12mo = String(Math.floor(rnd() * 2));
      return v; } },
  { name: "Cost-sensitive, minimal needs", build: () => {
      const v = base(); v.age = ageR(65, 70); v.conditions = []; v.medications = [""];
      v.specialistVisits12mo = "0"; return v; } },
  { name: "Well-controlled T2 diabetes", build: () => {
      const v = base(); v.age = ageR(66, 75);
      v.conditions = ["diabetes", "hypertension", "hyperlipidemia"];
      v.medications = meds("Metformin", "Lisinopril", "Atorvastatin");
      v.specialistVisits12mo = String(1 + Math.floor(rnd() * 2)); return v; } },
  { name: "Complex diabetes (insulin/CKD)", build: () => {
      const v = base(); v.age = ageR(68, 82);
      v.conditions = ["diabetes", "ckd", "hyperlipidemia"];
      v.medications = meds("Metformin", "Insulin glargine", "Empagliflozin", "Atorvastatin");
      v.specialistVisits12mo = String(2 + Math.floor(rnd() * 3));
      v.priorYearInpatientEvents = chance(0.25) ? "1" : "0"; return v; } },
  { name: "Cardiac (CHF / CAD)", build: () => {
      const v = base(); v.age = ageR(70, 85);
      v.conditions = ["chf", "cad", "hypertension"];
      v.medications = meds("Lisinopril", "Atorvastatin");
      v.specialistVisits12mo = String(2 + Math.floor(rnd() * 3));
      v.priorYearInpatientEvents = chance(0.35) ? "1" : "0"; return v; } },
  { name: "Active cancer treatment", build: () => {
      const v = base(); v.age = ageR(60, 82); v.conditions = ["cancer_active"];
      v.medications = meds("Pembrolizumab");
      v.specialistVisits12mo = String(3 + Math.floor(rnd() * 2));
      v.priorYearInpatientEvents = chance(0.4) ? "1" : "0"; return v; } },
  { name: "Behavioral health (depression/anxiety)", build: () => {
      const v = base(); v.age = ageR(66, 78); v.conditions = ["depression", "anxiety"];
      v.medications = meds("Sertraline");
      v.specialistVisits12mo = String(1 + Math.floor(rnd() * 3)); return v; } },
  { name: "Acupuncture-oriented / holistic", build: () => {
      const v = base(); v.age = ageR(66, 80);
      v.conditions = chance(0.6) ? ["osteoarthritis"] : [];
      v.medications = [""]; v.acupunctureVisits12mo = String(8 + Math.floor(rnd() * 13));
      v.specialistVisits12mo = String(Math.floor(rnd() * 3)); return v; } },
  { name: "COPD / respiratory", build: () => {
      const v = base(); v.age = ageR(68, 84); v.conditions = ["copd"];
      v.medications = meds("Albuterol");
      v.specialistVisits12mo = String(1 + Math.floor(rnd() * 3));
      v.priorYearInpatientEvents = chance(0.25) ? "1" : "0"; return v; } },
  { name: "Frail multimorbid 80+", build: () => {
      const v = base(); v.age = ageR(80, 90);
      v.conditions = ["diabetes", "hypertension", "ckd", "cad", "osteoarthritis"];
      v.medications = meds("Metformin", "Lisinopril", "Atorvastatin", "Insulin glargine");
      v.specialistVisits12mo = String(3 + Math.floor(rnd() * 2));
      v.priorYearInpatientEvents = chance(0.5) ? "1" : "0"; return v; } },
  { name: "Must-keep Cedars-Sinai", build: () => {
      const v = base(); v.age = ageR(66, 82);
      v.conditions = ["diabetes", "hypertension", "hyperlipidemia"];
      v.medications = meds("Metformin", "Lisinopril", "Atorvastatin");
      v.mustKeepSystemIds = ["sys-cedars"];
      v.specialistVisits12mo = String(1 + Math.floor(rnd() * 3)); return v; } },
  { name: "Must-keep UCLA Health", build: () => {
      const v = base(); v.age = ageR(66, 82);
      v.conditions = ["hypertension", "hyperlipidemia"];
      v.medications = meds("Lisinopril", "Atorvastatin");
      v.mustKeepSystemIds = ["sys-ucla"];
      v.specialistVisits12mo = String(1 + Math.floor(rnd() * 3)); return v; } },
  { name: "Generalist mid-complexity", build: () => {
      const v = base(); v.age = ageR(67, 80);
      v.conditions = ["hypertension", "osteoarthritis"];
      v.medications = meds("Lisinopril");
      v.specialistVisits12mo = String(1 + Math.floor(rnd() * 2)); return v; } },
];

// ---- configs ---------------------------------------------------------------
interface Res { replicas: number; scenarioCount: number }
const BASELINE: Res = { replicas: 120, scenarioCount: 500 };
// Ordered candidates: try cheapest first; first one that is SAFE wins.
const CANDIDATES: Res[] = [
  { replicas: 64, scenarioCount: 300 },
  { replicas: 80, scenarioCount: 400 },
  { replicas: 96, scenarioCount: 400 },
];
const NEAR_TIE_THRESHOLD = 0.08; // baseline winner within this of runner-up share
const PER = Number(process.env.PER) || 6;

interface HorizonStat {
  agree: number;
  total: number;
  deltas: number[];        // |winShare delta| over ALL profiles
  nearTieFlips: number;    // disagreements that were near-ties in baseline
  genuineFlips: number;    // disagreements that were NOT near-ties
}
const newStat = (): HorizonStat => ({ agree: 0, total: 0, deltas: [], nearTieFlips: 0, genuineFlips: 0 });

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const max = (a: number[]) => (a.length ? Math.max(...a) : 0);

async function main() {
  const db = getDataStore();

  // Build all profiles ONCE so baseline and candidates A/B identical inputs.
  const profiles = [];
  let idx = 0;
  for (const seg of SEGMENTS) {
    for (let i = 0; i < PER; i++) {
      const profile = toProfileInput(seg.build(), {
        profileId: `ab-${idx}`, capturedBy: "broker", drugs: DRUGS, providerSystems: SYSTEMS,
      });
      // Unique capturedAt per profile (belt-and-suspenders on top of the
      // replicas/scenarioCount cache key) so configs never collide on a profile.
      profile.capturedAt = `ab-${idx}`;
      profiles.push(profile);
      idx++;
    }
  }

  console.log(
    `Horizon resolution A/B — ${SEGMENTS.length} archetypes x ${PER} = ${profiles.length} patients · ` +
    `seed ${Number(process.env.SEED) || 20260624}`,
  );
  console.log(`Baseline: replicas=${BASELINE.replicas} scenarioCount=${BASELINE.scenarioCount}\n`);

  // ---- wall-clock timing: one baseline vs one candidate call ---------------
  const timed = profiles[0];
  const tb0 = performance.now();
  await recommendAcrossHorizons(timed, db, BASELINE);
  const tBaseline = performance.now() - tb0;
  const cand0 = CANDIDATES[0];
  const tc0 = performance.now();
  await recommendAcrossHorizons(timed, db, cand0);
  const tCandidate = performance.now() - tc0;
  console.log("Wall-clock for ONE recommendAcrossHorizons call (single profile):");
  console.log(`  baseline  (${BASELINE.replicas}/${BASELINE.scenarioCount}):  ${tBaseline.toFixed(0)} ms`);
  console.log(`  candidate (${cand0.replicas}/${cand0.scenarioCount}):  ${tCandidate.toFixed(0)} ms` +
    `  → ${(tBaseline / tCandidate).toFixed(2)}x faster\n`);

  // Precompute baseline results for every profile (reused across candidates).
  const baselineByProfile = new Map<string, Awaited<ReturnType<typeof recommendAcrossHorizons>>>();
  for (const p of profiles) {
    baselineByProfile.set(p.id, await recommendAcrossHorizons(p, db, BASELINE));
  }

  // Evaluate each candidate against the baseline.
  interface CandReport { res: Res; byYear: Map<number, HorizonStat>; safe: boolean }
  const reports: CandReport[] = [];

  for (const cand of CANDIDATES) {
    const byYear = new Map<number, HorizonStat>();
    for (const p of profiles) {
      const baseRes = baselineByProfile.get(p.id)!;
      const candRes = await recommendAcrossHorizons(p, db, cand);
      for (const bh of baseRes.horizons) {
        const ch = candRes.horizons.find((h) => h.years === bh.years);
        if (!ch) continue;
        const stat = byYear.get(bh.years) ?? newStat();
        stat.total++;
        stat.deltas.push(Math.abs((bh.winShare ?? 0) - (ch.winShare ?? 0)));
        if (bh.recommendedPlanId === ch.recommendedPlanId) {
          stat.agree++;
        } else {
          // Classify the disagreement using the BASELINE distribution: was the
          // baseline winner only marginally ahead of its runner-up?
          const winnerShare = bh.distribution[0]?.share ?? 0;
          const runnerShare = bh.distribution[1]?.share ?? 0;
          if (winnerShare - runnerShare <= NEAR_TIE_THRESHOLD) stat.nearTieFlips++;
          else stat.genuineFlips++;
        }
        byYear.set(bh.years, stat);
      }
    }
    // Safe = every horizon ≥ ~95% agreement AND no genuine (non-near-tie) flips.
    const safe = [...byYear.values()].every(
      (s) => s.agree / s.total >= 0.95 && s.genuineFlips === 0,
    );
    reports.push({ res: cand, byYear, safe });
  }

  // ---- verdict -------------------------------------------------------------
  const years = [...reports[0].byYear.keys()].sort((a, b) => a - b);
  for (const rep of reports) {
    console.log(`Candidate replicas=${rep.res.replicas} scenarioCount=${rep.res.scenarioCount}`);
    for (const y of years) {
      const s = rep.byYear.get(y)!;
      const pct = ((100 * s.agree) / s.total).toFixed(0);
      console.log(
        `  ${y}y: ${s.agree}/${s.total} agree = ${pct}%` +
        ` · |winShare delta| mean ${mean(s.deltas).toFixed(4)} max ${max(s.deltas).toFixed(4)}` +
        ` · disagreements: ${s.nearTieFlips} near-tie, ${s.genuineFlips} genuine flip`,
      );
    }
    console.log(`  → ${rep.safe ? "SAFE" : "NOT safe"}\n`);
  }

  const firstSafe = reports.find((r) => r.safe);
  console.log("════════════════════════════════════════════════════════════");
  if (firstSafe) {
    console.log(
      `RECOMMENDATION: use replicas=${firstSafe.res.replicas}, ` +
      `scenarioCount=${firstSafe.res.scenarioCount} (smallest tested config that is SAFE).`,
    );
  } else {
    console.log(
      "RECOMMENDATION: none of the tested candidates were SAFE — keep " +
      `replicas=${BASELINE.replicas}, scenarioCount=${BASELINE.scenarioCount} (or test higher resolutions).`,
    );
  }
}

main();
