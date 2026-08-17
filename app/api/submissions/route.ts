import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { storageIsDurable } from "@/lib/storage";
import { deleteSubmission, listForSession, resolveDefects, reviewSubmission, saveSubmission } from "@/lib/submissions";

export const dynamic = "force-dynamic";

// Shown when the server can't persist a write — almost always because no Vercel Blob
// store is connected to the project (so there's no writable storage on the serverless FS).
const NO_STORAGE = "Couldn’t save: the app’s storage isn’t connected. An admin needs to connect a Vercel Blob store to this project and redeploy.";

// Inspector submissions + supervisor review. Every action requires a signed-in session;
// the submissions layer enforces who may see, edit and review each record.

export async function GET() {
  const s = await getSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ ok: true, submissions: await listForSession(s), me: { role: s.role, username: s.username, branch: s.branch } });
}

export async function POST(req: NextRequest) {
  const s = await getSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const action = body?.action;

  // Every action below writes. Fail fast with a clear message if storage can't persist,
  // rather than letting a read-only-filesystem error surface as an opaque 500.
  if (["save", "submit", "delete", "resolve", "review"].includes(action) && !storageIsDurable()) {
    return NextResponse.json({ ok: false, error: NO_STORAGE }, { status: 503 });
  }

  if (action === "save" || action === "submit") {
    if (s.role === "supervisor") return NextResponse.json({ ok: false, error: "Supervisors review submissions; they don’t key them." }, { status: 403 });
    const res = await saveSubmission(s, { ...body, submit: action === "submit" });
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status || 400 });
    return NextResponse.json({ ok: true, submission: res.submission, submissions: await listForSession(s) });
  }

  if (action === "delete") {
    const res = await deleteSubmission(s, body?.id || "");
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status || 400 });
    return NextResponse.json({ ok: true, submissions: await listForSession(s) });
  }

  if (action === "resolve") {
    const res = await resolveDefects(s, Array.isArray(body?.refs) ? body.refs : [], body?.resolved !== false);
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status || 400 });
    return NextResponse.json({ ok: true, submissions: res.submissions, changed: res.changed });
  }

  if (action === "review") {
    const decision = body?.decision === "return" ? "return" : "approve";
    const res = await reviewSubmission(s, body?.id || "", decision, body?.note || "");
    if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status || 400 });
    return NextResponse.json({ ok: true, submission: res.submission, submissions: await listForSession(s) });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
