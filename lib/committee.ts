// The committee report: one pack for a quality or risk committee, as a PDF
// (pdf-lib, no browser needed) and an Excel workbook (ExcelJS). The same
// figures as the screens: inspection results, the risk league table and
// watchlist with the reasons, missed visits, sampling conclusions, the
// most-failed questions and the action register's position.
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { sql } from "drizzle-orm";
import { rowsOf, withTenant } from "@/lib/db/client";
import { getSettings } from "@/lib/company";
import { riskBoard } from "@/lib/riskScore";
import { visits } from "@/lib/schedule";
import { listPlans } from "@/lib/samplingPlans";
import { inspectionStats } from "@/lib/inspectionStats";
import { why } from "@/lib/risk";
import { BANDS, type BandKey } from "@/lib/bands";
import type { Actor } from "@/lib/roles";

export interface CommitteePack {
  company: string; unitLabel: string; unitPlural: string; generatedAt: string; by: string;
  kpis: { label: string; value: string; note: string }[];
  league: { rank: number; name: string; group: string; score: number | null; band: BandKey | "none"; delta: number | null; top: string; everyDays: number | null }[];
  watchlist: { name: string; band: BandKey | "none"; score: number | null; why: string }[];
  missed: { unit: string; template: string; by: string; assignee: string }[];
  sampling: { ref: string; name: string; unit: string; n: number; deviations: number | null; upper: number | null; tdr: number | null; conclusion: string }[];
  failed: { label: string; template: string; fails: number; asked: number; rate: number }[];
  actions: { open: number; overdue: number; awaiting: number; closed90: number };
}

const pc = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export async function committeePack(a: Actor, now = new Date()): Promise<CommitteePack> {
  const settings = await getSettings(a.tenant);
  // One after another: each opens its own tenant transaction.
  const board = await riskBoard(a, now);
  const vs = await visits(a, { now });
  const plans = await listPlans(a);
  const stats = await inspectionStats(a, 3);
  const act = await withTenant(a.tenant, async (tx) => rowsOf<{ open: number; overdue: number; awaiting: number; closed90: number }>(await tx.execute(sql`select
      count(*) filter (where status <> 'closed')::int as open, count(*) filter (where status <> 'closed' and due_date < current_date)::int as overdue,
      count(*) filter (where status = 'awaiting_verification')::int as awaiting, count(*) filter (where status = 'closed' and closed_at > now() - interval '90 days')::int as closed90 from actions`))[0]);
  const overdueVisits = vs.filter((v) => v.status === "overdue");
  const notEff = plans.filter((p) => p.evaluation && !p.evaluation.effective).length;
  const high = board.sites.filter((s) => s.band === "attention" || s.band === "escalate");
  return {
    company: a.tenantName, unitLabel: settings.unitLabel, unitPlural: settings.unitPlural, generatedAt: now.toISOString(), by: a.name || a.email,
    kpis: [
      { label: "Inspections approved", value: String(stats.total), note: `last 3 months, ${stats.questions.length ? "see most-failed questions" : "no failures"}` },
      { label: "Average inspection score", value: stats.sites.length ? `${(stats.sites.reduce((t, s) => t + (s.avg ?? 0) * s.n, 0) / Math.max(1, stats.sites.reduce((t, s) => t + s.n, 0))).toFixed(1)}%` : "—", note: "weighted by inspections" },
      { label: `${settings.unitPlural} at Attention or Escalate`, value: String(high.length), note: high.map((s) => s.name).join(", ") || "none" },
      { label: "Overdue visits", value: String(overdueVisits.length), note: "programme visits whose window has passed" },
      { label: "Controls not effective (sampling)", value: `${notEff} of ${plans.filter((p) => p.evaluation).length}`, note: "upper deviation limit above the tolerable rate" },
      { label: "Overdue corrective actions", value: String(act?.overdue ?? 0), note: `${act?.open ?? 0} open, ${act?.awaiting ?? 0} awaiting verification` },
    ],
    league: board.sites.map((s, i) => ({ rank: i + 1, name: s.name, group: s.group ?? "", score: s.score, band: s.band, delta: s.delta, top: s.top ? `${s.top.label}: ${s.top.detail}` : "—", everyDays: s.frequencyDays })),
    watchlist: board.sites.filter((s) => s.band === "attention" || s.band === "escalate" || (s.delta ?? 0) >= 5).map((s) => ({ name: s.name, band: s.band, score: s.score, why: why(s, settings.unitLabel) })),
    missed: overdueVisits.slice(0, 40).map((v) => ({ unit: v.unit, template: v.template, by: v.by, assignee: v.assignee ?? "unassigned" })),
    sampling: plans.filter((p) => p.evaluation).map((p) => ({ ref: p.ref, name: p.name, unit: p.unitName ?? "", n: p.evaluation!.n, deviations: p.evaluation!.deviations, upper: p.evaluation!.upper, tdr: p.tdr, conclusion: p.evaluation!.effective ? "Effective" : "Not effective" })),
    failed: stats.questions.map((q) => ({ label: q.label, template: q.template, fails: q.fails, asked: q.asked, rate: q.rate })),
    actions: { open: act?.open ?? 0, overdue: act?.overdue ?? 0, awaiting: act?.awaiting ?? 0, closed90: act?.closed90 ?? 0 },
  };
}

