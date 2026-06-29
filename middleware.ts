import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Content-Security-Policy. Strict for the PHI app; the only relaxation is the
 * YouTube THUMBNAIL image host for the "Our Heroes" showcase (which links out to
 * YouTube — no iframe, so no frame-src allowance is needed). img-src allows
 * i.ytimg.com GLOBALLY (not just on /login): client-side soft navigations don't
 * re-apply per-route CSP, so a page navigated *from* (e.g. /home) must already
 * permit it — otherwise the thumbnail is blocked until a hard refresh. An image
 * CDN in img-src can't execute code, so this is a safe, minimal relaxation.
 * 'unsafe-eval' is dev-only (Fast Refresh); production stays strict.
 */
function contentSecurityPolicy(): string {
  const isDev = process.env.NODE_ENV !== "production";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://i.ytimg.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

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
  const response = await updateSession(request);
  // Apply CSP per-route here (not in next.config) so the YouTube allowance can be
  // scoped to the auth pages while every other route keeps the strict policy.
  response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return response;
}

export const config = {
  // Run on everything except Next internals and static files. The handler itself
  // no-ops in memory mode and only gates the broker surfaces in supabase mode.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
