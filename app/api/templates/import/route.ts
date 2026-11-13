// Import a template from an Excel workbook (one question per row) or a JSON
// export. It arrives as a draft to check and publish.
import { actorOr, json, result } from "@/lib/api";
import { createTemplate } from "@/lib/templates/store";
import { xlsxToTemplate } from "@/lib/templates/io";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await actorOr(can.buildTemplates); if ("response" in g) return g.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "Choose an Excel (.xlsx) or JSON file." }, 400);
  if (file.size > 2 * 1024 * 1024) return json({ error: "Template files can be up to 2 MB." }, 413);
  const buf = Buffer.from(await file.arrayBuffer());
  let def: unknown;
  if (/\.json$/i.test(file.name) || file.type === "application/json") {
    try { def = JSON.parse(buf.toString("utf8")); } catch { return json({ error: "That JSON file can't be read." }, 400); }
    if (def && typeof def === "object" && "definition" in (def as object)) def = (def as { definition: unknown }).definition;
  } else {
    const r = await xlsxToTemplate(buf, file.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Imported template");
    if (!r.ok) return json({ error: r.error }, 400);
    def = r.def;
  }
  return result(await createTemplate(g.actor, { from: "import", def }, g.requestId), (template) => ({ template }));
}
