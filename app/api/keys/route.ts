// API keys (admins): list, and create (the secret is returned once).
import { actorOr, body, json, result } from "@/lib/api";
import { createKey, listKeys } from "@/lib/apiKeys";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return json({ keys: await listKeys(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return result(await createKey(g.actor, await body(req), g.requestId));
}
