// The dataset in its original shape, kept for Pulsus Platform: the company
// brief reads defects.rows by position ([period, branch, area, reviewed,
// instances, defects, resolvable, resolved, recurring]) and the quality driver
// reads opstd.rows ([period, branch, Operational Standard score, …8 more]).
import { getDataset } from "@/lib/dataset";
import { requestInfo, getActor } from "@/lib/session";
import { json } from "@/lib/api";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

export async function GET() {
  const info = await requestInfo();
  if (!info) return json({ error: "Unauthorized" }, 401);
  if (info.email !== "platform-feed") {
    const a = await getActor();
    if (!a || !can.view(a)) return json({ error: "Forbidden" }, 403);
  }
  const d = await getDataset(info.tenant);
  const sc = d.scorecard;
  return json({
    defects: { meta: { source: "Pulsus Quality", columns: ["periodIdx", "branchIdx", "areaIdx", "reviewed", "instances", "defects", "resolvable", "resolved", "recurring"] }, periods: d.periods, branches: d.units.map((u) => u.name), areas: d.areas.map((a) => a.name), rows: d.rows },
    opstd: sc ? { meta: { source: sc.name, columns: ["periodIdx", "branchIdx", ...sc.measures.map((m) => m.label)] }, metrics: sc.measures.map((m) => ({ key: m.key, label: m.label })), periods: sc.periods, branches: d.units.map((u) => u.name), rows: sc.rows, auditRaw: sc.auditRaw } : null,
    uploaded: { defects: d.rows.length > 0, opstd: !!sc && sc.rows.length > 0 },
  });
}
