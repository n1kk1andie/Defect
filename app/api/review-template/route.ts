import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadDatasetPayload } from "@/lib/data";
import { buildReviewTemplate } from "@/lib/xlsx";

export const dynamic = "force-dynamic";

// A blank Process Critical Review template (.xlsx) for officers who prefer to key in
// Excel and upload. Any signed-in user may download it.
export async function GET() {
  if (!getSession(Date.now())) return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  const payload = await loadDatasetPayload("defects");
  const buf = buildReviewTemplate(payload.areas || []);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Process-Critical-Review-template.xlsx"',
    },
  });
}
