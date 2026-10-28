// Pulsus Quality front-door gate. Viewing used to be open; now every page and
// protected API requires a session. A visitor with none is sent to /login
// (pages) or gets 401 (APIs). This runs on the Edge BEFORE page.tsx renders, so
// the server-rendered defect data is never sent to an unauthenticated visitor.
//
// A request is allowed through if it carries ONE of:
//   • a valid Quality session cookie (vmbs_session) — the app's own sign-in;
//   • a valid Command Center platform session (exec_auth cookie, an RS256 JWT
//     verified against the Command Center's public JWKS) — so a viewer already in
//     the Command Center opens Quality with no second sign-in;
//   • a Command Center server-to-server read — the synthesis pull of /api/data
//     carries either the shared x-pulse-feed token or a Bearer platform JWT.
//
// Edge-safe: the session cookie is checked with Web Crypto using the same secret
// and payload as lib/auth.ts.
import { NextRequest, NextResponse } from "next/server";
import { licenseWallActive, licenseWallResponse } from "./lib/licenseWall";

const SESSION_COOKIE = "vmbs_session";
const PLATFORM_COOKIE = "exec_auth";

function secret(): string {
  // Matches lib/auth.ts secret() (incl. its built-in default), so a valid session
  // verifies here even before SESSION_SECRET is set — and the built-in admin
  // password still lets someone sign in, so the app is never locked out.
  return process.env.SESSION_SECRET || "vmbs-dev-secret-change-me";
}

// ── base64url + HMAC (must match Node's base64url digest in lib/auth.ts) ──────
function bufToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlBytes(s: string): Uint8Array {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToStr(s: string): string {
  return new TextDecoder().decode(b64urlBytes(s));
}
function timingEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacB64url(sec: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(sec), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return bufToB64url(sig);
}

// Token = `${body}.${sig}`; body = base64url(JSON), sig = HMAC-SHA256(body).
async function validSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const body = token.slice(0, i), sig = token.slice(i + 1);
  let expected: string;
  try { expected = await hmacB64url(secret(), body); } catch { return false; }
  if (!timingEqual(sig, expected)) return false;
  let p: { exp?: number };
  try { p = JSON.parse(b64urlToStr(body)); } catch { return false; }
  if (!p || typeof p.exp !== "number" || Date.now() > p.exp) return false;
  return true;
}

// ── Command Center platform JWT (RS256, verified via JWKS) ────────────────────
const JWKS_URL = (process.env.PLATFORM_JWKS_URL || "").trim() || "https://executive.pulsus.tech/api/jwks";
const PLATFORM_JWT_ISSUER = "pulsus-command-center";
let jwksCache: Array<Record<string, string>> | null = null;
let jwksAt = 0;
async function jwksKeys(): Promise<Array<Record<string, string>>> {
  const now = Date.now();
  if (jwksCache && now - jwksAt < 5 * 60 * 1000) return jwksCache;
  const r = await fetch(JWKS_URL, { cache: "no-store" });
  if (!r.ok) throw new Error("jwks " + r.status);
  jwksCache = ((await r.json()).keys as Array<Record<string, string>>) || [];
  jwksAt = now;
  return jwksCache;
}
async function validPlatformJwt(token: string | undefined): Promise<boolean> {
  if (!token || token.split(".").length !== 3) return false;
  const [h, p, sig] = token.split(".");
  let header: Record<string, string>, payload: Record<string, unknown>;
  try { header = JSON.parse(b64urlToStr(h)); payload = JSON.parse(b64urlToStr(p)); } catch { return false; }
  if (header.alg !== "RS256" || payload.iss !== PLATFORM_JWT_ISSUER) return false;
  if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) return false;
  let keys: Array<Record<string, string>>;
  try { keys = await jwksKeys(); } catch { return false; }
  const jwk = keys.find((k) => k.kid === header.kid) || keys[0];
  if (!jwk) return false;
  try {
    const key = await crypto.subtle.importKey(
      "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key,
      b64urlBytes(sig) as unknown as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
    );
  } catch { return false; }
}

// What stays public while the licence holds: the sign-in page and endpoints.
const PUBLIC_PATH = /^\/(?:login|api\/login|api\/logout|api\/auth)(?:\/|$)/;

// ── Pulsus platform companies ────────────────────────────────────────────────
// A Pulsus company's session (issuer "pulsus-company") carries the company, the
// member's role and the company's modules. Quality opens only when "quality" is
// among them, and then passes the company on to the routes in trusted request
// headers — stripped from EVERY incoming request first, so they can't be forged.
const COMPANY_JWT_ISSUER = "pulsus-company";
const MODULE_KEY = "quality";
const COMPANY_HEADERS = ["x-pulsus-company", "x-pulsus-company-name", "x-pulsus-role", "x-pulsus-email"];
// What a company member may reach: the app and the routes that work its own
// reviews, actions, attachments, downloads and program. This deployment's own
// sign-in, passwords, accounts and workbook upload are not theirs to use.
const COMPANY_PATH = /^\/(?:$|api\/(?:data|submissions|actions|attachment|export|file|program)(?:\/|$|\?))/;

interface CompanySession { email: string; company: { id: string; name: string; role: string; modules: string[] } }

