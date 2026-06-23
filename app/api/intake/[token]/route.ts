import { NextResponse } from "next/server";
import { submitPatientIntake } from "@/lib/session/patientIntake";
import type { IntakeFormValues } from "@/lib/intake/types";

export const dynamic = "force-dynamic";

/**
 * PUBLIC patient self-entry submit. Authenticated by the capability token in the
 * URL (validated server-side), NOT by a broker session — so it lives under
 * /api/intake, which middleware does not gate. The write goes through the
 * service-role path inside submitPatientIntake() (server-only).
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let body: { values?: IntakeFormValues };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!body.values) return NextResponse.json({ error: "missing values" }, { status: 400 });

  const result = await submitPatientIntake(token, body.values);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.validation ? { validation: result.validation } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true });
}
