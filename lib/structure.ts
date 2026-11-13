// How sites roll up: entities (a hospital in a health system, an agency in a
// ministry, a campus in a university system), regions (the site's region
// field) and named site groups. Plus the comparison: every site's figures
// beside its entity, region or group, and benchmarks against the median.
// One tenant is one organisation or group; entities live inside it, so
// nothing is shared across tenants.
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, ne } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { actions, entities, inspections, issueReports, samplingPlans, siteGroups, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, inScope, type Actor } from "@/lib/roles";
import { riskBoard } from "@/lib/riskScore";
import type { StoredScore } from "@/lib/inspections";
import type { Evaluation } from "@/lib/sampling";
import type { BandKey } from "@/lib/bands";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export interface Structure {
  entities: { id: string; name: string; code: string | null; unitIds: string[] }[];
  groups: { id: string; name: string; unitIds: string[]; createdBy: string }[];
  regions: { name: string; unitIds: string[] }[];
}

export async function getStructure(a: Actor): Promise<Structure> {
  return withTenant(a.tenant, async (tx) => {
    const us = await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.active, true)));
    const es = await tx.select().from(entities).where(eq(entities.companyId, a.tenant)).orderBy(asc(entities.sort), asc(entities.name));
    const gs = await tx.select().from(siteGroups).where(eq(siteGroups.companyId, a.tenant)).orderBy(asc(siteGroups.name));
    const regions = new Map<string, string[]>();
    for (const u of us) if (u.region) (regions.get(u.region) || regions.set(u.region, []).get(u.region)!).push(u.id);
    return {
      entities: es.map((e) => ({ id: e.id, name: e.name, code: e.code, unitIds: us.filter((u) => u.entityId === e.id).map((u) => u.id) })),
      groups: gs.map((g) => ({ id: g.id, name: g.name, unitIds: (g.unitIds as string[]).filter((id) => us.some((u) => u.id === id)), createdBy: g.createdBy })),
      regions: Array.from(regions, ([name, unitIds]) => ({ name, unitIds })).sort((x, y) => x.name.localeCompare(y.name)),
    };
  });
}

/** Create or change an entity and the sites in it (admins). A site belongs to at most one entity. */
export async function saveEntity(a: Actor, id: string | null, input: { name?: unknown; code?: unknown; unitIds?: unknown; remove?: unknown }, requestId?: string): Promise<Result<Structure>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin changes the structure.", status: 403 };
  const r = await withTenant(a.tenant, async (tx) => {
    const ex = id ? (await tx.select().from(entities).where(and(eq(entities.companyId, a.tenant), eq(entities.id, id))).limit(1))[0] : null;
    if (id && !ex) return { ok: false as const, error: "Not found.", status: 404 };
    if (ex && input.remove === true) {
      await tx.update(units).set({ entityId: null }).where(and(eq(units.companyId, a.tenant), eq(units.entityId, ex.id)));
      await tx.delete(entities).where(eq(entities.id, ex.id));
      await record(tx, a.tenant, { actor: a.email, action: "structure.entity.delete", entityType: "entity", entityId: ex.id, summary: `Entity removed: ${ex.name}`, requestId });
      return { ok: true as const };
    }
    const name = clean(input.name, 80);
    if (!name) return { ok: false as const, error: "Give it a name.", status: 400 };
    const clash = (await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.companyId, a.tenant), eq(entities.name, name))).limit(1))[0];
    if (clash && clash.id !== id) return { ok: false as const, error: `There's already one called ${name}.`, status: 409 };
    const eid = ex?.id ?? randomUUID();
    if (ex) await tx.update(entities).set({ name, code: clean(input.code, 20) || null }).where(eq(entities.id, eid));
    else await tx.insert(entities).values({ id: eid, companyId: a.tenant, name, code: clean(input.code, 20) || null });
    if (Array.isArray(input.unitIds)) {
      const want = new Set(input.unitIds.map(String));
      await tx.update(units).set({ entityId: null }).where(and(eq(units.companyId, a.tenant), eq(units.entityId, eid)));
      if (want.size) await tx.update(units).set({ entityId: eid }).where(and(eq(units.companyId, a.tenant), inArray(units.id, Array.from(want))));
    }
    await record(tx, a.tenant, { actor: a.email, action: ex ? "structure.entity.update" : "structure.entity.create", entityType: "entity", entityId: eid, summary: `Entity ${ex ? "changed" : "added"}: ${name}`, after: { name, units: Array.isArray(input.unitIds) ? input.unitIds.length : undefined }, requestId });
    return { ok: true as const };
  });
  if (!r.ok) return r;
  return { ok: true, value: await getStructure(a) };
}

