import { actorOr, body, json, result } from "@/lib/api";
import { createAction, listActions } from "@/lib/actions";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ actions: await listActions(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.raiseActions); if ("response" in g) return g.response;
  return result(await createAction(g.actor, await body(req), g.requestId), (action) => ({ action }));
}
