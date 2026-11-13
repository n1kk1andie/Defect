// The risk model (weights, entered factors, band cut-offs, visit frequency by band) and the factor values per site.
import { actorOr, body, json, result } from "@/lib/api";
import { updateSettings, getSettings } from "@/lib/company";
import { cleanRisk } from "@/lib/risk";
import { riskBoard, setFactors } from "@/lib/riskScore";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ board: await riskBoard(g.actor) });
}

/** { model } replaces the model; { factors: [{ unitId, data }] } sets the entered factors. */
export async function PUT(req: Request) {
  const g = await actorOr(can.manage); if ("response" in g) return g.response;
  const b = await body(req);
  if (b.factors) return result(await setFactors(g.actor, b.factors, g.requestId), (n) => ({ saved: n }));
  const s = await getSettings(g.actor.tenant);
  const risk = cleanRisk(b.model, s.sector);
  await updateSettings(g.actor, { risk }, "Risk model changed", g.requestId);
  return json({ model: risk });
}
