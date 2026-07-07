// Server-side spreadsheet parsing & generation (SheetJS). Mirrors scripts/convert*.py:
// the 'Month' column is ignored (mislabeled), percentages/grades are derived in the
// UI, and only raw counts / scores are stored.
import * as XLSX from "xlsx";

const MON_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BRANCH_NORM: Record<string, string> = { "Duke St": "Duke Street" };
const normBranch = (b: string) => BRANCH_NORM[b] || b;

const OPSTD_METRIC_COLS: [string, string][] = [
  ["Operational Standard Score", "Op Standard Score"], ["Average SLA Score", "Average SLA"], ["% Queue SLA Adherence", "Queue SLA"],
  ["Onboarding SLA", "Onboarding SLA"], ["Procurement Score", "Procurement"], ["Compliance to Major Procedure Policy", "Major Procedure"],
  ["Avg Compliance to Major Procedure Policy", "Avg Procedure Compliance"], ["Customer Complaints Resolved", "Complaints Resolved"], ["Audit Resolution", "Audit Resolution"],
];

export type Dataset = "defects" | "opstd";
export interface DefectsPayload { meta: any; periods: string[]; branches: string[]; areas: string[]; rows: number[][]; }
export interface OpstdPayload { meta: any; metrics: { key: string; label: string }[]; periods: string[]; branches: string[]; rows: (number | null)[][]; auditRaw: (number | null)[]; }
export interface Parsed { type: Dataset; payload: DefectsPayload | OpstdPayload; }

function isoOf(v: any): string {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
}
const idx = (hdr: string[]) => { const o: Record<string, number> = {}; hdr.forEach((h, i) => (o[h] = i)); return o; };
const toInt = (v: any) => (typeof v === "number" ? Math.round(v) : 0);
const toNum = (v: any) => (typeof v === "number" ? Math.round(v * 100) / 100 : null);

// Header normalisation: lower-case, drop punctuation / "# of" filler, collapse
// whitespace. Lets us match a column by intent instead of an exact string, so an
// upload whose header reads "Recurring Defects" (no "# of") or has a stray double
// space still maps to the right field instead of being silently read as 0.
const normHdr = (h: string) => String(h).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isPctHdr = (h: string) => /%|percent|\brate\b/.test(String(h).toLowerCase());

/** Match a logical column against the header row by keyword. Percentage columns
 *  are excluded unless allowPct, so "% of Recurring Defects" never shadows the
 *  "# of Recurring Defects" count. Returns the column index, or -1 if unmatched. */
function findCol(hdr: string[], keywords: string[], opts: { exclude?: string[]; allowPct?: boolean } = {}): number {
  for (let i = 0; i < hdr.length; i++) {
    if (!opts.allowPct && isPctHdr(hdr[i])) continue;
    const n = normHdr(hdr[i]);
    if (!n) continue;
    if (!keywords.every((k) => n.includes(k))) continue;
    if (opts.exclude && opts.exclude.some((k) => n.includes(k))) continue;
    return i;
  }
  return -1;
}

export function parseWorkbook(buf: Buffer): Parsed {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hdr = (aoa[0] || []).map((h) => (h == null ? "" : String(h).trim()));
  const rows = aoa.slice(1).filter((r) => r && r.some((c) => c != null && c !== ""));
  const hasArea = findCol(hdr, ["area"]) >= 0, hasDefect = findCol(hdr, ["defect"], { allowPct: true }) >= 0;
  if (hasArea && hasDefect) return { type: "defects", payload: parseDefects(hdr, rows) };
  if (findCol(hdr, ["operational", "standard"], { allowPct: true }) >= 0 || findCol(hdr, ["queue", "sla"], { allowPct: true }) >= 0) return { type: "opstd", payload: parseOpstd(hdr, rows) };
  throw new Error("Unrecognized layout — expected the Branch Defects or Operational Standards sheet.");
}

