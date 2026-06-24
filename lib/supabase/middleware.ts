/**
 * Middleware session handling. Refreshes the broker's auth cookies on every
 * request and gates the broker surfaces. A NO-OP in memory mode / when Supabase
 * isn't configured, so local dev without auth is unaffected.
 *
 * Public surfaces (never gated): /login, /intake/[token] (anonymous patient
 * self-entry), /plans, static assets. Everything else under the broker app
 * requires a session.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, stateStore, supabaseConfigured } from "./env";

const PROTECTED_PAGES = ["/", "/session", "/audit"];
const PROTECTED_APIS = ["/api/sessions", "/api/audit"];

const matches = (path: string, prefixes: string[]) =>
  prefixes.some((p) => (p === "/" ? path === "/" : path === p || path.startsWith(p + "/")));

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  // Auth is off in memory mode — let everything through untouched.
  if (stateStore() !== "supabase" || !supabaseConfigured()) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
