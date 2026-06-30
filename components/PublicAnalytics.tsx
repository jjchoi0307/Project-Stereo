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
const PUBLIC_PREFIXES = ["/home", "/login", "/signup", "/plans"];

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
