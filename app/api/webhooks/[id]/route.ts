// PATCH { active?, events? } · DELETE · POST (send a test message). Admins.
import { actorOr, body, result } from "@/lib/api";
import { testWebhook, updateWebhook } from "@/lib/webhooks";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return result(await updateWebhook(g.actor, (await ctx.params).id, await body(req), g.requestId));
}
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return result(await updateWebhook(g.actor, (await ctx.params).id, { remove: true }, g.requestId));
}
export async function POST(_req: Request, ctx: Ctx) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return result(await testWebhook(g.actor, (await ctx.params).id));
}
