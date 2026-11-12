// Strict security headers for every response — the same set the demo deployment
// (claude/demo-environment) sends from its next.config.mjs.
//
// Kept in this module and applied with withSecurityHeaders() so that live and
// demo configs merge cleanly. If the config already sends these headers itself
// (the demo does), they are not added a second time.

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self' https://*.pulsus.tech",
  "form-action 'self'",
  "img-src 'self' data: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/** Add the security headers (and drop X-Powered-By) to a Next.js config. */
export function withSecurityHeaders(config) {
  const own = config.headers;
  return {
    ...config,
    poweredByHeader: false,
    async headers() {
      const rules = own ? await own() : [];
      const covered = rules.some((r) => r.source === "/:path*" && (r.headers || []).some((h) => h.key === "Content-Security-Policy"));
      return covered ? rules : [...rules, { source: "/:path*", headers: securityHeaders }];
    },
  };
}
