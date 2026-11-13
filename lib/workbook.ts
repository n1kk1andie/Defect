// Spreadsheets in and out (ExcelJS: no SheetJS and its advisories).
//
// In: the consolidated Branch Defects workbook (month × branch × area counts)
// and the Operational Standards workbook, as the previous version accepted
// them. Columns are matched by intent ("# of Recurring Defects", "Recurring
// Defects"…) and a missing one is an error, never a silent zero. Each upload is
// previewed row by row before an admin commits it (lib/imports.ts).
// Out: templates, and any table as .xlsx or CSV.
import ExcelJS from "exceljs";
import { OPERATIONAL_STANDARD } from "@/lib/scorecard";

const MON_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const normHdr = (h: unknown) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isPct = (h: unknown) => /%|percent|\brate\b/.test(String(h ?? "").toLowerCase());

function findCol(hdr: string[], keywords: string[], opts: { exclude?: string[]; allowPct?: boolean } = {}): number {
  for (let i = 0; i < hdr.length; i++) {
    if (!opts.allowPct && isPct(hdr[i])) continue;
    const n = normHdr(hdr[i]);
    if (!n || !keywords.every((k) => n.includes(k))) continue;
    if (opts.exclude?.some((k) => n.includes(k))) continue;
    return i;
  }
  return -1;
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object") {
    if (v instanceof Date) return v;
    if ("result" in v) return (v as ExcelJS.CellFormulaValue).result;
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return (v as ExcelJS.CellHyperlinkValue).text;
  }
  return v;
}

async function firstSheet(buf: Buffer): Promise<unknown[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("The workbook has no sheets.");
  const out: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
    out.push(vals);
  });
  return out;
}

