import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/store";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getAuditStore().get(id);
  if (!record) return NextResponse.json({ error: "audit record not found" }, { status: 404 });
  return NextResponse.json({ record });
}
