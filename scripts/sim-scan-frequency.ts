/**
 * Carrier-fairness simulation: how often does a SCAN plan surface in the top-3
 * recommendation across many diverse synthetic patients?
 *
 * Uses the REAL selection step (screenTopPlans = the single-screen ranking that
 * drives the live top-3; the ensemble just votes over repeats of it), run in
 * bounded-concurrency parallel batches (RLM decompose/delegate). Reports SCAN
 * top-1 / top-3 frequency overall + by region, the full top-1 carrier distribution,
 * and — the key fairness check — SCAN's top-3 rate vs its share of each patient's
 * ELIGIBLE set (over-surfacing = ranked above its availability; ~equal = neutral).
 *
 *   N=1500 CONC=10 node --conditions=react-server --import tsx scripts/sim-scan-frequency.ts
 */
import { getDataStore } from "@/lib/data";
import { screenTopPlans } from "@/lib/ai/recommend";
import { SMG_SERVICE_AREA_REGION_IDS } from "@/lib/data/fixtures/regions";
import type { ClientProfileInput, ConditionFlag } from "@/lib/domain";

const N = Number(process.env.N) || 1500;
const CONC = Number(process.env.CONC) || 10;

// Seeded RNG (mulberry32) so the run is reproducible.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COND_PREVALENCE: [ConditionFlag, number][] = [
  ["hypertension", 0.5], ["hyperlipidemia", 0.42], ["diabetes", 0.3], ["obesity", 0.22],
  ["osteoarthritis", 0.2], ["depression", 0.13], ["anxiety", 0.13], ["cad", 0.12],
  ["prediabetes", 0.12], ["copd", 0.1], ["ckd", 0.1], ["sleep_disorder", 0.1],
  ["chf", 0.07], ["cancer_history", 0.08], ["cancer_active", 0.03],
];

async function main() {
  const db = getDataStore();
  const [plans, drugs, systems] = await Promise.all([
    db.listPlans(),
    db.listDrugs(),
    db.listProviderSystems(),
  ]);
  const carrierOf = new Map(plans.map((p) => [p.id, p.carrier]));
  const isScan = (id: string) => carrierOf.get(id) === "SCAN Health Plan";
  const regions = [...SMG_SERVICE_AREA_REGION_IDS];

  const r = rng(20260625);
  const pick = <T,>(arr: T[]) => arr[Math.floor(r() * arr.length)];

  function makePatient(i: number): ClientProfileInput {
    const conditions = COND_PREVALENCE.filter(([, p]) => r() < p).map(([c]) => c);
    const nMeds = Math.floor(r() * 5); // 0–4
    const meds = Array.from({ length: nMeds }, () => {
      const d = pick(drugs);
      return { raw: d.name, name: d.name, drugId: d.id };
    });
    const dualEligible = r() < 0.18;
    const providerConstraints =
      r() < 0.2
        ? [{ systemId: pick(systems).id, label: "must keep", hardRequirement: true }]
        : [];
    return {
      id: `profile-sim-${i}`,
      capturedBy: "broker",
      capturedAt: "2026-06-25T00:00:00.000Z",
      age: 65 + Math.floor(r() * 24),
      marketRegion: pick(regions),
      gender: r() < 0.5 ? "female" : "male",
      medications: meds,
      conditions,
      familyHistory: [],
      providerConstraints,
      dualEligible,
    };
  }

  const patients = Array.from({ length: N }, (_, i) => makePatient(i));

  // Tallies.
  let valid = 0, noneEligible = 0, errors = 0;
  let scanTop1 = 0, scanTop3 = 0;
  let scanEligibleShareSum = 0;
  const top1Carrier = new Map<string, number>();
  const byRegion = new Map<string, { n: number; s1: number; s3: number }>();

  let done = 0;
  async function run(p: ClientProfileInput) {
    try {
      const { top, eligible } = await screenTopPlans(p, db, 3);
      if (eligible.length === 0 || top.length === 0) {
        noneEligible++;
        return;
      }
      valid++;
      const reg = p.marketRegion;
      const rb = byRegion.get(reg) ?? { n: 0, s1: 0, s3: 0 };
      rb.n++;
      const s1 = isScan(top[0]);
      const s3 = top.some(isScan);
      if (s1) { scanTop1++; rb.s1++; }
      if (s3) { scanTop3++; rb.s3++; }
      byRegion.set(reg, rb);
      const c1 = carrierOf.get(top[0]) ?? "unknown";
      top1Carrier.set(c1, (top1Carrier.get(c1) ?? 0) + 1);
      const scanEligible = eligible.filter(isScan).length;
      scanEligibleShareSum += scanEligible / eligible.length;
    } catch (e) {
      errors++;
      if (errors <= 5) console.error("patient failed:", (e as Error).message);
    } finally {
      done++;
      if (done % 100 === 0) console.log(`  …${done}/${N} (valid ${valid}, scanTop3 ${scanTop3}, err ${errors})`);
    }
  }

  // Bounded-concurrency parallel run.
  const t0 = Date.now();
  let next = 0;
  async function worker() {
    while (next < patients.length) {
      const i = next++;
      await run(patients[i]);
    }
  }
  console.log(`Running ${N} patients, concurrency ${CONC}…`);
  await Promise.all(Array.from({ length: CONC }, () => worker()));
  const mins = ((Date.now() - t0) / 60000).toFixed(1);

  const pctOf = (x: number, d: number) => (d > 0 ? ((100 * x) / d).toFixed(1) + "%" : "—");
  console.log(`\n===== RESULTS (${mins} min) =====`);
  console.log(`Patients: ${N} | valid ${valid} | no-eligible ${noneEligible} | errors ${errors}`);
  console.log(`SCAN in TOP-1: ${scanTop1}/${valid} = ${pctOf(scanTop1, valid)}`);
  console.log(`SCAN in TOP-3: ${scanTop3}/${valid} = ${pctOf(scanTop3, valid)}`);
  console.log(`SCAN avg share of ELIGIBLE set (baseline): ${(100 * scanEligibleShareSum / valid).toFixed(1)}%`);
  console.log(`  → over/under-surfacing = top-3 rate − eligible share = ${(100 * (scanTop3 / valid - scanEligibleShareSum / valid)).toFixed(1)} pts`);
  console.log(`\nTop-1 carrier distribution:`);
  for (const [c, n] of [...top1Carrier.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pctOf(n, valid).padStart(6)}  ${c} (${n})`);
  }
  console.log(`\nBy region (SCAN top-1 / top-3):`);
  for (const [reg, b] of byRegion) {
    console.log(`  ${reg}: n=${b.n} · top-1 ${pctOf(b.s1, b.n)} · top-3 ${pctOf(b.s3, b.n)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
