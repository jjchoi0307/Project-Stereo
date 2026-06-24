import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function middleware(request: NextRequest) {
  // CSRF defense-in-depth: reject cross-origin state-changing API calls. Browsers
  // always send an Origin header on such requests; a legitimate same-origin call
  // matches the Host. (Server actions have their own framework CSRF protection.)
  if (MUTATING.has(request.method) && request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    const reject = () => NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
    if (origin) {
      let originHost: string | null = null;
      try {
        originHost = new URL(origin).host;
      } catch {
        originHost = null;
      }
      if (originHost !== request.headers.get("host")) return reject();
    } else {
      // No Origin header — don't let a forged request bypass the check by simply
      // omitting it. Require the browser's Fetch-Metadata same-origin signal; a
      // legitimate same-origin fetch/XHR always sends `sec-fetch-site: same-origin`.
      const site = request.headers.get("sec-fetch-site");
      if (site !== "same-origin") return reject();
    }
  }
  return updateSession(request);
}

export const config = {
  // Run on everything except Next internals and static files. The handler itself
  // no-ops in memory mode and only gates the broker surfaces in supabase mode.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
