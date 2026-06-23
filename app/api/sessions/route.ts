import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/session/store";

export async function GET() {
  const store = getSessionStore();
  return NextResponse.json({ sessions: await store.list() });
}

export async function POST(req: Request) {
  const store = getSessionStore();
  let clientLabel: string | undefined;
  try {
    const body = await req.json();
    if (typeof body?.clientLabel === "string") clientLabel = body.clientLabel.trim() || undefined;
  } catch {
    // empty body is fine
  }
  const session = await store.create(clientLabel);
  return NextResponse.json({ session }, { status: 201 });
}
