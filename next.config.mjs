/** @type {import('next').NextConfig} */

// Security headers applied to every response. Defense-in-depth for a PHI app
// (HIPAA §164.312(e) transmission security + general hardening). HSTS forces
// HTTPS; frame-ancestors/X-Frame-Options block clickjacking; nosniff blocks MIME
// confusion; Referrer-Policy avoids leaking URLs; Permissions-Policy disables
// device APIs we never use.
//
// NOTE: the Content-Security-Policy is set in middleware.ts (not here) as a
// single uniform policy. It is strict everywhere; it globally permits one image
// CDN (i.ytimg.com) and one trusted frame origin (youtube-nocookie) for the "Our
// Heroes" showcase — these are applied to every route (not scoped per-route),
// because client-side soft navigations don't re-apply a per-route CSP. Keeping
// the other (uniform) headers here.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

// PHI must never be cached by the browser, a CDN, or Vercel's edge. Every /api
// response carries patient/session data or is otherwise per-request, so mark the
// whole API surface no-store (HIPAA §164.312 + stealth: no PHI left in caches).
const noStoreHeaders = [
  { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
  { key: "Pragma", value: "no-cache" },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise the framework
  productionBrowserSourceMaps: false, // don't ship source maps that expose internals
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: noStoreHeaders },
    ];
  },
};

export default nextConfig;
