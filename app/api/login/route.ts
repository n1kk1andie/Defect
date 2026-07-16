import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminConfigured, checkLogin, createSessionToken, getSession, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Session status. `configured` is always true — a built-in default password
// means sign-in works without any host/env configuration. `admin` is kept for
// backwards compatibility; `role`/`username` describe the signed-in account.
export async function GET() {
  const s = getSession(Date.now());
  return NextResponse.json({
    signedIn: !!s,
    role: s?.role ?? null,
    username: s?.username ?? null,
    branch: s?.branch ?? null,
    admin: s?.role === "admin",
    configured: await adminConfigured(),
  });
}

// Sign in with a username + password. The username is optional — a blank username
// (or "admin") is treated as the built-in admin login.
export async function POST(req: NextRequest) {
  let username = "", password = "";
  try { const b = await req.json(); username = b?.username || ""; password = b?.password || ""; } catch { /* empty */ }
  const result = await checkLogin(username, password);
  if (!result) {
    return NextResponse.json({ ok: false, error: "Incorrect username or password." }, { status: 401 });
  }
  cookies().set(SESSION_COOKIE, createSessionToken(Date.now(), result), sessionCookieOptions);
  return NextResponse.json({ ok: true, role: result.role, username: result.username, branch: result.branch });
}
