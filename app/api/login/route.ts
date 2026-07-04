import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminConfigured, checkPassword, createSessionToken, isAdmin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Session status + whether an admin password is configured on this deployment.
// `configured:false` means ADMIN_PASSWORD is not set (and no in-app password) here —
// a safe boolean, never the value itself.
export async function GET() {
  return NextResponse.json({ admin: isAdmin(Date.now()), configured: await adminConfigured() });
}

// Sign in.
export async function POST(req: NextRequest) {
  let password = "";
  try { password = (await req.json())?.password || ""; } catch { /* empty */ }
  if (!(await adminConfigured())) {
    return NextResponse.json(
      { ok: false, error: "Admin password is not configured on this deployment. Set ADMIN_PASSWORD in Vercel and redeploy." },
      { status: 503 },
    );
  }
  if (!(await checkPassword(password))) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }
  cookies().set(SESSION_COOKIE, createSessionToken(Date.now()), sessionCookieOptions);
  return NextResponse.json({ ok: true });
}
