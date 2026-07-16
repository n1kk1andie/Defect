import { NextRequest, NextResponse } from "next/server";
import { isAdmin, isRole, rolePasswordStatus, setRolePassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Admin-only: view which role sign-in passwords are set, and set them. These are the
// shared passwords staff use on the role login (Inspector / Supervisor).

function requireAdmin() {
  return isAdmin(Date.now()) ? null : NextResponse.json({ ok: false, error: "Admin sign-in required." }, { status: 401 });
}

export async function GET() {
  const denied = requireAdmin(); if (denied) return denied;
  return NextResponse.json({ ok: true, status: await rolePasswordStatus() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(); if (denied) return denied;
  let role = "", password = "";
  try { const b = await req.json(); role = b?.role || ""; password = b?.password || ""; } catch { /* empty */ }
  if (!isRole(role) || role === "admin") return NextResponse.json({ ok: false, error: "Choose a sign-in role." }, { status: 400 });
  if ((password || "").trim().length < 4) return NextResponse.json({ ok: false, error: "Password must be at least 4 characters." }, { status: 400 });
  await setRolePassword(role, password);
  return NextResponse.json({ ok: true, status: await rolePasswordStatus() });
}
