// Pulsus Quality's front door (Next.js 16 proxy, Node runtime). In order:
//
// 1. Every request loses any x-pq-* header it arrived with; only this file
//    sets them (lib/session.ts reads them back), so they can't be forged.
// 2. Public: the sign-in and sign-up pages, the licence page, health, the
//    web manifest and icons. GET /api/pulse checks its own service grant.
//    Each of these checks its own credential instead of a session: the
//    report-an-issue page and form (/r/<token>, /api/public/report/<token>:
//    the site's link token, Turnstile), the REST API (/api/v1: an API key),
//    the scheduled sweep (/api/cron: CRON_SECRET) and Pulsus Risk's
//    decision callback (/api/risk/status: the intake key).
// 3. Writes: a non-GET API call must come from this site (Origin check).
// 4. A demo deployment (DEMO_MODE=1) opens straight into its fictional
//    company as the chosen persona (guest viewer by default): no sign-in, no
//    licence wall, no trial banner.
// 5. A customer company's Pulsus session (exec_auth: RS256, exact key id,
//    issuer, audience "pulsus-suite", expiry and revocation; lib/platform-jwt.ts)
//    opens that company — if Quality is among its modules, and its plan is not
//    suspended or ended (then: the licence page).
// 6. The licence wall for the institution's own tenant (LICENSE_WALL).
// 7. The institution's machine feed: GET /api/data with the Command Center's
//    Bearer staff token or the shared x-pulse-feed token (read-only).
// 8. A Pulsus staff session opens the institution's tenant; lib/session.ts
//    applies its allow-list.
// Otherwise: 401 for an API, /login for a page.
import { NextRequest, NextResponse } from "next/server";
import { licenseWallActive, licenseWallResponse } from "./lib/licenseWall";
import { claimedIssuer, COMPANY_JWT_ISSUER, platformSession, PLATFORM_COOKIE, type PlatformSession } from "./lib/platform-jwt";

const MODULE_KEY = "quality";
const OWN = "_own";
const DEMO = "_demo";
const H = {
  tenant: "x-pq-tenant", tenantName: "x-pq-tenant-name", email: "x-pq-email", name: "x-pq-name",
  platformRole: "x-pq-prole", operator: "x-pq-operator", plan: "x-pq-plan", requestId: "x-pq-request-id",
};
const PERSONA_COOKIE = "pq_persona";
const DEMO_PERSONAS = ["guest", "admin", "taylor.reid", "robin.ellis", "jordan.blake", "sam.foster"].map((p) => `${p}@demo.pulsus.tech`);

const PUBLIC = /^\/(?:login|signup|licence|api\/health|api\/logout|manifest\.webmanifest|icon\.png|apple-icon\.png|favicon\.ico|pulsus-quality[\w.-]*\.png|r|api\/public|api\/v1|api\/cron|api\/risk\/status)(?:\/|$)/;
const isDemo = () => (process.env.DEMO_MODE || "").trim().replace(/^["']+|["']+$/g, "") === "1";

function forward(req: NextRequest, id: Record<string, string> | null): NextResponse {
  const headers = new Headers(req.headers);
  for (const h of Object.values(H)) headers.delete(h);
  headers.set(H.requestId, crypto.randomUUID());
  if (id) for (const [k, v] of Object.entries(id)) headers.set(k, v);
  const res = NextResponse.next({ request: { headers } });
  return res;
}

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origin).host === req.headers.get("host"); } catch { return false; }
}

function companyIdentity(s: PlatformSession): Record<string, string> {
  const c = s.company!;
  return {
    [H.tenant]: c.id, [H.tenantName]: encodeURIComponent(c.name), [H.email]: s.email, [H.platformRole]: c.role,
    ...(c.plan ? { [H.plan]: `${c.plan.standing}|${c.plan.trialEndsAt ?? ""}` } : {}),
  };
}

function refuse(pathname: string, status: number, title: string, body: string): NextResponse {
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: title }, { status, headers: { "Cache-Control": "no-store" } });
  return new NextResponse(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name=viewport content="width=device-width,initial-scale=1"><title>Pulsus Quality</title><body style="font-family:system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;text-align:center;color:#1C1416;background:#F7F1E8"><h1 style="font-size:22px">${title}</h1><p>${body}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const api = pathname.startsWith("/api/");

  if (api && req.method !== "GET" && req.method !== "HEAD" && !sameOrigin(req)) {
    return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  if (PUBLIC.test(pathname) || /^\/api\/pulse\/?$/.test(pathname)) return forward(req, null);

  if (isDemo()) {
    const p = (req.cookies.get(PERSONA_COOKIE)?.value || "").toLowerCase();
    const email = DEMO_PERSONAS.includes(p) ? p : DEMO_PERSONAS[0];
    return forward(req, { [H.tenant]: DEMO, [H.tenantName]: encodeURIComponent("Meridian Financial Group"), [H.email]: email, [H.platformRole]: "demo" });
  }

  const token = req.cookies.get(PLATFORM_COOKIE)?.value;
  if (token && claimedIssuer(token) === COMPANY_JWT_ISSUER) {
    const s = await platformSession(token);
    if (s?.company) {
      if (!s.company.modules.includes(MODULE_KEY)) return refuse(pathname, 403, "Pulsus Quality isn't switched on for your company", "An owner or admin can add it on the company page in Pulsus.");
      const standing = s.company.plan?.standing;
      if (standing === "suspended" || standing === "ended") {
        if (api) return NextResponse.json({ error: "licence_required" }, { status: 402 });
        if (pathname !== "/licence") { const u = req.nextUrl.clone(); u.pathname = "/licence"; u.search = `?reason=${standing}`; return NextResponse.redirect(u); }
      }
      return forward(req, companyIdentity(s));
    }
  }

  // The licence wall stops sessions that aren't a paying customer company. A
  // visitor who isn't signed in at all goes to the sign-in page instead (with its
  // free-trial link), as in every Pulsus app; a dead-end notice is no front door.
  if (licenseWallActive()) {
    if (!token && !api) {
      const u = req.nextUrl.clone(); u.pathname = "/login";
      u.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
      return NextResponse.redirect(u);
    }
    return licenseWallResponse(pathname);
  }

  if (/^\/api\/data\/?$/.test(pathname) && req.method === "GET") {
    const feed = (process.env.PULSE_FEED_TOKEN || "").trim();
    const authz = req.headers.get("authorization") || "";
    const bearer = authz.startsWith("Bearer ") ? await platformSession(authz.slice(7).trim()) : null;
    if ((feed && req.headers.get("x-pulse-feed") === feed) || (bearer && !bearer.company)) {
      return forward(req, { [H.tenant]: OWN, [H.email]: "platform-feed", [H.platformRole]: "feed" });
    }
  }

  if (token) {
    const s = await platformSession(token);
    if (s && !s.company) return forward(req, { [H.tenant]: OWN, [H.email]: s.email, [H.platformRole]: "staff", ...(s.operator ? { [H.operator]: "1" } : {}) });
  }

  if (api) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
