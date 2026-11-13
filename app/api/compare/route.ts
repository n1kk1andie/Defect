// The comparison: ?level=entity|region|group|site&days=30|90|180|365, or ?format=xlsx.
import ExcelJS from "exceljs";
import { actorOr, json } from "@/lib/api";
import { compare } from "@/lib/structure";
import { getSettings } from "@/lib/company";
import { BANDS } from "@/lib/bands";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const u = new URL(req.url);
  const c = await compare(g.actor, { level: u.searchParams.get("level") || undefined, days: Number(u.searchParams.get("days")) || undefined });
  if (u.searchParams.get("format") !== "xlsx") return json({ comparison: c });
  const s = await getSettings(g.actor.tenant);
  const band = (b: string) => BANDS.find((x) => x.key === b)?.label ?? "No data";
  const wb = new ExcelJS.Workbook(); wb.creator = "Pulsus Quality";
  const add = (name: string, header: string[], rows: unknown[][]) => { const ws = wb.addWorksheet(name); ws.addRow(header).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; rows.forEach((r) => ws.addRow(r)); ws.columns.forEach((col) => { col.width = 16; }); };
  const lvl = c.level === "entity" ? s.entityLabel : c.level === "group" ? "Group" : s.groupLabel;
  if (c.groups.length) add(`By ${lvl}`.slice(0, 31), [lvl, s.unitPlural, "Inspections", "Average score", "Pass rate", "Critical failures", "Average risk", "Worst band", "Worst site", "Open actions", "Overdue", "Open reports", "Controls not effective"], c.groups.map((x) => [x.name, x.sites, x.inspections, x.avgScore, x.passRate, x.criticalFails, x.avgRisk, band(x.worstBand), x.worstSite, x.openActions, x.overdueActions, x.openIssues, x.controlsFailed]));
  add(s.unitPlural.slice(0, 31), [s.unitLabel, s.groupLabel, "Inspections", "Average score", "Percentile", "Vs median", "Pass rate", "Critical failures", "Risk", "Band", "Open actions", "Overdue", "Open reports"], c.sites.map((x) => [x.name, x.region, x.inspections, x.avgScore, x.scorePercentile, x.vsMedian, x.passRate, x.criticalFails, x.risk, band(x.band), x.openActions, x.overdueActions, x.openIssues]));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="pulsus-quality-comparison-${new Date().toISOString().slice(0, 10)}.xlsx"`, "Cache-Control": "no-store" } });
}
