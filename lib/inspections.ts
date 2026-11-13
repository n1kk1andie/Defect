// Inspections and field visits: a published template version answered at one
// site for one period, on a phone, then approved by a supervisor who didn't
// carry it out (docs/quality-model.md §4 and §7).
//
//   draft → submitted → approved (or returned → resubmitted)
//
// A draft is keyed on the device with a client id, so a save retried after a
// dropped connection updates the same inspection instead of making a second.
// Approval:
//   • stores the score against the version the inspection was started on;
//   • feeds the template's binding: Branch Defects (month × site × area, as a
//     review does) or the scorecard (the month's entry for the site);
//   • raises a corrective action for each failed question set to do so (and
//     every critical failure), with the approver as the raiser — so the
//     verifier ≠ raiser rule applies to them as to any action.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { actionEvents, actions, evidence, inspectionEvents, inspections, scorecardEntries, scorecards, templates, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { approveBlocker, can, inScope, isSupervisor, type Actor } from "@/lib/roles";
import { loadSettings } from "@/lib/company";
import { loadVersion } from "@/lib/templates/store";
import { feedScorecardFromInspections } from "@/lib/scorecards/store";
import { evaluateFromInspection } from "@/lib/samplingPlans";
import { allQuestions, answerScore, scoreInspection, type Answer, type Answers, type SampledItem, type Score, type TemplateDef } from "@/lib/templates/model";
import { evaluate, type ScorecardDef } from "@/lib/scorecard";
import { AUDIT_POINTS } from "@/lib/bands";

export type InspectionStatus = "draft" | "submitted" | "returned" | "approved";
type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

export interface Signature { name: string; role?: string; data: string; at: string }
export interface Checkin { at: string; lat?: number; lng?: number; accuracy?: number }
/** What an approved inspection contributes to Branch Defects (one entry per sampled item). */
export interface DefectsFeed { kind: "defects"; areaId: string; items: { checks: Record<string, string>; defects: number; nature: string; recurring: boolean; itemType: string; reference: string }[] }
export type StoredScore = Score & { feed?: DefectsFeed };

export interface InspectionView {
  id: string; ref: string; clientId: string | null; templateId: string; templateName: string; templateVersion: number; sector: string;
  unitId: string; unitName: string; period: string; status: InspectionStatus; inspectorEmail: string; supervisorEmail: string | null;
  answers: Answers; items: SampledItem[]; signatures: { inspector?: Signature; site?: Signature }; checkin: Checkin | null;
  score: StoredScore | null; note: string; createdAt: string; updatedAt: string; submittedAt: string | null; approvedAt: string | null;
  history: { status: string; by: string; at: string; note: string | null }[];
  evidence: { id: string; name: string; size: number; contentType: string }[];
  actions: { id: string; ref: string; status: string; title: string }[];
}

const iso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

export function canSeeInspection(a: Actor, r: { inspectorEmail: string; status: string; unitId: string }): boolean {
  if (r.inspectorEmail === a.email) return true;
  if (!inScope(a, r.unitId)) return false;
  if (isSupervisor(a)) return true;
  return r.status === "approved";
}

