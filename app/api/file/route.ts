import { NextRequest, NextResponse } from "next/server";
import { datasetWorkbook } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Download the current workbook: GET /api/file?dataset=defects|opstd
export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("dataset");
  if (type !== "defects" && type !== "opstd") return NextResponse.json({ error: "Unknown dataset." }, { status: 400 });
  const buf = await datasetWorkbook(type);
  const name = type === "defects" ? "Branch_Defects_Consolidated.xlsx" : "Operational_Standards_Consolidated.xlsx";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
