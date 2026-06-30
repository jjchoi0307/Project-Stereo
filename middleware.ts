import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// GET endpoints that perform server-side writes (horizon_cache upserts, audit /
// access-log entries) and kick off an expensive Claude ensemble. They are
// normally fetched same-origin by the app, so a cross-site trigger could force
// costly AI runs or pollute the compliance trail. We apply a conservative origin
// check to them — blocking only clearly cross-site requests so legitimate
// same-origin reads (and header-less old browsers) still pass.
const WRITE_BEARING_GET = [
  /^\/api\/sessions\/[^/]+\/recommendation(\/horizons)?$/,
  /^\/api\/audit\/[^/]+\/verify$/,
];

/**
 * Content-Security-Policy. Strict for the PHI app; the only relaxations are for
 * the "Our Heroes" showcase: the YouTube THUMBNAIL host (img-src i.ytimg.com) and
 * the privacy-preserving YouTube PLAYER frame (frame-src youtube-nocookie). Both
 * are allowed GLOBALLY (not scoped per-route): client-side soft navigations don't
 * re-apply per-route CSP, so a page navigated *from* (e.g. /home → /login) must
 * already permit them — otherwise the thumbnail/player is blocked until a hard
 * refresh. An image CDN and a single trusted frame origin can't execute code in
 * our context, so this stays a minimal relaxation; everything else is strict.
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
    "frame-src 'self' https://www.youtube-nocookie.com",
  ];
  return directives.join("; ");
}

export async function middleware(request: NextRequest) {
  // CSRF defense-in-depth: reject cross-origin state-changing API calls.
  // (Server actions have their own framework CSRF protection.)
  const path = request.nextUrl.pathname;
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const reject = () => NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  // True only when an Origin header is present AND its host differs from ours.
  const originMismatch = (): boolean => {
    if (!origin) return false;
    try {
      return new URL(origin).host !== request.headers.get("host");
    } catch {
      return true;
    }
  };

  // State-changing methods: browsers send an Origin header on such requests; a
  // legitimate same-origin call matches the Host. With no Origin, require the
  // Fetch-Metadata same-origin signal so a forged request can't bypass by
  // omitting Origin.
  if (MUTATING.has(request.method) && path.startsWith("/api/")) {
    if (origin) {
      if (originMismatch()) return reject();
    } else if (site !== "same-origin") {
      return reject();
    }
  }

  // Write-bearing GETs: block only clearly cross-site requests (Origin host
  // mismatch, or a Fetch-Metadata site of `same-site`/`cross-site`). Same-origin
  // fetches, direct navigations (`none`), and header-less old browsers still
  // pass, so reads are never broken.
  if (request.method === "GET" && WRITE_BEARING_GET.some((re) => re.test(path))) {
    if (originMismatch() || (site && site !== "same-origin" && site !== "none")) return reject();
  }

  const response = await updateSession(request);
  // CSP is set here (not in next.config) as a single uniform policy; see the
  // contentSecurityPolicy() note for why the YouTube allowances are global.
  response.headers.set("Content-Security-Policy", contentSecurityPolicy());
  return response;
}

export const config = {
  // Run on everything except Next internals and static files. The handler itself
  // no-ops in memory mode and only gates the broker surfaces in supabase mode.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
