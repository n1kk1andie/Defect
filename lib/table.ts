// Tabular uploads (CSV, TSV or Excel) for the sampling population and the bulk
// imports: read the file into a header row and string cells, then let the
// person map columns to fields. parseCsv and guessMapping are pure (the browser
// uses them for pasted text); readTable reads Excel on the server.

export interface Table { headers: string[]; rows: string[][]; sheet?: string; truncated: boolean }

export const MAX_ROWS = 50000;

/** RFC 4180 CSV (quotes, doubled quotes, newlines in quotes), or tab-separated when the first line has tabs and no commas. */
export function parseCsv(text: string, max = MAX_ROWS): Table {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = first.includes("\t") && !first.includes(",") ? "\t" : first.split(";").length > first.split(",").length ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false, truncated = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") { q = true; continue; }
    if (ch === sep) { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row.map((c) => c.trim()));
      row = [];
      if (out.length > max) { truncated = true; break; }
      continue;
    }
    cell += ch;
  }
  if (!truncated) { row.push(cell); if (row.some((c) => c.trim() !== "")) out.push(row.map((c) => c.trim())); }
  const [head = [], ...rows] = out;
  const width = Math.max(head.length, ...rows.slice(0, 200).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => head[i]?.trim() || `Column ${i + 1}`);
  return { headers, rows: rows.slice(0, max).map((r) => headers.map((_, i) => r[i] ?? "")), truncated: truncated || rows.length > max };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Map each field to the best-matching column (by name or a synonym), or -1. */
export function guessMapping(headers: string[], fields: { key: string; synonyms: string[] }[]): Record<string, number> {
  const used = new Set<number>();
  const out: Record<string, number> = {};
  for (const f of fields) {
    const names = [f.key, ...f.synonyms].map(norm);
    let idx = headers.findIndex((h, i) => !used.has(i) && names.includes(norm(h)));
    if (idx < 0) idx = headers.findIndex((h, i) => !used.has(i) && names.some((n) => n.length > 2 && norm(h).includes(n)));
    out[f.key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return out;
}

/** A number from a cell: "12,500.00", "$1 200", "(300)" (negative) or "1.5e3". */
export function toNumber(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()\s$£€¥,]/g, "").replace(/[A-Za-z]{3}$/, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

/** Read an uploaded file (server): .xlsx through ExcelJS (first sheet with data), else CSV/TSV text. */
export async function readTable(name: string, buf: Buffer, max = MAX_ROWS): Promise<Table> {
  if (/\.xlsx$/i.test(name) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
    if (!ws) return { headers: [], rows: [], truncated: false };
    const cell = (v: unknown): string => {
      if (v == null) return "";
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object") {
        const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
        if (o.richText) return o.richText.map((r) => r.text).join("");
        if (o.result !== undefined) return cell(o.result);
        if (o.text !== undefined) return String(o.text);
        return "";
      }
      return String(v).trim();
    };
    const all: string[][] = [];
    let truncated = false;
    ws.eachRow({ includeEmpty: false }, (r) => {
      if (all.length > max) { truncated = true; return; }
      const vals = (r.values as unknown[]).slice(1).map(cell);
      if (vals.some((x) => x !== "")) all.push(vals);
    });
    const [head = [], ...rows] = all;
    const width = Math.max(head.length, ...rows.slice(0, 200).map((x) => x.length));
    const headers = Array.from({ length: width }, (_, i) => head[i] || `Column ${i + 1}`);
    return { headers, rows: rows.slice(0, max).map((x) => headers.map((_, i) => x[i] ?? "")), sheet: ws.name, truncated: truncated || rows.length > max };
  }
  return parseCsv(buf.toString("utf8"), max);
}
