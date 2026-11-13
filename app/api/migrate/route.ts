// Move the previous version's data in: { action: "preview" } runs the dry run;
// { action: "commit", id } imports that preview, only for an admin who has seen it.
import { actorOr, body, json } from "@/lib/api";
import { commit, latestImports, preview } from "@/lib/migrator";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return json({ imports: await latestImports(g.actor.tenant) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  if (b.action === "preview") return json(await preview(g.actor, g.requestId));
  if (b.action === "commit") {
    if (b.confirm !== true) return json({ error: "Confirm that you've checked the preview." }, 400);
    const r = await commit(g.actor, String(b.id || ""), g.requestId);
    return r.ok ? json(r) : json({ error: r.error }, r.status ?? 400);
  }
  return json({ error: "Unknown action." }, 400);
}
