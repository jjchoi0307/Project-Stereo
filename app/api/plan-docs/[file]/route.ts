import { NextResponse } from "next/server";
import { serviceClient } from "@/lib/supabase/client";
import { PLAN_DOC_FILES } from "@/lib/data/planDocs";
import { supabaseConfigured, stateStore } from "@/lib/supabase/env";

/**
 * Source-document access for the Plan Library. The carrier PDFs live in a PRIVATE
 * Supabase Storage bucket (`plan-docs`) — not in git and not served as public
 * static assets. This route mints a SHORT-LIVED signed URL and 302-redirects to
 * it, so there is no permanent, guessable, or search-indexable public URL, and a
 * document can be rotated/revoked by replacing the storage object.
 *
 * The `file` segment is validated against the generated allowlist (PLAN_DOC_FILES
 * values are the only valid object names), so this cannot be used to enumerate or
 * reach any other object in the bucket.
 *
 * Access is currently OPEN (the Library is a public page). To restrict it to
 * signed-in brokers, add "/api/plan-docs" to PROTECTED_APIS in
 * lib/supabase/middleware.ts — a one-line change (the Library would then need to
 * be broker-only too).
 */
export const dynamic = "force-dynamic";

const BUCKET = "plan-docs";
const VALID_OBJECTS = new Set(Object.values(PLAN_DOC_FILES));
const SIGNED_URL_TTL_SECONDS = 120;

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!VALID_OBJECTS.has(file)) {
    return NextResponse.json({ error: "document not found" }, { status: 404 });
  }
  if (stateStore() !== "supabase" || !supabaseConfigured()) {
    return NextResponse.json({ error: "document store not configured" }, { status: 503 });
  }
  try {
    const { data, error } = await serviceClient().storage.from(BUCKET).createSignedUrl(file, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: "document not found" }, { status: 404 });
    }
    // Preserve the cited page as a PDF fragment on the signed URL (fragments never
    // reach the server, so the page is passed as ?page= and re-attached here).
    const page = new URL(req.url).searchParams.get("page");
    const location = page && /^\d+$/.test(page) ? `${data.signedUrl}#page=${page}` : data.signedUrl;
    return NextResponse.redirect(location, 302);
  } catch {
    return NextResponse.json({ error: "document temporarily unavailable" }, { status: 503 });
  }
}
