// A company's dashboards dataset (lib/metrics.ts QualityData), built from:
//   • monthly_stats — Branch Defects history at month × unit × area grain
//     (the institution's consolidated workbooks, imported workbooks); and
//   • published reviews — each sampled item aggregated into the same grain.
// Where published reviews cover a cell, they REPLACE that cell's imported
// figure rather than add to it: the institution's legacy dataset already had
// its published reviews merged in, so adding would count them twice. Several
// reviews of the same cell add up among themselves.
//
// The scorecard (Operational Standard) comes from scorecard_entries.
import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { areas, checks, monthlyStats, natures, reviewItems, reviews, scorecardEntries, scorecards, units } from "@/lib/db/schema";
import { loadSettings } from "@/lib/company";
import type { QualityData, Row, ScorecardData } from "@/lib/metrics";
import type { CompanySettings } from "@/lib/settings";
import type { ScorecardDef } from "@/lib/scorecard";

const iso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export interface ItemAgg { reviewed: number; instances: number; defects: number; resolvable: number; resolved: number; recurring: number }

/** One sampled item's contribution to its cell. */
export function itemContribution(it: { checks: Record<string, string>; defects: number; status: string; recurring: boolean }, basis: CompanySettings["instanceBasis"]): ItemAgg {
  const d = Math.max(0, Math.round(it.defects || 0));
  const instances = basis === "check" ? Object.values(it.checks || {}).filter((v) => v === "yes" || v === "no").length : 1;
  return { reviewed: 1, instances, defects: d, resolvable: d, resolved: it.status === "resolved" ? d : 0, recurring: it.recurring ? d : 0 };
}

export async function buildDataset(tx: Tx, companyId: string, settings?: CompanySettings): Promise<QualityData> {
  const s = settings ?? (await loadSettings(tx, companyId));
  const [u, a, stats, pubs, natureRows] = await Promise.all([
    tx.select().from(units).where(eq(units.companyId, companyId)).orderBy(asc(units.sort), asc(units.name)),
    tx.select().from(areas).where(eq(areas.companyId, companyId)).orderBy(asc(areas.sort), asc(areas.name)),
    tx.select().from(monthlyStats).where(eq(monthlyStats.companyId, companyId)),
    tx.select({ id: reviews.id, unitId: reviews.unitId, period: reviews.period }).from(reviews).where(and(eq(reviews.companyId, companyId), eq(reviews.status, "published"), eq(reviews.kind, "checklist"))),
    tx.select({ label: natures.label, category: natures.category }).from(natures).where(eq(natures.companyId, companyId)),
  ]);
  const items = pubs.length ? await tx.select().from(reviewItems).where(and(eq(reviewItems.companyId, companyId), inArray(reviewItems.reviewId, pubs.map((p) => p.id)))) : [];
  const reviewOf = new Map(pubs.map((p) => [p.id, p]));

  // Cells from published reviews.
  const fromReviews = new Map<string, ItemAgg>();
  for (const it of items) {
    const r = reviewOf.get(it.reviewId)!;
    const key = `${iso(r.period)}|${r.unitId}|${it.areaId}`;
    const c = itemContribution({ checks: it.checks as Record<string, string>, defects: it.defects, status: it.status, recurring: it.recurring }, s.instanceBasis);
    const acc = fromReviews.get(key) || { reviewed: 0, instances: 0, defects: 0, resolvable: 0, resolved: 0, recurring: 0 };
    for (const k of Object.keys(acc) as (keyof ItemAgg)[]) acc[k] += c[k];
    fromReviews.set(key, acc);
  }
  // Imported cells, unless reviews cover them.
  const cells = new Map<string, ItemAgg>();
  for (const st of stats) {
    const key = `${iso(st.period)}|${st.unitId}|${st.areaId}`;
    if (fromReviews.has(key)) continue;
    const acc = cells.get(key) || { reviewed: 0, instances: 0, defects: 0, resolvable: 0, resolved: 0, recurring: 0 };
    acc.reviewed += st.reviewed; acc.instances += st.instances; acc.defects += st.defects; acc.resolvable += st.resolvable; acc.resolved += st.resolved; acc.recurring += st.recurring;
    cells.set(key, acc);
  }
  for (const [k, v] of fromReviews) cells.set(k, v);

  const usedUnits = new Set<string>(), usedAreas = new Set<string>(), periods = new Set<string>();
  for (const k of cells.keys()) { const [p, un, ar] = k.split("|"); periods.add(p); usedUnits.add(un); usedAreas.add(ar); }
  const unitList = u.filter((x) => x.active || usedUnits.has(x.id));
  const areaList = a.filter((x) => x.active || usedAreas.has(x.id));
  const sc = s.scorecard ? await buildScorecard(tx, companyId, unitList.map((x) => x.id)) : null;
  if (!periods.size && !sc) periods.add(new Date().toISOString().slice(0, 7) + "-01");
  const periodList = Array.from(periods).sort();
  const pI = new Map(periodList.map((p, i) => [p, i])), uI = new Map(unitList.map((x, i) => [x.id, i])), aI = new Map(areaList.map((x, i) => [x.id, i]));
  const rows: Row[] = [];
  for (const [k, v] of cells) {
    const [p, un, ar] = k.split("|");
    if (!uI.has(un) || !aI.has(ar)) continue;
    rows.push([pI.get(p)!, uI.get(un)!, aI.get(ar)!, v.reviewed, v.instances, v.defects, v.resolvable, v.resolved, v.recurring]);
  }
  rows.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

  // Defect natures on published reviews, by cell.
  const categoryOf = new Map(natureRows.map((n) => [n.label.toLowerCase(), n.category]));
  const natureList: { label: string; category: string }[] = [];
  const nI = new Map<string, number>();
  const nCells = new Map<string, number[]>();
  for (const it of items) {
    if (!it.defects || !it.nature) continue;
    const r = reviewOf.get(it.reviewId)!;
    const p = pI.get(iso(r.period)), ui = uI.get(r.unitId), ai = aI.get(it.areaId);
    if (p == null || ui == null || ai == null) continue;
    const label = it.nature.trim();
    if (!nI.has(label.toLowerCase())) { nI.set(label.toLowerCase(), natureList.length); natureList.push({ label, category: categoryOf.get(label.toLowerCase()) || "Other" }); }
    const ni = nI.get(label.toLowerCase())!;
    const k = `${p}|${ui}|${ai}|${ni}`;
    const c = nCells.get(k) || [p, ui, ai, ni, 0, 0];
    c[4] += it.defects; if (it.recurring) c[5] += it.defects;
    nCells.set(k, c);
  }
  return {
    periods: periodList,
    units: unitList.map((x) => ({ id: x.id, name: x.name })),
    areas: areaList.map((x) => ({ id: x.id, name: x.name })),
    rows,
    natures: natureList,
    natureRows: Array.from(nCells.values()),
    scorecard: sc ? { ...sc, rows: sc.rows.map((r) => [r[0] as number, uI.get(r[1] as string) ?? -1, ...(r.slice(2) as (number | null)[])]).filter((r) => (r[1] as number) >= 0) } : null,
  };
}

