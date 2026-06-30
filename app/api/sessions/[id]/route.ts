import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({ session });
}

/** Remove a client session from the broker's list (soft-delete; audit trail kept).
 *  RLS scopes the store to the signed-in broker, so this only affects own sessions. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getSessionStore();
  const session = await store.get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  // get() can succeed for a caller who can read but not delete (org_admin
  // oversight); remove() reports whether a row was actually soft-deleted so we
  // don't return a misleading success.
  const removed = await store.remove(id);
  if (!removed) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
