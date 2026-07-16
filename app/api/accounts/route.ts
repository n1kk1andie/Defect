import { NextRequest, NextResponse } from "next/server";
import { isAdmin, isRole, listAccounts, removeAccount, upsertAccount } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Account management — admin only. Lets an admin create the inspector and supervisor
// logins whose role decides which screens they see after signing in.

function requireAdmin() {
  return isAdmin(Date.now()) ? null : NextResponse.json({ ok: false, error: "Admin sign-in required." }, { status: 401 });
}

export async function GET() {
  const denied = requireAdmin(); if (denied) return denied;
  return NextResponse.json({ ok: true, accounts: await listAccounts() });
}

export async function POST(req: NextRequest) {
  const denied = requireAdmin(); if (denied) return denied;
  let username = "", password = "", role = "", branch: string | null = null;
  try { const b = await req.json(); username = b?.username || ""; password = b?.password || ""; role = b?.role || ""; branch = b?.branch ?? null; } catch { /* empty */ }
  if (!isRole(role)) return NextResponse.json({ ok: false, error: "Choose a role." }, { status: 400 });
  const res = await upsertAccount({ username, password, role, branch });
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true, accounts: await listAccounts() });
}

export async function DELETE(req: NextRequest) {
  const denied = requireAdmin(); if (denied) return denied;
  const username = new URL(req.url).searchParams.get("username") || "";
  if (!username) return NextResponse.json({ ok: false, error: "No username given." }, { status: 400 });
  await removeAccount(username);
  return NextResponse.json({ ok: true, accounts: await listAccounts() });
}