async function view(tx: Tx, companyId: string, rows: (typeof inspections.$inferSelect)[]): Promise<InspectionView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [ev, files, unitRows, tpls, acts] = await Promise.all([
    tx.select().from(inspectionEvents).where(and(eq(inspectionEvents.companyId, companyId), inArray(inspectionEvents.inspectionId, ids))).orderBy(asc(inspectionEvents.at), asc(inspectionEvents.id)),
    tx.select().from(evidence).where(and(eq(evidence.companyId, companyId), eq(evidence.entityType, "inspection"), inArray(evidence.entityId, ids))),
    tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, companyId)),
    tx.select({ id: templates.id, name: templates.name, sector: templates.sector }).from(templates).where(eq(templates.companyId, companyId)),
    tx.select({ id: actions.id, ref: actions.ref, status: actions.status, title: actions.title, sourceId: actions.sourceId }).from(actions).where(and(eq(actions.companyId, companyId), eq(actions.sourceType, "inspection"))),
  ]);
  const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
  const tpl = new Map(tpls.map((t) => [t.id, t]));
  return rows.map((r) => ({
    id: r.id, ref: r.ref, clientId: r.clientId, templateId: r.templateId, templateName: tpl.get(r.templateId)?.name ?? "Template", templateVersion: r.templateVersion, sector: tpl.get(r.templateId)?.sector ?? "general",
    unitId: r.unitId, unitName: unitName.get(r.unitId) || "—", period: iso(r.period), status: r.status as InspectionStatus, inspectorEmail: r.inspectorEmail, supervisorEmail: r.supervisorEmail,
    answers: (r.answers as Answers) || {}, items: (r.items as SampledItem[]) || [], signatures: (r.signatures as InspectionView["signatures"]) || {}, checkin: (r.checkin as Checkin) ?? null,
    score: (r.score as StoredScore) ?? null, note: r.note, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    submittedAt: r.submittedAt?.toISOString() ?? null, approvedAt: r.approvedAt?.toISOString() ?? null,
    history: ev.filter((e) => e.inspectionId === r.id).map((e) => ({ status: e.status, by: e.by, at: e.at.toISOString(), note: e.note })),
    evidence: files.filter((f) => f.entityId === r.id).map((f) => ({ id: f.id, name: f.name, size: f.size, contentType: f.contentType })),
    actions: acts.filter((x) => x.sourceId?.startsWith(r.id + ":")).map((x) => ({ id: x.id, ref: x.ref, status: x.status, title: x.title })),
  }));
}

export async function listInspections(a: Actor, opts: { limit?: number; templateId?: string } = {}): Promise<InspectionView[]> {
  return withTenant(a.tenant, async (tx) => {
    const where = [eq(inspections.companyId, a.tenant)];
    if (opts.templateId) where.push(eq(inspections.templateId, opts.templateId));
    const rows = (await tx.select().from(inspections).where(and(...where)).orderBy(desc(inspections.updatedAt)).limit(opts.limit ?? 500)).filter((r) => canSeeInspection(a, r));
    return view(tx, a.tenant, rows);
  });
}

export async function getInspection(a: Actor, id: string): Promise<{ inspection: InspectionView; def: TemplateDef } | null> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.id, id))).limit(1))[0];
    if (!r || !canSeeInspection(a, r)) return null;
    const def = await loadVersion(tx, a.tenant, r.templateId, r.templateVersion);
    if (!def) return null;
    return { inspection: (await view(tx, a.tenant, [r]))[0], def };
  });
}

// ── cleaning what the device sends ───────────────────────────────────────────

function cleanAnswer(def: TemplateDef, qid: string, raw: unknown): Answer | null {
  const q = allQuestions(def).find((x) => x.q.id === qid)?.q;
  if (!q || !raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const a: Answer = {};
  if (o.na && q.allowNA) a.na = true;
  const v = o.v;
  if (!a.na && v !== undefined && v !== null && v !== "") {
    if (q.type === "multi") a.v = (Array.isArray(v) ? v : [v]).map((x) => clean(x, 40)).filter((x) => q.options?.some((op) => op.id === x)).slice(0, 20);
    else if (q.type === "number" || q.type === "rating") { const n = Number(v); if (Number.isFinite(n)) a.v = Math.round(n * 1e4) / 1e4; }
    else if (q.type === "choice") { const s = clean(v, 40); if (q.options?.some((op) => op.id === s)) a.v = s; }
    else if (q.type === "yesno") { if (v === "yes" || v === "no") a.v = v; }
    else if (q.type === "passfail") { if (v === "pass" || v === "fail") a.v = v; }
    else if (q.type === "date") { const s = clean(v, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(s)) a.v = s; }
    else if (q.type === "signature") { const s = String(v); if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 200_000) a.v = s; }
    else a.v = clean(v, q.type === "text" ? 4000 : 200);
  }
  const note = clean(o.note, 2000); if (note) a.note = note;
  if (Array.isArray(o.photos)) { const p = o.photos.map((x) => clean(x, 80)).filter((x) => /^[A-Za-z0-9-]{8,80}$/.test(x)).slice(0, 12); if (p.length) a.photos = p; }
  return Object.keys(a).length ? a : null;
}

