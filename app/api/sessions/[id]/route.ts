import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getSessionStore()).get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
  return NextResponse.json({ session });
}
