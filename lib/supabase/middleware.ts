/**
 * Middleware session handling. Refreshes the broker's auth cookies on every
 * request and gates the broker surfaces. A NO-OP in memory mode / when Supabase
 * isn't configured, so local dev without auth is unaffected.
 *
 * Public surfaces (never gated): / (public landing), /home, /login,
 * /intake/[token] (anonymous patient self-entry), static assets. The broker
 * workspace at / redirects logged-out visitors to /home itself (so the landing
 * renders rather than bouncing to /login). Everything else requires a session.
 *
 * The Plan Library (/plans) and the carrier source documents (/api/plan-docs) are
 * BROKER-ONLY — the plan facts and PDFs are confidential and must never render on
 * the public site.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, stateStore, supabaseConfigured } from "./env";

const PROTECTED_PAGES = ["/session", "/audit", "/settings", "/plans"];
const PROTECTED_APIS = ["/api/sessions", "/api/audit", "/api/plan-docs"];
// Public surfaces that are NEVER gated and are overwhelmingly logged-out. We skip
// the Supabase session round-trip on these so their TTFB isn't taxed by an auth
// call (a big win for the dynamic /home). NOT "/", which is the broker workspace
// for a signed-in user; the session still refreshes on the next gated request.
const PUBLIC_PAGES = ["/home", "/login", "/signup", "/intake"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/")));

export async function updateSession(request: NextRequest, requestHeaders: Headers): Promise<NextResponse> {
  // Forward request-header overrides (the CSP nonce) so Next can read them while
  // rendering, on every path including the no-auth one.
  const forward = { request: { headers: requestHeaders } };

  // Auth is off in memory mode — let everything through untouched.
  if (stateStore() !== "supabase" || !supabaseConfigured()) return NextResponse.next(forward);

  // Public, never-gated routes: skip the auth round-trip entirely (keeps their
  // TTFB low). The CSP/nonce headers are still applied by the caller.
  if (matches(request.nextUrl.pathname, PUBLIC_PAGES)) return NextResponse.next(forward);

  let response = NextResponse.next(forward);
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        // Re-derive the forwarded request headers so refreshed auth cookies are
        // visible to server components on this same request — while keeping the
        // nonce header. Dropping back to a stale snapshot would forward old
        // cookies and cause spurious logouts (the bug this block guards against).
        const merged = new Headers(requestHeaders);
        const cookieHeader = request.cookies
          .getAll()
          .map((c) => `${c.name}=${c.value}`)
          .join("; ");
        if (cookieHeader) merged.set("cookie", cookieHeader);
        response = NextResponse.next({ request: { headers: merged } });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Do not run code between createServerClient and getUser() — it refreshes the
  // session cookie, and stale state here causes hard-to-debug logouts.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && matches(path, PROTECTED_APIS)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!user && matches(path, PROTECTED_PAGES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  return response;
}
