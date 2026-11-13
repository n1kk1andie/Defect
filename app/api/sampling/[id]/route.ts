import { actorOr, body, json, result } from "@/lib/api";
import { evaluatePlan, getPlan, startPlanInspection } from "@/lib/samplingPlans";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const p = await getPlan(g.actor, (await ctx.params).id);
  return p ? json(p) : json({ error: "Not found." }, 404);
}

/** { action: "start" } opens the review of the selected items; { action: "evaluate", deviations } records the result. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const id = (await ctx.params).id;
  const b = await body(req);
  if (b.action === "start") { if (!can.inspect(g.actor)) return json({ error: "Your role doesn't carry out reviews." }, 403); return result(await startPlanInspection(g.actor, id, g.requestId)); }
  return result(await evaluatePlan(g.actor, id, b.deviations, g.requestId), (plan) => ({ plan }));
}
