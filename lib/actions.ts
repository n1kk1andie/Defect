// Corrective and preventive actions (CAPA): turning a finding into owned,
// dated work that is closed on evidence.
//
// A supervisor (or admin) raises an action against a unit, optionally one
// process area and optionally from a published defect, with a kind
// (corrective or preventive), root cause, priority, owner and due date. The
// owner's team works it (in progress), then submits it for verification with a
// closure note and evidence. A supervisor verifies and closes it, or sends it
// back. Whoever raised it, whoever submitted the closure and its owner can
// never be the one who verifies it. Every step lands in the history.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { actionEvents, actions, evidence, inspections, issueReports, members, reviewItems, reviews, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { can, inScope, isSupervisor, verifyBlocker, type Actor } from "@/lib/roles";

import type { ActionView } from "@/lib/actionRules";
export type { ActionView };
import { STATUS_LABEL, PRIORITIES, isOverdue, allowedSteps, cleanRca, effectivenessBlocker, type ActionStatus, type ActionPriority, type ActionStep, type ActionKind, type Effectiveness, type Rca } from "@/lib/actionRules";
export { STATUS_LABEL, PRIORITIES, isOverdue, allowedSteps, type ActionStatus, type ActionPriority, type ActionStep };
const KINDS: ActionKind[] = ["containment", "corrective", "preventive"];
/** A pending effectiveness check reads "due" once its date has come. */
const effectivenessNow = (e: Effectiveness | null, today = new Date().toISOString().slice(0, 10)): Effectiveness | null => (e && e.status === "pending" && e.due <= today ? { ...e, status: "due" } : e);
const addDaysIso = (d: Date, n: number) => new Date(d.getTime() + n * 864e5).toISOString().slice(0, 10);
type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };


const iso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const validDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z"));


/** Who may see an action: anyone whose scope covers its unit, and always its owner. */
export function canSeeAction(a: Actor, x: { unitId: string; ownerEmail: string | null }): boolean {
  return (a.roles.length > 0 && inScope(a, x.unitId)) || (!!x.ownerEmail && x.ownerEmail === a.email);
}

async function view(tx: Tx, companyId: string, rows: (typeof actions.$inferSelect)[]): Promise<ActionView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [ev, files, unitRows] = await Promise.all([
    tx.select().from(actionEvents).where(and(eq(actionEvents.companyId, companyId), inArray(actionEvents.actionId, ids))).orderBy(asc(actionEvents.at), asc(actionEvents.id)),
    tx.select().from(evidence).where(and(eq(evidence.companyId, companyId), eq(evidence.entityType, "action"), inArray(evidence.entityId, ids))).orderBy(asc(evidence.uploadedAt)),
    tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, companyId)),
  ]);
  const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const history = ev.filter((e) => e.actionId === r.id).map((e) => ({ kind: e.kind, status: e.status, by: e.by, at: e.at.toISOString(), note: e.note }));
    const submittedBy = [...history].reverse().find((h) => h.status === "awaiting_verification")?.by ?? null;
    const due = iso(r.dueDate);
    return {
      id: r.id, ref: r.ref, kind: r.kind as ActionView["kind"], unitId: r.unitId, unitName: unitName.get(r.unitId) || "—", areaId: r.areaId,
      title: r.title, details: r.details, rootCause: r.rootCause, priority: r.priority as ActionPriority, ownerEmail: r.ownerEmail, ownerName: r.ownerName,
      dueDate: due, status: r.status as ActionStatus, closureNote: r.closureNote, raisedBy: r.raisedBy, verifierEmail: r.verifierEmail,
      verifiedBy: r.verifiedBy, verifiedAt: r.verifiedAt?.toISOString() ?? null, submittedBy, sourceType: r.sourceType, sourceId: r.sourceId,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), closedAt: r.closedAt?.toISOString() ?? null,
      overdue: isOverdue({ status: r.status, dueDate: due }),
      rca: (r.rca as Rca | null) ?? null, effectivenessDays: r.effectivenessDays, effectiveness: effectivenessNow(r.effectiveness as Effectiveness | null), reopenCount: r.reopenCount,
      history,
      evidence: files.filter((f) => f.entityId === r.id).map((f) => ({ id: f.id, name: f.name, size: f.size, contentType: f.contentType, uploadedBy: f.uploadedBy, uploadedAt: f.uploadedAt.toISOString() })),
    };
  });
}

/** Actions this person may see: open work first (earliest due), then closed (latest first). */
export async function listActions(a: Actor): Promise<ActionView[]> {
  return withTenant(a.tenant, async (tx) => {
    const rows = (await tx.select().from(actions).where(eq(actions.companyId, a.tenant)).orderBy(desc(actions.updatedAt))).filter((r) => canSeeAction(a, r));
    const out = await view(tx, a.tenant, rows);
    return out.sort((x, y) => {
      const xc = x.status === "closed" ? 1 : 0, yc = y.status === "closed" ? 1 : 0;
      if (xc !== yc) return xc - yc;
      return xc ? y.updatedAt.localeCompare(x.updatedAt) : x.dueDate.localeCompare(y.dueDate);
    });
  });
}

