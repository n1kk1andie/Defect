// Replace a site's link: the old one stops working.
import { actorOr, result } from "@/lib/api";
import { rotateLink } from "@/lib/issues";
import { isSupervisor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ unitId: string }> }) {
  const g = await actorOr(isSupervisor); if ("response" in g) return g.response;
  return result(await rotateLink(g.actor, (await ctx.params).unitId, g.requestId));
}
