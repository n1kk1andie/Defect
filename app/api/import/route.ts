// Workbook upload: multipart { file } → a preview; JSON { commit: id, confirm: true } → import it.
import { actorOr, json } from "@/lib/api";
import { commitUpload, previewUpload } from "@/lib/imports";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  if ((req.headers.get("content-type") || "").includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as { commit?: string; confirm?: boolean };
    if (!b.commit || b.confirm !== true) return json({ error: "Confirm the preview first." }, 400);
    const r = await commitUpload(g.actor, b.commit, g.requestId);
    return r.ok ? json(r) : json({ error: r.error }, r.status ?? 400);
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "Choose a workbook (.xlsx)." }, 400);
  if (file.size > 20 * 1024 * 1024) return json({ error: "Workbooks can be up to 20 MB." }, 413);
  try {
    return json({ preview: await previewUpload(g.actor, file.name, Buffer.from(await file.arrayBuffer()), g.requestId) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "That workbook couldn't be read." }, 400);
  }
}