export async function getAction(a: Actor, id: string): Promise<ActionView | null> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.id, id))).limit(1))[0];
    if (!r || !canSeeAction(a, r)) return null;
    return (await view(tx, a.tenant, [r]))[0];
  });
}

interface ActionInput { rca?: unknown; effectivenessDays?: unknown; kind?: unknown; unitId?: unknown; areaId?: unknown; title?: unknown; details?: unknown; rootCause?: unknown; priority?: unknown; ownerEmail?: unknown; ownerName?: unknown; dueDate?: unknown; verifierEmail?: unknown; sourceType?: unknown; sourceId?: unknown }

async function readFields(tx: Tx, a: Actor, input: ActionInput, fixedUnit?: string) {
  const unitId = fixedUnit ?? clean(input.unitId, 80);
  const unit = (await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.id, unitId))).limit(1))[0];
  if (!unit) return { ok: false as const, error: "Choose a branch." };
  if (!inScope(a, unitId)) return { ok: false as const, error: `${unit.name} is outside your branches.` };
  const title = clean(input.title, 160);
  if (!title) return { ok: false as const, error: "Describe the issue in a short title." };
  const priority = clean(input.priority, 10) as ActionPriority;
  if (!PRIORITIES.includes(priority)) return { ok: false as const, error: "Choose a priority." };
  const ownerEmail = clean(input.ownerEmail, 254).toLowerCase() || null;
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) return { ok: false as const, error: "The owner's email doesn't look right." };
  let ownerName = clean(input.ownerName, 120);
  if (ownerEmail && !ownerName) ownerName = (await tx.select({ name: members.name }).from(members).where(and(eq(members.companyId, a.tenant), eq(members.email, ownerEmail))).limit(1))[0]?.name || ownerEmail;
  if (!ownerEmail && !ownerName) return { ok: false as const, error: "Name an owner: the person or team responsible." };
  const dueDate = clean(input.dueDate, 10);
  if (!validDate(dueDate)) return { ok: false as const, error: "Set a due date." };
  const verifierEmail = clean(input.verifierEmail, 254).toLowerCase() || null;
  if (verifierEmail && verifierEmail === a.email) return { ok: false as const, error: "You raised this action, so name someone else to verify it." };
  return {
    ok: true as const,
    value: {
      kind: (KINDS.find((k) => k === input.kind) ?? "corrective") as ActionView["kind"], unitId, areaId: clean(input.areaId, 80) || null, title,
      details: clean(input.details, 4000), rootCause: clean(input.rootCause, 2000), priority, ownerEmail, ownerName, dueDate, verifierEmail,
      rca: cleanRca(input.rca), effectivenessDays: [0, 14, 30, 60, 90, 180].includes(Math.round(Number(input.effectivenessDays))) ? Math.round(Number(input.effectivenessDays)) : 0,
    },
  };
}

/** Raise an action (supervisors and admins). */
export async function createAction(a: Actor, input: ActionInput, requestId?: string): Promise<Result<ActionView>> {
  if (!can.raiseActions(a)) return { ok: false, error: "Only supervisors and admins raise actions.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const f = await readFields(tx, a, input);
    if (!f.ok) return { ok: false as const, error: f.error, status: 400 };
    let sourceType = "manual", sourceId: string | null = null;
    if (input.sourceType === "review_item" && typeof input.sourceId === "string") {
      const [rid, idx] = input.sourceId.split(":");
      const it = (await tx.select({ id: reviewItems.id }).from(reviewItems).innerJoin(reviews, eq(reviews.id, reviewItems.reviewId))
        .where(and(eq(reviewItems.companyId, a.tenant), eq(reviewItems.reviewId, rid), eq(reviewItems.idx, Number(idx)), eq(reviews.status, "published"))).limit(1))[0];
      if (!it) return { ok: false as const, error: "That defect isn't published.", status: 400 };
      sourceType = "review_item"; sourceId = input.sourceId;
    } else if (input.sourceType === "recurring" && typeof input.sourceId === "string") {
      sourceType = "recurring"; sourceId = clean(input.sourceId, 200);
    } else if (input.sourceType === "issue_report" && typeof input.sourceId === "string") {
      const rep = (await tx.select().from(issueReports).where(and(eq(issueReports.companyId, a.tenant), eq(issueReports.id, input.sourceId))).limit(1))[0];
      if (!rep) return { ok: false as const, error: "That report wasn't found.", status: 400 };
      sourceType = "issue_report"; sourceId = rep.id;
    } else if ((input.sourceType === "api" || input.sourceType === "import") && a.platformRole !== "staff") {
      sourceType = String(input.sourceType); sourceId = typeof input.sourceId === "string" ? clean(input.sourceId, 200) || null : null;
    }
    const id = randomUUID();
    const ref = await nextRef(tx, a.tenant, "action", "ACT");
    await tx.insert(actions).values({ id, companyId: a.tenant, ref, ...f.value, status: "open", raisedBy: a.email, sourceType, sourceId });
    await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: id, kind: "status", status: "open", by: a.email });
    await record(tx, a.tenant, { actor: a.email, action: "action.create", entityType: "action", entityId: id, summary: `${ref} raised: ${f.value.title}`, after: { ref, ...f.value }, requestId });
    const r = (await tx.select().from(actions).where(eq(actions.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [r]))[0] };
  });
}

