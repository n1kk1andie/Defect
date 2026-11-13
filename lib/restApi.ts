// The REST API (/api/v1): read sites, inspections, actions, risk, sampling and
// reported issues; raise actions and report issues. Authenticated by an API key
// (lib/apiKeys.ts) as "Authorization: Bearer pq_…", scoped, rate limited, and
// paged with ?limit= and ?after= (an opaque cursor). Errors are
// { "error": { "code", "message" } }. Documented in docs/api.md.
import { and, asc, eq, gt, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db/client";
import { actions, entities, inspections, siteGroups, templates, units } from "@/lib/db/schema";
import { authenticateKey, rateLimited, type KeyActor, type Scope } from "@/lib/apiKeys";
import type { StoredScore } from "@/lib/inspections";
import { LICENCE_MESSAGE } from "@/lib/planStatus";

export const API_VERSION = "2026-11-01";

export function apiError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store", "X-Pulsus-Api-Version": API_VERSION, ...headers } });
}
export const apiJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "X-Pulsus-Api-Version": API_VERSION } });

/** 402 with code "licence_required": the company's plan has lapsed (the same rule as the licence wall). */
export const licenceRefusal = () => apiError(402, "licence_required", LICENCE_MESSAGE);

/** Authenticate, check the licence, the scope and the rate limit, then run. */
export async function withKey(req: Request, scope: Scope, fn: (k: KeyActor) => Promise<Response>): Promise<Response> {
  const k = await authenticateKey(req.headers.get("authorization"));
  if (!k) return apiError(401, "unauthorized", "Send a valid API key as Authorization: Bearer pq_…", { "WWW-Authenticate": 'Bearer realm="pulsus-quality"' });
  if (k.licence) return licenceRefusal();
  if (!k.scopes.includes(scope)) return apiError(403, "insufficient_scope", `This key doesn't have the ${scope} scope.`);
  if (rateLimited(k.keyId)) return apiError(429, "rate_limited", "Too many requests: 120 a minute per key.", { "Retry-After": "60" });
  try { return await fn(k); } catch (e) { console.error("api v1", e); return apiError(500, "server_error", "Something went wrong on our side."); }
}

export function page(req: Request): { limit: number; after: string | null; since: Date | null } {
  const u = new URL(req.url);
  const limit = Math.max(1, Math.min(200, Math.round(Number(u.searchParams.get("limit")) || 50)));
  const after = u.searchParams.get("after");
  const s = u.searchParams.get("since");
  const since = s && !Number.isNaN(Date.parse(s)) ? new Date(s) : null;
  return { limit, after: after && /^[\w-]{1,80}$/.test(after) ? after : null, since };
}

export async function sitesFor(k: KeyActor) {
  const t = k.actor.tenant;
  return withTenant(t, async (tx) => {
    const us = await tx.select().from(units).where(eq(units.companyId, t)).orderBy(asc(units.sort), asc(units.name));
    const es = await tx.select().from(entities).where(eq(entities.companyId, t));
    const gs = await tx.select().from(siteGroups).where(eq(siteGroups.companyId, t));
    return {
      sites: us.map((u) => ({ id: u.id, name: u.name, code: u.code, region: u.region, entity_id: u.entityId, active: u.active })),
      entities: es.map((e) => ({ id: e.id, name: e.name, code: e.code })),
      groups: gs.map((g) => ({ id: g.id, name: g.name, site_ids: g.unitIds })),
    };
  });
}

const inspectionJson = (r: typeof inspections.$inferSelect, tName: Map<string, string>, uName: Map<string, string>, full = false) => {
  const s = r.score as StoredScore | null;
  return {
    id: r.id, ref: r.ref, status: r.status, site_id: r.unitId, site: uName.get(r.unitId) ?? null, template_id: r.templateId, template: tName.get(r.templateId) ?? null, template_version: r.templateVersion,
    period: String(r.period).slice(0, 7), inspector: r.inspectorEmail, approver: r.supervisorEmail, score: s?.pct ?? null, result: s?.result ?? null, critical_failures: s?.criticalFails ?? 0,
    items: s?.items ?? 0, deviations: s?.deviations ?? 0, created_at: r.createdAt.toISOString(), submitted_at: r.submittedAt?.toISOString() ?? null, approved_at: r.approvedAt?.toISOString() ?? null, updated_at: r.updatedAt.toISOString(),
    ...(full ? { findings: (s?.findings ?? []).map((f) => ({ question_id: f.questionId, question: f.label, item: f.itemRef || null, critical: f.critical, severity: f.severity, note: f.note || null })) } : {}),
  };
};

