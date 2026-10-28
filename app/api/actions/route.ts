import { NextRequest, NextResponse } from "next/server";
import { requestSession } from "@/lib/auth";
import { storageIsDurable } from "@/lib/storage";
import { createAction, deleteAction, editAction, listActionsForSession, stepAction, type ActionStep } from "@/lib/actions";

export const dynamic = "force-dynamic";

const NO_STORAGE = "Couldn’t save: the app’s storage isn’t connected. An admin needs to connect storage to this app and redeploy.";
const STEPS: ActionStep[] = ["start", "submit", "verify", "return", "reopen"];

// Corrective actions. Every call needs a signed-in session; lib/actions enforces who may
// see, raise, work and verify each action.

export async function GET() {
  const s = await requestSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ ok: true, actions: await listActionsForSession(s) });
}

export async function POST(req: NextRequest) {
  const s = await requestSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  if (!storageIsDurable()) return NextResponse.json({ ok: false, error: NO_STORAGE }, { status: 503 });
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const op = body?.op;

  let res;
  if (op === "create") res = await createAction(s, body);
  else if (op === "edit") res = await editAction(s, body?.id || "", body);
  else if (op === "delete") res = await deleteAction(s, body?.id || "");
  else if (STEPS.includes(op)) res = await stepAction(s, body?.id || "", op, { note: body?.note, evidence: body?.evidence });
  else return NextResponse.json({ ok: false, error: "Unknown request." }, { status: 400 });

  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: res.status || 400 });
  return NextResponse.json({ ok: true, actions: await listActionsForSession(s) });
}
