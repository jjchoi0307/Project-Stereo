/**
 * Live latency smoke test for the AI 3yr/5yr horizon recommendation.
 * Run: npx tsx --env-file=.env.local scripts/smoke-horizon-latency.ts
 *
 * Times the REAL pipeline end-to-end against a representative profile, and prints
 * the per-leaf trajectory (screen vs deep write-ups, per horizon) so we can see
 * exactly where the wall-clock goes. Hits Anthropic — costs a few calls.
 */

import { getDataStore } from "@/lib/data";
import { recommendPlans } from "@/lib/ai/recommend";
import { recommendHorizons } from "@/lib/ai/horizonRecommend";
import { simConfigured } from "@/lib/sim/env";
import { ENSEMBLE } from "@/lib/engine/config";

const ms = (n: number) => `${(n / 1000).toFixed(1)}s`;

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  const r = await fn();
  console.log(`⏱  ${label}: ${ms(Date.now() - t0)}`);
  return r;
}

async function main() {
  if (!simConfigured()) {
    console.error("✗ ANTHROPIC_API_KEY not set — run with --env-file=.env.local");
    process.exit(1);
  }
  const db = getDataStore();
  const profiles = await db.listExampleProfiles();
  // Prefer a profile with a must-keep provider so we exercise the constrained path.
  const profile =
    profiles.find((p) => p.providerConstraints.some((c) => c.hardRequirement)) ??
    profiles.find((p) => p.id === "profile-diabetic-specialist") ??
    profiles[0];

  console.log(`profile: ${profile.id}`);
  console.log(`  must-keep: ${profile.providerConstraints.filter((c) => c.hardRequirement).map((c) => c.label).join(", ") || "none"}`);
  console.log(`  ensemble: runs=${ENSEMBLE.runs} concurrency=${ENSEMBLE.concurrency}\n`);

  // 1) Today (needed for todayTopPlanId — and what the broker waits on first).
  const today = await timed("TODAY recommendation", () => recommendPlans(profile, db));
  console.log(`   today top: ${today.topPlanId} · ${today.ranked.length} ranked · ${today.ensembleRuns} screen votes\n`);

  // 2) Horizons (the slow thing under investigation). Trajectory steps print via
  //    logTrajectory inside recommendHorizons (kind:"rlm_trajectory").
  const horizons = await timed("HORIZONS (3yr+5yr)", () =>
    recommendHorizons(profile, db, today.topPlanId),
  );
  for (const h of horizons.horizons) {
    console.log(
      `   ${h.years}yr: rec=${h.recommended?.planId ?? "(none)"} · ${h.ranked.length} full card(s) · ` +
        `changedVsToday=${h.changedVsToday} · proj +${h.projection.conditions.length}cond/+${h.projection.medications.length}med`,
    );
  }

  // 3) Cache check: a second horizon call would normally be served from the route
  //    cache (recCacheKey). recommendHorizons itself has no cache (the ROUTE does),
  //    so re-running here recomputes — that's expected; the route is what caches.
  console.log("\n(Note: the ROUTE caches per facts-signature; recompute only on first load or ?refresh=1.)");
}

main().catch((e) => {
  console.error("smoke failed:", e);
  process.exit(1);
});
