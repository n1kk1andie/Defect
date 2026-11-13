// Programmes and the visit calendar. A programme says which checklist is
// inspected, at which sites, how often (a fixed number of days, or
// risk-based: the site's current risk band sets it), within what window, and
// by whom (inspectors take sites in turn). Visits are worked out from the
// programme and the inspections actually carried out — nothing to keep in
// step: a visit is done when an inspection of that checklist at that site was
// started in its window; overdue when its window has passed without one.
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { inspections, programmes, templates, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { loadSettings } from "@/lib/company";
import { can, inScope, type Actor } from "@/lib/roles";
import { scoreSite } from "@/lib/risk";
import { siteInputs } from "@/lib/riskScore";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const DAY = 864e5;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => isoDay(new Date(Date.parse(iso + "T12:00:00Z") + n * DAY));

export type VisitStatus = "done" | "in_progress" | "overdue" | "due" | "upcoming";
export interface Visit { key: string; programmeId: string; programme: string; templateId: string; template: string; unitId: string; unit: string; from: string; by: string; assignee: string | null; status: VisitStatus; inspectionId: string | null; everyDays: number }
export interface ProgrammeView { id: string; name: string; templateId: string; template: string; unitIds: string[]; everyDays: number; windowDays: number; assignees: string[]; startDate: string; active: boolean; sites: number }

/** The visit windows of one programme at one site, from its start to the horizon. Pure. */
export function windows(start: string, everyDays: number, windowDays: number, until: string): { from: string; by: string }[] {
  const out: { from: string; by: string }[] = [];
  const step = Math.max(1, everyDays);
  for (let d = start, i = 0; d <= until && i < 2000; d = addDays(d, step), i++) out.push({ from: d, by: addDays(d, Math.max(0, Math.min(windowDays, step) - 1)) });
  return out;
}

/** A window's status, given the inspections started at that site on that checklist. Pure. */
export function statusOf(w: { from: string; by: string }, today: string, started: { id: string; day: string; status: string }[]): { status: VisitStatus; inspectionId: string | null } {
  const hit = started.filter((s) => s.day >= w.from && s.day <= w.by).sort((a, b) => (a.status === "draft" ? 1 : 0) - (b.status === "draft" ? 1 : 0))[0];
  if (hit) return { status: hit.status === "draft" || hit.status === "returned" ? "in_progress" : "done", inspectionId: hit.id };
  if (w.by < today) return { status: "overdue", inspectionId: null };
  if (w.from <= today) return { status: "due", inspectionId: null };
  return { status: "upcoming", inspectionId: null };
}

export async function listProgrammes(a: Actor): Promise<ProgrammeView[]> {
  return withTenant(a.tenant, async (tx) => {
    const [ps, ts, us] = await Promise.all([
      tx.select().from(programmes).where(eq(programmes.companyId, a.tenant)).orderBy(asc(programmes.name)),
      tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.companyId, a.tenant)),
      tx.select({ id: units.id }).from(units).where(and(eq(units.companyId, a.tenant), eq(units.active, true))),
    ]);
    const tn = new Map(ts.map((t) => [t.id, t.name]));
    return ps.map((p) => ({ id: p.id, name: p.name, templateId: p.templateId, template: tn.get(p.templateId) ?? "—", unitIds: p.unitIds, everyDays: p.everyDays, windowDays: p.windowDays, assignees: p.assignees, startDate: String(p.startDate).slice(0, 10), active: p.active, sites: p.unitIds.length || us.length }));
  });
}