/** The active scorecard and its entries (unit ids still as ids; buildDataset maps them to indices). */
async function buildScorecard(tx: Tx, companyId: string, _unitIds: string[]): Promise<(Omit<ScorecardData, "rows"> & { rows: (number | string | null)[][] }) | null> {
  const card = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0];
  if (!card) return null;
  const def = card.definition as ScorecardDef;
  const entries = await tx.select().from(scorecardEntries).where(and(eq(scorecardEntries.companyId, companyId), eq(scorecardEntries.scorecardId, card.id)));
  const periodList = Array.from(new Set(entries.map((e) => iso(e.period)))).sort();
  const pI = new Map(periodList.map((p, i) => [p, i]));
  const sorted = entries.slice().sort((x, y) => iso(x.period).localeCompare(iso(y.period)) || x.unitId.localeCompare(y.unitId));
  return {
    id: card.id, name: def.name, measures: def.columns, periods: periodList, target: def.target,
    rows: sorted.map((e) => { const v = e.values as Record<string, number | null>; return [pI.get(iso(e.period))!, e.unitId, ...def.columns.map((c) => (typeof v[c.key] === "number" ? v[c.key] : null))]; }),
    auditRaw: sorted.map((e) => e.auditRaw),
  };
}

export async function getDataset(companyId: string): Promise<QualityData> {
  return withTenant(companyId, (tx) => buildDataset(tx, companyId));
}

/** Check weights per area (for weighted compliance scores in reviews). */
export async function checkSeverities(tx: Tx, companyId: string): Promise<Map<string, string>> {
  const rows = await tx.select({ id: checks.id, code: checks.code, areaId: checks.areaId, severity: checks.severity }).from(checks).where(eq(checks.companyId, companyId));
  return new Map(rows.map((r) => [`${r.areaId}|${r.code}`, r.severity]));
}
