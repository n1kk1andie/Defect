import { actorOr, body, json, result } from "@/lib/api";
import { createScorecard, listScorecards } from "@/lib/scorecards/store";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ scorecards: await listScorecards(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await createScorecard(g.actor, { from: String(b.from || ""), libraryKey: String(b.libraryKey || ""), copyOf: String(b.copyOf || ""), name: String(b.name || "") }, g.requestId), (scorecard) => ({ scorecard }));
}