const bandLabel = (b: string) => BANDS.find((x) => x.key === b)?.label ?? "No data";

export async function committeeXlsx(p: CommitteePack): Promise<Buffer> {
  const wb = new ExcelJS.Workbook(); wb.creator = "Pulsus Quality";
  const add = (name: string, header: string[], rows: (string | number | null)[][], widths: number[]) => {
    const ws = wb.addWorksheet(name);
    ws.columns = header.map((h, i) => ({ header: h, key: String(i), width: widths[i] ?? 16 }));
    ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of rows) ws.addRow(r);
  };
  add("Summary", ["Measure", "Value", "Note"], [[`${p.company}: committee report`, new Date(p.generatedAt).toISOString().slice(0, 10), `prepared by ${p.by}`], ...p.kpis.map((k) => [k.label, k.value, k.note])], [42, 16, 70]);
  add("Risk league table", ["Rank", p.unitLabel, "Group", "Risk score", "Band", "Change (30 days)", "Biggest driver", "Visit every (days)"], p.league.map((l) => [l.rank, l.name, l.group, l.score, bandLabel(l.band), l.delta, l.top, l.everyDays]), [6, 22, 16, 10, 12, 14, 70, 14]);
  add("Watchlist", [p.unitLabel, "Band", "Risk score", "Why"], p.watchlist.map((w) => [w.name, bandLabel(w.band), w.score, w.why]), [20, 12, 10, 110]);
  add("Missed visits", [p.unitLabel, "Checklist", "Window ended", "Assigned to"], p.missed.map((m) => [m.unit, m.template, m.by, m.assignee]), [20, 40, 14, 30]);
  add("Sampling", ["Plan", "Name", p.unitLabel, "Sample", "Deviations", "Upper limit", "Tolerable", "Conclusion"], p.sampling.map((s) => [s.ref, s.name, s.unit, s.n, s.deviations, s.upper, s.tdr, s.conclusion]), [10, 40, 16, 8, 10, 12, 10, 14]);
  add("Most-failed questions", ["Question", "Checklist", "Failed", "Asked", "Rate"], p.failed.map((f) => [f.label, f.template, f.fails, f.asked, f.rate]), [70, 36, 8, 8, 8]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const RED = rgb(0.831, 0, 0.141), INK = rgb(0.11, 0.08, 0.086), DIM = rgb(0.42, 0.376, 0.36), LINE = rgb(0.88, 0.86, 0.85);
const BANDC: Record<string, [number, number, number]> = { worldClass: [0.086, 0.639, 0.29], strong: [0.133, 0.773, 0.369], healthy: [0.525, 0.937, 0.675], watch: [0.918, 0.702, 0.031], attention: [0.976, 0.451, 0.086], escalate: [0.863, 0.149, 0.149], none: [0.85, 0.83, 0.82] };
/** The standard PDF fonts only cover WinAnsi: replace what they can't draw. */
const safe = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/…/g, "...").replace(/→/g, "->").replace(/×/g, "x").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function committeePdf(p: CommitteePack): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${p.company}: quality committee report`); doc.setAuthor("Pulsus Quality"); doc.setCreator("Pulsus Quality");
  const f = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 44;
  let page: PDFPage = doc.addPage([W, H]); let y = H - M;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; footer(); };
  const pages: PDFPage[] = [];
  const footer = () => { pages.push(page); };
  footer();
  const wrap = (text: string, font: PDFFont, size: number, width: number) => {
    const words = safe(text).split(/\s+/); const lines: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(t, size) > width && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  };
  const need = (h: number) => { if (y - h < M + 20) newPage(); };
  const text = (s: string, x: number, size: number, font = f, color = INK) => page.drawText(safe(s), { x, y, size, font, color });
  const para = (s: string, size = 10, color = INK, font = f, width = W - 2 * M) => { for (const l of wrap(s, font, size, width)) { need(size + 4); text(l, M, size, font, color); y -= size + 4; } };
  const h2 = (s: string) => { need(40); y -= 12; text(s, M, 14, b); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: RED }); y -= 14; };
  const table = (cols: { h: string; w: number; align?: "r" }[], rows: (string | { band: string; label: string })[][], size = 8.5) => {
    const x0 = M;
    const head = () => { need(18); let x = x0; for (const c of cols) { text(c.h.toUpperCase(), c.align ? x + c.w - b.widthOfTextAtSize(safe(c.h.toUpperCase()), 7) - 4 : x, 7, b, DIM); x += c.w; } y -= 6; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE }); y -= 11; };
    head();
    for (const r of rows) {
      const cells = r.map((c, i) => (typeof c === "string" ? wrap(c, f, size, cols[i].w - 8) : [c.label]));
      const lines = Math.max(...cells.map((c) => c.length));
      const h = lines * (size + 3) + 4;
      if (y - h < M + 20) { newPage(); head(); }
      let x = x0;
      r.forEach((c, i) => {
        if (typeof c !== "string") { const [R, G, B] = BANDC[c.band] ?? BANDC.none; page.drawRectangle({ x, y: y - 2, width: 7, height: 7, color: rgb(R, G, B) }); page.drawText(safe(c.label), { x: x + 10, y, size, font: f, color: INK }); }
        else cells[i].forEach((l, li) => page.drawText(l, { x: cols[i].align ? x + cols[i].w - f.widthOfTextAtSize(l, size) - 4 : x, y: y - li * (size + 3), size, font: f, color: INK }));
        x += cols[i].w;
      });
      y -= h; page.drawLine({ start: { x: M, y: y + 4 }, end: { x: W - M, y: y + 4 }, thickness: 0.3, color: LINE }); y -= 4;
    }
  };
  // Cover band.
  page.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: RED });
  page.drawText("PULSUS QUALITY", { x: M, y: H - 46, size: 10, font: b, color: rgb(1, 1, 1) });
  page.drawText(safe(`${p.company}`), { x: M, y: H - 76, size: 22, font: b, color: rgb(1, 1, 1) });
  page.drawText("Quality committee report", { x: M, y: H - 100, size: 13, font: f, color: rgb(1, 1, 1) });
  y = H - 150;
  text(safe(`Prepared ${new Date(p.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} by ${p.by}. Figures as on the screens; risk scores 0 (low) to 100 (high).`), M, 9, f, DIM); y -= 26;
  // KPI tiles.
  const tw = (W - 2 * M - 20) / 3;
  p.kpis.forEach((k, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = M + col * (tw + 10), top = y - row * 74;
    page.drawRectangle({ x, y: top - 64, width: tw, height: 64, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1) });
    page.drawText(safe(k.value), { x: x + 10, y: top - 28, size: 18, font: b, color: INK });
    page.drawText(safe(k.label), { x: x + 10, y: top - 42, size: 8, font: b, color: DIM });
    const note = wrap(k.note, f, 7, tw - 20)[0] ?? ""; page.drawText(note, { x: x + 10, y: top - 54, size: 7, font: f, color: DIM });
  });
  y -= Math.ceil(p.kpis.length / 3) * 74 + 6;
  h2(`Risk league table: every ${p.unitLabel.toLowerCase()}, highest risk first`);
  table([{ h: "#", w: 22 }, { h: p.unitLabel, w: 82 }, { h: "Score", w: 44, align: "r" }, { h: "Band", w: 74 }, { h: "30 days", w: 46, align: "r" }, { h: "Biggest driver", w: 239 }],
    p.league.map((l) => [String(l.rank), l.name, l.score == null ? "-" : l.score.toFixed(1), { band: l.band, label: bandLabel(l.band) }, l.delta == null ? "-" : `${l.delta > 0 ? "+" : ""}${l.delta.toFixed(1)}`, l.top]));
  h2("Watchlist: why these need attention");
  if (p.watchlist.length) for (const w of p.watchlist) { need(30); const [R, G, B] = BANDC[w.band] ?? BANDC.none; page.drawRectangle({ x: M, y: y - 2, width: 8, height: 8, color: rgb(R, G, B) }); text(`${w.name} - ${bandLabel(w.band)} (${w.score ?? "-"})`, M + 14, 10.5, b); y -= 15; para(w.why, 9.5, INK); y -= 6; }
  else para(`No ${p.unitPlural.toLowerCase()} at Attention or Escalate, and none rising sharply.`, 10, DIM);
  h2("Missed visits");
  if (p.missed.length) table([{ h: p.unitLabel, w: 100 }, { h: "Checklist", w: 200 }, { h: "Window ended", w: 80 }, { h: "Assigned to", w: 127 }], p.missed.map((m) => [m.unit, m.template, m.by, m.assignee]));
  else para("None: every programmed visit was carried out in its window.", 10, DIM);
  h2("Sampling conclusions");
  if (p.sampling.length) table([{ h: "Plan", w: 52 }, { h: "Review", w: 140 }, { h: p.unitLabel, w: 70 }, { h: "Sample", w: 44, align: "r" }, { h: "Dev.", w: 34, align: "r" }, { h: "Upper limit", w: 84, align: "r" }, { h: "Conclusion", w: 83 }],
    p.sampling.map((s) => [s.ref, s.name, s.unit, String(s.n), String(s.deviations ?? "-"), `${pc(s.upper)} vs ${pc(s.tdr)}`, s.conclusion]));
  else para("No sampling plans evaluated yet.", 10, DIM);
  h2("Most-failed questions (last 3 months)");
  if (p.failed.length) table([{ h: "Question", w: 250 }, { h: "Checklist", w: 160 }, { h: "Failed", w: 50, align: "r" }, { h: "Rate", w: 47, align: "r" }], p.failed.map((q) => [q.label, q.template, `${q.fails} of ${q.asked}`, pc(q.rate)]));
  else para("Nothing failed.", 10, DIM);
  h2("Corrective actions");
  para(`${p.actions.open} open, of which ${p.actions.overdue} overdue and ${p.actions.awaiting} awaiting independent verification. ${p.actions.closed90} closed in the last 90 days, each verified by someone other than whoever raised it.`, 10);
  // Footers.
  doc.getPages().forEach((pg, i, all) => {
    pg.drawText(safe(`${p.company} - Pulsus Quality committee report`), { x: M, y: 24, size: 7.5, font: f, color: DIM });
    pg.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 50, y: 24, size: 7.5, font: f, color: DIM });
  });
  void pages;
  return Buffer.from(await doc.save());
}