function cleanAnswers(def: TemplateDef, raw: unknown, perItem: boolean): Answers {
  const out: Answers = {};
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const s of def.sections) {
    if (!!s.perItem !== perItem) continue;
    for (const q of s.questions) { const a = cleanAnswer(def, q.id, o[q.id]); if (a) out[q.id] = a; }
  }
  return out;
}

function cleanSignature(raw: unknown): Signature | undefined {
  const o = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!o) return undefined;
  const data = String(o.data || "");
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(data) || data.length > 200_000) return undefined;
  const name = clean(o.name, 120);
  if (!name) return undefined;
  const at = clean(o.at, 40);
  return { name, ...(clean(o.role, 80) ? { role: clean(o.role, 80) } : {}), data, at: Number.isNaN(Date.parse(at)) ? new Date().toISOString() : at };
}

function cleanCheckin(raw: unknown): Checkin | null {
  const o = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!o || Number.isNaN(Date.parse(String(o.at)))) return null;
  const c: Checkin = { at: new Date(String(o.at)).toISOString() };
  const lat = Number(o.lat), lng = Number(o.lng), acc = Number(o.accuracy);
  if (o.lat != null && Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180) { c.lat = Math.round(lat * 1e5) / 1e5; c.lng = Math.round(lng * 1e5) / 1e5; if (Number.isFinite(acc)) c.accuracy = Math.round(acc); }
  return c;
}

const missingText = (s: Score, itemLabel: string) => {
  const m = s.missing[0];
  const where = m.item !== null ? ` (${itemLabel.toLowerCase()} ${m.item + 1})` : "";
  const what = m.why === "photo" ? "needs a photo, because it failed" : m.why === "note" ? "needs a note, because it failed" : "needs an answer";
  return `“${m.label.slice(0, 80)}”${where} ${what}${s.missing.length > 1 ? `, and ${s.missing.length - 1} more` : ""}.`;
};

export interface InspectionInput { id?: unknown; clientId?: unknown; templateId?: unknown; unitId?: unknown; period?: unknown; answers?: unknown; items?: unknown; signatures?: unknown; checkin?: unknown; submit?: unknown }

