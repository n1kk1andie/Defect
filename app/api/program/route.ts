import { NextRequest, NextResponse } from "next/server";
import { currentCompany, companyManager } from "@/lib/company";
import { loadProgram, normaliseProgram, sampleProgram, saveProgram } from "@/lib/program";

export const dynamic = "force-dynamic";

// A Pulsus company's quality program — its units, process areas, checklists and
// people. Every member reads it (the review form is built from it); only the
// company's owners and admins change it. This deployment's own checklist is built
// into the app, so the route serves companies only.
//   GET  /api/program              → { program }
//   GET  /api/program?sample=1     → { program: a neutral starting point }
//   POST /api/program  { program } → { program } (saved)
export async function GET(req: NextRequest) {
  const c = currentCompany();
  if (!c) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (req.nextUrl.searchParams.get("sample")) return NextResponse.json({ ok: true, program: sampleProgram() });
  return NextResponse.json({ ok: true, program: await loadProgram() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const c = currentCompany();
  if (!c) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (!companyManager(c)) return NextResponse.json({ ok: false, error: "Only your company's owners and admins can change the program." }, { status: 403 });
  let body: any = null;
  try { body = await req.json(); } catch { /* fall through */ }
  const parsed = normaliseProgram(body?.program);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  return NextResponse.json({ ok: true, program: await saveProgram(parsed.program, c.email) });
}
