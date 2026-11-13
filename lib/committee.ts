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
import { compare, type GroupFigures } from "@/lib/structure";
import { listReports, CATEGORY_INFO, STATUS_INFO } from "@/lib/issues";

/** The sections a report can hold, in the order they print. */
export const SECTIONS = [
  { key: "kpis", label: "Headline figures" },
  { key: "league", label: "Risk league table" },
  { key: "watchlist", label: "Watchlist with reasons" },
  { key: "comparison", label: "Comparison by entity, region or group" },
  { key: "missed", label: "Missed visits" },
  { key: "sampling", label: "Sampling conclusions" },
  { key: "failed", label: "Most-failed questions" },
  { key: "actions", label: "Corrective actions and effectiveness" },
  { key: "issues", label: "Reported issues" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];
export const COMMITTEE_SECTIONS: SectionKey[] = ["kpis", "league", "watchlist", "missed", "sampling", "failed", "actions"];

export interface PackOptions { title?: string; scopeLabel?: string; sections?: SectionKey[]; level?: "entity" | "region" | "group"; days?: number }

export interface CommitteePack {
  title: string; scopeLabel: string; sections: SectionKey[];
  company: string; unitLabel: string; unitPlural: string; generatedAt: string; by: string;
  kpis: { label: string; value: string; note: string }[];
  league: { rank: number; name: string; group: string; score: number | null; band: BandKey | "none"; delta: number | null; top: string; everyDays: number | null }[];
  watchlist: { name: string; band: BandKey | "none"; score: number | null; why: string }[];
  missed: { unit: string; template: string; by: string; assignee: string }[];
  sampling: { ref: string; name: string; unit: string; n: number; deviations: number | null; upper: number | null; tdr: number | null; conclusion: string }[];
  failed: { label: string; template: string; fails: number; asked: number; rate: number }[];
  actions: { open: number; overdue: number; awaiting: number; closed90: number; containmentOpen: number; effective: number; ineffective: number; checksDue: number; reopened: number };
  comparison: { level: string; label: string; days: number; median: number | null; groups: GroupFigures[] } | null;
  issues: { total: number; open: number; byCategory: { label: string; n: number }[]; recent: { ref: string; unit: string; category: string; status: string; at: string; text: string }[] } | null;
}

const pc = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

export async function committeePack(a: Actor, now = new Date(), opts: PackOptions = {}): Promise<CommitteePack> {
  const settings = await getSettings(a.tenant);
  const sections = opts.sections?.length ? SECTIONS.map((x) => x.key).filter((k) => opts.sections!.includes(k)) : COMMITTEE_SECTIONS;
  const days = opts.days ?? 90;
  const scoped = a.unitIds.length > 0;
  // One after another: each opens its own tenant transaction.
  const board = await riskBoard(a, now);
  const vs = await visits(a, { now });
  const plans = await listPlans(a);
  const stats = await inspectionStats(a, 3);
  const units = a.unitIds.length ? a.unitIds : null;
  const act = await withTenant(a.tenant, async (tx) => rowsOf<CommitteePack["actions"]>(await tx.execute(sql`select
      count(*) filter (where status <> 'closed')::int as open, count(*) filter (where status <> 'closed' and due_date < current_date)::int as overdue,
      count(*) filter (where status = 'awaiting_verification')::int as awaiting, count(*) filter (where status = 'closed' and closed_at > now() - interval '90 days')::int as "closed90",
      count(*) filter (where status <> 'closed' and kind = 'containment')::int as "containmentOpen",
      count(*) filter (where effectiveness->>'status' = 'effective')::int as effective, count(*) filter (where effectiveness->>'status' = 'ineffective')::int as ineffective,
      count(*) filter (where effectiveness->>'status' = 'due')::int as "checksDue", count(*) filter (where reopen_count > 0)::int as reopened
      from actions where ${units ? sql`unit_id in (${sql.join(units.map((u) => sql`${u}`), sql`, `)})` : sql`true`}`))[0]);
  const cmp = sections.includes("comparison") ? await compare(a, { level: opts.level ?? "region", days, now }) : null;
  const reps = sections.includes("issues") ? (await listReports(a)).filter((r) => Date.parse(r.createdAt) >= now.getTime() - days * 864e5) : null;
  const overdueVisits = vs.filter((v) => v.status === "overdue");
  const notEff = plans.filter((p) => p.evaluation && !p.evaluation.effective).length;
  const high = board.sites.filter((s) => s.band === "attention" || s.band === "escalate");
  const levelLabel = (l: string) => (l === "entity" ? settings.entityLabel : l === "group" ? "Group" : settings.groupLabel);
  return {
    title: opts.title || "Quality committee report", scopeLabel: opts.scopeLabel || (scoped ? `${a.unitIds.length} ${settings.unitPlural.toLowerCase()}` : `All ${settings.unitPlural.toLowerCase()}`), sections,
    comparison: cmp ? { level: cmp.level, label: levelLabel(cmp.level), days: cmp.days, median: cmp.median, groups: cmp.groups } : null,
    issues: reps ? {
      total: reps.length, open: reps.filter((r) => r.status === "new").length,
      byCategory: Object.entries(CATEGORY_INFO).map(([k, v]) => ({ label: v.label, n: reps.filter((r) => r.category === k).length })).filter((x) => x.n),
      recent: reps.slice(0, 25).map((r) => ({ ref: r.ref, unit: r.unitName, category: CATEGORY_INFO[r.category]?.label ?? r.category, status: STATUS_INFO[r.status] ?? r.status, at: r.createdAt.slice(0, 10), text: r.description })),
    } : null,
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
    actions: { open: act?.open ?? 0, overdue: act?.overdue ?? 0, awaiting: act?.awaiting ?? 0, closed90: act?.closed90 ?? 0, containmentOpen: act?.containmentOpen ?? 0, effective: act?.effective ?? 0, ineffective: act?.ineffective ?? 0, checksDue: act?.checksDue ?? 0, reopened: act?.reopened ?? 0 },
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
  const on = (k: SectionKey) => p.sections.includes(k);
  add("Summary", ["Measure", "Value", "Note"], [[`${p.company}: ${p.title}`, new Date(p.generatedAt).toISOString().slice(0, 10), `prepared by ${p.by} · ${p.scopeLabel}`], ...(on("kpis") ? p.kpis.map((k) => [k.label, k.value, k.note]) : [])], [42, 16, 70]);
  if (on("league")) add("Risk league table", ["Rank", p.unitLabel, "Group", "Risk score", "Band", "Change (30 days)", "Biggest driver", "Visit every (days)"], p.league.map((l) => [l.rank, l.name, l.group, l.score, bandLabel(l.band), l.delta, l.top, l.everyDays]), [6, 22, 16, 10, 12, 14, 70, 14]);
  if (on("watchlist")) add("Watchlist", [p.unitLabel, "Band", "Risk score", "Why"], p.watchlist.map((w) => [w.name, bandLabel(w.band), w.score, w.why]), [20, 12, 10, 110]);
  if (on("comparison") && p.comparison) add(`By ${p.comparison.label.toLowerCase()}`, [p.comparison.label, p.unitPlural, "Inspections", "Average score", "Pass rate", "Critical failures", "Average risk", "Worst band", "Worst site", "Open actions", "Overdue actions", "Open reports", "Controls not effective"], p.comparison.groups.map((g) => [g.name, g.sites, g.inspections, g.avgScore, g.passRate, g.criticalFails, g.avgRisk, bandLabel(g.worstBand), g.worstSite, g.openActions, g.overdueActions, g.openIssues, g.controlsFailed]), [24, 8, 11, 12, 10, 12, 12, 12, 16, 11, 12, 11, 12]);
  if (on("missed")) add("Missed visits", [p.unitLabel, "Checklist", "Window ended", "Assigned to"], p.missed.map((m) => [m.unit, m.template, m.by, m.assignee]), [20, 40, 14, 30]);
  if (on("sampling")) add("Sampling", ["Plan", "Name", p.unitLabel, "Sample", "Deviations", "Upper limit", "Tolerable", "Conclusion"], p.sampling.map((s) => [s.ref, s.name, s.unit, s.n, s.deviations, s.upper, s.tdr, s.conclusion]), [10, 40, 16, 8, 10, 12, 10, 14]);
  if (on("failed")) add("Most-failed questions", ["Question", "Checklist", "Failed", "Asked", "Rate"], p.failed.map((f) => [f.label, f.template, f.fails, f.asked, f.rate]), [70, 36, 8, 8, 8]);
  if (on("actions")) add("Actions", ["Measure", "Count"], [["Open", p.actions.open], ["Overdue", p.actions.overdue], ["Awaiting verification", p.actions.awaiting], ["Closed in the last 90 days", p.actions.closed90], ["Containment actions open", p.actions.containmentOpen], ["Effectiveness checks passed", p.actions.effective], ["Effectiveness checks failed", p.actions.ineffective], ["Effectiveness checks due", p.actions.checksDue], ["Reopened because the finding recurred", p.actions.reopened]], [44, 10]);
  if (on("issues") && p.issues) add("Reported issues", ["Ref", p.unitLabel, "Kind", "Status", "Reported", "What was reported"], p.issues.recent.map((r) => [r.ref, r.unit, r.category, r.status, r.at, r.text]), [10, 18, 20, 18, 12, 90]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const RED = rgb(0.831, 0, 0.141), INK = rgb(0.11, 0.08, 0.086), DIM = rgb(0.42, 0.376, 0.36), LINE = rgb(0.88, 0.86, 0.85);
const BANDC: Record<string, [number, number, number]> = { worldClass: [0.086, 0.639, 0.29], strong: [0.133, 0.773, 0.369], healthy: [0.525, 0.937, 0.675], watch: [0.918, 0.702, 0.031], attention: [0.976, 0.451, 0.086], escalate: [0.863, 0.149, 0.149], none: [0.85, 0.83, 0.82] };
/** The standard PDF fonts only cover WinAnsi: replace what they can't draw. */
const safe = (s: string) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/…/g, "...").replace(/→/g, "->").replace(/×/g, "x").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function committeePdf(p: CommitteePack): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const on = (k: SectionKey) => p.sections.includes(k);
  doc.setTitle(`${p.company}: ${p.title}`); doc.setAuthor("Pulsus Quality"); doc.setCreator("Pulsus Quality");
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
  page.drawText(safe(`${p.title} · ${p.scopeLabel}`), { x: M, y: H - 100, size: 13, font: f, color: rgb(1, 1, 1) });
  y = H - 150;
  text(safe(`Prepared ${new Date(p.generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} by ${p.by}. Figures as on the screens; risk scores 0 (low) to 100 (high).`), M, 9, f, DIM); y -= 26;
  // KPI tiles.
  const tw = (W - 2 * M - 20) / 3;
  if (on("kpis")) p.kpis.forEach((k, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = M + col * (tw + 10), top = y - row * 74;
    page.drawRectangle({ x, y: top - 64, width: tw, height: 64, borderColor: LINE, borderWidth: 0.8, color: rgb(1, 1, 1) });
    page.drawText(safe(k.value), { x: x + 10, y: top - 28, size: 18, font: b, color: INK });
    page.drawText(safe(k.label), { x: x + 10, y: top - 42, size: 8, font: b, color: DIM });
    const note = wrap(k.note, f, 7, tw - 20)[0] ?? ""; page.drawText(note, { x: x + 10, y: top - 54, size: 7, font: f, color: DIM });
  });
  if (on("kpis")) y -= Math.ceil(p.kpis.length / 3) * 74 + 6;
  if (on("league")) h2(`Risk league table: every ${p.unitLabel.toLowerCase()}, highest risk first`);
  if (on("league")) table([{ h: "#", w: 22 }, { h: p.unitLabel, w: 82 }, { h: "Score", w: 44, align: "r" }, { h: "Band", w: 74 }, { h: "30 days", w: 46, align: "r" }, { h: "Biggest driver", w: 239 }],
    p.league.map((l) => [String(l.rank), l.name, l.score == null ? "-" : l.score.toFixed(1), { band: l.band, label: bandLabel(l.band) }, l.delta == null ? "-" : `${l.delta > 0 ? "+" : ""}${l.delta.toFixed(1)}`, l.top]));
  if (on("watchlist")) h2("Watchlist: why these need attention");
  if (!on("watchlist")) { /* skipped */ } else if (p.watchlist.length) for (const w of p.watchlist) { need(30); const [R, G, B] = BANDC[w.band] ?? BANDC.none; page.drawRectangle({ x: M, y: y - 2, width: 8, height: 8, color: rgb(R, G, B) }); text(`${w.name} - ${bandLabel(w.band)} (${w.score ?? "-"})`, M + 14, 10.5, b); y -= 15; para(w.why, 9.5, INK); y -= 6; }
  else para(`No ${p.unitPlural.toLowerCase()} at Attention or Escalate, and none rising sharply.`, 10, DIM);
  if (on("comparison") && p.comparison) {
    h2(`By ${p.comparison.label.toLowerCase()}: last ${p.comparison.days} days`);
    if (p.comparison.groups.length) table([{ h: p.comparison.label, w: 110 }, { h: "Sites", w: 34, align: "r" }, { h: "Insp.", w: 36, align: "r" }, { h: "Avg score", w: 52, align: "r" }, { h: "Crit.", w: 32, align: "r" }, { h: "Avg risk", w: 48, align: "r" }, { h: "Worst", w: 100 }, { h: "Overdue", w: 46, align: "r" }, { h: "Reports", w: 49, align: "r" }],
      p.comparison.groups.map((g) => [g.name, String(g.sites), String(g.inspections), g.avgScore == null ? "-" : `${g.avgScore.toFixed(1)}%`, String(g.criticalFails), g.avgRisk == null ? "-" : g.avgRisk.toFixed(1), { band: g.worstBand, label: g.worstSite ? `${g.worstSite}` : bandLabel(g.worstBand) }, String(g.overdueActions), String(g.openIssues)]));
    else para(`No ${p.comparison.label.toLowerCase()}s are set up yet.`, 10, DIM);
    if (p.comparison.median != null) para(`Median inspection score across ${p.unitPlural.toLowerCase()}: ${p.comparison.median.toFixed(1)}%.`, 9, DIM);
  }
  if (on("missed")) h2("Missed visits");
  if (!on("missed")) { /* skipped */ } else if (p.missed.length) table([{ h: p.unitLabel, w: 100 }, { h: "Checklist", w: 200 }, { h: "Window ended", w: 80 }, { h: "Assigned to", w: 127 }], p.missed.map((m) => [m.unit, m.template, m.by, m.assignee]));
  else para("None: every programmed visit was carried out in its window.", 10, DIM);
  if (on("sampling")) h2("Sampling conclusions");
  if (!on("sampling")) { /* skipped */ } else if (p.sampling.length) table([{ h: "Plan", w: 52 }, { h: "Review", w: 140 }, { h: p.unitLabel, w: 70 }, { h: "Sample", w: 44, align: "r" }, { h: "Dev.", w: 34, align: "r" }, { h: "Upper limit", w: 84, align: "r" }, { h: "Conclusion", w: 83 }],
    p.sampling.map((s) => [s.ref, s.name, s.unit, String(s.n), String(s.deviations ?? "-"), `${pc(s.upper)} vs ${pc(s.tdr)}`, s.conclusion]));
  else para("No sampling plans evaluated yet.", 10, DIM);
  if (on("failed")) h2("Most-failed questions (last 3 months)");
  if (!on("failed")) { /* skipped */ } else if (p.failed.length) table([{ h: "Question", w: 250 }, { h: "Checklist", w: 160 }, { h: "Failed", w: 50, align: "r" }, { h: "Rate", w: 47, align: "r" }], p.failed.map((q) => [q.label, q.template, `${q.fails} of ${q.asked}`, pc(q.rate)]));
  else para("Nothing failed.", 10, DIM);
  if (on("actions")) {
    h2("Corrective actions");
    para(`${p.actions.open} open, of which ${p.actions.overdue} overdue and ${p.actions.awaiting} awaiting independent verification; ${p.actions.containmentOpen} of the open ones are containment. ${p.actions.closed90} closed in the last 90 days, each verified by someone other than whoever raised it.`, 10);
    y -= 4;
    para(`Effectiveness: ${p.actions.effective} check${p.actions.effective === 1 ? "" : "s"} passed, ${p.actions.ineffective} failed (the action was reopened), ${p.actions.checksDue} due for a re-check. ${p.actions.reopened} action${p.actions.reopened === 1 ? "" : "s"} reopened because the finding came back.`, 10);
  }
  if (on("issues") && p.issues) {
    h2("Reported issues");
    para(`${p.issues.total} reported from site links${p.issues.byCategory.length ? ` (${p.issues.byCategory.map((c) => `${c.n} ${c.label.toLowerCase()}`).join(", ")})` : ""}; ${p.issues.open} waiting for triage.`, 10);
    if (p.issues.recent.length) { y -= 4; table([{ h: "Ref", w: 52 }, { h: p.unitLabel, w: 72 }, { h: "Kind", w: 92 }, { h: "Status", w: 82 }, { h: "What was reported", w: 209 }], p.issues.recent.slice(0, 15).map((r) => [r.ref, r.unit, r.category, r.status, r.text.slice(0, 160)])); }
  }
  // Footers.
  doc.getPages().forEach((pg, i, all) => {
    pg.drawText(safe(`${p.company} - Pulsus Quality ${p.title.toLowerCase()}`), { x: M, y: 24, size: 7.5, font: f, color: DIM });
    pg.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 50, y: 24, size: 7.5, font: f, color: DIM });
  });
  void pages;
  return Buffer.from(await doc.save());
}
