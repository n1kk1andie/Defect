// Reviews and the supervisor approval gate (the original app's rules, now on
// Postgres). An inspector keys a review as a draft, submits it, and a
// supervisor approves it (publishing it to the dashboards) or returns it with a
// note. Nothing reaches the dashboards until it is published. Nobody approves
// their own review. Published defects are then resolved (or reopened) item by
// item, which moves the resolution rate.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { evidence, reviewEvents, reviewItems, reviews, scorecardEntries, scorecards, units } from "@/lib/db/schema";
import { loadProgram, loadSettings } from "@/lib/company";
import { record } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { approveBlocker, can, inScope, isSupervisor, type Actor } from "@/lib/roles";
import { AUDIT_POINTS } from "@/lib/bands";
import { evaluate, type ScorecardDef } from "@/lib/scorecard";
import type { CompanySettings } from "@/lib/settings";
import { itemContribution } from "@/lib/dataset";

export type ReviewStatus = "draft" | "submitted" | "returned" | "published";
type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

export interface ItemView { idx: number; areaId: string; itemType: string; reference: string; checks: Record<string, string>; defects: number; nature: string; recurring: boolean; status: "open" | "resolved"; resolvedBy: string | null }
export interface ReviewView {
  id: string; ref: string; kind: "checklist" | "scorecard"; unitId: string; unitName: string; period: string; entryDate: string;
  status: ReviewStatus; inspectorEmail: string; supervisorEmail: string | null; note: string;
  items: ItemView[]; scorecardValues: Record<string, number | null> | null; auditGrade: string | null;
  history: { status: string; by: string; at: string; note: string | null }[];
  evidence: { id: string; name: string; size: number; contentType: string }[];
  createdAt: string; updatedAt: string;
  totals: { sample: number; instances: number; defects: number; resolved: number; defectRate: number | null };
}

const iso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Who may see a review: supervisors and admins (in scope) see all; inspectors their own; everyone else published ones in scope. */
export function canSeeReview(a: Actor, r: { inspectorEmail: string; status: string; unitId: string }): boolean {
  if (!inScope(a, r.unitId) && r.inspectorEmail !== a.email) return false;
  if (isSupervisor(a)) return true;
  if (r.inspectorEmail === a.email) return true;
  return r.status === "published";
}

async function view(tx: Tx, companyId: string, rows: (typeof reviews.$inferSelect)[], settings: CompanySettings): Promise<ReviewView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [items, events, files, unitRows] = await Promise.all([
    tx.select().from(reviewItems).where(and(eq(reviewItems.companyId, companyId), inArray(reviewItems.reviewId, ids))).orderBy(asc(reviewItems.idx)),
    tx.select().from(reviewEvents).where(and(eq(reviewEvents.companyId, companyId), inArray(reviewEvents.reviewId, ids))).orderBy(asc(reviewEvents.at), asc(reviewEvents.id)),
    tx.select().from(evidence).where(and(eq(evidence.companyId, companyId), eq(evidence.entityType, "review"), inArray(evidence.entityId, ids))),
    tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, companyId)),
  ]);
  const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const its = items.filter((i) => i.reviewId === r.id).map((i) => ({ idx: i.idx, areaId: i.areaId, itemType: i.itemType, reference: i.reference, checks: i.checks as Record<string, string>, defects: i.defects, nature: i.nature, recurring: i.recurring, status: i.status as "open" | "resolved", resolvedBy: i.resolvedBy }));
    const t = its.reduce((acc, it) => { const c = itemContribution(it, settings.instanceBasis); acc.instances += c.instances; acc.defects += c.defects; acc.resolved += c.resolved; return acc; }, { instances: 0, defects: 0, resolved: 0 });
    return {
      id: r.id, ref: r.ref, kind: r.kind as ReviewView["kind"], unitId: r.unitId, unitName: unitName.get(r.unitId) || "—", period: iso(r.period), entryDate: iso(r.entryDate),
      status: r.status as ReviewStatus, inspectorEmail: r.inspectorEmail, supervisorEmail: r.supervisorEmail, note: r.note,
      items: its, scorecardValues: (r.scorecardValues as Record<string, number | null>) ?? null, auditGrade: r.auditGrade,
      history: events.filter((e) => e.reviewId === r.id).map((e) => ({ status: e.status, by: e.by, at: e.at.toISOString(), note: e.note })),
      evidence: files.filter((f) => f.entityId === r.id).map((f) => ({ id: f.id, name: f.name, size: f.size, contentType: f.contentType })),
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      totals: { sample: its.length, instances: t.instances, defects: t.defects, resolved: t.resolved, defectRate: t.instances ? t.defects / t.instances : null },
    };
  });
}

