import { actorOr, body, result } from "@/lib/api";
import { resolveItems } from "@/lib/reviews";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** { items: [{ reviewId, idx }], resolved: boolean } */
export async function POST(req: Request) {
  const g = await actorOr(can.resolveDefects); if ("response" in g) return g.response;
  const b = await body(req);
  const items = Array.isArray(b.items) ? (b.items as { reviewId: string; idx: number }[]) : [];
  return result(await resolveItems(g.actor, items, b.resolved !== false, g.requestId), (changed) => ({ changed }));
}
