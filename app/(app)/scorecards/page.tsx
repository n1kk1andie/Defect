import { getActor } from "@/lib/session";
import { listScorecards } from "@/lib/scorecards/store";
import { Scorecards } from "@/components/screens/Scorecards";

export const dynamic = "force-dynamic";

export default async function ScorecardsPage() {
  const actor = (await getActor())!;
  return <Scorecards scorecards={await listScorecards(actor)} />;
}
