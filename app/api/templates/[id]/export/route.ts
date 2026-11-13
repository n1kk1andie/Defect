// Download a template: ?format=json (default) or xlsx; ?version=n for a
// published version, otherwise the current draft.
import { actorOr, json } from "@/lib/api";
import { getTemplate, loadVersion } from "@/lib/templates/store";
import { templateToXlsx } from "@/lib/templates/io";
import { withTenant } from "@/lib/db/client";
import { record } from "@/lib/audit";
import type { TemplateDef } from "@/lib/templates/model";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const id = (await ctx.params).id;
  const t = await getTemplate(g.actor, id);
  if (!t) return json({ error: "Not found." }, 404);
  const q = new URL(req.url).searchParams;
  const v = Number(q.get("version"));
  let def: TemplateDef | null = t.draft;
  if (Number.isInteger(v) && v > 0) def = await withTenant(g.actor.tenant, (tx) => loadVersion(tx, g.actor.tenant, id, v));
  if (!def) return json({ error: "No such version." }, 404);
  await withTenant(g.actor.tenant, (tx) => record(tx, g.actor.tenant, { actor: g.actor.email, action: "template.export", entityType: "template", entityId: id, summary: `${def!.name} exported`, requestId: g.requestId }));
  const base = def.name.replace(/[^A-Za-z0-9 _-]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "template";
  const name = `${base}${v > 0 ? `-v${v}` : "-draft"}`;
  if (q.get("format") === "xlsx") {
    const buf = await templateToXlsx(def);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${name}.xlsx"`, "Cache-Control": "no-store" } });
  }
  return new Response(JSON.stringify(def, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${name}.json"`, "Cache-Control": "no-store" } });
}
