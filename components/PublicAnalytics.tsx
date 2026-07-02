"use client";

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

/**
 * Web Analytics + Speed Insights scoped to the PUBLIC marketing/funnel pages
 * ONLY. The authenticated broker workspace handles PHI and is deliberately left
 * un-instrumented — no third-party beacon on the PHI surface (stealth posture).
 * The patient intake link (/intake/[token]) is also excluded.
 *
 * Both record the App-Router route PATTERN (e.g. /plans), not raw ids, and beacon
 * same-origin so they stay within the strict CSP. Use only under the Vercel BAA;
 * never attach PHI to custom events.
 */
// The landing now lives at "/" (which also serves the PHI workspace to signed-in
// brokers, so it can't be path-gated here) — PublicHome renders its own analytics.
// These are the remaining public, non-PHI pages. NOTE: /plans (the Plan Library) is
// intentionally excluded — it is now broker-only and confidential, so it carries no
// public third-party beacon.
const PUBLIC_PREFIXES = ["/login", "/signup"];

export default function PublicAnalytics() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isPublic) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
