import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";
import { issueIntakeToken } from "@/lib/session/patientIntake";
import { getBrokerContext } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * Broker-only: mint (or reuse) the capability token for a session's patient
 * self-entry link. Gated by middleware (under /api/sessions); RLS ensures a
 * broker can only token a session they own.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getBrokerContext();
  const session = await (await getSessionStore(ctx ?? undefined)).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const token = await issueIntakeToken(id, ctx);
  return NextResponse.json({ token });
}
