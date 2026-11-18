import { actorOr, body, json, result } from "@/lib/api";
import { createPlan, listPlans } from "@/lib/samplingPlans";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ plans: await listPlans(g.actor) });
}

/** Create a plan: population, method, seed. The selection is made and recorded here. */
export async function POST(req: Request) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await createPlan(g.actor, await body(req), g.requestId), (plan) => ({ plan }));
}