/** The reviews this person may see, newest activity first. */
export async function listReviews(a: Actor, opts: { limit?: number } = {}): Promise<ReviewView[]> {
  return withTenant(a.tenant, async (tx) => {
    const rows = await tx.select().from(reviews).where(eq(reviews.companyId, a.tenant)).orderBy(desc(reviews.updatedAt)).limit(opts.limit ?? 400);
    const visible = rows.filter((r) => canSeeReview(a, r));
    return view(tx, a.tenant, visible, await loadSettings(tx, a.tenant));
  });
}

export async function getReview(a: Actor, id: string): Promise<ReviewView | null> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.id, id))).limit(1))[0];
    if (!r || !canSeeReview(a, r)) return null;
    return (await view(tx, a.tenant, [r], await loadSettings(tx, a.tenant)))[0];
  });
}

interface ReviewInput { id?: unknown; kind?: unknown; unitId?: unknown; period?: unknown; entryDate?: unknown; items?: unknown; values?: unknown; auditGrade?: unknown; submit?: unknown }

async function activeScorecard(tx: Tx, companyId: string) {
  return (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0] ?? null;
}

/** Create or update a draft; `submit` sends it to a supervisor. Only its inspector (or an admin) edits it, and only while draft or returned. */
export async function saveReview(a: Actor, input: ReviewInput, requestId?: string): Promise<Result<ReviewView>> {
  if (!can.keyReviews(a)) return { ok: false, error: "Your role doesn't key reviews.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const settings = await loadSettings(tx, a.tenant);
    const program = await loadProgram(tx, a.tenant);
    const kind = input.kind === "scorecard" ? "scorecard" : "checklist";
    const unitId = clean(input.unitId, 80);
    const unit = program.units.find((u) => u.id === unitId && u.active);
    if (!unit) return { ok: false as const, error: `Choose a ${settings.unitLabel.toLowerCase()}.`, status: 400 };
    if (!inScope(a, unitId)) return { ok: false as const, error: `${unit.name} isn't one of your ${settings.unitPlural.toLowerCase()}.`, status: 403 };
    const period = clean(input.period, 10);
    if (!/^\d{4}-\d{2}-01$/.test(period)) return { ok: false as const, error: "Choose a valid month.", status: 400 };
    const ed = clean(input.entryDate, 10);
    const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(ed) ? ed : new Date().toISOString().slice(0, 10);

    let itemRows: Omit<typeof reviewItems.$inferInsert, "companyId" | "reviewId" | "id">[] = [];
    let values: Record<string, number | null> | null = null;
    let auditGrade: string | null = null;
    if (kind === "checklist") {
      const raw = Array.isArray(input.items) ? input.items.slice(0, 500) : [];
      if (!raw.length) return { ok: false as const, error: `Add at least one reviewed ${settings.itemLabel.toLowerCase()}.`, status: 400 };
      for (let i = 0; i < raw.length; i++) {
        const it = (raw[i] || {}) as Record<string, unknown>;
        const area = program.areas.find((x) => x.id === it.areaId);
        if (!area) return { ok: false as const, error: `Row ${i + 1}: choose a process area.`, status: 400 };
        const marks: Record<string, string> = {};
        const given = (it.checks && typeof it.checks === "object" ? it.checks : {}) as Record<string, unknown>;
        for (const c of area.checks) marks[c.code] = given[c.code] === "no" ? "no" : given[c.code] === "na" ? "na" : "yes";
        const failed = Object.values(marks).filter((v) => v === "no").length;
        const defects = settings.instanceBasis === "check" ? failed : Math.max(failed, Math.min(99, Math.max(0, Math.round(Number(it.defects) || 0))));
        const nature = clean(it.nature, 120);
        if (defects > 0 && !nature) return { ok: false as const, error: `Row ${i + 1}: name the nature of the defect.`, status: 400 };
        itemRows.push({ idx: i, areaId: area.id, itemType: clean(it.itemType, 40), reference: clean(it.reference, 80), checks: marks, defects, nature: defects ? nature : "", recurring: defects > 0 && !!it.recurring, status: defects > 0 && it.status === "resolved" ? "resolved" : "open" });
      }
    } else {
      const card = await activeScorecard(tx, a.tenant);
      if (!card) return { ok: false as const, error: "There's no scorecard set up yet.", status: 400 };
      const def = card.definition as ScorecardDef;
      const given = (input.values && typeof input.values === "object" ? input.values : {}) as Record<string, unknown>;
      values = {};
      for (const m of def.measures.filter((x) => x.kind === "input")) {
        const v = given[m.key];
        if (v === "" || v == null) { values[m.key] = null; continue; }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false as const, error: `${m.label}: enter a score from 0 to 100.`, status: 400 };
        values[m.key] = Math.round(n * 100) / 100;
      }
      if (def.audit) {
        const g = clean(input.auditGrade, 3);
        if (g && AUDIT_POINTS[g] == null) return { ok: false as const, error: "Audit grade must be A, B+, B, C or D.", status: 400 };
        auditGrade = g || null;
      }
    }

    const now = new Date();
    const id = clean(input.id, 80);
    let row = id ? (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.id, id))).limit(1))[0] : undefined;
    let before: unknown = null;
    if (id && !row) return { ok: false as const, error: "Review not found.", status: 404 };
    if (row) {
      if (row.inspectorEmail !== a.email && !a.roles.includes("admin")) return { ok: false as const, error: "You can only edit your own reviews.", status: 403 };
      if (row.status === "submitted" || row.status === "published") return { ok: false as const, error: `This review is locked: it's already ${row.status}.`, status: 409 };
      before = { unitId: row.unitId, period: iso(row.period), status: row.status };
      await tx.update(reviews).set({ kind, unitId, period, entryDate, scorecardValues: values, auditGrade, updatedAt: now }).where(eq(reviews.id, row.id));
      await tx.delete(reviewItems).where(and(eq(reviewItems.companyId, a.tenant), eq(reviewItems.reviewId, row.id)));
    } else {
      const rid = randomUUID();
      const ref = await nextRef(tx, a.tenant, "review", "REV");
      await tx.insert(reviews).values({ id: rid, companyId: a.tenant, ref, kind, unitId, period, entryDate, status: "draft", inspectorEmail: a.email, scorecardValues: values, auditGrade });
      await tx.insert(reviewEvents).values({ companyId: a.tenant, reviewId: rid, status: "draft", by: a.email });
      row = (await tx.select().from(reviews).where(eq(reviews.id, rid)).limit(1))[0];
    }
    for (const it of itemRows) await tx.insert(reviewItems).values({ ...it, id: randomUUID(), companyId: a.tenant, reviewId: row!.id });
    if (input.submit) {
      await tx.update(reviews).set({ status: "submitted", note: "", submittedAt: now, updatedAt: now }).where(eq(reviews.id, row!.id));
      await tx.insert(reviewEvents).values({ companyId: a.tenant, reviewId: row!.id, status: "submitted", by: a.email });
    }
    await record(tx, a.tenant, {
      actor: a.email, action: input.submit ? "review.submit" : before ? "review.update" : "review.create", entityType: "review", entityId: row!.id,
      summary: `${row!.ref} · ${unit.name} · ${period.slice(0, 7)}${kind === "checklist" ? ` · ${itemRows.length} items, ${itemRows.reduce((s, x) => s + (x.defects ?? 0), 0)} defects` : " · scorecard"}`,
      before, after: { unitId, period, status: input.submit ? "submitted" : row!.status, items: itemRows.length, values, auditGrade }, requestId,
    });
    const fresh = (await tx.select().from(reviews).where(eq(reviews.id, row!.id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [fresh], settings))[0] };
  });
}

