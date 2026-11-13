import { actorOr, body, json, result } from "@/lib/api";
import { deleteAction, editAction, getAction } from "@/lib/actions";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const a = await getAction(g.actor, (await ctx.params).id);
  return a ? json({ action: a }) : json({ error: "Not found." }, 404);
}

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  return result(await editAction(g.actor, (await ctx.params).id, await body(req), g.requestId), (action) => ({ action }));
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  return result(await deleteAction(g.actor, (await ctx.params).id, g.requestId), () => ({ ok: true }));
}
