// The figures. One pure model used by the server (exports, the platform feed,
// the report) and the browser (every dashboard), so a number can only ever be
// computed one way. It reproduces the original app's arithmetic exactly:
//
//   defect rate      = defects ÷ possible instances
//   resolution rate  = resolved ÷ resolvable defects
//   recurring rate   = recurring ÷ defects
//
// summed over the rows in scope, then divided. One correction: a row can no
// longer claim more resolved than resolvable defects, or more recurring than
// defects found. A handful of keyed rows did, which is how the resolution rate
// once read above 100%. Such rows are capped here and listed by the migrator.

export const C = { P: 0, U: 1, A: 2, REVIEWED: 3, INSTANCES: 4, DEFECTS: 5, RESOLVABLE: 6, RESOLVED: 7, RECURRING: 8 } as const;
export type Row = number[];

export interface Named { id: string; name: string }

export interface ScorecardData {
  id: string;
  name: string;
  /** Display columns; the first is the overall score. */
  measures: { key: string; label: string }[];
  periods: string[];
  /** [periodIdx, unitIdx (into QualityData.units), ...one value per measure] */
  rows: (number | null)[][];
  /** Raw audit score per row (1–5 or 0–100), or null. */
  auditRaw: (number | null)[];
  /** The target score (the gauge marker). */
  target: number;
}

export interface QualityData {
  periods: string[];
  units: Named[];
  areas: Named[];
  rows: Row[];
  /** Defect natures recorded on published reviews, with their reporting category. */
  natures: { label: string; category: string }[];
  /** [periodIdx, unitIdx, areaIdx, natureIdx, defects, recurring] from published reviews. */
  natureRows: number[][];
  scorecard: ScorecardData | null;
}

export interface Filter { year: string; unit: number; area: number; period?: number }
export const ALL: Filter = { year: "all", unit: -1, area: -1 };

export interface Rec {
  reviewed: number; instances: number; defects: number; resolvable: number; resolved: number; recurring: number;
  defectRate: number | null; resolutionRate: number | null; recurringRate: number | null; unresolved: number;
}

export const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const yearOf = (iso: string) => iso.slice(0, 4);
export const monthLabel = (iso: string) => `${MON3[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const monthShort = (iso: string) => `${MON3[Number(iso.slice(5, 7)) - 1]} '${iso.slice(2, 4)}`;

/** The year screens open on: the year of the latest month with data (entered
 *  or uploaded), else the last year in the grid, else this year. Never fixed. */
export function openingYear(d: Pick<QualityData, "rows" | "periods">, now: Date = new Date()): string {
  const li = lastActive(d);
  if (li >= 0 && d.periods[li]) return yearOf(d.periods[li]);
  const ys = years(d.periods);
  return ys[ys.length - 1] || String(now.getFullYear());
}

export function years(periods: string[]): string[] {
  return Array.from(new Set(periods.map(yearOf)));
}

export function matches(r: Row, periods: string[], f: Filter): boolean {
  if (f.year !== "all" && yearOf(periods[r[C.P]] || "") !== f.year) return false;
  if (f.unit >= 0 && r[C.U] !== f.unit) return false;
  if (f.area >= 0 && r[C.A] !== f.area) return false;
  if (f.period != null && r[C.P] !== f.period) return false;
  return true;
}

export function filterRows(d: Pick<QualityData, "rows" | "periods">, f: Filter): Row[] {
  return d.rows.filter((r) => matches(r, d.periods, f));
}

/** Totals and the three rates for a set of rows. */
export function record(rows: Row[]): Rec {
  let reviewed = 0, instances = 0, defects = 0, resolvable = 0, resolved = 0, recurring = 0;
  for (const r of rows) {
    reviewed += r[C.REVIEWED]; instances += r[C.INSTANCES]; defects += r[C.DEFECTS]; resolvable += r[C.RESOLVABLE];
    resolved += Math.min(r[C.RESOLVED], r[C.RESOLVABLE]);
    recurring += Math.min(r[C.RECURRING], r[C.DEFECTS]);
  }
  return {
    reviewed, instances, defects, resolvable, resolved, recurring,
    defectRate: instances ? defects / instances : null,
    resolutionRate: resolvable ? resolved / resolvable : null,
    recurringRate: defects ? recurring / defects : null,
    unresolved: resolvable - resolved,
  };
}

