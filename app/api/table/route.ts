// Read an uploaded CSV, TSV or Excel file into columns, for mapping (sampling populations, bulk imports). Nothing is stored.
import { actorOr, json } from "@/lib/api";
import { readTable } from "@/lib/table";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const g = await actorOr((a) => a.roles.some((r) => r === "admin" || r === "supervisor")); if ("response" in g) return g.response;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return json({ error: "Choose a CSV or Excel file." }, 400);
  if (file.size > 20 * 1024 * 1024) return json({ error: "Files can be up to 20 MB." }, 413);
  if (!/\.(csv|tsv|txt|xlsx)$/i.test(file.name)) return json({ error: "Upload a .csv, .tsv or .xlsx file." }, 415);
  try {
    const t = await readTable(file.name, Buffer.from(await file.arrayBuffer()));
    if (!t.headers.length || !t.rows.length) return json({ error: "That file has no rows under its header." }, 400);
    return json({ table: { ...t, name: file.name } });
  } catch {
    return json({ error: "That file couldn't be read. Save it as .xlsx or .csv and try again." }, 400);
  }
}
