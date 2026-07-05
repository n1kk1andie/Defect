import { NextRequest, NextResponse } from "next/server";
import { checkPassword, isAdmin, setPassword } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isAdmin(Date.now())) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  let current = "", next = "";
  try { const b = await req.json(); current = b?.current || ""; next = b?.new || ""; } catch { /* empty */ }
  if (next.length < 4) return NextResponse.json({ ok: false, error: "New password must be at least 4 characters." }, { status: 400 });
  if (!(await checkPassword(current))) return NextResponse.json({ ok: false, error: "Current password is incorrect." }, { status: 403 });
  await setPassword(next);
  return NextResponse.json({ ok: true });
}
