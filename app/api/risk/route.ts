// Propose a serious or recurring defect to Pulsus Risk (docs/risk-contract.md).
import { actorOr, body, json } from "@/lib/api";
import { buildProposal, outbox, sendToRisk } from "@/lib/riskLink";
import { can } from "@/lib/roles";
import { getSettings } from "@/lib/company";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = await actorOr(); if ("response" in g) return g.response;
  return json({ outbox: await outbox(g.actor.tenant) });
}

export async function POST(req: Request) {
  const g = await actorOr(can.sendToRisk); if ("response" in g) return g.response;
  const b = await body(req);
  const s = await getSettings(g.actor.tenant);
  const sev = ["critical", "high", "medium", "low"].includes(String(b.severity)) ? (b.severity as "critical" | "high" | "medium" | "low") : "high";
  const rt = b.recordType === "action" ? "action" : b.recordType === "defect" ? "defect" : "recurring_issue";
  const p = buildProposal(g.actor, {
    recordType: rt, recordRef: String(b.recordRef || "").slice(0, 200), title: String(b.title || ""), description: String(b.description || ""), severity: sev,
    unitName: String(b.unitName || ""), unitType: s.unitLabel, area: b.area ? String(b.area) : null, detectedAt: String(b.detectedAt || new Date().toISOString()),
    recurrence: b.recurrence && typeof b.recurrence === "object" ? (b.recurrence as never) : null, action: b.action && typeof b.action === "object" ? (b.action as never) : null,
    path: typeof b.path === "string" && b.path.startsWith("/") ? b.path : "/insights",
  });
  const r = await sendToRisk(g.actor, p, g.requestId);
  return r.ok ? json({ ...r, proposal: p }) : json({ error: r.error }, r.status ?? 400);
}
