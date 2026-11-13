// The report builder: saved reports (sections, scope, period, PDF and/or
// Excel), run on demand or on a schedule, and emailed through Resend when
// RESEND_API_KEY is set. Without it (or in a demo) each run is kept here to
// download instead, and the page says so. Scheduled runs act as the person who
// saved the report, with their roles and sites, so a report never shows more
// than its owner could see.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, lte, notInArray } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { companies, entities, members, reportRuns, savedReports, siteGroups, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { loadSettings } from "@/lib/company";
import { can, inScope, isRole, type Actor, type Role } from "@/lib/roles";
import { committeePack, committeePdf, committeeXlsx, SECTIONS, type SectionKey } from "@/lib/committee";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];

export interface Schedule { every: "none" | "weekly" | "monthly"; day: number; hour: number }
export interface ReportFilters { scope: string; days: number; level: "entity" | "region" | "group" }
export interface SavedReportView { id: string; name: string; sections: SectionKey[]; filters: ReportFilters; format: "pdf" | "xlsx" | "both"; schedule: Schedule; recipients: string[]; nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; createdBy: string; runs: { id: string; at: string; status: string; note: string; recipients: string[]; pdf: boolean; xlsx: boolean }[] }

export const emailConfigured = () => !!(process.env.RESEND_API_KEY || "").trim() && (process.env.DEMO_MODE || "").trim() !== "1";

/** The next run at or after `from`: weekly on a weekday (1 = Monday … 7 = Sunday) or monthly on a day (1–28), at an hour (UTC). */
export function nextRun(s: Schedule, from: Date): Date | null {
  if (s.every === "none") return null;
  const hour = Math.max(0, Math.min(23, Math.round(s.hour)));
  for (let i = 0; i <= 62; i++) {
    const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i, hour));
    if (d <= from) continue;
    const dow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (s.every === "weekly" && dow === s.day) return d;
    if (s.every === "monthly" && d.getUTCDate() === s.day) return d;
  }
  return null;
}

export function cleanSchedule(raw: unknown): Schedule {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const every = o.every === "weekly" || o.every === "monthly" ? o.every : "none";
  const day = Math.round(Number(o.day));
  const hour = Math.round(Number(o.hour));
  return { every, day: every === "weekly" ? (day >= 1 && day <= 7 ? day : 1) : day >= 1 && day <= 28 ? day : 1, hour: hour >= 0 && hour <= 23 ? hour : 7 };
}

const cleanFilters = (raw: unknown): ReportFilters => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const scope = typeof o.scope === "string" && /^(all|entity:[\w-]{1,80}|region:.{1,80}|group:[\w-]{1,80})$/.test(o.scope) ? o.scope : "all";
  return { scope, days: [30, 90, 180, 365].includes(Number(o.days)) ? Number(o.days) : 90, level: o.level === "entity" || o.level === "group" ? o.level : "region" };
};

async function view(companyId: string, rows: (typeof savedReports.$inferSelect)[]): Promise<SavedReportView[]> {
  if (!rows.length) return [];
  const runs = await withTenant(companyId, async (tx) => tx.select({ id: reportRuns.id, reportId: reportRuns.reportId, at: reportRuns.at, status: reportRuns.status, note: reportRuns.note, recipients: reportRuns.recipients, pdf: reportRuns.pdf, xlsx: reportRuns.xlsx }).from(reportRuns).where(eq(reportRuns.companyId, companyId)).orderBy(desc(reportRuns.at)).limit(200));
  return rows.map((r) => ({
    id: r.id, name: r.name, sections: (r.sections as SectionKey[]).filter((k) => SECTION_KEYS.includes(k)), filters: cleanFilters(r.filters), format: (r.format as SavedReportView["format"]) || "pdf", schedule: cleanSchedule(r.schedule), recipients: r.recipients as string[],
    nextRunAt: r.nextRunAt?.toISOString() ?? null, lastRunAt: r.lastRunAt?.toISOString() ?? null, lastStatus: r.lastStatus, createdBy: r.createdBy,
    runs: runs.filter((x) => x.reportId === r.id).slice(0, 6).map((x) => ({ id: x.id, at: x.at.toISOString(), status: x.status, note: x.note, recipients: x.recipients as string[], pdf: !!x.pdf, xlsx: !!x.xlsx })),
  }));
}

