import { actorOr, body, json, result } from "@/lib/api";
import { listInspections, saveInspection } from "@/lib/inspections";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ inspections: await listInspections(g.actor) });
}

/** Create or update a draft (idempotent on clientId); { submit: true } sends it for approval. */
export async function POST(req: Request) {
  const g = await actorOr(can.inspect); if ("response" in g) return g.response;
  return result(await saveInspection(g.actor, await body(req), g.requestId), (inspection) => ({ inspection }));
}
