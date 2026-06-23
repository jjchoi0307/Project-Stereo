import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/store";
import { auditIdFor, buildAuditRecord } from "@/lib/audit/record";
import { getDataStore } from "@/lib/data";
import { runEngine } from "@/lib/engine/pipeline";
import { getSessionStore } from "@/lib/session/store";

/** Create (upsert) the canonical audit record for this session's recommendation.
 *  Always runs with preference weighting ON — that's the delivered recommendation. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionStore().get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const run = await runEngine(session.profile, getDataStore(), { preferenceWeighting: true });
  const record = buildAuditRecord(session.profile, run);
  await getAuditStore().save(record);
  return NextResponse.json({ auditId: record.id }, { status: 201 });
}

/** Return the stored audit id for this session's current facts (if any). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionStore().get(id);
  if (!session?.profile) return NextResponse.json({ auditId: null });
  const auditId = auditIdFor(session.profile);
  const record = await getAuditStore().get(auditId);
  return NextResponse.json({ auditId: record ? auditId : null });
}
