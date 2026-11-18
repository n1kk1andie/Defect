// Triage: { to: "action" | "inspection" | "dismiss", note, …action or inspection fields }.
import { actorOr, body, result } from "@/lib/api";
import { triage } from "@/lib/issues";
import { isSupervisor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(isSupervisor); if ("response" in g) return g.response;
  return result(await triage(g.actor, (await ctx.params).id, await body(req), g.requestId), (issue) => ({ issue }));
}
