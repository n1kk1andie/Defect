import { actorOr, body, json, result } from "@/lib/api";
import { activateScorecard, getScorecard, publishScorecard, saveScorecardDraft } from "@/lib/scorecards/store";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const s = await getScorecard(g.actor, (await ctx.params).id);
  return s ? json({ scorecard: s }) : json({ error: "Not found." }, 404);
}

/** Save the designer's draft. */
export async function PUT(req: Request, ctx: Ctx) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await saveScorecardDraft(g.actor, (await ctx.params).id, b.draft, g.requestId), (scorecard) => ({ scorecard }));
}

/** { action: "publish", activate? } or { action: "activate" }. */
export async function POST(req: Request, ctx: Ctx) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  const id = (await ctx.params).id;
  if (b.action === "activate") return result(await activateScorecard(g.actor, id, g.requestId), (scorecard) => ({ scorecard }));
  return result(await publishScorecard(g.actor, id, { activate: !!b.activate }, g.requestId), (scorecard) => ({ scorecard }));
}