/** Create or change a named site group (supervisors and admins). */
export async function saveGroup(a: Actor, id: string | null, input: { name?: unknown; unitIds?: unknown; remove?: unknown }, requestId?: string): Promise<Result<Structure>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins make site groups.", status: 403 };
  const r = await withTenant(a.tenant, async (tx) => {
    const ex = id ? (await tx.select().from(siteGroups).where(and(eq(siteGroups.companyId, a.tenant), eq(siteGroups.id, id))).limit(1))[0] : null;
    if (id && !ex) return { ok: false as const, error: "Not found.", status: 404 };
    if (ex && input.remove === true) {
      await tx.delete(siteGroups).where(eq(siteGroups.id, ex.id));
      await record(tx, a.tenant, { actor: a.email, action: "structure.group.delete", entityType: "site_group", entityId: ex.id, summary: `Group removed: ${ex.name}`, requestId });
      return { ok: true as const };
    }
    const name = clean(input.name, 80);
    if (!name) return { ok: false as const, error: "Give the group a name.", status: 400 };
    const valid = new Set((await tx.select({ id: units.id }).from(units).where(eq(units.companyId, a.tenant))).map((u) => u.id));
    const unitIds = Array.from(new Set((Array.isArray(input.unitIds) ? input.unitIds : []).map(String))).filter((x) => valid.has(x));
    if (unitIds.length < 1) return { ok: false as const, error: "Choose the sites in the group.", status: 400 };
    const clash = (await tx.select({ id: siteGroups.id }).from(siteGroups).where(and(eq(siteGroups.companyId, a.tenant), eq(siteGroups.name, name))).limit(1))[0];
    if (clash && clash.id !== id) return { ok: false as const, error: `There's already a group called ${name}.`, status: 409 };
    const gid = ex?.id ?? randomUUID();
    if (ex) await tx.update(siteGroups).set({ name, unitIds }).where(eq(siteGroups.id, gid));
    else await tx.insert(siteGroups).values({ id: gid, companyId: a.tenant, name, unitIds, createdBy: a.email });
    await record(tx, a.tenant, { actor: a.email, action: ex ? "structure.group.update" : "structure.group.create", entityType: "site_group", entityId: gid, summary: `Group ${ex ? "changed" : "added"}: ${name} (${unitIds.length} sites)`, requestId });
    return { ok: true as const };
  });
  if (!r.ok) return r;
  return { ok: true, value: await getStructure(a) };
}

// ── comparison and benchmarking ───────────────────────────────────────────────

export interface SiteFigures {
  unitId: string; name: string; entityId: string | null; region: string | null;
  inspections: number; avgScore: number | null; passRate: number | null; criticalFails: number;
  risk: number | null; band: BandKey | "none"; openActions: number; overdueActions: number; openIssues: number; controlsFailed: number;
  /** Benchmarks: percentile of the score among all sites (100 = best), and the gap to the median score. */
  scorePercentile: number | null; vsMedian: number | null;
}
export interface GroupFigures { key: string; name: string; sites: number; inspections: number; avgScore: number | null; passRate: number | null; criticalFails: number; avgRisk: number | null; worstBand: BandKey | "none"; worstSite: string | null; openActions: number; overdueActions: number; openIssues: number; controlsFailed: number }
export interface Comparison { level: "entity" | "region" | "group" | "site"; days: number; median: number | null; best: number | null; sites: SiteFigures[]; groups: GroupFigures[] }