/** Index of the last month with any reviewed instances (months after it are blank). */
export function lastActive(d: Pick<QualityData, "rows">): number {
  let last = -1;
  for (const r of d.rows) if (r[C.INSTANCES] > 0 && r[C.P] > last) last = r[C.P];
  return last;
}

/** The months in scope up to the last active one, for a year or all years. */
export function activeMonths(d: Pick<QualityData, "rows" | "periods">, year: string): number[] {
  const last = lastActive(d);
  return d.periods.map((_, i) => i).filter((i) => i <= last && (year === "all" || yearOf(d.periods[i]) === year));
}

export type MetricKey = "defectRate" | "resolutionRate" | "recurringRate";
export const METRICS: { key: MetricKey; label: string; family: MetricKey }[] = [
  { key: "defectRate", label: "Defect rate", family: "defectRate" },
  { key: "resolutionRate", label: "Resolution rate", family: "resolutionRate" },
  { key: "recurringRate", label: "Recurring rate", family: "recurringRate" },
];

/** A record per month in scope, for trends. */
export function trend(d: QualityData, f: Filter): { period: number; iso: string; rec: Rec }[] {
  const scoped = filterRows(d, { ...f, period: undefined });
  const byP = new Map<number, Row[]>();
  for (const r of scoped) (byP.get(r[C.P]) || byP.set(r[C.P], []).get(r[C.P])!).push(r);
  return activeMonths(d, f.year).map((p) => ({ period: p, iso: d.periods[p], rec: record(byP.get(p) || []) }));
}

/** A record per unit (only units with instances in scope). */
export function byUnit(d: QualityData, f: Filter): { index: number; name: string; rec: Rec }[] {
  const scoped = filterRows(d, { ...f, unit: -1 });
  return d.units.map((u, i) => ({ index: i, name: u.name, rec: record(scoped.filter((r) => r[C.U] === i)) })).filter((x) => x.rec.instances > 0);
}

/** A record per process area (only areas with instances in scope). */
export function byArea(d: QualityData, f: Filter): { index: number; name: string; rec: Rec }[] {
  const scoped = filterRows(d, { ...f, area: -1 });
  return d.areas.map((a, i) => ({ index: i, name: a.name, rec: record(scoped.filter((r) => r[C.A] === i)) })).filter((x) => x.rec.instances > 0);
}

/** Unit × month grid of one metric (null where nothing was reviewed). */
export function heatGrid(d: QualityData, f: Filter, metric: MetricKey): { months: number[]; units: { index: number; name: string; cells: (number | null)[]; total: number | null }[] } {
  const months = activeMonths(d, f.year);
  const scoped = filterRows(d, { ...f, unit: -1, period: undefined });
  const cell = new Map<string, Row[]>();
  for (const r of scoped) { const k = `${r[C.U]}|${r[C.P]}`; (cell.get(k) || cell.set(k, []).get(k)!).push(r); }
  const units = d.units.map((u, i) => {
    const cells = months.map((p) => record(cell.get(`${i}|${p}`) || [])[metric]);
    const total = record(scoped.filter((r) => r[C.U] === i))[metric];
    return { index: i, name: u.name, cells, total };
  }).filter((u) => u.cells.some((c) => c != null));
  return { months, units };
}

/** Unit × process area grid of one metric, with the counts behind each cell. */
export function areaGrid(d: QualityData, f: Filter, metric: MetricKey): { units: { index: number; name: string; cells: { rate: number | null; rec: Rec }[] }[] } {
  const scoped = filterRows(d, { ...f, unit: -1, area: -1 });
  const units = d.units.map((u, i) => ({
    index: i, name: u.name,
    cells: d.areas.map((_, ai) => { const rec = record(scoped.filter((r) => r[C.U] === i && r[C.A] === ai)); return { rate: rec[metric], rec }; }),
  })).filter((u) => u.cells.some((c) => c.rec.instances > 0));
  return { units };
}

// ── Insights (the original app's rules, unchanged) ────────────────────────────

export interface WatchItem { index: number; name: string; rec: Rec; risk: number; why: string[] }

