import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { normalizeProfile } from "@/lib/engine/normalize";
import { getSessionStore } from "@/lib/session/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  if (!session.profile) return NextResponse.json({ error: "no profile yet" }, { status: 409 });

  const drugs = await getDataStore().listDrugs();
  const normalized = normalizeProfile(session.profile, drugs);
  return NextResponse.json({ normalized });
}
