// Demo access: the register-to-view gate in front of a demo deployment.
//
// Active ONLY on a demo deployment (DEMO_MODE=1); a live deployment never calls
// into it (demoAccessGate returns null straight away), so live behaviour is
// unchanged.
//
// Contract (shared by every Pulsus demo app; the platform issues the token):
//   cookie   pz_demo, set by https://executive.pulsus.tech on Domain=.pulsus.tech
//            when a visitor registers (kind "visitor") or opens a Webby judge
//            link (kind "webby"). It is NOT a session: it grants no company, role
//            or data, only "this browser may look at the demos".
//   token    a JWT signed with the platform's key, published at the FIXED url
//            https://executive.pulsus.tech/api/jwks (DEMO_ACCESS_JWKS_URL
//            overrides it for tests). iss "pulsus-demo-access", aud
//            "pulsus-demo", kind visitor|webby, exp in the future.
//   webby    a Webby token can be revoked before it expires: the platform answers
//            GET /api/demo/access/check (on the JWKS origin, or
//            DEMO_ACCESS_CHECK_URL) with {ok} for the token, sent as the pz_demo
//            cookie and as a Bearer token. Asked at most once per 10 minutes per
//            token; if the platform can't be reached, a cryptographically valid
//            token is accepted.
//   no/bad   page requests → 302 to the platform's register page
//            (…/demo/register?app=<key>&next=<full current url>); API calls → 401
//            JSON; static assets, favicons, manifest, icons, robots and health
//            checks pass untouched.
//
// Local test runs of a demo build (the accessibility suite) can switch the gate
// off with DEMO_ACCESS_GATE=off. That switch is ignored on Vercel (VERCEL=1), so
// a deployed demo is always gated.
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTHeaderParameters, type FlattenedJWSInput } from "jose";
import { NextResponse, type NextRequest } from "next/server";

export const DEMO_ACCESS_COOKIE = "pz_demo";
export const DEMO_ACCESS_ISSUER = "pulsus-demo-access";
export const DEMO_ACCESS_AUDIENCE = "pulsus-demo";
export const DEMO_PLATFORM_ORIGIN = "https://executive.pulsus.tech";
export const DEMO_REGISTER_URL = `${DEMO_PLATFORM_ORIGIN}/demo/register`;
const DEFAULT_JWKS_URL = `${DEMO_PLATFORM_ORIGIN}/api/jwks`;
const CHECK_PATH = "/api/demo/access/check";
const ALGORITHMS = ["RS256", "PS256", "ES256", "EdDSA"];

const JWKS_TTL_MS = 10 * 60 * 1000;
const JWKS_REFRESH_MIN_MS = 60 * 1000;
const CHECK_TTL_MS = 10 * 60 * 1000;
const CHECK_TIMEOUT_MS = 3000;

export type DemoAccessKind = "visitor" | "webby";
export interface DemoAccess { sub: string; kind: DemoAccessKind; exp: number }