export async function deleteReview(a: Actor, id: string, requestId?: string): Promise<Result<true>> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.id, id))).limit(1))[0];
    if (!r) return { ok: true as const, value: true as const };
    if (r.inspectorEmail !== a.email && !a.roles.includes("admin")) return { ok: false as const, error: "You can only delete your own reviews.", status: 403 };
    if (r.status === "published") return { ok: false as const, error: "Published reviews can't be deleted.", status: 409 };
    await tx.delete(reviewItems).where(and(eq(reviewItems.companyId, a.tenant), eq(reviewItems.reviewId, id)));
    await tx.delete(reviews).where(eq(reviews.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "review.delete", entityType: "review", entityId: id, summary: `Deleted ${r.ref}`, before: { ref: r.ref, status: r.status }, requestId });
    return { ok: true as const, value: true as const };
  });
}

/** Approve (publish) or return a submitted review. */
export async function decideReview(a: Actor, id: string, decision: "approve" | "return", note: string, requestId?: string): Promise<Result<ReviewView>> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Review not found.", status: 404 };
    const block = approveBlocker(a, r);
    if (block) return { ok: false as const, error: block, status: 403 };
    if (!inScope(a, r.unitId)) return { ok: false as const, error: "This review is outside your branches.", status: 403 };
    if (r.status !== "submitted") return { ok: false as const, error: "Only submitted work can be reviewed.", status: 409 };
    const n = clean(note, 2000);
    const now = new Date();
    if (decision === "return") {
      if (!n) return { ok: false as const, error: "Say what needs changing before you return it.", status: 400 };
      await tx.update(reviews).set({ status: "returned", supervisorEmail: a.email, note: n, updatedAt: now }).where(eq(reviews.id, id));
    } else {
      await tx.update(reviews).set({ status: "published", supervisorEmail: a.email, note: n, updatedAt: now, publishedAt: now }).where(eq(reviews.id, id));
      if (r.kind === "scorecard") {
        const card = await activeScorecard(tx, a.tenant);
        if (card) {
          const def = card.definition as ScorecardDef;
          const points = r.auditGrade ? AUDIT_POINTS[r.auditGrade] ?? null : null;
          const vals = evaluate(def, (r.scorecardValues as Record<string, number | null>) || {}, points);
          const period = iso(r.period);
          await tx.insert(scorecardEntries).values({ companyId: a.tenant, scorecardId: card.id, period, unitId: r.unitId, values: vals, auditRaw: points, source: "review", reviewId: r.id })
            .onConflictDoUpdate({ target: [scorecardEntries.companyId, scorecardEntries.scorecardId, scorecardEntries.period, scorecardEntries.unitId], set: { values: vals, auditRaw: points, source: "review", reviewId: r.id } });
        }
      }
    }
    const status = decision === "return" ? "returned" : "published";
    await tx.insert(reviewEvents).values({ companyId: a.tenant, reviewId: id, status, by: a.email, note: n || null });
    await record(tx, a.tenant, { actor: a.email, action: `review.${decision}`, entityType: "review", entityId: id, summary: `${r.ref} ${status}${n ? `: ${n.slice(0, 120)}` : ""}`, before: { status: r.status }, after: { status }, requestId });
    const fresh = (await tx.select().from(reviews).where(eq(reviews.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [fresh], await loadSettings(tx, a.tenant)))[0] };
  });
}