/** Create or update a draft, optionally submitting it. Idempotent on clientId. */
export async function saveInspection(a: Actor, input: InspectionInput, requestId?: string): Promise<Result<InspectionView>> {
  if (!can.inspect(a)) return { ok: false, error: "Your role doesn't carry out inspections.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const settings = await loadSettings(tx, a.tenant);
    const id = clean(input.id, 80);
    const clientId = clean(input.clientId, 80) || null;
    let row = id ? (await tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.id, id))).limit(1))[0] : undefined;
    if (id && !row) return { ok: false as const, error: "Inspection not found.", status: 404 };
    if (!row && clientId) row = (await tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.clientId, clientId))).limit(1))[0];
    if (row) {
      if (row.inspectorEmail !== a.email && !a.roles.includes("admin")) return { ok: false as const, error: "You can only change your own inspections.", status: 403 };
      if (row.status === "submitted" || row.status === "approved") {
        // A retry of a submit that already landed is not an error.
        if (input.submit && row.status === "submitted") return { ok: true as const, value: (await view(tx, a.tenant, [row]))[0] };
        return { ok: false as const, error: `This inspection is locked: it's already ${row.status}.`, status: 409 };
      }
    }
    const templateId = row?.templateId ?? clean(input.templateId, 80);
    const t = (await tx.select().from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, templateId))).limit(1))[0];
    if (!t) return { ok: false as const, error: "Choose a template.", status: 400 };
    if (!row && (t.version === 0 || t.status === "archived")) return { ok: false as const, error: "That template isn't published.", status: 400 };
    const version = row?.templateVersion ?? t.version;
    const def = await loadVersion(tx, a.tenant, templateId, version);
    if (!def) return { ok: false as const, error: "That template version is missing.", status: 500 };
    const unitId = clean(input.unitId, 80) || row?.unitId || "";
    const unit = (await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.id, unitId))).limit(1))[0];
    if (!unit || !unit.active) return { ok: false as const, error: `Choose a ${settings.unitLabel.toLowerCase()}.`, status: 400 };
    if (!inScope(a, unitId)) return { ok: false as const, error: `${unit.name} isn't one of your ${settings.unitPlural.toLowerCase()}.`, status: 403 };
    const period = clean(input.period, 10) || (row ? iso(row.period) : "");
    if (!/^\d{4}-\d{2}-01$/.test(period)) return { ok: false as const, error: "Choose the month this inspection covers.", status: 400 };

    const answers = cleanAnswers(def, input.answers, false);
    const sampled = def.sections.some((s) => s.perItem);
    const rawItems = Array.isArray(input.items) ? input.items : [];
    const maxItems = def.sampling?.max ?? 200;
    if (sampled && rawItems.length > maxItems) return { ok: false as const, error: `Up to ${maxItems} ${def.sampling?.itemLabel.toLowerCase() ?? "item"}s.`, status: 400 };
    const items: SampledItem[] = sampled ? rawItems.slice(0, maxItems).map((it: any) => ({ ref: clean(it?.ref, 80), answers: cleanAnswers(def, it?.answers, true) })) : [];
    const sig = (input.signatures && typeof input.signatures === "object" ? input.signatures : {}) as Record<string, unknown>;
    const signatures: InspectionView["signatures"] = {};
    const si = cleanSignature(sig.inspector), ss = cleanSignature(sig.site);
    if (si) signatures.inspector = si;
    if (ss) signatures.site = ss;
    const checkin = cleanCheckin(input.checkin) ?? ((row?.checkin as Checkin) || null);
    const score = scoreInspection(def, answers, items);

    if (input.submit) {
      if (score.missing.length) return { ok: false as const, error: missingText(score, def.sampling?.itemLabel ?? "Item"), status: 400 };
      if (sampled && items.length < (def.sampling?.min ?? 1)) return { ok: false as const, error: `Add at least ${def.sampling?.min ?? 1} ${(def.sampling?.itemLabel ?? "item").toLowerCase()}.`, status: 400 };
      if (def.signatures.inspector && !signatures.inspector) return { ok: false as const, error: "Sign the inspection before you submit it.", status: 400 };
      if (def.signatures.site && !signatures.site) return { ok: false as const, error: `Ask the ${settings.unitLabel.toLowerCase()} manager to sign before you submit.`, status: 400 };
    }
    const now = new Date();
    const status: InspectionStatus = input.submit ? "submitted" : (row?.status as InspectionStatus) ?? "draft";
    const patch = { unitId, period, answers, items, signatures, checkin, score, updatedAt: now, ...(input.submit ? { status, note: "", submittedAt: now } : {}) };
    let ref: string;
    let iid: string;
    if (row) {
      await tx.update(inspections).set(patch).where(eq(inspections.id, row.id));
      iid = row.id; ref = row.ref;
    } else {
      iid = randomUUID(); ref = await nextRef(tx, a.tenant, "inspection", "INS");
      await tx.insert(inspections).values({ id: iid, companyId: a.tenant, ref, clientId, templateId, templateVersion: version, inspectorEmail: a.email, status: "draft", ...patch, ...(input.submit ? {} : { status: "draft" }) });
      await tx.insert(inspectionEvents).values({ companyId: a.tenant, inspectionId: iid, status: "draft", by: a.email });
    }
    if (input.submit) await tx.insert(inspectionEvents).values({ companyId: a.tenant, inspectionId: iid, status: "submitted", by: a.email });
    await record(tx, a.tenant, {
      actor: a.email, action: input.submit ? "inspection.submit" : row ? "inspection.update" : "inspection.create", entityType: "inspection", entityId: iid,
      summary: `${ref} · ${def.name} v${version} · ${unit.name} · ${period.slice(0, 7)}${score.pct !== null ? ` · ${score.pct}%` : ""}${score.findings.length ? ` · ${score.findings.length} failed` : ""}`,
      before: row ? { status: row.status } : null, after: { status, score: score.pct, result: score.result, findings: score.findings.length, items: items.length }, requestId,
    });
    const fresh = (await tx.select().from(inspections).where(eq(inspections.id, iid)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [fresh]))[0] };
  });
}

