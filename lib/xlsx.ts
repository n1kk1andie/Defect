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

// ---- Process Critical Review: template + parsing (officer register upload) ----

export interface ReviewItem { area: string; txnType: string; checks: Record<string, string>; defects: number; defectArea: string; recurring: boolean; status: string; }
const REVIEW_HEADERS = ["Date", "Process Area", "Transaction Type", "Member Verified", "Card Keyed to CMS", "CMS & Sig Match", "ID Capture Updated", "Form Completed", "# of Defects", "Defect Area", "Recurring", "Status"];

// Map a free-text process-area value (e.g. "ABM", "Wires / RTGS") to one of the
// dataset's canonical area names, so uploads from the real branch sheet line up.
function mapArea(raw: string, areas: string[]): string {
  const n = normHdr(raw);
  if (!n) return "";
  const exact = areas.find((a) => normHdr(a) === n);
  if (exact) return exact;
  const kw: [string, RegExp][] = [
    ["abm", /\babm\b/], ["addition of name", /addition|name/], ["cif merge", /cif|merge|delet/],
    ["standing order", /standing|order|\bso\b/], ["wire", /wire|rtgs/],
  ];
  for (const [key, re] of kw) { if (re.test(n)) { const hit = areas.find((a) => normHdr(a).includes(normHdr(key).split(" ")[0])); if (hit) return hit; } }
  const contains = areas.find((a) => normHdr(a).includes(n) || n.includes(normHdr(a)));
  return contains || raw.trim();
}
function yesNoNa(v: any): string { const s = String(v ?? "").trim().toLowerCase(); if (["no", "n", "fail", "false", "0"].includes(s)) return "no"; if (["na", "n a", "n/a", "-"].includes(s.replace(/\s/g, ""))) return "na"; return "yes"; }
function truthy(v: any): boolean { const s = String(v ?? "").trim().toLowerCase(); return ["yes", "y", "true", "1", "recurring"].includes(s); }

/** A blank fill-in template for the officer's monthly Process Critical Review. */
export function buildReviewTemplate(areas: string[]): Buffer {
  const example = ["2026-06-15", areas[0] || "ABM", "Application", "Yes", "Yes", "Yes", "No", "Yes", 1, "ID Cap", "No", "Open"];
  const clean = ["2026-06-16", areas[areas.length - 1] || "Wire Transfers", "Amendment", "Yes", "Yes", "Yes", "Yes", "Yes", 0, "", "No", ""];
  const aoa = [REVIEW_HEADERS, example, clean];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = REVIEW_HEADERS.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Process Critical Review");
  // A reference sheet listing the valid process areas + control-check values.
  const ref = [["Valid Process Areas"], ...areas.map((a) => [a]), [""], ["Control checks:", "Yes / No / N/A"], ["Recurring:", "Yes / No"], ["Status:", "Open / Resolved"], ["", ""], ["Add one row per sampled transaction. The app computes the sample, defect rate, resolution, recurring and score."]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ref), "Guide");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Parse a filled review workbook into register rows. Reads every sheet that looks
 *  like a review (has a Process Area + Defects column); when a Branch column is present
 *  and `branch` is given, keeps only that branch's rows — so either our template or the
 *  real multi-branch Process Critical Review workbook can be uploaded. */
export function parseReviewWorkbook(buf: Buffer, areas: string[], branch?: string): { items: ReviewItem[]; sheets: number; skipped: number } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const items: ReviewItem[] = [];
  let sheets = 0, skipped = 0;
  const bnorm = branch ? normHdr(branch) : "";
  for (const name of wb.SheetNames) {
    const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    if (!aoa.length) continue;
    const hdr = (aoa[0] || []).map((h) => (h == null ? "" : String(h)));
    const cArea = findCol(hdr, ["process", "area"]) >= 0 ? findCol(hdr, ["process", "area"]) : findCol(hdr, ["area"], { exclude: ["defect"] });
    const cDef = findCol(hdr, ["defect"], { exclude: ["area", "form", "total", "amount"] });
    if (cArea < 0 || cDef < 0) continue; // not a review sheet
    // Require a per-transaction signal (a Date or Transaction column) so summary /
    // roll-up sheets — which also have a Process-Area + Defect column — are skipped.
    const cTxn = findCol(hdr, ["transaction"]);
    const cDate = findCol(hdr, ["date"], { exclude: ["follow", "1st", "2nd", "3rd"] });
    if (cTxn < 0 && cDate < 0) continue;
    if (/summary|nature|guide|instruction|comment/i.test(name)) continue;
    sheets++;
    const cBranch = findCol(hdr, ["branch"]);
    const cDefArea = findCol(hdr, ["defect", "area"]);
    const cRec = findCol(hdr, ["recurring"]), cStatus = findCol(hdr, ["status"]);
    const cChecks: Record<string, number> = {
      memberVerified: findCol(hdr, ["member", "verif"]), cardKeyedCMS: findCol(hdr, ["card", "cms"]),
      cmsSigMatch: findCol(hdr, ["sig"]), idCapture: findCol(hdr, ["id", "cap"]), formCompleted: findCol(hdr, ["form", "complet"]),
    };
    for (const r of aoa.slice(1)) {
      if (!r || !r.some((c) => c != null && c !== "")) continue;
      const rawArea = r[cArea];
      if (rawArea == null || String(rawArea).trim() === "" || /^nil$/i.test(String(rawArea).trim())) { skipped++; continue; }
      if (cBranch >= 0 && bnorm && normHdr(String(r[cBranch] ?? "")) !== bnorm) { skipped++; continue; }
      // A "nil" in the Date cell marks an area with no transactions sampled — skip it so
      // it doesn't inflate the sample count.
      if (cDate >= 0) { const dv = String(r[cDate] ?? "").trim().toLowerCase(); if (dv === "nil" || dv === "n/a" || dv === "none" || dv === "-") { skipped++; continue; } }
      const area = mapArea(String(rawArea), areas);
      const checks: Record<string, string> = {};
      Object.keys(cChecks).forEach((k) => (checks[k] = cChecks[k] >= 0 ? yesNoNa(r[cChecks[k]]) : "yes"));
      const defects = typeof r[cDef] === "number" ? Math.max(0, Math.round(r[cDef])) : parseInt(String(r[cDef] ?? "0"), 10) || 0;
      const statusRaw = cStatus >= 0 ? String(r[cStatus] ?? "").toLowerCase() : "";
      items.push({
        area, txnType: cTxn >= 0 ? String(r[cTxn] ?? "").trim() : "", checks, defects,
        defectArea: cDefArea >= 0 ? String(r[cDefArea] ?? "").trim() : "",
        recurring: cRec >= 0 ? truthy(r[cRec]) : false,
        status: /resolv|clos|complete/.test(statusRaw) ? "resolved" : "open",
      });
    }
  }
  return { items, sheets, skipped };
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
