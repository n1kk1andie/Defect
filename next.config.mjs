/** @type {import('next').NextConfig} */

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

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// Mirror the server-only DEMO_MODE into a build-inlined public flag so client
// components can tell they are running in a demo — the header badge reads it.
// One env var (DEMO_MODE=1 on the demo Vercel project) drives everything;
// production never sets it, so this is always "" there.
const DEMO_MODE = (process.env.DEMO_MODE || "").trim() === "1" ? "1" : "";

const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_DEMO_MODE: DEMO_MODE },
  // xlsx is CommonJS; keep it external to the server bundle so it loads cleanly.
  serverExternalPackages: ["xlsx"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