export async function deleteInspection(a: Actor, id: string, requestId?: string): Promise<Result<true>> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.id, id))).limit(1))[0];
    if (!r) return { ok: true as const, value: true as const };
    if (r.inspectorEmail !== a.email && !a.roles.includes("admin")) return { ok: false as const, error: "You can only delete your own inspections.", status: 403 };
    if (r.status !== "draft" && r.status !== "returned") return { ok: false as const, error: "Only a draft can be deleted.", status: 409 };
    await tx.delete(inspectionEvents).where(and(eq(inspectionEvents.companyId, a.tenant), eq(inspectionEvents.inspectionId, id)));
    await tx.delete(inspections).where(eq(inspections.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "inspection.delete", entityType: "inspection", entityId: id, summary: `Deleted draft ${r.ref}`, before: { ref: r.ref, status: r.status }, requestId });
    return { ok: true as const, value: true as const };
  });
}

/** What a defects-bound inspection contributes to Branch Defects. */
export function defectsFeed(def: TemplateDef, items: SampledItem[]): DefectsFeed | undefined {
  if (def.binding?.kind !== "defects") return undefined;
  const sec = def.sections.find((s) => s.perItem);
  if (!sec) return undefined;
  const checks = sec.questions.filter((q) => q.key && !q.key.startsWith("@") && (q.type === "passfail" || q.type === "yesno"));
  const byKey = (k: string) => sec.questions.find((q) => q.key === k);
  return {
    kind: "defects", areaId: def.binding.areaId,
    items: items.map((it) => {
      const marks: Record<string, string> = {};
      for (const q of checks) { const o = answerScore(q, it.answers[q.id]).outcome; marks[q.key!] = o === "fail" ? "no" : o === "na" ? "na" : "yes"; }
      const defects = Object.values(marks).filter((v) => v === "no").length;
      const typeQ = byKey("@itemType"), natQ = byKey("@nature"), recQ = byKey("@recurring");
      const itemType = typeQ ? typeQ.options?.find((o) => o.id === it.answers[typeQ.id]?.v)?.label ?? "" : "";
      return { checks: marks, defects, nature: defects && natQ ? String(it.answers[natQ.id]?.v ?? "") : "", recurring: defects > 0 && !!recQ && it.answers[recQ.id]?.v === "yes", itemType, reference: it.ref };
    }),
  };
}

/** Approve (publish) or return a submitted inspection. */
export async function decideInspection(a: Actor, id: string, decision: "approve" | "return", note: string, requestId?: string): Promise<Result<InspectionView>> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Inspection not found.", status: 404 };
    const block = approveBlocker(a, r, "inspection");
    if (block) return { ok: false as const, error: block, status: 403 };
    if (!inScope(a, r.unitId)) return { ok: false as const, error: "This inspection is outside your sites.", status: 403 };
    if (r.status !== "submitted") return { ok: false as const, error: "Only a submitted inspection can be approved or returned.", status: 409 };
    const n = clean(note, 2000);
    const now = new Date();
    if (decision === "return") {
      if (!n) return { ok: false as const, error: "Say what needs changing before you return it.", status: 400 };
      await tx.update(inspections).set({ status: "returned", supervisorEmail: a.email, note: n, updatedAt: now }).where(eq(inspections.id, id));
    } else {
      const def = (await loadVersion(tx, a.tenant, r.templateId, r.templateVersion))!;
      const items = (r.items as SampledItem[]) || [];
      const answers = (r.answers as Answers) || {};
      const score: StoredScore = scoreInspection(def, answers, items);
      const feed = defectsFeed(def, items);
      if (feed) score.feed = feed;
      await tx.update(inspections).set({ status: "approved", supervisorEmail: a.email, note: n, score, updatedAt: now, approvedAt: now }).where(eq(inspections.id, id));
      if (def.binding?.kind === "scorecard") await writeScorecard(tx, a.tenant, def, answers, r.unitId, iso(r.period), id);
      await feedScorecardFromInspections(tx, a.tenant, r.templateId, r.unitId, iso(r.period));
      await evaluateFromInspection(tx, a.tenant, r.id, score.items, score.deviations, a.email);
      await raiseActions(tx, a, r, def, score, requestId);
    }
    const status = decision === "return" ? "returned" : "approved";
    await tx.insert(inspectionEvents).values({ companyId: a.tenant, inspectionId: id, status, by: a.email, note: n || null });
    await record(tx, a.tenant, { actor: a.email, action: `inspection.${decision}`, entityType: "inspection", entityId: id, summary: `${r.ref} ${status}${n ? `: ${n.slice(0, 120)}` : ""}`, before: { status: r.status }, after: { status }, requestId });
    const fresh = (await tx.select().from(inspections).where(eq(inspections.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [fresh]))[0] };
  });
}

