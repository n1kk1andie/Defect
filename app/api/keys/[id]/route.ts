// { op: "revoke" | "rotate" } (admins). Rotating returns the new secret once.
import { actorOr, body, result } from "@/lib/api";
import { changeKey } from "@/lib/apiKeys";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  const op = b.op === "rotate" ? "rotate" : b.op === "revoke" ? "revoke" : null;
  if (!op) return result({ ok: false, error: "Unknown operation.", status: 400 });
  return result(await changeKey(g.actor, (await ctx.params).id, op, g.requestId));
}
