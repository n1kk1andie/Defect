import { getActor } from "@/lib/session";
import { riskBoard } from "@/lib/riskScore";
import { outbox } from "@/lib/riskLink";
import { Risk } from "@/components/screens/Risk";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const actor = (await getActor())!;
  const board = await riskBoard(actor);
  const proposals = await outbox(actor.tenant, 30);
  return <Risk board={board} proposals={proposals} connected={!!(process.env.RISK_INTAKE_URL || "").trim()} />;
}