async function verifyCompanySession(token: string | undefined): Promise<CompanySession | null> {
  if (!token || token.split(".").length !== 3) return null;
  const [h, p, sig] = token.split(".");
  let header: Record<string, string>, payload: Record<string, unknown>;
  try { header = JSON.parse(b64urlToStr(h)); payload = JSON.parse(b64urlToStr(p)); } catch { return null; }
  if (header.alg !== "RS256" || payload.iss !== COMPANY_JWT_ISSUER) return null;
  if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) return null;
  const companyId = typeof payload.company_id === "string" ? payload.company_id : "";
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(companyId)) return null;
  let keys: Array<Record<string, string>>;
  try { keys = await jwksKeys(); } catch { return null; }
  const jwk = keys.find((k) => k.kid === header.kid) || keys[0];
  if (!jwk) return null;
  try {
    const key = await crypto.subtle.importKey(
      "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key,
      b64urlBytes(sig) as unknown as BufferSource,
      new TextEncoder().encode(`${h}.${p}`) as unknown as BufferSource,
    );
    if (!ok) return null;
  } catch { return null; }
  const email = String((payload.email as string) || (payload.sub as string) || "").trim().toLowerCase();
  if (!email) return null;
  return {
    email,
    company: {
      id: companyId,
      name: typeof payload.company_name === "string" ? payload.company_name.slice(0, 80) : companyId,
      role: typeof payload.role === "string" ? payload.role : "viewer",
      modules: Array.isArray(payload.modules) ? payload.modules.filter((m): m is string => typeof m === "string") : [],
    },
  };
}

/** Pass the request on with the trusted company headers set from the verified session (or cleared). */
function forward(req: NextRequest, session: CompanySession | null = null): NextResponse {
  const headers = new Headers(req.headers);
  for (const h of COMPANY_HEADERS) headers.delete(h);
  if (session) {
    headers.set("x-pulsus-company", session.company.id);
    headers.set("x-pulsus-company-name", encodeURIComponent(session.company.name));
    headers.set("x-pulsus-role", session.company.role);
    headers.set("x-pulsus-email", session.email);
  }
  return NextResponse.next({ request: { headers } });
}

/** A company member asking for something that isn't theirs: an API not open to
 *  companies (404), or any path when Quality isn't among their modules (403). */
function companyRefusal(pathname: string, notEnabled: boolean): NextResponse {
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: notEnabled ? "module_not_enabled" : "Not found" }, { status: notEnabled ? 403 : 404, headers: { "Cache-Control": "no-store" } });
  }
  return new NextResponse(
    "<!doctype html><meta name=viewport content='width=device-width'><title>Pulsus Quality</title><body style='font-family:system-ui;max-width:520px;margin:15vh auto;padding:0 16px;text-align:center'><h2>Pulsus Quality isn't switched on for your company</h2><p>An owner or admin can add it on the company page in Pulsus.</p></body>",
    { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function middleware(req: NextRequest) {
  // A Pulsus company's session carries its company on EVERY path, so no route
  // answers a company member with this deployment's own data; a company without
  // this module is refused outright. Customer companies are licensed by their own
  // subscription (checked by the Command Center), so the wall below isn't theirs.
  const { pathname } = req.nextUrl;
  const companySession = await verifyCompanySession(req.cookies.get(PLATFORM_COOKIE)?.value);
  if (companySession) {
    if (!companySession.company.modules.includes(MODULE_KEY)) return companyRefusal(pathname, true);
    if (!COMPANY_PATH.test(pathname)) {
      if (pathname.startsWith("/api/")) return companyRefusal(pathname, false);
      const url = req.nextUrl.clone(); url.pathname = "/"; url.search = "";
      return NextResponse.redirect(url);
    }
    return forward(req, companySession);
  }

  // The licence wall for this deployment's own tenant: while it is up, everyone
  // who isn't a customer company gets the notice — its own sign-in included.
  if (licenseWallActive()) return licenseWallResponse(req.nextUrl.pathname);
  if (PUBLIC_PATH.test(req.nextUrl.pathname)) return forward(req);
  // Command Center server-to-server read of /api/data: the shared feed token, or
  // the Bearer platform JWT it sends. Either keeps the synthesis feed alive.
  const feed = (process.env.PULSE_FEED_TOKEN || "").trim();
  if (feed && req.headers.get("x-pulse-feed") === feed) return forward(req);
  const authz = req.headers.get("authorization") || "";
  if (authz.startsWith("Bearer ") && (await validPlatformJwt(authz.slice(7)))) return forward(req);

  // Command Center platform session only — an RS256 JWT verified against the
  // Command Center's public JWKS (asymmetric; unforgeable). The HMAC own-session
  // (vmbs_session) door is intentionally disabled at the GATE: it is only as strong
  // as a shared secret, so the sole browser way past the front door is the hard
  // platform path (plus the machine feed / Bearer above). The in-app role login
  // still uses vmbs_session at the handler level — Command Center viewers arrive
  // with exec_auth on every request. Re-enable the validSession check here when
  // Microsoft SSO is turned on AND a real SESSION_SECRET is set.
  if (await validPlatformJwt(req.cookies.get(PLATFORM_COOKIE)?.value)) return forward(req);

  const { search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return NextResponse.redirect(url);
}

// Protect everything except the sign-in page, the sign-in/SSO endpoints, Next
// internals, and static files (any path with a dot — images, favicon, etc.).
export const config = {
  // /api/:path* is listed on its own so the gate (which strips forged x-pulsus-*
  // headers) also runs on API paths that contain a dot.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)", "/api/:path*"],
};
