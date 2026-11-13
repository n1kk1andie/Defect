import { actorOr, body, result } from "@/lib/api";
import { applySetup } from "@/lib/setup";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** The set-up wizard's answers: sector, labels, locations, starter checklists and scorecard. */
export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return result(await applySetup(g.actor, await body(req), g.requestId), (summary) => ({ summary }));
}
