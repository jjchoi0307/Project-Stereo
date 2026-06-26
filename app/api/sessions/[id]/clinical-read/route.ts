import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";
import { simConfigured } from "@/lib/sim/env";
import { loadClinicalRead } from "@/lib/ai/clinicalReadCache";
import { getBrokerContext } from "@/lib/supabase/auth";
import { getInputImportance } from "@/lib/config/orgSettings";

export const dynamic = "force-dynamic";
// Adaptive thinking over the clinical read can take 30-50s.
export const maxDuration = 120;

/**
 * AI clinical read — Claude produces the risk markers + 5/10-year health-futures
 * narrative, grounded in the member's de-identified clinical facts.
 *
 * Outside the recommendation data path (ARCHITECTURE.md invariant #6): the result
 * is presentational only — it never feeds scoring and is not part of the audit.
 * The deterministic markers (/normalized) and health futures (/health-futures)
 * remain available as a graceful fallback when the AI is unconfigured.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  // Admin-configurable input importance feeds the projection.
  const ctx = await getBrokerContext();
  const config = await getInputImportance(ctx?.orgId);

  if (!simConfigured()) {
    return NextResponse.json(
      {
        error: "not configured",
        detail: "The AI clinical read is opt-in. Set ANTHROPIC_API_KEY to enable it.",
      },
      { status: 503 },
    );
  }

  // Shared loader (cache get/set + compute) — the SAME read the horizon
  // recommendation reuses, so the Health Futures card and the recommendation's
  // projection are always built from one clinical read and agree.
  const result = await loadClinicalRead(id, session.profile, config);
  if (!result) return NextResponse.json({ error: "clinical read failed" }, { status: 502 });
  return NextResponse.json(result);
}
