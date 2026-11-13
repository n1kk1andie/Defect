import { actorOr, json } from "@/lib/api";
import { readEvidence } from "@/lib/evidence";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const r = await readEvidence(g.actor, (await ctx.params).id);
  if (!r.ok) return json({ error: r.error }, r.status ?? 404);
  const inline = new URL(req.url).searchParams.get("inline") === "1" && /^image\/|^application\/pdf$/.test(r.value.contentType);
  return new Response(new Uint8Array(r.value.bytes), {
    headers: {
      "Content-Type": r.value.contentType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(r.value.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
