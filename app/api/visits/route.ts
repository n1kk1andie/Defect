// Programme visits: ?mine=1 for the signed-in inspector's own schedule.
import { actorOr, json } from "@/lib/api";
import { visits } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const all = await visits(g.actor);
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  return json({ visits: mine ? all.filter((v) => v.assignee === g.actor.email) : all });
}
