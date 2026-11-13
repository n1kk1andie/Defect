import { actorOr } from "@/lib/api";
import { getProgram } from "@/lib/company";
import { defectsTemplate, opstdTemplate } from "@/lib/workbook";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const what = new URL(req.url).searchParams.get("what") === "opstd" ? "opstd" : "defects";
  const p = await getProgram(g.actor.tenant);
  const units = p.units.filter((u) => u.active).map((u) => u.name);
  const buf = what === "opstd" ? await opstdTemplate(units) : await defectsTemplate(units, p.areas.map((a) => a.name));
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="pulsus-quality-${what}-template.xlsx"`, "Cache-Control": "no-store" } });
}
