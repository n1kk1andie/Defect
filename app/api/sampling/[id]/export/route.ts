// The selected items (and the method that chose them) as CSV or Excel.
import { actorOr, json } from "@/lib/api";
import { getPlan } from "@/lib/samplingPlans";
import { buildXlsx, toCsv } from "@/lib/workbook";
import { withTenant } from "@/lib/db/client";
import { record } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const got = await getPlan(g.actor, (await ctx.params).id);
  if (!got) return json({ error: "Not found." }, 404);
  const p = got.plan;
  const header = ["#", "Item", "Stratum", "Value"];
  const rows: (string | number | null)[][] = p.selection.map((s, i) => [i + 1, s.id, s.stratum || null, s.value ?? null]);
  const xlsx = new URL(req.url).searchParams.get("format") === "xlsx";
  await withTenant(g.actor.tenant, (tx) => record(tx, g.actor.tenant, { actor: g.actor.email, action: "sampling.export", entityType: "sampling_plan", entityId: p.id, summary: `${p.ref} selection exported`, requestId: g.requestId }));
  const name = `${p.ref.toLowerCase()}-selection`;
  if (xlsx) {
    const buf = await buildXlsx([{ name: "Selection", header, rows }, { name: "Method", header: ["Field", "Value"], rows: [["Plan", `${p.ref} ${p.name}`], ["Method", p.method_text], ["Seed", p.seed], ["Population", p.populationSize], ["Population SHA-256", p.populationHash], ["Sample", p.sampleSize], ["Created", `${p.createdAt} by ${p.createdBy}`]] }]);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
  }
  return new Response(toCsv(header, rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
}
