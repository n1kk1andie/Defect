import { and, asc, eq } from "drizzle-orm";
import { getActor } from "@/lib/session";
import { listReviews } from "@/lib/reviews";
import { withTenant } from "@/lib/db/client";
import { scorecards } from "@/lib/db/schema";
import { Review } from "@/components/screens/Review";
import type { ScorecardDef } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const actor = (await getActor())!;
  const [reviews, card] = await Promise.all([
    listReviews(actor, { limit: 300 }),
    withTenant(actor.tenant, async (tx) => (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, actor.tenant), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0]),
  ]);
  return <Review reviews={reviews} scorecard={card ? (card.definition as ScorecardDef) : null} />;
}
