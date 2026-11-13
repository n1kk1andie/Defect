import { actorOr, json, result } from "@/lib/api";
import { deleteReview, getReview } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const r = await getReview(g.actor, (await ctx.params).id);
  return r ? json({ review: r }) : json({ error: "Not found." }, 404);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  return result(await deleteReview(g.actor, (await ctx.params).id, g.requestId), () => ({ ok: true }));
}
