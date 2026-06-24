/**
 * SCAN fit-by-segment sweep. Builds realistic SoCal Medicare patient archetypes,
 * samples many patients within each (with variation), and runs every one through
 * the REAL engine. Reports SCAN's win-rate per segment on PURE FIT (preference
 * off) and with the product's bounded preference weighting on.
 *
 * No segment is rigged for SCAN — each archetype is a real patient type, and the
 * provider must-keep / conditions / meds reflect that type honestly.
 *
 * Run: npx tsx scripts/sim-scan-segments.ts
 */
import { getDataStore } from "@/lib/data";
import { buildEngineCatalog, runEngine } from "@/lib/engine/pipeline";
import { toProfileInput } from "@/lib/intake/toProfile";
import { drugs as DRUGS, providerSystems as SYSTEMS } from "@/lib/data/fixtures";
import { emptyIntakeValues, type IntakeFormValues } from "@/lib/intake/types";
import type { ConditionFlag } from "@/lib/domain";

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
];

async function main() {
  const PER = Number(process.env.PER) || 60;
  const COUNT = Number(process.env.COUNT) || 300;
  const db = getDataStore();
  const catalog = await buildEngineCatalog(db);
  const byId = new Map(catalog.plans.map((p) => [p.id, p]));

  console.log(`SCAN fit-by-segment — ${SEGMENTS.length} archetypes × ${PER} patients = ${SEGMENTS.length * PER} total · ${COUNT} scenarios/run · seed ${Number(process.env.SEED) || 20260624}\n`);
  console.log("PURE FIT (preference OFF) unless noted. 'pref#1' = SCAN #1 with bounded preference ON.\n");
  console.log("segment".padEnd(38) + "SCAN#1  top3  elig   beats SCAN (pure fit)        pref#1");
  console.log("─".repeat(104));

  const tot = { n: 0, t1: 0, t3: 0, el: 0, p1: 0 };
  for (const seg of SEGMENTS) {
    let t1 = 0, t3 = 0, el = 0, none = 0, p1 = 0;
    const winner: Record<string, number> = {};
    for (let i = 0; i < PER; i++) {
      const profile = toProfileInput(seg.build(), {
        profileId: `seg-${seg.name}-${i}`, capturedBy: "broker", drugs: DRUGS, providerSystems: SYSTEMS,
      });
      const off = (await runEngine(profile, db, { preferenceWeighting: false, count: COUNT, catalog })).scoring.ranked;
      const on = (await runEngine(profile, db, { preferenceWeighting: true, count: COUNT, catalog })).scoring.ranked;
      if (!off.length) { none++; } else {
        const top = byId.get(off[0].planId)!;
        winner[top.carrier] = (winner[top.carrier] ?? 0) + 1;
        if (top.isScan) t1++;
        if (off.slice(0, 3).some((r) => byId.get(r.planId)?.isScan)) t3++;
        if (off.some((r) => byId.get(r.planId)?.isScan)) el++;
      }
      if (on.length && byId.get(on[0].planId)?.isScan) p1++;
    }
    const eff = PER - none; // patients with an eligible plan
    const pct = (n: number) => `${Math.round((100 * n) / PER)}%`.padStart(5);
    const topCarrier = Object.entries(winner).sort((a, b) => b[1] - a[1])[0];
    const beats = topCarrier ? `${topCarrier[0]} ${Math.round((100 * topCarrier[1]) / Math.max(1, eff))}%` : "—";
    console.log(
      seg.name.padEnd(38) + pct(t1) + " " + pct(t3) + " " + pct(el) + "   " +
      beats.padEnd(28) + pct(p1) + (none ? `   (${none} none-elig)` : ""),
    );
    tot.n += PER; tot.t1 += t1; tot.t3 += t3; tot.el += el; tot.p1 += p1;
  }
  console.log("─".repeat(104));
  const tp = (n: number) => `${((100 * n) / tot.n).toFixed(0)}%`.padStart(5);
  console.log("ALL PATIENTS".padEnd(38) + tp(tot.t1) + " " + tp(tot.t3) + " " + tp(tot.el) + "   " + "".padEnd(28) + tp(tot.p1));
}

main();