export async function listSavedReports(a: Actor): Promise<SavedReportView[]> {
  const rows = await withTenant(a.tenant, async (tx) => tx.select().from(savedReports).where(eq(savedReports.companyId, a.tenant)).orderBy(asc(savedReports.name)));
  return view(a.tenant, rows.filter((r) => can.buildTemplates(a) || r.createdBy === a.email));
}

export interface ReportInput { name?: unknown; sections?: unknown; filters?: unknown; format?: unknown; schedule?: unknown; recipients?: unknown; remove?: unknown }

/** Save a report (supervisors and admins). */
export async function saveReport(a: Actor, id: string | null, input: ReportInput, requestId?: string): Promise<Result<SavedReportView>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins save reports.", status: 403 };
  const name = clean(input.name, 100);
  const sections = Array.isArray(input.sections) ? SECTION_KEYS.filter((k) => (input.sections as unknown[]).includes(k)) : [];
  const recipients = Array.from(new Set((Array.isArray(input.recipients) ? input.recipients : String(input.recipients || "").split(/[,;\s]+/)).map((x) => String(x).trim().toLowerCase()).filter(Boolean)));
  const bad = recipients.find((r) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
  const schedule = cleanSchedule(input.schedule);
  const filters = cleanFilters(input.filters);
  const format = input.format === "xlsx" || input.format === "both" ? input.format : "pdf";
  const out = await withTenant(a.tenant, async (tx) => {
    const ex = id ? (await tx.select().from(savedReports).where(and(eq(savedReports.companyId, a.tenant), eq(savedReports.id, id))).limit(1))[0] : null;
    if (id && !ex) return { ok: false as const, error: "Report not found.", status: 404 };
    if (ex && input.remove === true) {
      await tx.delete(reportRuns).where(and(eq(reportRuns.companyId, a.tenant), eq(reportRuns.reportId, ex.id)));
      await tx.delete(savedReports).where(eq(savedReports.id, ex.id));
      await record(tx, a.tenant, { actor: a.email, action: "report.delete", entityType: "report", entityId: ex.id, summary: `Saved report removed: ${ex.name}`, requestId });
      return { ok: true as const, value: null };
    }
    if (!name) return { ok: false as const, error: "Name the report.", status: 400 };
    if (!sections.length) return { ok: false as const, error: "Choose at least one section.", status: 400 };
    if (bad) return { ok: false as const, error: `${bad} doesn't look like an email address.`, status: 400 };
    if (recipients.length > 25) return { ok: false as const, error: "Up to 25 recipients.", status: 400 };
    if (schedule.every !== "none" && !recipients.length) return { ok: false as const, error: "Add who it goes to, or turn the schedule off.", status: 400 };
    const rid = ex?.id ?? randomUUID();
    const v = { name, sections, filters, format, schedule, recipients, nextRunAt: nextRun(schedule, new Date()), updatedAt: new Date() };
    if (ex) await tx.update(savedReports).set(v).where(eq(savedReports.id, rid));
    else await tx.insert(savedReports).values({ id: rid, companyId: a.tenant, createdBy: a.email, ...v });
    await record(tx, a.tenant, { actor: a.email, action: ex ? "report.update" : "report.create", entityType: "report", entityId: rid, summary: `Saved report ${ex ? "changed" : "created"}: ${name} (${schedule.every === "none" ? "on demand" : `${schedule.every}, to ${recipients.length}`})`, after: { sections, filters, format, schedule, recipients: recipients.length }, requestId });
    return { ok: true as const, value: (await tx.select().from(savedReports).where(eq(savedReports.id, rid)).limit(1))[0] };
  });
  if (!out.ok) return out;
  if (!out.value) return { ok: true, value: null as unknown as SavedReportView };
  return { ok: true, value: (await view(a.tenant, [out.value]))[0] };
}