/** Mark published defects resolved, or reopen them (supervisors and admins). */
export async function resolveItems(a: Actor, refs: { reviewId: string; idx: number }[], resolved: boolean, requestId?: string): Promise<Result<number>> {
  if (!can.resolveDefects(a)) return { ok: false, error: "Only supervisors and admins change resolution status.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    let changed = 0;
    const byReview = new Map<string, number[]>();
    for (const r of refs.slice(0, 1000)) { const i = Math.trunc(Number(r?.idx)); if (r?.reviewId && i >= 0) (byReview.get(r.reviewId) || byReview.set(r.reviewId, []).get(r.reviewId)!).push(i); }
    for (const [rid, idxs] of byReview) {
      const r = (await tx.select().from(reviews).where(and(eq(reviews.companyId, a.tenant), eq(reviews.id, rid))).limit(1))[0];
      if (!r) continue;
      if (!inScope(a, r.unitId)) return { ok: false as const, error: "Outside your branches.", status: 403 };
      if (r.status !== "published") return { ok: false as const, error: "Only published defects can be marked resolved.", status: 409 };
      const items = await tx.select().from(reviewItems).where(and(eq(reviewItems.companyId, a.tenant), eq(reviewItems.reviewId, rid), inArray(reviewItems.idx, idxs)));
      let n = 0;
      for (const it of items) {
        const next = resolved ? "resolved" : "open";
        if (it.defects > 0 && it.status !== next) {
          await tx.update(reviewItems).set({ status: next, resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? a.email : null }).where(eq(reviewItems.id, it.id));
          n++;
        }
      }
      if (n) {
        changed += n;
        await tx.update(reviews).set({ updatedAt: new Date() }).where(eq(reviews.id, rid));
        const note = `${resolved ? "Marked" : "Reopened"} ${n} defect${n === 1 ? "" : "s"}${resolved ? " resolved" : ""}`;
        await tx.insert(reviewEvents).values({ companyId: a.tenant, reviewId: rid, status: "published", by: a.email, note });
        await record(tx, a.tenant, { actor: a.email, action: resolved ? "defect.resolve" : "defect.reopen", entityType: "review", entityId: rid, summary: `${r.ref}: ${note}`, after: { items: idxs, status: resolved ? "resolved" : "open" }, requestId });
      }
    }
    return { ok: true as const, value: changed };
  });
}
