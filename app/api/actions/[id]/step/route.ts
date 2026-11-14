import { actorOr, body, result } from "@/lib/api";
import { stepAction, type ActionStep } from "@/lib/actions";

export const dynamic = "force-dynamic";
const STEPS: ActionStep[] = ["start", "submit", "verify", "return", "reopen", "effective", "ineffective"];

/** { step: start | submit | verify | return | reopen | effective | ineffective, note } */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await actorOr(); if ("response" in g) return g.response;
  const b = await body(req);
  const step = STEPS.find((s) => s === b.step);
  if (!step) return result({ ok: false, error: "Unknown step.", status: 400 });
  return result(await stepAction(g.actor, (await ctx.params).id, step, { note: b.note }, g.requestId), (action) => ({ action }));
}
