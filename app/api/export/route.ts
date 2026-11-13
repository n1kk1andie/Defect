// Exports: ?what=register|history|actions|changes &format=csv|xlsx, scoped by
// the same filters as the screen (year, unit, area, group, metric). Each export
// is recorded in the change history.
import { actorOr, json } from "@/lib/api";
import { getDataset } from "@/lib/dataset";
import { getSettings } from "@/lib/company";
import { listActions } from "@/lib/actions";
import { actionsTable, historyTable, registerTable } from "@/lib/exports";
import { buildXlsx, toCsv } from "@/lib/workbook";
import { history } from "@/lib/audit";
import { withTenant } from "@/lib/db/client";
import { record } from "@/lib/audit";
import { can, inScope } from "@/lib/roles";
import type { MetricKey } from "@/lib/metrics";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const a = g.actor;
  const q = new URL(req.url).searchParams;
  const what = q.get("what") || "register";
  const format = q.get("format") === "xlsx" ? "xlsx" : "csv";
  const settings = await getSettings(a.tenant);
  const d = await getDataset(a.tenant);
  // A person scoped to some units exports only those.
  if (a.unitIds.length) { const keep = new Set(d.units.map((u, i) => (inScope(a, u.id) ? i : -1)).filter((i) => i >= 0)); d.rows = d.rows.filter((r) => keep.has(r[1])); }
  const f = { year: q.get("year") || "all", unit: Number(q.get("unit") ?? -1), area: Number(q.get("area") ?? -1) };
  let table;
  if (what === "register") table = registerTable(d, f, q.get("group") === "area" ? "area" : "unit", settings.unitLabel);
  else if (what === "history") table = historyTable(d, f, (["defectRate", "resolutionRate", "recurringRate"].includes(q.get("metric") || "") ? q.get("metric") : "defectRate") as MetricKey, settings.unitLabel);
  else if (what === "actions") table = actionsTable(await listActions(a), (id) => d.areas.find((x) => x.id === id)?.name ?? "", settings.unitLabel);
  else if (what === "changes") {
    if (!can.manage(a)) return json({ error: "Admins export the change history." }, 403);
    const h = await history(a.tenant, { limit: 2000 });
    table = { name: "Change history", header: ["#", "When", "Who", "What", "Record", "Summary"], rows: h.map((x) => [x.seq, x.at, x.actor, x.action, `${x.entityType}${x.entityId ? ":" + x.entityId : ""}`, x.summary]) };
  } else return json({ error: "Unknown export." }, 400);
  await withTenant(a.tenant, (tx) => record(tx, a.tenant, { actor: a.email, action: "export", entityType: what, summary: `Exported ${table.name} (${format.toUpperCase()}, ${table.rows.length} rows)`, requestId: g.requestId }));
  const stamp = new Date().toISOString().slice(0, 10);
  const file = `pulsus-quality-${what}-${stamp}.${format}`;
  const bytes = format === "xlsx" ? new Uint8Array(await buildXlsx([table])) : new TextEncoder().encode(toCsv(table.header, table.rows));
  return new Response(bytes, { headers: { "Content-Type": format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "no-store" } });
}
