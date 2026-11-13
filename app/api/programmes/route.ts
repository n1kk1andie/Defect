import { actorOr, body, json, result } from "@/lib/api";
import { listProgrammes, saveProgramme } from "@/lib/schedule";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ programmes: await listProgrammes(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await saveProgramme(g.actor, null, await body(req), g.requestId), (programme) => ({ programme }));
}
