import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function middleware(request: NextRequest) {
  // CSRF defense-in-depth: reject cross-origin state-changing API calls. Browsers
  // always send an Origin header on such requests; a legitimate same-origin call
  // matches the Host. (Server actions have their own framework CSRF protection.)
  if (MUTATING.has(request.method) && request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== request.headers.get("host")) {
        return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
      }
    }
  }
  return updateSession(request);
}

export const config = {
  // Run on everything except Next internals and static files. The handler itself
  // no-ops in memory mode and only gates the broker surfaces in supabase mode.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
