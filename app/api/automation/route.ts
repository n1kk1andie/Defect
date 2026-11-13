// Run this company's checks now (admins): band changes, overdue actions, effectiveness checks, scheduled reports, retries.
import { actorOr, json } from "@/lib/api";
import { sweep } from "@/lib/automation";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST() {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return json({ result: await sweep(g.actor.tenant) });
}
