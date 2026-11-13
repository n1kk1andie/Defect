// The tables behind each export (CSV and Excel), built from the same figures
// the screens show (lib/metrics.ts).
import { byArea, byUnit, filterRows, heatGrid, monthLabel, record, type Filter, type MetricKey, type QualityData } from "@/lib/metrics";
import type { ActionView } from "@/lib/actions";

type Table = { name: string; header: string[]; rows: (string | number | null)[][] };
const r4 = (v: number | null) => (v == null ? null : Math.round(v * 10000) / 10000);

export function registerTable(d: QualityData, f: Filter, group: "unit" | "area", unitLabel: string): Table {
  const list = group === "area" ? byArea(d, f) : byUnit(d, f);
  const total = record(filterRows(d, f));
  const row = (name: string, x: ReturnType<typeof record>) => [name, x.reviewed, x.instances, x.defects, r4(x.defectRate), x.resolvable, x.resolved, r4(x.resolutionRate), x.recurring, r4(x.recurringRate)];
  return {
    name: "Register",
    header: [group === "area" ? "Process area" : unitLabel, "Reviewed", "Possible instances", "Defects", "Defect rate", "Resolvable", "Resolved", "Resolution rate", "Recurring", "Recurring rate"],
    rows: [...list.map((x) => row(x.name, x.rec)), row("Total", total)],
  };
}

export function historyTable(d: QualityData, f: Filter, metric: MetricKey, unitLabel: string): Table {
  const g = heatGrid(d, f, metric);
  return { name: "History", header: [unitLabel, ...g.months.map((p) => monthLabel(d.periods[p])), "All months"], rows: g.units.map((u) => [u.name, ...u.cells.map(r4), r4(u.total)]) };
}

export function actionsTable(list: ActionView[], areaName: (id: string | null) => string, unitLabel: string): Table {
  return {
    name: "Actions",
    header: ["Ref", "Kind", unitLabel, "Process area", "Issue", "Root cause", "Priority", "Owner", "Due", "Status", "Overdue", "Raised by", "Verified by", "Closed"],
    rows: list.map((a) => [a.ref, a.kind, a.unitName, areaName(a.areaId), a.title, a.rootCause, a.priority, a.ownerName || a.ownerEmail, a.dueDate, a.status.replace(/_/g, " "), a.overdue ? "yes" : "", a.raisedBy, a.verifiedBy, a.closedAt?.slice(0, 10) ?? null]),
  };
}
