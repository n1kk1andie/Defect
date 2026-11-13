import { getActor } from "@/lib/session";
import { inspectionStats } from "@/lib/inspectionStats";
import { Insights } from "@/components/screens/Insights";

export const dynamic = "force-dynamic";

export default async function InsightsPage() {
  const actor = (await getActor())!;
  return <Insights inspections={await inspectionStats(actor)} />;
}
