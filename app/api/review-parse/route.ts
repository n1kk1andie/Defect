import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadDatasetPayload } from "@/lib/data";
import { parseReviewWorkbook } from "@/lib/xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Parse an uploaded Process Critical Review workbook into register rows and return them
// to the client to load into the Entry screen. Nothing is persisted here — the officer
// reviews the parsed rows and submits them through the normal supervisor gate.
export async function POST(req: NextRequest) {
  const s = getSession(Date.now());
  if (!s) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  if (s.role === "supervisor") return NextResponse.json({ ok: false, error: "Supervisors review submissions; they don’t key them." }, { status: 403 });

  let buf: Buffer;
  try { buf = Buffer.from(await req.arrayBuffer()); } catch { return NextResponse.json({ ok: false, error: "Could not read the file." }, { status: 400 }); }
  if (!buf.length) return NextResponse.json({ ok: false, error: "The file was empty." }, { status: 400 });

  const payload = await loadDatasetPayload("defects");
  // Officers are scoped to their branch; admins may upload a multi-branch workbook.
  const branch = s.role === "inspector" ? s.branch || undefined : undefined;
  let result;
  try { result = parseReviewWorkbook(buf, payload.areas || [], branch); }
  catch { return NextResponse.json({ ok: false, error: "That file isn’t a readable .xlsx workbook." }, { status: 400 }); }

  if (!result.sheets) return NextResponse.json({ ok: false, error: "No review sheet found — expected a Process Area and # of Defects column." }, { status: 400 });
  if (!result.items.length) return NextResponse.json({ ok: false, error: "No reviewed transactions found" + (branch ? " for " + branch + "." : "."), status: 400 });
  return NextResponse.json({ ok: true, items: result.items, stats: { rows: result.items.length, sheets: result.sheets, skipped: result.skipped } });
}
