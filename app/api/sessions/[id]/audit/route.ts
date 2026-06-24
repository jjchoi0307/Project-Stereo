import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/store";
import { auditIdFor, buildAuditRecord } from "@/lib/audit/record";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";
import { getHorizonPayload } from "@/lib/engine/horizonCacheStore";
import { getSessionStore } from "@/lib/session/store";
import { SIM_MODEL } from "@/lib/sim/env";
import { DATA_VERSION } from "@/lib/version";
import type { AuditAiRecommendation } from "@/lib/domain";

/** Shape of the cached AI recommendation payload (app/api/.../recommendation/route.ts). */
interface CachedAiRec {
  model?: string;
  topPlanId?: string | null;
  ranked?: {
    planId: string;
    plan?: { id: string; name: string };
    total: number;
    reasons?: { text: string; positive: boolean; citation?: { sourceFile: string; page?: number | null; quote: string } | null }[];
  }[];
  excluded?: { plan?: { id: string; name: string }; reasons?: { detail: string }[] }[];
}

/** Map the cached AI recommendation payload into the audit snapshot shape. */
function toAuditAi(cached: CachedAiRec): AuditAiRecommendation {
  const ranked = (cached.ranked ?? []).map((r) => ({
    planId: r.planId,
    planName: r.plan?.name ?? r.planId,
    fitScore: r.total,
    reasons: (r.reasons ?? []).map((reason) => ({
      text: reason.text,
      positive: reason.positive,
      citation: reason.citation
        ? { sourceFile: reason.citation.sourceFile, sourcePage: reason.citation.page ?? null, quote: reason.citation.quote }
        : null,
    })),
  }));
  return {
    model: cached.model ?? SIM_MODEL,
    generatedAt: new Date().toISOString(),
    topPlanId: cached.topPlanId ?? null,
    ranked,
    excluded: (cached.excluded ?? []).map((e) => ({
      planId: e.plan?.id ?? "",
      planName: e.plan?.name ?? e.plan?.id ?? "",
      reasons: (e.reasons ?? []).map((x) => x.detail),
    })),
    groundingPlanIds: ranked.map((r) => r.planId),
  };
}

/**
 * Create (upsert) the canonical audit record for this session's recommendation.
 *
 * The delivered recommendation is now AI-powered, so the audit preserves it
 * verbatim: the exact AI ranking + every reason and its source citation are
 * stored ("reproducibility by record"). The deterministic engine backbone
 * (eligibility, normalized markers, exclusion log) is kept alongside — it stays
 * bit-for-bit reproducible and is what the Verify check re-runs.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  // Pull the AI recommendation the member was shown from the server cache (the
  // recommendation route warms it). Audit is POSTed after the recommendation
  // loads, so it's normally present; if not, the record still saves with the
  // deterministic backbone and the AI snapshot fills in on a later view.
  const aiCacheKey = `airec:${id}:${session.profile.capturedAt}:${SIM_MODEL}:${DATA_VERSION}`;
  const cachedAi = (await getHorizonPayload(aiCacheKey)) as CachedAiRec | null;
  const ai = cachedAi?.ranked?.length ? toAuditAi(cachedAi) : null;

  const run = await runEngine(session.profile, getDataStore(), { preferenceWeighting: false });
  const record = buildAuditRecord(session.profile, run, ai);
  await (await getAuditStore()).save(record);
  return NextResponse.json({ auditId: record.id }, { status: 201 });
}

/** Return the stored audit id for this session's current facts (if any). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session?.profile) return NextResponse.json({ auditId: null });
  const auditId = auditIdFor(session.profile);
  const record = await (await getAuditStore()).get(auditId);
  return NextResponse.json({ auditId: record ? auditId : null });
}