/** The actor a report runs as: its owner's current roles and sites, narrowed to the report's scope. */
async function reportActor(companyId: string, tenantName: string, r: typeof savedReports.$inferSelect, as?: Actor): Promise<{ actor: Actor; scopeLabel: string } | null> {
  return withTenant(companyId, async (tx) => {
    let base: Actor;
    if (as) base = as;
    else {
      const m = (await tx.select().from(members).where(and(eq(members.companyId, companyId), eq(members.email, r.createdBy))).limit(1))[0];
      if (!m || m.status !== "active") return null;
      base = { tenant: companyId, tenantName, kind: companyId === "_own" ? "institution" : companyId === "_demo" ? "demo" : "company", email: m.email, name: m.name, roles: (m.roles as string[]).filter(isRole) as Role[], unitIds: m.unitIds as string[], platformRole: "report", operator: false, plan: null };
    }
    const f = cleanFilters(r.filters);
    const s = await loadSettings(tx, companyId);
    const us = (await tx.select().from(units).where(and(eq(units.companyId, companyId), eq(units.active, true)))).filter((u) => inScope(base, u.id));
    let pick = us, label = `All ${s.unitPlural.toLowerCase()}`;
    if (f.scope.startsWith("entity:")) { const id = f.scope.slice(7); pick = us.filter((u) => u.entityId === id); label = `${s.entityLabel}: ${(await tx.select().from(entities).where(and(eq(entities.companyId, companyId), eq(entities.id, id))).limit(1))[0]?.name ?? "removed"}`; }
    else if (f.scope.startsWith("region:")) { const n = f.scope.slice(7); pick = us.filter((u) => u.region === n); label = `${s.groupLabel}: ${n}`; }
    else if (f.scope.startsWith("group:")) { const g = (await tx.select().from(siteGroups).where(and(eq(siteGroups.companyId, companyId), eq(siteGroups.id, f.scope.slice(6)))).limit(1))[0]; pick = us.filter((u) => (g?.unitIds as string[] | undefined)?.includes(u.id)); label = `Group: ${g?.name ?? "removed"}`; }
    const unitIds = f.scope === "all" ? base.unitIds : pick.map((u) => u.id);
    return { actor: { ...base, tenantName: base.tenantName || tenantName, unitIds: f.scope !== "all" && !unitIds.length ? ["__none__"] : unitIds }, scopeLabel: label };
  });
}

export async function renderReport(a: Actor, r: typeof savedReports.$inferSelect, now = new Date(), as?: Actor): Promise<{ pdf: Buffer | null; xlsx: Buffer | null; scopeLabel: string } | null> {
  const ra = await reportActor(a.tenant, a.tenantName, r, as);
  if (!ra) return null;
  const f = cleanFilters(r.filters);
  const pack = await committeePack(ra.actor, now, { title: r.name, scopeLabel: `${ra.scopeLabel} · last ${f.days} days`, sections: r.sections as SectionKey[], level: f.level, days: f.days });
  return { pdf: r.format !== "xlsx" ? await committeePdf(pack) : null, xlsx: r.format !== "pdf" ? await committeeXlsx(pack) : null, scopeLabel: ra.scopeLabel };
}

let fetcher: typeof fetch = (...x) => fetch(...x);
export function __setFetch(f: typeof fetch) { fetcher = f; }