function parseDefects(hdr: string[], rows: any[][]): DefectsPayload {
  // Resolve each column by intent (tolerant of "# of" / spacing / case differences).
  // Order matters: the specific defect columns are claimed before the generic
  // "# of Defects" count, which then excludes their keywords.
  const col = {
    period: findCol(hdr, ["period"]),
    branch: findCol(hdr, ["branch"]),
    area: findCol(hdr, ["area"]),
    reviewed: findCol(hdr, ["reviewed"]),
    instances: findCol(hdr, ["instances"]),
    resolvable: findCol(hdr, ["resolvable"]),
    resolved: findCol(hdr, ["resolved"]),
    recurring: findCol(hdr, ["recurring"]),
    defects: findCol(hdr, ["defects"], { exclude: ["resolvable", "resolved", "recurring", "possible", "reviewed"] }),
  };
  // Fail loudly rather than silently reading a missing column as 0 (the bug that
  // let uploaded recurring counts vanish when the header didn't match exactly).
  const REQUIRED: [keyof typeof col, string][] = [
    ["period", "Period"], ["branch", "Branch"], ["area", "Process Area"],
    ["reviewed", "# of Items Reviewed"], ["instances", "# of Possible Instances"], ["defects", "# of Defects"],
    ["resolvable", "# of Resolvable Defects"], ["resolved", "# of Defects Resolved"], ["recurring", "# of Recurring Defects"],
  ];
  const missing = REQUIRED.filter(([k]) => col[k] < 0).map(([, label]) => label);
  if (missing.length) throw new Error("Missing column(s) in the Branch Defects sheet: " + missing.join(", ") + ". Found headers: " + hdr.filter(Boolean).join(", "));

  const periods: string[] = [], branches: string[] = [], areas: string[] = [];
  rows.forEach((r) => {
    const p = isoOf(r[col.period]); if (!periods.includes(p)) periods.push(p);
    const b = normBranch(r[col.branch]); if (!branches.includes(b)) branches.push(b);
    const a = r[col.area]; if (!areas.includes(a)) areas.push(a);
  });
  periods.sort(); branches.sort(); areas.sort();
  const pI = idx(periods), bI = idx(branches), aI = idx(areas);
  const out = rows.map((r) => [
    pI[isoOf(r[col.period])], bI[normBranch(r[col.branch])], aI[r[col.area]],
    toInt(r[col.reviewed]), toInt(r[col.instances]), toInt(r[col.defects]),
    toInt(r[col.resolvable]), toInt(r[col.resolved]), toInt(r[col.recurring]),
  ]);
  return { meta: { source: "uploaded", columns: ["periodIdx", "branchIdx", "areaIdx", "reviewed", "instances", "defects", "resolvable", "resolved", "recurring"] }, periods, branches, areas, rows: out };
}

function parseOpstd(hdr: string[], rows: any[][]): OpstdPayload {
  const c = idx(hdr);
  const isoRow = (r: any[]) => `${String(r[c["Year"]])}-${String(MON_FULL.indexOf(r[c["Month"]]) + 1).padStart(2, "0")}-01`;
  const periods: string[] = [], branches: string[] = [];
  rows.forEach((r) => {
    const p = isoRow(r); if (!periods.includes(p)) periods.push(p);
    const b = normBranch(r[c["Branch"]]); if (!branches.includes(b)) branches.push(b);
  });
  periods.sort(); branches.sort();
  const pI = idx(periods), bI = idx(branches);
  const out: (number | null)[][] = [], audit: (number | null)[] = [];
  rows.forEach((r) => {
    const row: (number | null)[] = [pI[isoRow(r)], bI[normBranch(r[c["Branch"]])]];
    OPSTD_METRIC_COLS.forEach((m) => row.push(toNum(r[c[m[0]]])));
    out.push(row);
    audit.push(toNum(r[c["Audit Score"]]));
  });
  return { meta: { source: "uploaded", note: "Scores 0–100; percentages/grades derived in-app." }, metrics: OPSTD_METRIC_COLS.map((m) => ({ key: m[0], label: m[1] })), periods, branches, rows: out, auditRaw: audit };
}

export function buildWorkbook(type: Dataset, payload: any): Buffer {
  let aoa: any[][], sheetName: string;
  if (type === "defects") {
    const D = payload as DefectsPayload;
    aoa = [["Year", "Period", "Month", "Branch", "Process Area", "# of Items Reviewed", "# of Possible Instances", "# of Defects", "% Defects", "# of Resolvable Defects", "# of Defects Resolved", "% Defects Resolved", "# of Recurring Defects", "% of Recurring Defects"]];
    D.rows.forEach((r) => {
      const iso = D.periods[r[0]], y = iso.slice(0, 4), mi = parseInt(iso.slice(5, 7), 10) - 1;
      const [, , , rev, inst, def, resv, res, rec] = r;
      aoa.push([y, iso, MON_FULL[mi], D.branches[r[1]], D.areas[r[2]], rev, inst, def, inst ? def / inst : 0, resv, res, resv ? res / resv : 0, rec, def ? rec / def : 0]);
    });
    sheetName = "Branch Defects 2024-2026";
  } else {
    const O = payload as OpstdPayload;
    aoa = [["Year", "Month", "Branch", ...O.metrics.map((m) => m.key), "Audit Score"]];
    O.rows.forEach((r, i) => {
      const iso = O.periods[r[0] as number], y = iso.slice(0, 4), mi = parseInt(iso.slice(5, 7), 10) - 1;
      const vals = O.metrics.map((_m, j) => (r[2 + j] == null ? "" : r[2 + j]));
      aoa.push([y, MON_FULL[mi], O.branches[r[1] as number], ...vals, O.auditRaw[i] == null ? "" : O.auditRaw[i]]);
    });
    sheetName = "Op Standards 2024-2026";
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