/** Change the plan: title, details, root cause, priority, owner, due date, verifier. Supervisors and admins, while not closed. */
export async function editAction(a: Actor, id: string, input: ActionInput, requestId?: string): Promise<Result<ActionView>> {
  if (!can.planActions(a)) return { ok: false, error: "Only supervisors and admins change an action's plan.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Action not found.", status: 404 };
    if (r.status === "closed") return { ok: false as const, error: "This action is closed. Reopen it to change it.", status: 409 };
    const f = await readFields(tx, a, input, r.unitId);
    if (!f.ok) return { ok: false as const, error: f.error, status: 400 };
    const keys = ["kind", "areaId", "title", "details", "rootCause", "priority", "ownerEmail", "ownerName", "dueDate", "verifierEmail", "effectivenessDays"] as const;
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    for (const k of keys) {
      const was = k === "dueDate" ? iso(r.dueDate) : (r as Record<string, unknown>)[k];
      if ((was ?? null) !== (f.value[k] ?? null)) { before[k] = was; after[k] = f.value[k]; }
    }
    if (input.rca !== undefined && JSON.stringify(r.rca ?? null) !== JSON.stringify(f.value.rca)) { before.rca = r.rca; after.rca = f.value.rca; }
    const patchValue = { ...f.value, ...(input.rca === undefined ? { rca: r.rca as Rca | null } : {}), ...(input.effectivenessDays === undefined ? { effectivenessDays: r.effectivenessDays } : {}) };
    if (input.effectivenessDays === undefined) { delete after.effectivenessDays; delete before.effectivenessDays; }
    if (!Object.keys(after).length) return { ok: true as const, value: (await view(tx, a.tenant, [r]))[0] };
    await tx.update(actions).set({ ...patchValue, updatedAt: new Date() }).where(eq(actions.id, id));
    const note = `Changed ${Object.keys(after).map((k) => ({ dueDate: "due date", ownerEmail: "owner", ownerName: "owner", rootCause: "root cause", areaId: "process area", verifierEmail: "verifier", rca: "root cause analysis", effectivenessDays: "effectiveness check" } as Record<string, string>)[k] || k).filter((v, i, xs) => xs.indexOf(v) === i).join(", ")}`;
    await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: id, kind: "edited", by: a.email, note });
    await record(tx, a.tenant, { actor: a.email, action: "action.edit", entityType: "action", entityId: id, summary: `${r.ref}: ${note}`, before, after, requestId });
    const fresh = (await tx.select().from(actions).where(eq(actions.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [fresh]))[0] };
  });
}

/**
 * Move an action through its lifecycle.
 *  start   open → in progress
 *  submit  open / in progress → awaiting verification, with a closure note (+ evidence already attached)
 *  verify  awaiting verification → closed, by a supervisor who didn't raise, own or submit it
 *  return  awaiting verification → in progress, with a note
 *  reopen  closed → in progress, with a note
 */
