import { actorOr, body, result } from "@/lib/api";
import { decideInspection } from "@/lib/inspections";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** { decision: "approve" | "return", note } — a supervisor who didn't carry it out. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(can.approveInspections); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await decideInspection(g.actor, (await ctx.params).id, b.decision === "approve" ? "approve" : "return", String(b.note ?? ""), g.requestId), (inspection) => ({ inspection }));
}
