import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/store";
import { logAccess } from "@/lib/security/accessLog";
import { getBrokerContext } from "@/lib/supabase/auth";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = (await getBrokerContext()) ?? undefined;
  const record = await (await getAuditStore(ctx)).get(id);
  if (!record) return NextResponse.json({ error: "audit record not found" }, { status: 404 });
  // PHI read: this route returns the full profileSnapshot. Record WHO/WHAT/WHEN
  // (PHI-free) on the persisted path. ctx is null in in-memory dev mode.
  if (ctx) {
    const sessionId = record.profileSnapshot.id.replace(/^profile-/, "");
    logAccess({ actor: ctx.brokerId, action: "audit.read", sessionId });
  }
  return NextResponse.json({ record });
}
