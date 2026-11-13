// Webhooks (admins): list, add.
import { actorOr, body, json, result } from "@/lib/api";
import { createWebhook, listWebhooks } from "@/lib/webhooks";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return json({ webhooks: await listWebhooks(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  return result(await createWebhook(g.actor, await body(req), g.requestId));
}