/** Email the files through Resend. */
async function email(to: string[], subject: string, html: string, files: { filename: string; content: Buffer }[]): Promise<{ ok: boolean; note: string }> {
  try {
    const r = await fetcher("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${(process.env.RESEND_API_KEY || "").trim()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: (process.env.RESEND_FROM || "Pulsus Quality <reports@pulsus.tech>").trim(), to, subject, html, attachments: files.map((f) => ({ filename: f.filename, content: f.content.toString("base64") })) }),
      signal: AbortSignal.timeout(15000),
    });
    if (r.ok) return { ok: true, note: `Emailed to ${to.length} recipient${to.length === 1 ? "" : "s"}.` };
    const j = (await r.json().catch(() => ({}))) as { message?: string };
    return { ok: false, note: `The email service refused it (${r.status}${j.message ? `: ${String(j.message).slice(0, 120)}` : ""}). The files are kept here.` };
  } catch (e) {
    return { ok: false, note: `The email service couldn't be reached (${e instanceof Error ? e.message : "error"}). The files are kept here.` };
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Run a saved report now: render, email when configured, keep the files. */
export async function runReport(a: Actor, id: string, opts: { now?: Date; send?: boolean; scheduled?: boolean } = {}, requestId?: string): Promise<Result<{ runId: string; status: string; note: string }>> {
  const now = opts.now ?? new Date();
  const r = await withTenant(a.tenant, async (tx) => (await tx.select().from(savedReports).where(and(eq(savedReports.companyId, a.tenant), eq(savedReports.id, id))).limit(1))[0]);
  if (!r) return { ok: false, error: "Report not found.", status: 404 };
  if (!opts.scheduled && !can.buildTemplates(a) && r.createdBy !== a.email) return { ok: false, error: "You can't run this report.", status: 403 };
  const out = await renderReport(a, r, now, opts.scheduled ? undefined : a);
  const runId = randomUUID();
  let status = "stored", note = "";
  if (!out) { status = "failed"; note = "The report's owner no longer has access, so it wasn't run."; }
  else if ((opts.send ?? true) && r.recipients.length) {
    if (!emailConfigured()) note = (process.env.DEMO_MODE || "").trim() === "1" ? "Demo: email isn't sent. The files are kept here to download." : "Email isn't set up on this deployment (RESEND_API_KEY). The files are kept here to download.";
    else {
      const day = now.toISOString().slice(0, 10);
      const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
      const files = [...(out.pdf ? [{ filename: `${slug}-${day}.pdf`, content: out.pdf }] : []), ...(out.xlsx ? [{ filename: `${slug}-${day}.xlsx`, content: out.xlsx }] : [])];
      const sent = await email(r.recipients as string[], `${r.name}: ${a.tenantName || "Pulsus Quality"}, ${day}`, `<p>${esc(r.name)} for ${esc(out.scopeLabel)}, prepared by Pulsus Quality on ${day}.</p><p>The ${files.length > 1 ? "files are" : "file is"} attached. Figures are as shown on the screens at the time it ran.</p>`, files);
      status = sent.ok ? "emailed" : "failed"; note = sent.note;
    }
  } else note = "Run on demand.";
  await withTenant(a.tenant, async (tx) => {
    await tx.insert(reportRuns).values({ id: runId, companyId: a.tenant, reportId: r.id, at: now, status, recipients: status === "emailed" ? r.recipients : [], note, by: opts.scheduled ? "schedule" : a.email, pdf: out?.pdf?.toString("base64") ?? null, xlsx: out?.xlsx?.toString("base64") ?? null });
    const keep = (await tx.select({ id: reportRuns.id }).from(reportRuns).where(and(eq(reportRuns.companyId, a.tenant), eq(reportRuns.reportId, r.id))).orderBy(desc(reportRuns.at)).limit(12)).map((x) => x.id);
    await tx.delete(reportRuns).where(and(eq(reportRuns.companyId, a.tenant), eq(reportRuns.reportId, r.id), notInArray(reportRuns.id, keep)));
    await tx.update(savedReports).set({ lastRunAt: now, lastStatus: status, ...(opts.scheduled ? { nextRunAt: nextRun(cleanSchedule(r.schedule), now) } : {}) }).where(eq(savedReports.id, r.id));
    await record(tx, a.tenant, { actor: opts.scheduled ? "schedule" : a.email, action: "report.run", entityType: "report", entityId: r.id, summary: `${r.name}: ${status}${note ? ` (${note})` : ""}`, requestId });
  });
  return { ok: true, value: { runId, status, note } };
}

/** A kept run's file, for download. */
export async function runFile(a: Actor, runId: string, kind: "pdf" | "xlsx"): Promise<{ name: string; bytes: Buffer } | null> {
  return withTenant(a.tenant, async (tx) => {
    const run = (await tx.select().from(reportRuns).where(and(eq(reportRuns.companyId, a.tenant), eq(reportRuns.id, runId))).limit(1))[0];
    if (!run) return null;
    const r = (await tx.select().from(savedReports).where(and(eq(savedReports.companyId, a.tenant), eq(savedReports.id, run.reportId))).limit(1))[0];
    if (!r || (!can.buildTemplates(a) && r.createdBy !== a.email)) return null;
    const b64 = kind === "pdf" ? run.pdf : run.xlsx;
    if (!b64) return null;
    const slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "report";
    return { name: `${slug}-${run.at.toISOString().slice(0, 10)}.${kind}`, bytes: Buffer.from(b64, "base64") };
  });
}

/** Run every saved report whose time has come (the sweep calls this). */
export async function runDueReports(companyId: string, now = new Date()): Promise<number> {
  const due = await withTenant(companyId, async (tx) => tx.select().from(savedReports).where(and(eq(savedReports.companyId, companyId), lte(savedReports.nextRunAt, now))));
  if (!due.length) return 0;
  const cname = companyId === "_demo" ? "Meridian Society" : await withTenant(companyId, async (tx) => (await tx.select({ n: companies.name }).from(companies).where(eq(companies.companyId, companyId)).limit(1))[0]?.n ?? "");
  let n = 0;
  for (const r of due) {
    const sys: Actor = { tenant: companyId, tenantName: cname, kind: "company", email: "schedule", name: "Schedule", roles: [], unitIds: [], platformRole: "system", operator: false, plan: null };
    const res = await runReport(sys, r.id, { now, scheduled: true });
    if (res.ok) n++;
  }
  return n;
}
