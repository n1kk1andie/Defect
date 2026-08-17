import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminConfigured, checkLogin, checkRoleLogin, createSessionToken, getSession, isRole, Role, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { resolveRole } from "@/lib/msauth";
import { PLATFORM_COOKIE, verifyPlatformJwt } from "@/lib/server/platform";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Session status. `configured` is always true — a built-in default password
// means sign-in works without any host/env configuration. `admin` is kept for
// backwards compatibility; `role`/`username` describe the signed-in account.
export async function GET() {
  const now = Date.now();
  let s = await getSession(now);

  // Platform single sign-on: if there's no Defect session yet but the visitor
  // holds a valid Command Center session (shared exec_auth cookie on
  // .pulsus.tech, an RS256 JWT verified against the platform JWKS), sign them in
  // here — resolving their role from Defect's OWN existing email→role rules
  // (never broadening access; NEVER admin) — and mint the SAME signed session
  // cookie the normal sign-in issues. Seamless: no second sign-in. Additive: the
  // existing role/admin/Microsoft logins are untouched.
  let bootstrap: { role: Role; username: string; branch: string | null } | null = null;
  if (!s) {
    const platformCookie = (await cookies()).get(PLATFORM_COOKIE)?.value;
    const email = await verifyPlatformJwt(platformCookie);
    const role = email ? resolveRole(email) : null;
    if (email && role) {
      const username = email.split("@")[0];
      bootstrap = { role, username, branch: null };
      s = { role, username, branch: null, exp: now };
    }
  }

  const res = NextResponse.json({
    signedIn: !!s,
    role: s?.role ?? null,
    username: s?.username ?? null,
    branch: s?.branch ?? null,
    admin: s?.role === "admin",
    configured: await adminConfigured(),
  });
  if (bootstrap) {
    res.cookies.set(SESSION_COOKIE, createSessionToken(now, bootstrap), sessionCookieOptions);
  }
  return res;
}

// Two sign-in paths:
//  • Role login: { role: "inspector"|"supervisor", name, branch, password } — the staff
//    pick a role, type their name (used as the submission author) and enter the shared
//    password for that role. Branch scopes what they key/review.
//  • Admin login: { username, password } — a blank username (or "admin") + the admin
//    password.
export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  // Role login.
  if (isRole(body?.role) && body.role !== "admin") {
    const name = (body?.name || "").trim();
    const branch = (body?.branch || "").trim();
    if (!name) return NextResponse.json({ ok: false, error: "Enter your name." }, { status: 400 });
    if (body.role === "inspector" && !branch) return NextResponse.json({ ok: false, error: "Choose your branch." }, { status: 400 });
    if (!(await checkRoleLogin(body.role, body?.password || ""))) {
      return NextResponse.json({ ok: false, error: "Incorrect password for that role." }, { status: 401 });
    }
    const session = { role: body.role, username: name, branch: branch || null };
    (await cookies()).set(SESSION_COOKIE, createSessionToken(Date.now(), session), sessionCookieOptions);
    return NextResponse.json({ ok: true, ...session });
  }

  // Admin login (username optional; blank/"admin" + admin password).
  const result = await checkLogin(body?.username || "", body?.password || "");
  if (!result) return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  (await cookies()).set(SESSION_COOKIE, createSessionToken(Date.now(), result), sessionCookieOptions);
  return NextResponse.json({ ok: true, role: result.role, username: result.username, branch: result.branch });
}
