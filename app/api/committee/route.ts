// The committee report: ?format=pdf (default) or xlsx.
import { actorOr } from "@/lib/api";
import { committeePack, committeePdf, committeeXlsx } from "@/lib/committee";
import { withTenant } from "@/lib/db/client";
import { record } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const xlsx = new URL(req.url).searchParams.get("format") === "xlsx";
  const pack = await committeePack(g.actor);
  const buf = xlsx ? await committeeXlsx(pack) : await committeePdf(pack);
  await withTenant(g.actor.tenant, (tx) => record(tx, g.actor.tenant, { actor: g.actor.email, action: "export", entityType: "committee", summary: `Committee report (${xlsx ? "Excel" : "PDF"})`, requestId: g.requestId }));
  const name = `pulsus-quality-committee-${new Date().toISOString().slice(0, 10)}.${xlsx ? "xlsx" : "pdf"}`;
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf", "Content-Disposition": `${xlsx ? "attachment" : "inline"}; filename="${name}"`, "Cache-Control": "no-store" } });
}
