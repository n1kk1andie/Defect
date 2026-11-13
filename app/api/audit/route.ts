// The change history: GET lists the latest entries (?entityType&entityId for
// one record); ?verify=1 checks the hash chain end to end.
import { actorOr, json } from "@/lib/api";
import { history, verify } from "@/lib/audit";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const entityType = q.get("entityType") || undefined, entityId = q.get("entityId") || undefined;
  // One record's history is open to anyone who can see the app; the full log and the chain check are for admins.
  const g = await actorOr(entityId ? undefined : can.manage); if ("response" in g) return g.response;
  if (q.get("verify") === "1") return json(await verify(g.actor.tenant));
  return json({ entries: await history(g.actor.tenant, { limit: Number(q.get("limit") || 200), entityType, entityId }) });
}
