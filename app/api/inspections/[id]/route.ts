import { actorOr, json, result } from "@/lib/api";
import { deleteInspection, getInspection } from "@/lib/inspections";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const r = await getInspection(g.actor, (await ctx.params).id);
  return r ? json(r) : json({ error: "Not found." }, 404);
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  return result(await deleteInspection(g.actor, (await ctx.params).id, g.requestId), () => ({ ok: true }));
}