const isoOf = (v: unknown): string => {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-01` : "";
};
const toInt = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : Number.isFinite(Number(v)) && String(v).trim() !== "" ? Math.max(0, Math.round(Number(v))) : 0);
const toNum = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").trim()); return String(v ?? "").trim() !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };

export interface DefectsUpload { kind: "defects"; rows: [string, string, string, number, number, number, number, number, number][]; problems: { row: number; message: string }[] }
export interface OpstdUpload { kind: "opstd"; entries: [string, string, Record<string, number | null>, number | null][]; problems: { row: number; message: string }[] }

/** Read an uploaded workbook: which layout it is and its rows, with any per-row problems. */
export async function parseUpload(buf: Buffer, aliases: Record<string, string> = {}): Promise<DefectsUpload | OpstdUpload> {
  const aoa = await firstSheet(buf);
  const hdr = (aoa[0] || []).map((h) => String(h ?? "").trim());
  const body = aoa.slice(1).filter((r) => r.some((c) => c != null && c !== ""));
  const unit = (b: unknown) => { const s = String(b ?? "").trim(); return aliases[s] || s; };
  if (findCol(hdr, ["area"]) >= 0 && findCol(hdr, ["defect"], { allowPct: true }) >= 0) {
    const col = {
      period: findCol(hdr, ["period"]), branch: findCol(hdr, ["branch"]) >= 0 ? findCol(hdr, ["branch"]) : findCol(hdr, ["unit"]), area: findCol(hdr, ["area"]),
      reviewed: findCol(hdr, ["reviewed"]), instances: findCol(hdr, ["instances"]), resolvable: findCol(hdr, ["resolvable"]),
      resolved: findCol(hdr, ["resolved"]), recurring: findCol(hdr, ["recurring"]),
      defects: findCol(hdr, ["defects"], { exclude: ["resolvable", "resolved", "recurring", "possible", "reviewed"] }),
    };
    const req: [keyof typeof col, string][] = [["period", "Period"], ["branch", "Branch"], ["area", "Process Area"], ["reviewed", "# of Items Reviewed"], ["instances", "# of Possible Instances"], ["defects", "# of Defects"], ["resolvable", "# of Resolvable Defects"], ["resolved", "# of Defects Resolved"], ["recurring", "# of Recurring Defects"]];
    const missing = req.filter(([k]) => col[k] < 0).map(([, l]) => l);
    if (missing.length) throw new Error(`Missing column(s): ${missing.join(", ")}. Found: ${hdr.filter(Boolean).join(", ")}`);
    const problems: DefectsUpload["problems"] = [];
    const rows: DefectsUpload["rows"] = [];
    body.forEach((r, i) => {
      const p = isoOf(r[col.period]), b = unit(r[col.branch]), a = String(r[col.area] ?? "").trim();
      if (!p || !b || !a) { problems.push({ row: i + 2, message: "Needs a period, branch and process area." }); return; }
      const v = [toInt(r[col.reviewed]), toInt(r[col.instances]), toInt(r[col.defects]), toInt(r[col.resolvable]), toInt(r[col.resolved]), toInt(r[col.recurring])];
      if (v[2] > v[1]) problems.push({ row: i + 2, message: "More defects than possible instances." });
      if (v[4] > v[3]) { problems.push({ row: i + 2, message: `Resolved (${v[4]}) is more than resolvable (${v[3]}); capped.` }); v[4] = v[3]; }
      if (v[5] > v[2]) { problems.push({ row: i + 2, message: `Recurring (${v[5]}) is more than defects (${v[2]}); capped.` }); v[5] = v[2]; }
      rows.push([p, b, a, v[0], v[1], v[2], v[3], v[4], v[5]]);
    });
    return { kind: "defects", rows, problems };
  }
  if (findCol(hdr, ["operational", "standard"], { allowPct: true }) >= 0 || findCol(hdr, ["queue", "sla"], { allowPct: true }) >= 0) {
    const ix = (name: string) => hdr.findIndex((h) => normHdr(h) === normHdr(name));
    const yearC = ix("Year"), monthC = ix("Month"), branchC = ix("Branch"), auditC = ix("Audit Score");
    if (yearC < 0 || monthC < 0 || branchC < 0) throw new Error("The Operational Standards sheet needs Year, Month and Branch columns.");
    const sourceCols = ["Operational Standard Score", "Average SLA Score", "% Queue SLA Adherence", "Onboarding SLA", "Procurement Score", "Compliance to Major Procedure Policy", "Avg Compliance to Major Procedure Policy", "Customer Complaints Resolved", "Audit Resolution"];
    const problems: OpstdUpload["problems"] = [];
    const entries: OpstdUpload["entries"] = [];
    body.forEach((r, i) => {
      const mi = MON_FULL.indexOf(String(r[monthC] ?? "").trim());
      const y = String(r[yearC] ?? "").trim();
      if (mi < 0 || !/^\d{4}$/.test(y)) { problems.push({ row: i + 2, message: "Needs a year and a month name." }); return; }
      const values: Record<string, number | null> = {};
      OPERATIONAL_STANDARD.columns.forEach((c, ci) => { const k = ix(sourceCols[ci]); values[c.key] = k >= 0 ? toNum(r[k]) : null; });
      entries.push([`${y}-${String(mi + 1).padStart(2, "0")}-01`, unit(r[branchC]), values, auditC >= 0 ? toNum(r[auditC]) : null]);
    });
    return { kind: "opstd", entries, problems };
  }
  throw new Error("Unrecognised layout: expected the Branch Defects or Operational Standards sheet. Download a template from this page.");
}

const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B2559" } };

/** A workbook from rows (first row bold headers on navy). */
export async function buildXlsx(sheets: { name: string; header: string[]; rows: (string | number | null)[][]; widths?: number[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pulsus Quality";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.header);
    ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = HEAD_FILL; });
    for (const r of s.rows) ws.addRow(r);
    ws.columns.forEach((c, i) => { c.width = s.widths?.[i] ?? Math.max(12, Math.min(48, (s.header[i] || "").length + 4)); });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV with a BOM so Excel opens it as UTF-8. Cells that could run as formulas are neutralised. */
export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v == null) return "";
    let s = String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function defectsTemplate(units: string[], areas: string[]): Promise<Buffer> {
  const header = ["Period", "Branch", "Process Area", "# of Items Reviewed", "# of Possible Instances", "# of Defects", "# of Resolvable Defects", "# of Defects Resolved", "# of Recurring Defects"];
  const ex = [["2026-01-01", units[0] || "Harbour", areas[0] || "Payments", 30, 150, 6, 6, 5, 1]];
  return buildXlsx([{ name: "Branch Defects", header, rows: ex }, { name: "Guide", header: ["Valid branches", "Valid process areas"], rows: Array.from({ length: Math.max(units.length, areas.length) }, (_, i) => [units[i] ?? null, areas[i] ?? null]) }]);
}

export async function opstdTemplate(units: string[]): Promise<Buffer> {
  const header = ["Year", "Month", "Branch", "Operational Standard Score", "Average SLA Score", "% Queue SLA Adherence", "Onboarding SLA", "Procurement Score", "Compliance to Major Procedure Policy", "Avg Compliance to Major Procedure Policy", "Customer Complaints Resolved", "Audit Resolution", "Audit Score"];
  return buildXlsx([{ name: "Operational Standards", header, rows: [[2026, "January", units[0] || "Harbour", 92.4, 95.1, 96.8, 94.2, 90.4, 93.6, 93.6, 95.0, 88.0, 80]] }]);
}
