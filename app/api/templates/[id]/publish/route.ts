import { actorOr, body, result } from "@/lib/api";
import { publishTemplate } from "@/lib/templates/store";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** Freeze the draft as the next locked version. Inspections already started keep theirs. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await publishTemplate(g.actor, (await ctx.params).id, String(b.note ?? ""), g.requestId), (template) => ({ template }));
}