const RANK: Record<string, number> = { none: -1, worldClass: 0, strong: 1, healthy: 2, watch: 3, attention: 4, escalate: 5 };
const round1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);
export const median = (xs: number[]) => { const v = [...xs].sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
/** Percentile rank (0–100) of x among xs: the share of values at or below it, ties counted half. */
export const percentile = (x: number, xs: number[]) => { if (!xs.length) return null; const below = xs.filter((v) => v < x).length, same = xs.filter((v) => v === x).length; return Math.round(((below + same / 2) / xs.length) * 100); };

/** Roll a set of sites up: totals, inspection-weighted average score, average risk, the worst band. */
export function rollUp(key: string, name: string, xs: SiteFigures[]): GroupFigures {
  const n = xs.reduce((t, s) => t + s.inspections, 0);
  const scored = xs.filter((s) => s.avgScore != null && s.inspections > 0);
  const w = scored.reduce((t, s) => t + s.inspections, 0);
  const risks = xs.filter((s) => s.risk != null);
  const worst = [...xs].sort((p, q) => RANK[q.band] - RANK[p.band] || (q.risk ?? -1) - (p.risk ?? -1))[0];
  const passN = xs.reduce((t, s) => t + (s.passRate != null ? s.passRate * s.inspections : 0), 0);
  return {
    key, name, sites: xs.length, inspections: n, avgScore: w ? round1(scored.reduce((t, s) => t + s.avgScore! * s.inspections, 0) / w) : null, passRate: n ? Math.round((passN / n) * 1000) / 1000 : null,
    criticalFails: xs.reduce((t, s) => t + s.criticalFails, 0), avgRisk: risks.length ? round1(risks.reduce((t, s) => t + s.risk!, 0) / risks.length) : null,
    worstBand: worst?.band ?? "none", worstSite: worst && worst.band !== "none" ? worst.name : null,
    openActions: xs.reduce((t, s) => t + s.openActions, 0), overdueActions: xs.reduce((t, s) => t + s.overdueActions, 0), openIssues: xs.reduce((t, s) => t + s.openIssues, 0), controlsFailed: xs.reduce((t, s) => t + s.controlsFailed, 0),
  };
}

export async function compare(a: Actor, opts: { level?: string; days?: number; now?: Date } = {}): Promise<Comparison> {
  const now = opts.now ?? new Date();
  const days = [30, 90, 180, 365].includes(Number(opts.days)) ? Number(opts.days) : 90;
  const level = (["entity", "region", "group", "site"] as const).find((l) => l === opts.level) ?? "region";
  const since = new Date(now.getTime() - days * 864e5);
  const today = now.toISOString().slice(0, 10);
  const board = await riskBoard(a, now);
  const structure = await getStructure(a);
  const base = await withTenant(a.tenant, async (tx) => {
    const us = (await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.active, true))).orderBy(asc(units.sort), asc(units.name))).filter((u) => inScope(a, u.id));
    const ins = await tx.select({ unitId: inspections.unitId, score: inspections.score }).from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.status, "approved"), gte(inspections.approvedAt, since)));
    const acts = await tx.select({ unitId: actions.unitId, dueDate: actions.dueDate }).from(actions).where(and(eq(actions.companyId, a.tenant), ne(actions.status, "closed")));
    const iss = await tx.select({ unitId: issueReports.unitId }).from(issueReports).where(and(eq(issueReports.companyId, a.tenant), eq(issueReports.status, "new")));
    const plans = await tx.select({ unitId: samplingPlans.unitId, evaluation: samplingPlans.evaluation, updatedAt: samplingPlans.updatedAt }).from(samplingPlans).where(and(eq(samplingPlans.companyId, a.tenant), eq(samplingPlans.status, "evaluated")));
    return { us, ins, acts, iss, plans };
  });
  const risk = new Map(board.sites.map((s) => [s.unitId, s]));
  const sites: SiteFigures[] = base.us.map((u) => {
    const mine = base.ins.filter((i) => i.unitId === u.id).map((i) => i.score as StoredScore | null);
    const scored = mine.filter((s) => s?.pct != null) as StoredScore[];
    const r = risk.get(u.id);
    return {
      unitId: u.id, name: u.name, entityId: u.entityId, region: u.region, inspections: mine.length,
      avgScore: scored.length ? round1(scored.reduce((t, s) => t + (s.pct ?? 0), 0) / scored.length) : null,
      passRate: mine.length ? Math.round((mine.filter((s) => s?.result === "pass").length / mine.length) * 1000) / 1000 : null,
      criticalFails: mine.reduce((t, s) => t + (s?.criticalFails ?? 0), 0),
      risk: r?.score ?? null, band: r?.band ?? "none",
      openActions: base.acts.filter((x) => x.unitId === u.id).length, overdueActions: base.acts.filter((x) => x.unitId === u.id && String(x.dueDate) < today).length,
      openIssues: base.iss.filter((x) => x.unitId === u.id).length,
      controlsFailed: base.plans.filter((p) => p.unitId === u.id && p.updatedAt >= since && (p.evaluation as Evaluation | null)?.effective === false).length,
      scorePercentile: null, vsMedian: null,
    };
  });
  const scores = sites.filter((s) => s.avgScore != null).map((s) => s.avgScore!);
  const med = median(scores);
  for (const s of sites) if (s.avgScore != null) { s.scorePercentile = percentile(s.avgScore, scores); s.vsMedian = med == null ? null : round1(s.avgScore - med); }
  let groups: GroupFigures[] = [];
  if (level === "entity") {
    groups = structure.entities.map((e) => rollUp(e.id, e.name, sites.filter((s) => s.entityId === e.id))).filter((g) => g.sites);
    const none = sites.filter((s) => !s.entityId);
    if (none.length) groups.push(rollUp("_none", "Not in an entity", none));
  } else if (level === "region") {
    groups = structure.regions.map((r) => rollUp(r.name, r.name, sites.filter((s) => s.region === r.name))).filter((g) => g.sites);
    const none = sites.filter((s) => !s.region);
    if (none.length) groups.push(rollUp("_none", "No region", none));
  } else if (level === "group") {
    groups = structure.groups.map((g) => rollUp(g.id, g.name, sites.filter((s) => g.unitIds.includes(s.unitId)))).filter((g) => g.sites);
  }
  groups.sort((x, y) => (y.avgRisk ?? -1) - (x.avgRisk ?? -1));
  return { level, days, median: med, best: scores.length ? Math.max(...scores) : null, sites, groups };
}
