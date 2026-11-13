// Templates in and out of Excel (ExcelJS). One row per question on the
// "Questions" sheet, the template's own settings on "Template". An exported
// sheet re-imports to the same definition (tested); people can also start a
// template from a spreadsheet they already keep.
//
// Columns (Questions): Section · Repeat per item · Question · Type · Weight ·
// Severity · Critical · N/A allowed · Required · Options · Min · Max · Unit ·
// Guidance · Reference · Photo if failed · Note if failed · Auto action ·
// Shown when · Key
//   Options:    "Good=1; Needs work=0.5; Poor=0!"   (! marks a failing option)
//   Shown when: "3=fail" (question 3 in the same section failed), "3=pass",
//               "3=na", "3=answered" or "3=Poor" (an option's label)
import ExcelJS from "exceljs";
import { QUESTION_TYPES, TYPE_INFO, validateTemplate, type QType, type TemplateDef } from "@/lib/templates/model";

const COLS = ["Section", "Repeat per item", "Question", "Type", "Weight", "Severity", "Critical", "N/A allowed", "Required", "Options", "Min", "Max", "Unit", "Guidance", "Reference", "Photo if failed", "Note if failed", "Auto action", "Shown when", "Key"];
const yes = (b: unknown) => (b ? "Yes" : "");
const truthy = (v: unknown) => /^(y|yes|true|1|x|✓)$/i.test(String(v ?? "").trim());
const typeByLabel = (v: unknown): QType => {
  const s = String(v ?? "").trim().toLowerCase();
  const direct = (QUESTION_TYPES as readonly string[]).find((t) => t === s);
  if (direct) return direct as QType;
  const byLabel = (Object.entries(TYPE_INFO) as [QType, { label: string }][]).find(([, i]) => i.label.toLowerCase() === s);
  if (byLabel) return byLabel[0];
  if (/yes|no/.test(s)) return "yesno";
  if (/pass|fail/.test(s)) return "passfail";
  if (/rat|scale|star/.test(s)) return "rating";
  if (/num|count|temp|amount/.test(s)) return "number";
  if (/several|multi|checkbox|tick/.test(s)) return "multi";
  if (/choice|select|option|drop/.test(s)) return "choice";
  if (/date/.test(s)) return "date";
  if (/photo|image|evidence|media/.test(s)) return "photo";
  if (/sign/.test(s)) return "signature";
  if (/ref|file|sample|account|chart|record/.test(s)) return "reference";
  if (/text|comment|note/.test(s)) return "text";
  return "yesno";
};

