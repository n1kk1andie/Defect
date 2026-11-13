import { getActor } from "@/lib/session";
import { riskBoard } from "@/lib/riskScore";
import { Risk } from "@/components/screens/Risk";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const actor = (await getActor())!;
  return <Risk board={await riskBoard(actor)} />;
}