/** Every visit from `fromDay` to `untilDay` across the active programmes, in the person's scope. */
export async function visits(a: Actor, opts: { fromDay?: string; untilDay?: string; now?: Date } = {}): Promise<Visit[]> {
  const now = opts.now ?? new Date();
  const today = isoDay(now);
  const fromDay = opts.fromDay ?? addDays(today, -120);
  const untilDay = opts.untilDay ?? addDays(today, 60);
  return withTenant(a.tenant, async (tx) => {
    const s = await loadSettings(tx, a.tenant);
    const [ps, us, ts] = await Promise.all([
      tx.select().from(programmes).where(and(eq(programmes.companyId, a.tenant), eq(programmes.active, true))),
      tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.active, true))).orderBy(asc(units.sort), asc(units.name)),
      tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.companyId, a.tenant)),
    ]);
    if (!ps.length) return [];
    const tn = new Map(ts.map((t) => [t.id, t.name]));
    const started = await tx.select({ id: inspections.id, unitId: inspections.unitId, templateId: inspections.templateId, createdAt: inspections.createdAt, status: inspections.status })
      .from(inspections).where(and(eq(inspections.companyId, a.tenant), inArray(inspections.templateId, ps.map((p) => p.templateId))));
    const risk = ps.some((p) => p.everyDays === 0) ? new Map((await siteInputs(tx, a.tenant, now)).inputs.map((i) => [i.unitId, scoreSite(i, s.risk)])) : new Map();
    const out: Visit[] = [];
    for (const p of ps) {
      const sites = us.filter((u) => !p.unitIds.length || p.unitIds.includes(u.id));
      sites.forEach((u, ui) => {
        if (!inScope(a, u.id)) return;
        const band = risk.get(u.id)?.band;
        const every = p.everyDays || (band && band !== "none" ? s.risk.frequency[band as keyof typeof s.risk.frequency] : 90);
        const mine = started.filter((x) => x.unitId === u.id && x.templateId === p.templateId).map((x) => ({ id: x.id, day: isoDay(x.createdAt), status: x.status }));
        const assignee = p.assignees.length ? p.assignees[ui % p.assignees.length] : null;
        for (const w of windows(String(p.startDate).slice(0, 10), every, p.windowDays, untilDay)) {
          if (w.by < fromDay) continue;
          const st = statusOf(w, today, mine);
          out.push({ key: `${p.id}|${u.id}|${w.from}`, programmeId: p.id, programme: p.name, templateId: p.templateId, template: tn.get(p.templateId) ?? "—", unitId: u.id, unit: u.name, from: w.from, by: w.by, assignee, status: st.status, inspectionId: st.inspectionId, everyDays: every });
        }
      });
    }
    return out.sort((x, y) => x.by.localeCompare(y.by) || x.unit.localeCompare(y.unit));
  });
}

export interface ProgrammeInput { name?: unknown; templateId?: unknown; unitIds?: unknown; everyDays?: unknown; windowDays?: unknown; assignees?: unknown; startDate?: unknown; active?: unknown }

export async function saveProgramme(a: Actor, id: string | null, input: ProgrammeInput, requestId?: string): Promise<Result<ProgrammeView>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins plan programmes.", status: 403 };
  const name = String(input.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name the programme.", status: 400 };
  const every = Math.round(Number(input.everyDays));
  if (!(every === 0 || (every >= 1 && every <= 730))) return { ok: false, error: "Choose how often (or risk-based).", status: 400 };
  const windowDays = Math.max(1, Math.min(120, Math.round(Number(input.windowDays) || 14)));
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(input.startDate || "")) ? String(input.startDate) : isoDay(new Date());
  const assignees = Array.from(new Set((Array.isArray(input.assignees) ? input.assignees : []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))).slice(0, 50);
  const r = await withTenant(a.tenant, async (tx): Promise<Result<string>> => {
    const t = (await tx.select().from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, String(input.templateId || "")))).limit(1))[0];
    if (!t || !t.version) return { ok: false as const, error: "Choose a published template.", status: 400 };
    const valid = new Set((await tx.select({ id: units.id }).from(units).where(eq(units.companyId, a.tenant))).map((u) => u.id));
    const unitIds = (Array.isArray(input.unitIds) ? input.unitIds : []).map(String).filter((u) => valid.has(u)).slice(0, 1000);
    const values = { name, templateId: t.id, unitIds, everyDays: every, windowDays, assignees, startDate, active: input.active !== false, updatedAt: new Date() };
    let pid = id;
    if (pid) {
      const before = (await tx.select().from(programmes).where(and(eq(programmes.companyId, a.tenant), eq(programmes.id, pid))).limit(1))[0];
      if (!before) return { ok: false as const, error: "Programme not found.", status: 404 };
      await tx.update(programmes).set(values).where(eq(programmes.id, pid));
      await record(tx, a.tenant, { actor: a.email, action: "programme.update", entityType: "programme", entityId: pid, summary: `${name} changed`, before: { everyDays: before.everyDays, units: before.unitIds.length, assignees: before.assignees, active: before.active }, after: { everyDays: every, units: unitIds.length, assignees, active: values.active }, requestId });
    } else {
      pid = randomUUID();
      await tx.insert(programmes).values({ id: pid, companyId: a.tenant, createdBy: a.email, ...values });
      await record(tx, a.tenant, { actor: a.email, action: "programme.create", entityType: "programme", entityId: pid, summary: `${name}: ${t.name}, ${every ? `every ${every} days` : "risk-based"}`, after: values, requestId });
    }
    return { ok: true as const, value: pid };
  });
  if (!r.ok) return r;
  return { ok: true, value: (await listProgrammes(a)).find((p) => p.id === r.value)! };
}
