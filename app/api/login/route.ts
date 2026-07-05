import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { adminConfigured, checkPassword, createSessionToken, isAdmin, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Session status. `configured` is always true — a built-in default password
// means sign-in works without any host/env configuration.
export async function GET() {
  return NextResponse.json({ admin: isAdmin(Date.now()), configured: await adminConfigured() });
}

// Sign in.
export async function POST(req: NextRequest) {
  let password = "";
  try { password = (await req.json())?.password || ""; } catch { /* empty */ }
  if (!(await checkPassword(password))) {
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 401 });
  }
  cookies().set(SESSION_COOKIE, createSessionToken(Date.now()), sessionCookieOptions);
  return NextResponse.json({ ok: true });
}
