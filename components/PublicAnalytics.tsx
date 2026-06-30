"use client";

import { usePathname } from "next/navigation";
import { Analytics } from "@vercel/analytics/next";

/**
 * Web analytics scoped to the PUBLIC marketing/funnel pages ONLY. The
 * authenticated broker workspace handles PHI and is deliberately left
 * un-instrumented — no third-party beacon on the PHI surface (stealth posture).
 * The patient intake link (/intake/[token]) is also excluded.
 *
 * Vercel Analytics records the App-Router route PATTERN (e.g. /plans), not raw
 * ids, and beacons same-origin (/_vercel/insights/*) so it stays within the
 * strict CSP. Use only under the Vercel BAA; never attach PHI to custom events.
 */
const PUBLIC_PREFIXES = ["/home", "/login", "/signup", "/plans"];

export default function PublicAnalytics() {
  const pathname = usePathname();
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
  return isPublic ? <Analytics /> : null;
}
