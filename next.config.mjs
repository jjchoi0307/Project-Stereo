/** @type {import('next').NextConfig} */

// Security headers applied to every response. Defense-in-depth for a PHI app
// (HIPAA §164.312(e) transmission security + general hardening). HSTS forces
// HTTPS; frame-ancestors/X-Frame-Options block clickjacking; nosniff blocks MIME
// confusion; Referrer-Policy avoids leaking URLs; Permissions-Policy disables
// device APIs we never use. The CSP is pragmatic (allows inline for Next's
// bootstrap) — a nonce-based strict CSP is the documented next step (SECURITY.md).
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next injects a small inline bootstrap; 'unsafe-inline' keeps it working.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'", // the browser only talks to same-origin /api
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
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