/** Branch watchlist: composite of defect rate (60), unresolved share (25) and recurring (15), each scaled to the worst branch. */
export function watchlist(d: QualityData, f: Filter, n = 5): WatchItem[] {
  const stats = byUnit(d, f);
  if (!stats.length) return [];
  const maxDR = Math.max(...stats.map((s) => s.rec.defectRate || 0)) || 1;
  const maxRR = Math.max(...stats.map((s) => s.rec.recurringRate || 0)) || 1;
  return stats.map((s) => {
    const unres = s.rec.resolutionRate == null ? 0 : 1 - s.rec.resolutionRate;
    const risk = ((s.rec.defectRate || 0) / maxDR) * 60 + unres * 25 + ((s.rec.recurringRate || 0) / maxRR) * 15;
    const why: string[] = [];
    if ((s.rec.defectRate || 0) >= maxDR * 0.7) why.push("high defect rate");
    if (s.rec.resolutionRate != null && s.rec.resolutionRate < 0.7) why.push(`only ${pct(s.rec.resolutionRate)} resolved`);
    if ((s.rec.recurringRate || 0) >= 0.35) why.push(`${pct(s.rec.recurringRate)} recurring`);
    return { ...s, risk, why: why.length ? why : ["elevated overall"] };
  }).sort((a, b) => b.risk - a.risk).slice(0, n);
}

/** Resolution gap: branches with at least 10 defects, lowest resolution first. */
export function resolutionGap(d: QualityData, f: Filter, n = 6) {
  return byUnit(d, f).filter((s) => s.rec.defects >= 10 && s.rec.resolutionRate != null).sort((a, b) => (a.rec.resolutionRate ?? 0) - (b.rec.resolutionRate ?? 0)).slice(0, n);
}

/** Systemic recurring: process areas with at least 20 defects, most recurring first, with the branch that has the most repeats. */
export function systemicRecurring(d: QualityData, f: Filter, n = 4) {
  return byArea(d, f).filter((a) => a.rec.defects >= 20 && a.rec.recurringRate != null).map((a) => {
    let top = "", topRec = -1;
    d.units.forEach((u, ui) => { const r = record(filterRows(d, { ...f, unit: ui, area: a.index })); if (r.recurring > topRec) { topRec = r.recurring; top = u.name; } });
    return { ...a, topUnit: top };
  }).sort((a, b) => (b.rec.recurringRate ?? 0) - (a.rec.recurringRate ?? 0)).slice(0, n);
}

/** Pearson correlation of paired values (null with fewer than three pairs). */
export function pearson(pairs: [number, number][]): number | null {
  const n = pairs.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sx += x; sy += y; sxy += x * y; sxx += x * x; syy += y * y; }
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den ? (n * sxy - sx * sy) / den : null;
}

// ── Defect natures and recurring issues ──────────────────────────────────────

/** Defects by reporting category (Process, Documentation, Data…), largest first. */
export function byCategory(d: QualityData, f: Filter): { category: string; defects: number; share: number }[] {
  const m = new Map<string, number>();
  let total = 0;
  for (const r of d.natureRows) {
    if (!matches(r, d.periods, f)) continue;
    const c = d.natures[r[3]]?.category || "Other";
    m.set(c, (m.get(c) || 0) + r[4]); total += r[4];
  }
  return Array.from(m, ([category, defects]) => ({ category, defects, share: total ? defects / total : 0 })).sort((a, b) => b.defects - a.defects);
}

/** The defect natures that recur most, with where they recur most. */
export function topRecurring(d: QualityData, f: Filter, n = 5): { nature: string; category: string; recurring: number; defects: number; topUnit: string }[] {
  const m = new Map<number, { rec: number; def: number; units: Map<number, number> }>();
  for (const r of d.natureRows) {
    if (!matches(r, d.periods, f)) continue;
    const e = m.get(r[3]) || { rec: 0, def: 0, units: new Map() };
    e.rec += r[5]; e.def += r[4]; e.units.set(r[1], (e.units.get(r[1]) || 0) + r[5]);
    m.set(r[3], e);
  }
  return Array.from(m, ([ni, e]) => {
    const top = Array.from(e.units).sort((a, b) => b[1] - a[1])[0];
    return { nature: d.natures[ni]?.label || "—", category: d.natures[ni]?.category || "Other", recurring: e.rec, defects: e.def, topUnit: top ? d.units[top[0]]?.name || "—" : "—" };
  }).filter((x) => x.recurring > 0).sort((a, b) => b.recurring - a.recurring || b.defects - a.defects).slice(0, n);
}

