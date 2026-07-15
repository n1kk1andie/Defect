import { NextRequest, NextResponse } from "next/server";
import { checkPassword, isAdmin, setPassword } from "@/lib/auth";
import { storageIsDurable } from "@/lib/storage";

export const dynamic = "force-dynamic";

const NO_STORE_MSG =
  "This deployment has no persistent storage, so a new password can’t be saved (it would be lost on the next request). " +
  "Connect a Vercel Blob store to the project (Storage → Blob), or set ADMIN_PASSWORD in the project’s environment variables instead.";

export async function POST(req: NextRequest) {
  if (!isAdmin(Date.now())) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  let current = "", next = "";
  try { const b = await req.json(); current = b?.current || ""; next = b?.new || ""; } catch { /* empty */ }
  if (next.length < 4) return NextResponse.json({ ok: false, error: "New password must be at least 4 characters." }, { status: 400 });
  if (!(await checkPassword(current))) return NextResponse.json({ ok: false, error: "Current password is incorrect." }, { status: 403 });
  // Don't pretend to save a change that won't survive the next request.
  if (!storageIsDurable()) return NextResponse.json({ ok: false, error: NO_STORE_MSG }, { status: 503 });
  await setPassword(next);
  return NextResponse.json({ ok: true });
}
