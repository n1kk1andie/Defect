import { actorOr, body, json, result } from "@/lib/api";
import { deleteTemplate, getTemplate, saveDraft } from "@/lib/templates/store";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const t = await getTemplate(g.actor, (await ctx.params).id);
  return t ? json({ template: t }) : json({ error: "Not found." }, 404);
}

/** Save the draft (the builder autosaves). */
export async function PUT(req: Request, ctx: Ctx) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await saveDraft(g.actor, (await ctx.params).id, b.draft, g.requestId), (template) => ({ template }));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await deleteTemplate(g.actor, (await ctx.params).id, g.requestId), () => ({ ok: true }));
}
