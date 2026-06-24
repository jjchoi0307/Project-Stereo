import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { getSessionStore } from "@/lib/session/store";
import { simConfigured, SIM_MODEL } from "@/lib/sim/env";
import { projectHealthFuture } from "@/lib/sim/healthFutureAgent";
import { getHorizonPayload, setHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { ENGINE_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";
// Adaptive thinking over a two-horizon projection can run for a while.
export const maxDuration = 120;

/**
 * AI health-future projection — Claude interprets the deterministic Monte-Carlo
 * backbone into a 5- and 10-year narrative. ON-DEMAND only (live API call), so
 * unlike the deterministic panels this is never auto-loaded with the session.
 *
 * Outside the recommendation data path (ARCHITECTURE.md invariant #6): the result
 * never feeds scoring and is not persisted to the audit record.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  // Cache the AI projection keyed by facts-version + engine + model: it auto-runs
  // when the recommendation opens, so without this every page view would be a
  // ~30s Claude call + cost. Stored once per facts-version, instant thereafter.
  const cacheKey = `projection:${id}:${session.profile.capturedAt}:${ENGINE_VERSION}:${SIM_MODEL}`;
  const cached = await getHorizonPayload(cacheKey);
  if (cached) return NextResponse.json(cached);

  if (!simConfigured()) {
    return NextResponse.json(
      {
        error: "not configured",
        detail: "The health-future simulation is opt-in. Set ANTHROPIC_API_KEY to enable it.",
      },
      { status: 503 },
    );
  }

  try {
    const drugs = await getDataStore().listDrugs();
    const result = await projectHealthFuture(session.profile, drugs);
    await setHorizonPayload(cacheKey, result);
    return NextResponse.json(result);
  } catch (e) {
    // PHI-free: log the error name/message only, never the profile.
    const err = e as Error;
    console.error("health-future projection failed:", err?.name, err?.message);
    return NextResponse.json({ error: "projection failed" }, { status: 502 });
  }
}
