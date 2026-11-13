import { actorOr, body, result } from "@/lib/api";
import { setArchived } from "@/lib/templates/store";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await setArchived(g.actor, (await ctx.params).id, b.archived !== false, g.requestId), (template) => ({ template }));
}
