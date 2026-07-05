import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { parseWorkbook, buildWorkbook } from "@/lib/xlsx";
import { saveDataset, statsFor, resetDataset } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reset a dataset back to the bundled seed: POST /api/upload?reset=defects|opstd
async function handleReset(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("reset");
  if (type !== "defects" && type !== "opstd") return NextResponse.json({ ok: false, error: "Unknown dataset." }, { status: 400 });
  await resetDataset(type);
  return NextResponse.json({ ok: true, dataset: type, reset: true });
}

// Upload an .xlsx (raw body). Auto-detects Branch Defects vs Operational Standard.
export async function POST(req: NextRequest) {
  if (!isAdmin(Date.now())) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (req.nextUrl.searchParams.has("reset")) return handleReset(req);

  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length) return NextResponse.json({ ok: false, error: "Empty upload." }, { status: 400 });
  try {
    const { type, payload } = parseWorkbook(buf);
    const workbook = buildWorkbook(type, payload); // normalize to a clean workbook for re-download
    await saveDataset(type, payload, workbook);
    return NextResponse.json({ ok: true, dataset: type, stats: statsFor(type, payload) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
