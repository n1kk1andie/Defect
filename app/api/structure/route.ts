// Entities and site groups. GET; POST { type: "entity" | "group" | "label", id?, name, code?, unitIds?, remove?, entityLabel? }.
import { actorOr, body, json, result } from "@/lib/api";
import { getStructure, saveEntity, saveGroup } from "@/lib/structure";
import { updateSettings } from "@/lib/company";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ structure: await getStructure(g.actor) });
}

export async function POST(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const b = await body(req);
  const id = typeof b.id === "string" && b.id ? b.id : null;
  if (b.type === "label") {
    if (!can.manage(g.actor)) return json({ error: "Only a Quality admin renames entities." }, 403);
    const label = String(b.entityLabel || "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!label) return json({ error: "Enter a name." }, 400);
    await updateSettings(g.actor, { entityLabel: label }, `Entities are called "${label}"`, g.requestId);
    return json({ structure: await getStructure(g.actor) });
  }
  const r = b.type === "group" ? await saveGroup(g.actor, id, b, g.requestId) : await saveEntity(g.actor, id, b, g.requestId);
  return result(r, (structure) => ({ structure }));
}
