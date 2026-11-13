import { actorOr, body, result } from "@/lib/api";
import { saveProgramme } from "@/lib/schedule";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await saveProgramme(g.actor, (await ctx.params).id, await body(req), g.requestId), (programme) => ({ programme }));
}