export async function stepAction(a: Actor, id: string, step: ActionStep, input: { note?: unknown }, requestId?: string): Promise<Result<ActionView>> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Action not found.", status: 404 };
    if (!canSeeAction(a, r)) return { ok: false as const, error: "You can't update this action.", status: 403 };
    const current = (await view(tx, a.tenant, [r]))[0];
    const note = clean(input.note, 4000);
    const now = new Date();
    const worker = (can.workActions(a) && inScope(a, r.unitId)) || r.ownerEmail === a.email;
    let next: ActionStatus;
    const patch: Partial<typeof actions.$inferInsert> = {};
    if (step === "start") {
      if (!worker) return { ok: false as const, error: "Your role doesn't work actions.", status: 403 };
      if (r.status !== "open") return { ok: false as const, error: "Only an open action can be started.", status: 409 };
      next = "in_progress";
    } else if (step === "submit") {
      if (!worker) return { ok: false as const, error: "Your role doesn't work actions.", status: 403 };
      if (r.status !== "open" && r.status !== "in_progress") return { ok: false as const, error: "This action isn't open.", status: 409 };
      if (note.length < 10) return { ok: false as const, error: "Say what was done to resolve it (at least a sentence).", status: 400 };
      next = "awaiting_verification";
      patch.closureNote = note;
    } else if (step === "verify") {
      if (r.status !== "awaiting_verification") return { ok: false as const, error: "Only an action awaiting verification can be closed.", status: 409 };
      const block = verifyBlocker(a, current);
      if (block) return { ok: false as const, error: block, status: 403 };
      next = "closed";
      Object.assign(patch, { verifiedBy: a.email, verifiedAt: now, closedAt: now });
      if (r.effectivenessDays > 0) {
        let templateId: string | null = null; const questionIds: string[] = [];
        if (r.sourceType === "inspection" && r.sourceId) {
          const [iid, qid] = r.sourceId.split(":");
          templateId = (await tx.select({ t: inspections.templateId }).from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.id, iid))).limit(1))[0]?.t ?? null;
          if (qid) questionIds.push(qid);
        }
        patch.effectiveness = { days: r.effectivenessDays, due: addDaysIso(now, r.effectivenessDays), status: "pending", templateId, questionIds } satisfies Effectiveness;
      }
    } else if (step === "return" || step === "reopen") {
      if (!isSupervisor(a)) return { ok: false as const, error: "A supervisor sends actions back.", status: 403 };
      if (step === "return" && r.status !== "awaiting_verification") return { ok: false as const, error: "Only an action awaiting verification can be sent back.", status: 409 };
      if (step === "reopen" && r.status !== "closed") return { ok: false as const, error: "Only a closed action can be reopened.", status: 409 };
      if (!note) return { ok: false as const, error: "Add a note saying what still needs doing.", status: 400 };
      next = "in_progress";
      Object.assign(patch, { verifiedBy: null, verifiedAt: null, closedAt: null });
      if (step === "reopen") patch.reopenCount = r.reopenCount + 1;
    } else if (step === "effective" || step === "ineffective") {
      const eff = r.effectiveness as Effectiveness | null;
      if (r.status !== "closed" || !eff || (eff.status !== "pending" && eff.status !== "due")) return { ok: false as const, error: "There's no effectiveness check waiting on this action.", status: 409 };
      const block = effectivenessBlocker(a, current);
      if (block) return { ok: false as const, error: block, status: 403 };
      if (note.length < 10) return { ok: false as const, error: "Say what you checked (at least a sentence).", status: 400 };
      const done: Effectiveness = { ...eff, status: step, checkedAt: now.toISOString(), by: a.email, note };
      if (step === "effective") {
        await tx.update(actions).set({ effectiveness: done, updatedAt: now }).where(eq(actions.id, id));
        await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: id, kind: "effectiveness", status: null, by: a.email, note: `Effective: ${note}` });
        await record(tx, a.tenant, { actor: a.email, action: "action.effective", entityType: "action", entityId: id, summary: `${r.ref}: effectiveness check passed`, after: { effectiveness: "effective", note }, requestId });
        const fresh0 = (await tx.select().from(actions).where(eq(actions.id, id)).limit(1))[0];
        return { ok: true as const, value: (await view(tx, a.tenant, [fresh0]))[0] };
      }
      next = "in_progress";
      Object.assign(patch, { effectiveness: done, verifiedBy: null, verifiedAt: null, closedAt: null, reopenCount: r.reopenCount + 1 });
    } else {
      return { ok: false as const, error: "Unknown step.", status: 400 };
    }
    await tx.update(actions).set({ ...patch, status: next, updatedAt: now }).where(eq(actions.id, id));
    await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: id, kind: "status", status: next, by: a.email, note: note || null });
    await record(tx, a.tenant, { actor: a.email, action: `action.${step}`, entityType: "action", entityId: id, summary: `${r.ref}: ${r.status} → ${next}`, before: { status: r.status }, after: { status: next, ...(note ? { note } : {}) }, requestId });
    const fresh = (await tx.select().from(actions).where(eq(actions.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [fresh]))[0] };
  });
}

/** Delete an action raised in error. Admins only; everyone else closes or reopens. */
export async function deleteAction(a: Actor, id: string, requestId?: string): Promise<Result<true>> {
  if (!can.deleteActions(a)) return { ok: false, error: "Only an admin can delete an action.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Action not found.", status: 404 };
    await tx.delete(actionEvents).where(and(eq(actionEvents.companyId, a.tenant), eq(actionEvents.actionId, id)));
    await tx.delete(actions).where(eq(actions.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "action.delete", entityType: "action", entityId: id, summary: `Deleted ${r.ref}: ${r.title}`, before: { ref: r.ref, title: r.title, status: r.status }, requestId });
    return { ok: true as const, value: true as const };
  });
}
