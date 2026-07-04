import { NextRequest, NextResponse } from "next/server";
import { loadDatasets } from "@/lib/data";
import { buildWorkbook, type Dataset } from "@/lib/xlsx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Filtered Excel export: GET /api/export?dataset=defects|opstd&from=ISO&to=ISO&branch=&area=
// `from`/`to` are inclusive ISO period dates (YYYY-MM-DD); branch/area are dataset indices
// (-1 = all). Rows outside the range or scope are dropped before the workbook is built.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get("dataset");
  if (type !== "defects" && type !== "opstd") return NextResponse.json({ error: "Unknown dataset." }, { status: 400 });

  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const branch = parseInt(sp.get("branch") || "-1", 10);
  const area = parseInt(sp.get("area") || "-1", 10);

  const ds = await loadDatasets();
  const payload = type === "defects" ? ds.defects : ds.opstd;
  const periods: string[] = payload.periods;
  const inRange = (pIdx: number) => {
    const iso = periods[pIdx];
    return (!from || iso >= from) && (!to || iso <= to);
  };

  let filtered: any;
  if (type === "defects") {
    const rows = payload.rows.filter(
      (r: number[]) => inRange(r[0]) && (branch < 0 || r[1] === branch) && (area < 0 || r[2] === area),
    );
    filtered = { ...payload, rows };
  } else {
    const keep: boolean[] = payload.rows.map((r: any[]) => inRange(r[0]) && (branch < 0 || r[1] === branch));
    const rows = payload.rows.filter((_: any, i: number) => keep[i]);
    const auditRaw = (payload.auditRaw || []).filter((_: any, i: number) => keep[i]);
    filtered = { ...payload, rows, auditRaw };
  }

  const buf = buildWorkbook(type as Dataset, filtered);
  const tag = (from ? from.slice(0, 7) : "start") + "_to_" + (to ? to.slice(0, 7) : "end");
  const name = (type === "defects" ? "Branch_Defects_" : "Operational_Standards_") + tag + ".xlsx";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
