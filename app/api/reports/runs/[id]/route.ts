// A kept run's file: ?kind=pdf (default) or xlsx.
import { actorOr, json } from "@/lib/api";
import { runFile } from "@/lib/reportBuilder";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const kind = new URL(req.url).searchParams.get("kind") === "xlsx" ? "xlsx" : "pdf";
  const f = await runFile(g.actor, (await ctx.params).id, kind);
  if (!f) return json({ error: "Not found." }, 404);
  return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `${kind === "pdf" ? "inline" : "attachment"}; filename="${f.name}"`, "Cache-Control": "no-store" } });
}
