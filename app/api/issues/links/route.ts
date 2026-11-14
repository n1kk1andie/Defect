// Every site's report-an-issue link (supervisors), created when missing.
import { actorOr, json } from "@/lib/api";
import { listLinks } from "@/lib/issues";
import { isSupervisor } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(isSupervisor); if ("response" in g) return g.response;
  return json({ links: await listLinks(g.actor) });
}
