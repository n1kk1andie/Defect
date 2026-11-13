import { actorOr, body, json, result } from "@/lib/api";
import { listReviews, saveReview } from "@/lib/reviews";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ reviews: await listReviews(g.actor) });
}

/** Create or update a draft; { submit: true } sends it for approval. */
export async function POST(req: Request) {
  const g = await actorOr(can.keyReviews); if ("response" in g) return g.response;
  return result(await saveReview(g.actor, await body(req), g.requestId), (review) => ({ review }));
}
