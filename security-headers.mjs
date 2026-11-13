// Strict security headers for every response, in live and demo alike.
//
// The sign-in and sign-up pages call the Pulsus account service from the
// browser, so its hosts are in connect-src; sign-up's human check is
// Cloudflare Turnstile (its script, its calls home and its frame). Pulsus
// pages (about.pulsus.tech, the Command Center) may frame the app.

const ACCOUNT_HOSTS = ["https://executive.pulsus.tech", "https://demo-executive.pulsus.tech", (process.env.PLATFORM_URL || "").trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "")].filter(Boolean).join(" ");
const TURNSTILE = "https://challenges.cloudflare.com";
const dev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self' https://*.pulsus.tech",
  "form-action 'self' https://executive.pulsus.tech https://demo-executive.pulsus.tech",
  "img-src 'self' data: blob: https:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}${dev ? " 'unsafe-eval'" : ""}`,
  `connect-src 'self' ${ACCOUNT_HOSTS} ${TURNSTILE}`,
  `frame-src 'self' ${TURNSTILE}`,
].join("; ");

export const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

/** Add the security headers (and drop X-Powered-By) to a Next.js config. */
export function withSecurityHeaders(config) {
  return {
    ...config,
    poweredByHeader: false,
    async headers() {
      return [{ source: "/:path*", headers: securityHeaders }];
    },
  };
}