async function writeScorecard(tx: Tx, companyId: string, def: TemplateDef, answers: Answers, unitId: string, period: string, inspectionId: string) {
  const card = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0];
  if (!card) return;
  const sc = card.definition as ScorecardDef;
  const inputs: Record<string, number | null> = {};
  let points: number | null = null;
  for (const { q } of allQuestions(def)) {
    if (!q.key) continue;
    const a = answers[q.id];
    if (q.key === "@audit") { const label = q.options?.find((o) => o.id === a?.v)?.label; points = label ? AUDIT_POINTS[label] ?? null : null; continue; }
    const v = Number(a?.v);
    inputs[q.key] = !a || a.na || a.v === undefined || !Number.isFinite(v) ? null : Math.max(0, Math.min(100, v));
  }
  const vals = evaluate(sc, inputs, points);
  await tx.insert(scorecardEntries).values({ companyId, scorecardId: card.id, period, unitId, values: vals, auditRaw: points, source: "inspection", reviewId: inspectionId })
    .onConflictDoUpdate({ target: [scorecardEntries.companyId, scorecardEntries.scorecardId, scorecardEntries.period, scorecardEntries.unitId], set: { values: vals, auditRaw: points, source: "inspection", reviewId: inspectionId } });
}

/** One corrective action per failed question that asks for one (all critical failures do), across every sampled item it failed on. */
async function raiseActions(tx: Tx, a: Actor, r: typeof inspections.$inferSelect, def: TemplateDef, score: Score, requestId?: string) {
  const unit = (await tx.select().from(units).where(eq(units.id, r.unitId)).limit(1))[0];
  const settings = await loadSettings(tx, a.tenant);
  const byQ = new Map<string, Score["findings"]>();
  for (const f of score.findings) (byQ.get(f.questionId) || byQ.set(f.questionId, []).get(f.questionId)!).push(f);
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  // Earlier actions raised at this site from this checklist: a question that fails again reopens its action (recurrence) instead of raising a new one.
  const prior = (await tx.select().from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.unitId, r.unitId), eq(actions.sourceType, "inspection"))))
    .filter((x) => x.sourceId && !x.sourceId.startsWith(r.id + ":"));
  const priorIns = prior.length ? await tx.select({ id: inspections.id, templateId: inspections.templateId }).from(inspections).where(and(eq(inspections.companyId, a.tenant), inArray(inspections.id, Array.from(new Set(prior.map((x) => x.sourceId!.split(":")[0])))))) : [];
  const tplOf = new Map(priorIns.map((i) => [i.id, i.templateId]));
  const sameChecklist = prior.filter((x) => tplOf.get(x.sourceId!.split(":")[0]) === r.templateId).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  for (const [qid, fs] of byQ) {
    const q = allQuestions(def).find((x) => x.q.id === qid)!.q;
    if (!q.action?.auto && !q.critical) continue;
    const sourceId = `${r.id}:${qid}`;
    const exists = (await tx.select({ id: actions.id }).from(actions).where(and(eq(actions.companyId, a.tenant), eq(actions.sourceType, "inspection"), eq(actions.sourceId, sourceId))).limit(1)).length;
    if (exists) continue;
    const earlier = sameChecklist.find((x) => x.sourceId!.endsWith(":" + qid) && (x.status !== "closed" || (x.closedAt && now.getTime() - x.closedAt.getTime() < 365 * 864e5)));
    if (earlier) {
      if (earlier.status === "closed") {
        const eff = earlier.effectiveness as { status?: string } | null;
        const effectiveness = eff && (eff.status === "pending" || eff.status === "due") ? { ...eff, status: "ineffective", checkedAt: now.toISOString(), by: a.email, note: `Failed again on ${r.ref}.`, inspectionRef: r.ref } : eff;
        await tx.update(actions).set({ status: "in_progress", closedAt: null, verifiedBy: null, verifiedAt: null, reopenCount: earlier.reopenCount + 1, effectiveness, updatedAt: now }).where(eq(actions.id, earlier.id));
        await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: earlier.id, kind: "status", status: "in_progress", by: a.email, note: `Reopened: "${q.label.slice(0, 120)}" failed again on ${r.ref}.` });
        await record(tx, a.tenant, { actor: a.email, action: "action.recurred", entityType: "action", entityId: earlier.id, summary: `${earlier.ref} reopened: the finding recurred on ${r.ref}`, before: { status: "closed" }, after: { status: "in_progress", reopenCount: earlier.reopenCount + 1 }, requestId });
      } else {
        await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: earlier.id, kind: "comment", status: null, by: a.email, note: `Failed again on ${r.ref} while this action is still open.` });
        await tx.update(actions).set({ updatedAt: now }).where(eq(actions.id, earlier.id));
      }
      continue;
    }
    const id = randomUUID();
    const ref = await nextRef(tx, a.tenant, "action", "ACT");
    const itemLabel = def.sampling?.itemLabel ?? "item";
    const where = fs[0].item !== null ? ` on ${fs.length} ${itemLabel.toLowerCase()}${fs.length === 1 ? "" : "s"}${fs.some((f) => f.itemRef) ? ` (${fs.map((f) => f.itemRef).filter(Boolean).slice(0, 8).join(", ")}${fs.length > 8 ? "…" : ""})` : ""}` : "";
    const notes = fs.map((f) => f.note).filter(Boolean).slice(0, 3).join(" · ");
    const details = [`Failed in ${r.ref} (${def.name}, version ${r.templateVersion})${where}.`, q.critical ? "Critical: this failure fails the inspection." : "", q.reference ? `Standard: ${q.reference}.` : "", notes ? `Inspector's notes: ${notes}` : "", q.guidance ? `Guidance: ${q.guidance}` : ""].filter(Boolean).join("\n");
    const v = {
      id, companyId: a.tenant, ref, kind: "corrective", unitId: r.unitId, areaId: def.binding?.kind === "defects" ? def.binding.areaId : null,
      title: (q.critical ? "Critical: " : "") + q.label.slice(0, 150), details, rootCause: "", priority: q.action?.priority ?? "high",
      ownerEmail: null, ownerName: `${unit?.name ?? ""} ${settings.unitLabel.toLowerCase()} manager`.trim(), dueDate: addDays(today, q.action?.dueDays ?? 14),
      status: "open", raisedBy: a.email, sourceType: "inspection", sourceId, effectivenessDays: 30,
    };
    await tx.insert(actions).values(v);
    await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: id, kind: "status", status: "open", by: a.email, note: `Raised from ${r.ref}` });
    await record(tx, a.tenant, { actor: a.email, action: "action.create", entityType: "action", entityId: id, summary: `${ref} raised from ${r.ref}: ${v.title}`, after: { ref, title: v.title, sourceId }, requestId });
  }
  // Effectiveness checks: a closed action's check passes when a re-inspection of the same checklist, on or after its check date, answers its questions without failing them.
  const failed = new Set(score.findings.map((f) => f.questionId));
  const answered = (qid: string) => { const top = (r.answers as Answers)?.[qid]; if (top && !top.na) return true; return ((r.items as SampledItem[]) || []).some((it) => it.answers?.[qid] && !it.answers[qid].na); };
  for (const x of sameChecklist) {
    const eff = x.effectiveness as { status?: string; due?: string; questionIds?: string[] } | null;
    if (x.status !== "closed" || !eff || (eff.status !== "pending" && eff.status !== "due") || !eff.due || today < eff.due) continue;
    const qs = eff.questionIds ?? [];
    if (!qs.length || qs.some((qid) => failed.has(qid)) || !qs.every(answered)) continue;
    await tx.update(actions).set({ effectiveness: { ...eff, status: "effective", checkedAt: now.toISOString(), by: a.email, note: `Passed on re-inspection ${r.ref}.`, inspectionRef: r.ref }, updatedAt: now }).where(eq(actions.id, x.id));
    await tx.insert(actionEvents).values({ companyId: a.tenant, actionId: x.id, kind: "effectiveness", status: null, by: a.email, note: `Effective: passed on re-inspection ${r.ref}.` });
    await record(tx, a.tenant, { actor: a.email, action: "action.effective", entityType: "action", entityId: x.id, summary: `${x.ref}: effective, passed on re-inspection ${r.ref}`, requestId });
  }
}
