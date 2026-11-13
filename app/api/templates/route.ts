// The company's checklist templates: list, and create (blank, from the
// library, as a copy, or from a JSON definition).
import { actorOr, body, json, result } from "@/lib/api";
import { createTemplate, listTemplates } from "@/lib/templates/store";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ templates: await listTemplates(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  return result(await createTemplate(g.actor, await body(req), g.requestId), (template) => ({ template }));
}
