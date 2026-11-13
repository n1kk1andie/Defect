import { actorOr, body, json } from "@/lib/api";
import { getProgram, saveProgram } from "@/lib/company";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ program: await getProgram(g.actor.tenant) });
}

/** Replace the programme: units, process areas, checks with severities, natures. */
export async function PUT(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const r = await saveProgram(g.actor, await body(req), g.requestId);
  return r.ok ? json({ program: r.program }) : json({ error: r.error }, 400);
}