export function isDemoMode(): boolean {
  return (process.env.DEMO_MODE || "").trim().replace(/^["']+|["']+$/g, "") === "1";
}

/** The gate runs on every demo deployment; DEMO_ACCESS_GATE=off is honoured only off Vercel (local test runs). */
export function demoAccessGateActive(): boolean {
  if (!isDemoMode()) return false;
  const off = (process.env.DEMO_ACCESS_GATE || "").trim().toLowerCase() === "off";
  const vercel = (process.env.VERCEL || "").trim() !== "";
  return !(off && !vercel);
}

function jwksUrl(): string {
  return (process.env.DEMO_ACCESS_JWKS_URL || "").trim() || DEFAULT_JWKS_URL;
}
function checkUrl(): string {
  const o = (process.env.DEMO_ACCESS_CHECK_URL || "").trim();
  if (o) return o;
  try { return new URL(CHECK_PATH, jwksUrl()).href; } catch { return DEMO_PLATFORM_ORIGIN + CHECK_PATH; }
}

// ── The platform's public keys, cached; an unknown kid re-fetches (at most once a minute). ──
type KeySet = { url: string; at: number; kids: Set<string>; get: ReturnType<typeof createLocalJWKSet> };
let keySet: KeySet | null = null;

async function fetchKeys(url: string): Promise<KeySet> {
  const r = await fetch(url, { cache: "no-store", headers: { accept: "application/json" }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
  if (!r.ok) throw new Error("jwks " + r.status);
  const body = (await r.json()) as JSONWebKeySet;
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  return { url, at: Date.now(), kids: new Set(keys.map((k) => String(k.kid ?? ""))), get: createLocalJWKSet({ keys }) };
}

async function keys(force: boolean): Promise<KeySet> {
  const url = jwksUrl();
  const fresh = keySet && keySet.url === url && Date.now() - keySet.at < JWKS_TTL_MS;
  if (fresh && !force) return keySet!;
  try {
    keySet = await fetchKeys(url);
  } catch (e) {
    if (!keySet || keySet.url !== url) throw e; // nothing to fall back on
    // Keep the last good key list when the platform is briefly unreachable.
  }
  return keySet!;
}

async function getKey(header: JWTHeaderParameters, token: FlattenedJWSInput) {
  let set = await keys(false);
  if (header.kid && !set.kids.has(header.kid) && Date.now() - set.at > JWKS_REFRESH_MIN_MS) set = await keys(true);
  return set.get(header, token);
}

// ── Webby revocation check: at most once per 10 minutes per token. ──
const checks = new Map<string, { ok: boolean; at: number }>();

async function webbyStillValid(token: string): Promise<boolean> {
  const hit = checks.get(token);
  if (hit && Date.now() - hit.at < CHECK_TTL_MS) return hit.ok;
  let ok = true; // unreachable platform → accept the (cryptographically valid) token
  try {
    const r = await fetch(checkUrl(), {
      cache: "no-store",
      headers: { accept: "application/json", cookie: `${DEMO_ACCESS_COOKIE}=${token}`, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (r.status === 401 || r.status === 403 || r.status === 410) ok = false;
    else if (r.ok) {
      const j = (await r.json().catch(() => null)) as { ok?: unknown } | null;
      if (j && j.ok === false) ok = false;
    }
  } catch { /* unreachable: accept */ }
  if (checks.size > 1000) checks.clear();
  checks.set(token, { ok, at: Date.now() });
  return ok;
}

/** The visitor's demo access, or null when the token is missing, invalid, expired or revoked. */
export async function verifyDemoAccess(token: string | null | undefined): Promise<DemoAccess | null> {
  if (!token || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: DEMO_ACCESS_ISSUER,
      audience: DEMO_ACCESS_AUDIENCE,
      algorithms: ALGORITHMS,
      requiredClaims: ["exp", "sub"],
    });
    const kind = payload.kind;
    if (kind !== "visitor" && kind !== "webby") return null;
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (kind === "webby" && !(await webbyStillValid(token))) return null;
    return { sub: payload.sub, kind, exp: payload.exp as number };
  } catch {
    return null;
  }
}

/** Paths every demo leaves open: Next internals, static files, icons, manifest, robots, health. */
const STATIC_FILE = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|css|js|mjs|map|woff2?|ttf|otf|eot|txt|xml|webmanifest)$/i;
export function demoAccessExempt(pathname: string): boolean {
  if (pathname.startsWith("/_next/") || pathname.startsWith("/.well-known/")) return true;
  if (pathname === "/api/health" || pathname === "/health" || pathname === "/healthz") return true;
  if (pathname === "/robots.txt" || pathname === "/sitemap.xml") return true;
  if (pathname === "/manifest.webmanifest" || pathname === "/manifest.json" || pathname === "/site.webmanifest") return true;
  if (/^\/(?:favicon|icon|apple-icon|apple-touch-icon|opengraph-image|twitter-image)(?:[-./]|$)/i.test(pathname)) return true;
  if (!pathname.startsWith("/api/") && STATIC_FILE.test(pathname)) return true;
  return false;
}

/** The address the visitor asked for, as they see it (behind the proxy). */
export function currentUrl(req: NextRequest): string {
  const u = req.nextUrl;
  const first = (v: string | null) => (v || "").split(",")[0].trim();
  const host = first(req.headers.get("x-forwarded-host")) || first(req.headers.get("host")) || u.host;
  const proto = first(req.headers.get("x-forwarded-proto")) || u.protocol.replace(/:$/, "");
  return `${proto}://${host}${u.pathname}${u.search}`;
}

export function registerUrl(app: string, next: string): string {
  return `${DEMO_REGISTER_URL}?app=${encodeURIComponent(app)}&next=${encodeURIComponent(next)}`;
}

export interface DemoAccessGateOptions {
  /** The app's key on the register page (risk, quality, accord, cx, panorama, tech, cash, recon…). */
  app: string;
  /** This app's own endpoints that must stay open (they check their own credentials). */
  exempt?: (pathname: string) => boolean;
}

/**
 * The gate. Returns a response to send (302 to the register page, or 401 JSON
 * for an API call) when the visitor has no valid demo access, else null — and
 * always null on a live deployment.
 */
export async function demoAccessGate(req: NextRequest, opts: DemoAccessGateOptions): Promise<NextResponse | null> {
  if (!demoAccessGateActive()) return null;
  const { pathname } = req.nextUrl;
  if (req.method === "OPTIONS") return null;
  if (demoAccessExempt(pathname) || opts.exempt?.(pathname)) return null;
  if (await verifyDemoAccess(req.cookies.get(DEMO_ACCESS_COOKIE)?.value)) return null;
  const register = registerUrl(opts.app, currentUrl(req));
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "demo_registration_required", register },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return new NextResponse(null, { status: 302, headers: { Location: register, "Cache-Control": "no-store" } });
}

/** Tests only: forget cached keys and webby checks. */
export function resetDemoAccessCache(): void {
  keySet = null;
  checks.clear();
}
