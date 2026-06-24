import { NextResponse } from "next/server";
import { getDataStore } from "@/lib/data";
import { SMG_SERVICE_AREA_REGION_IDS } from "@/lib/data/fixtures/regions";
import { mergeProvenance, toProfileInput } from "@/lib/intake/toProfile";
import type { IntakeFormValues } from "@/lib/intake/types";
import { validateIntake } from "@/lib/intake/validate";
import { getSessionStore } from "@/lib/session/store";
import type { CaptureSource } from "@/lib/domain";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = (await getSessionStore());
  const session = await store.get(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  let body: { capturedBy?: CaptureSource; values?: IntakeFormValues };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const capturedBy = body.capturedBy;
  if (capturedBy !== "patient" && capturedBy !== "broker") {
    return NextResponse.json({ error: "capturedBy must be 'patient' or 'broker'" }, { status: 400 });
  }
  if (!body.values) {
    return NextResponse.json({ error: "missing values" }, { status: 400 });
  }

  // Server-side validation — never trust the client.
  const validation = validateIntake(body.values);
  if (!validation.ok) {
    return NextResponse.json({ error: "validation failed", validation }, { status: 400 });
  }

  // SMG-specific: the client must be in SMG's actual service area (LA / Orange /
  // Santa Clara). SMG has no providers elsewhere, so a recommendation there would
  // be meaningless.
  if (!SMG_SERVICE_AREA_REGION_IDS.has(body.values.marketRegion)) {
    return NextResponse.json(
      { error: "region outside SMG service area", detail: "SMG serves Los Angeles, Orange, and Santa Clara counties only." },
      { status: 400 },
    );
  }

  const db = getDataStore();
  const [drugs, providerSystems] = await Promise.all([db.listDrugs(), db.listProviderSystems()]);

  let profile = toProfileInput(body.values, {
    profileId: `profile-${id}`,
    capturedBy,
    drugs,
    providerSystems,
  });

  // If facts already exist, this submit is a correction: preserve the original
  // origin and attribute only changed fields to the corrector.
  if (session.profile) {
    profile = mergeProvenance(session.profile, profile, capturedBy);
  }

  const updated = await store.setProfile(id, profile);
  return NextResponse.json({ session: updated });
}
