import { actorOr, body, result } from "@/lib/api";
import { decideReview } from "@/lib/reviews";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** { decision: "approve" | "return", note } — a supervisor who didn't key it. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(can.approveReviews); if ("response" in g) return g.response;
  const b = await body(req);
  return result(await decideReview(g.actor, (await ctx.params).id, b.decision === "approve" ? "approve" : "return", String(b.note ?? ""), g.requestId), (review) => ({ review }));
}
