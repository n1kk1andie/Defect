// Read an uploaded CSV, TSV or Excel file into a header row and string cells (server only).
import { MAX_ROWS, parseCsv, type Table } from "@/lib/table";

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