export async function templateToXlsx(def: TemplateDef): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Pulsus Quality";
  const meta = wb.addWorksheet("Template");
  meta.columns = [{ header: "Setting", key: "k", width: 22 }, { header: "Value", key: "v", width: 80 }];
  const rows: [string, unknown][] = [
    ["Name", def.name], ["Description", def.description], ["Sector", def.sector], ["Category", def.category],
    ["Pass mark", def.scoring.passMark], ["Critical failure", def.scoring.critical === "zero" ? "Fails and zeroes the score" : "Fails the inspection"],
    ["Sampled item", def.sampling?.itemLabel ?? ""], ["Inspector signs", yes(def.signatures.inspector)], ["Site manager signs", yes(def.signatures.site)], ["Check in at the site", yes(def.checkin)],
    ["Format", "pulsus.quality.template/v1"],
  ];
  for (const [k, v] of rows) meta.addRow({ k, v });
  meta.getRow(1).font = { bold: true };
  const ws = wb.addWorksheet("Questions");
  ws.columns = COLS.map((h) => ({ header: h, key: h, width: h === "Question" || h === "Guidance" ? 48 : h === "Options" ? 36 : 14 }));
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const s of def.sections) {
    s.questions.forEach((q) => {
      const idx = q.showIf ? s.questions.findIndex((x) => x.id === q.showIf!.q) + 1 : 0;
      const target = q.showIf ? s.questions[idx - 1] : null;
      const is = q.showIf ? (["pass", "fail", "na", "answered"].includes(q.showIf.is) ? q.showIf.is : target?.options?.find((o) => o.id === q.showIf!.is)?.label ?? q.showIf.is) : "";
      ws.addRow({
        Section: s.title, "Repeat per item": yes(s.perItem), Question: q.label, Type: TYPE_INFO[q.type].label, Weight: q.weight, Severity: q.severity,
        Critical: yes(q.critical), "N/A allowed": yes(q.allowNA), Required: yes(q.required),
        Options: q.options?.map((o) => `${o.label}=${o.score}${o.fail ? "!" : ""}`).join("; ") ?? "",
        Min: q.type === "rating" ? q.scale?.min : q.range?.min ?? "", Max: q.type === "rating" ? q.scale?.max : q.range?.max ?? "", Unit: q.type === "rating" ? `pass at ${q.scale?.passAt}` : q.range?.unit ?? "",
        Guidance: q.guidance ?? "", Reference: q.reference ?? "", "Photo if failed": yes(q.photoOnFail), "Note if failed": yes(q.noteOnFail),
        "Auto action": q.action?.auto ? `${q.action.priority}, ${q.action.dueDays} days` : "", "Shown when": q.showIf ? `${idx}=${is}` : "", Key: q.key ?? "",
      });
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cell = (v: ExcelJS.CellValue): string => {
  if (v && typeof v === "object") {
    if ("result" in v) return String((v as ExcelJS.CellFormulaValue).result ?? "");
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text);
  }
  return v == null ? "" : String(v);
};

/** Read a template from a workbook: the "Questions" sheet (or the first sheet), and "Template" when present. */
export async function xlsxToTemplate(buf: Buffer, fallbackName = "Imported template"): Promise<{ ok: true; def: TemplateDef } | { ok: false; error: string }> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { return { ok: false, error: "That file isn't an Excel workbook (.xlsx)." }; }
  const ws = wb.getWorksheet("Questions") || wb.worksheets.find((w) => w.name !== "Template") || wb.worksheets[0];
  if (!ws) return { ok: false, error: "The workbook has no sheets." };
  const grid: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => grid.push((row.values as ExcelJS.CellValue[]).slice(1).map(cell)));
  if (grid.length < 2) return { ok: false, error: "Add one question per row under a header row." };
  const hdr = grid[0].map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => hdr.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const c = {
    section: col("section"), perItem: col("repeat per item", "per item"), question: col("question", "item", "check"), type: col("type", "response"),
    weight: col("weight", "points"), severity: col("severity"), critical: col("critical"), na: col("n/a", "na allowed"), required: col("required", "mandatory"),
    options: col("options", "choices"), min: col("min"), max: col("max"), unit: col("unit"), guidance: col("guidance", "help"), reference: col("reference", "policy"),
    photo: col("photo"), note: col("note"), action: col("auto action", "action"), when: col("shown when", "condition"), key: col("key", "code"),
  };
  if (c.question < 0) return { ok: false, error: "There's no “Question” column." };
  const meta: Record<string, string> = {};
  const ms = wb.getWorksheet("Template");
  ms?.eachRow((row, i) => { if (i > 1) { const v = (row.values as ExcelJS.CellValue[]).slice(1).map(cell); if (v[0]) meta[v[0].trim().toLowerCase()] = v[1] ?? ""; } });
  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const sections: Record<string, any>[] = [];
  for (const r of grid.slice(1)) {
    const label = at(r, c.question);
    if (!label) continue;
    const title = at(r, c.section) || sections[sections.length - 1]?.title || "Checklist";
    let s = sections[sections.length - 1];
    if (!s || s.title !== title) { s = { title, perItem: truthy(at(r, c.perItem)), questions: [] }; sections.push(s); }
    const type = typeByLabel(at(r, c.type) || "yesno");
    const q: Record<string, any> = { id: `s${sections.length}q${s.questions.length + 1}`, type, label, guidance: at(r, c.guidance), reference: at(r, c.reference), key: at(r, c.key) };
    const w = at(r, c.weight); if (w) q.weight = Number(w);
    const sev = at(r, c.severity).toLowerCase(); if (sev) q.severity = sev;
    if (c.critical >= 0) q.critical = truthy(at(r, c.critical));
    if (c.na >= 0) q.allowNA = truthy(at(r, c.na)); else q.allowNA = type === "yesno" || type === "passfail";
    if (c.required >= 0 && at(r, c.required)) q.required = truthy(at(r, c.required));
    q.photoOnFail = truthy(at(r, c.photo)); q.noteOnFail = truthy(at(r, c.note));
    const act = at(r, c.action);
    if (act && !/^no?$/i.test(act)) { const pr = /high/i.test(act) ? "high" : /low/i.test(act) ? "low" : "medium"; const d = Number((act.match(/(\d+)/) || [])[1]); q.action = { auto: true, priority: pr, dueDays: d || 30 }; }
    const opts = at(r, c.options);
    if (opts) q.options = opts.split(/[;\n|]/).map((x, i) => { const m = x.trim().match(/^(.*?)(?:=\s*([0-9.]+))?\s*(!)?$/); return m && m[1].trim() ? { id: `o${i + 1}`, label: m[1].trim(), score: m[2] !== undefined ? Number(m[2]) : 1, fail: !!m[3] } : null; }).filter(Boolean);
    if ((type === "choice" || type === "multi") && !q.options?.length) q.options = [{ id: "o1", label: "Yes", score: 1 }, { id: "o2", label: "No", score: 0, fail: true }];
    const mn = at(r, c.min), mx = at(r, c.max), un = at(r, c.unit);
    if (type === "rating") q.scale = { min: mn ? Number(mn) : 1, max: mx ? Number(mx) : 5, passAt: Number((un.match(/(\d+)/) || [])[1]) || undefined };
    if (type === "number") q.range = { min: mn === "" ? undefined : Number(mn), max: mx === "" ? undefined : Number(mx), unit: un };
    const when = at(r, c.when).match(/^(\d+)\s*=\s*(.+)$/);
    if (when) {
      const target = s.questions[Number(when[1]) - 1];
      if (target) {
        const v = when[2].trim();
        const is = ["pass", "fail", "na", "answered"].includes(v.toLowerCase()) ? v.toLowerCase() : target.options?.find((o: any) => o.label.toLowerCase() === v.toLowerCase())?.id ?? v;
        q.showIf = { q: target.id, is };
      }
    }
    s.questions.push(q);
  }
  if (!sections.length) return { ok: false, error: "No questions found." };
  const pm = Number(meta["pass mark"]);
  return validateTemplate({
    name: meta["name"] || fallbackName, description: meta["description"] || "", sector: meta["sector"] || "general", category: meta["category"] || "Inspection",
    scoring: { passMark: Number.isFinite(pm) && meta["pass mark"] ? pm : 85, critical: /zero/i.test(meta["critical failure"] || "") ? "zero" : "fail" },
    sampling: { itemLabel: meta["sampled item"] || "Item" },
    signatures: { inspector: meta["inspector signs"] === undefined ? true : truthy(meta["inspector signs"]), site: truthy(meta["site manager signs"]) },
    checkin: meta["check in at the site"] === undefined ? true : truthy(meta["check in at the site"]),
    sections,
  });
}