/** Inspections, newest change first is awkward to page; we page by id within updated_at ascending. */
export async function listInspectionsApi(k: KeyActor, req: Request) {
  const t = k.actor.tenant;
  const { limit, after, since } = page(req);
  const status = new URL(req.url).searchParams.get("status");
  return withTenant(t, async (tx) => {
    const conds = [eq(inspections.companyId, t)];
    if (status && ["draft", "submitted", "returned", "approved"].includes(status)) conds.push(eq(inspections.status, status));
    if (since) conds.push(gte(inspections.updatedAt, since));
    if (after) conds.push(gt(inspections.id, after));
    const rows = await tx.select().from(inspections).where(and(...conds)).orderBy(asc(inspections.id)).limit(limit + 1);
    const ts = await tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.companyId, t));
    const us = await tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, t));
    const tn = new Map(ts.map((x) => [x.id, x.name])), un = new Map(us.map((x) => [x.id, x.name]));
    const more = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => inspectionJson(r, tn, un));
    return { data, next: more ? data[data.length - 1].id : null };
  });
}

export async function getInspectionApi(k: KeyActor, id: string) {
  const t = k.actor.tenant;
  return withTenant(t, async (tx) => {
    const r = (await tx.select().from(inspections).where(and(eq(inspections.companyId, t), eq(inspections.id, id))).limit(1))[0];
    if (!r) return null;
    const ts = await tx.select({ id: templates.id, name: templates.name }).from(templates).where(and(eq(templates.companyId, t), eq(templates.id, r.templateId)));
    const us = await tx.select({ id: units.id, name: units.name }).from(units).where(and(eq(units.companyId, t), eq(units.id, r.unitId)));
    return inspectionJson(r, new Map(ts.map((x) => [x.id, x.name])), new Map(us.map((x) => [x.id, x.name])), true);
  });
}

export async function listActionsApi(k: KeyActor, req: Request) {
  const t = k.actor.tenant;
  const { limit, after, since } = page(req);
  const st = new URL(req.url).searchParams.get("status");
  return withTenant(t, async (tx) => {
    const conds = [eq(actions.companyId, t)];
    if (st && ["open", "in_progress", "awaiting_verification", "closed"].includes(st)) conds.push(eq(actions.status, st));
    if (since) conds.push(gte(actions.updatedAt, since));
    if (after) conds.push(gt(actions.id, after));
    const rows = await tx.select().from(actions).where(and(...conds)).orderBy(asc(actions.id)).limit(limit + 1);
    const ids = Array.from(new Set(rows.map((r) => r.unitId)));
    const us = ids.length ? await tx.select({ id: units.id, name: units.name }).from(units).where(and(eq(units.companyId, t), inArray(units.id, ids))) : [];
    const un = new Map(us.map((x) => [x.id, x.name]));
    const today = new Date().toISOString().slice(0, 10);
    const more = rows.length > limit;
    const data = rows.slice(0, limit).map((r) => actionJson(r, un.get(r.unitId) ?? null, today));
    return { data, next: more ? data[data.length - 1].id : null };
  });
}

export const actionJson = (r: typeof actions.$inferSelect, site: string | null, today = new Date().toISOString().slice(0, 10)) => ({
  id: r.id, ref: r.ref, kind: r.kind, status: r.status, overdue: r.status !== "closed" && String(r.dueDate) < today, site_id: r.unitId, site, title: r.title, details: r.details,
  root_cause: r.rootCause, rca: r.rca ?? null, priority: r.priority, owner_email: r.ownerEmail, owner_name: r.ownerName, due_date: String(r.dueDate).slice(0, 10), raised_by: r.raisedBy,
  verified_by: r.verifiedBy, verified_at: r.verifiedAt?.toISOString() ?? null, effectiveness: r.effectiveness ?? null, reopen_count: r.reopenCount, source: { type: r.sourceType, id: r.sourceId },
  created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString(), closed_at: r.closedAt?.toISOString() ?? null,
});