export interface RecurringIssue { unit: number; unitName: string; area: number; areaName: string; nature: string; category: string; months: string[]; streak: number; defects: number; lastPeriod: string }

/**
 * Recurring-issue detection: the same defect nature at the same unit in at
 * least `minMonths` consecutive months (counting up to the latest month it
 * appeared). These are the candidates for a preventive action, or for Pulsus Risk.
 */
export function recurringIssues(d: QualityData, minMonths: number): RecurringIssue[] {
  const groups = new Map<string, { unit: number; area: number; nature: number; periods: Set<number>; defects: number }>();
  for (const r of d.natureRows) {
    if (r[4] <= 0) continue;
    const k = `${r[1]}|${r[2]}|${r[3]}`;
    const g = groups.get(k) || { unit: r[1], area: r[2], nature: r[3], periods: new Set<number>(), defects: 0 };
    g.periods.add(r[0]); g.defects += r[4];
    groups.set(k, g);
  }
  const monthNo = (iso: string) => Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
  const out: RecurringIssue[] = [];
  for (const g of groups.values()) {
    const ps = Array.from(g.periods).map((p) => d.periods[p]).sort();
    let streak = 1, best = 1, end = ps[0];
    for (let i = 1; i < ps.length; i++) {
      streak = monthNo(ps[i]) - monthNo(ps[i - 1]) === 1 ? streak + 1 : 1;
      if (streak >= best) { best = streak; end = ps[i]; }
    }
    if (best < minMonths) continue;
    out.push({
      unit: g.unit, unitName: d.units[g.unit]?.name || "—", area: g.area, areaName: d.areas[g.area]?.name || "—",
      nature: d.natures[g.nature]?.label || "—", category: d.natures[g.nature]?.category || "Other",
      months: ps, streak: best, defects: g.defects, lastPeriod: end,
    });
  }
  return out.sort((a, b) => b.lastPeriod.localeCompare(a.lastPeriod) || b.streak - a.streak || b.defects - a.defects);
}

// ── Scorecard (Operational Standard) figures ──────────────────────────────────

const meanOf = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

export function scRows(s: ScorecardData, f: Filter): (number | null)[][] {
  return s.rows.filter((r) => (f.year === "all" || yearOf(s.periods[r[0] as number] || "") === f.year) && (f.unit < 0 || r[1] === f.unit) && (f.period == null || r[0] === f.period));
}
/** Mean of one measure over the rows (untracked cells excluded). */
export function scMean(rows: (number | null)[][], measure: number): number | null { return meanOf(rows.map((r) => r[2 + measure])); }
export function scLastActive(s: ScorecardData): number { let l = -1; for (const r of s.rows) if (r[2] != null && (r[0] as number) > l) l = r[0] as number; return l; }
export function scMonths(s: ScorecardData, year: string): number[] {
  const last = scLastActive(s);
  return s.periods.map((_, i) => i).filter((i) => i <= last && (year === "all" || yearOf(s.periods[i]) === year));
}

/**
 * PMAS to date, the worksheet method: the sum of the year's monthly overall
 * scores up to the month, divided by 6 (through June) or 12 (after).
 */
export function pmasToDate(s: ScorecardData, unit: number, iso: string): { value: number | null; months: number; divisor: number; basis: "Mid-year" | "Year-end" } {
  const y = yearOf(iso), m = Number(iso.slice(5, 7));
  const divisor = m <= 6 ? 6 : 12;
  const vals: number[] = [];
  s.rows.forEach((r) => {
    const p = s.periods[r[0] as number];
    if (r[1] === unit && p && yearOf(p) === y && Number(p.slice(5, 7)) <= m && r[2] != null) vals.push(r[2] as number);
  });
  return { value: vals.length ? vals.reduce((a, b) => a + b, 0) / divisor : null, months: vals.length, divisor, basis: m <= 6 ? "Mid-year" : "Year-end" };
}

// ── Formatting ────────────────────────────────────────────────────────────────

export const pct = (v: number | null | undefined, dp = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);
export const num = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : Math.round(v).toLocaleString("en-US"));
export const score = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(1));
