// PUT (change) · DELETE · POST { send?: boolean } (run now; returns the run id; the files download from /api/reports/runs/{id}).
import { actorOr, body, result } from "@/lib/api";
import { runReport, saveReport } from "@/lib/reportBuilder";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: Request, ctx: Ctx) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await saveReport(g.actor, (await ctx.params).id, await body(req), g.requestId), (report) => ({ report }));
}
export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await saveReport(g.actor, (await ctx.params).id, { remove: true }, g.requestId));
}
export async function POST(req: Request, ctx: Ctx) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await runReport(g.actor, (await ctx.params).id, { send: b.send === true }, g.requestId));
}
