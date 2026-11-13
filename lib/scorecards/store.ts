// Scorecards a company designs: create (from the sector library, a copy or
// blank), edit the draft in the designer, publish a locked version, choose the
// one the dashboards show. Measures can be keyed monthly, computed from other
// measures, or taken from approved inspections of a checklist (fed when an
// inspection is approved). Every change lands in the change history.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { inspections, scorecardEntries, scorecardVersions, scorecards, templates } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor } from "@/lib/roles";
import { evaluate, validateDefinition, type ScorecardDef } from "@/lib/scorecard";
import { resolveLibraryScorecard, scorecardEntry } from "@/lib/scorecards/library";
import type { Score } from "@/lib/templates/model";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const iso = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

export interface ScorecardView {
  id: string; name: string; active: boolean; version: number; dirty: boolean; origin: string;
  definition: ScorecardDef; draft: ScorecardDef; entries: number; updatedAt: string | null; updatedBy: string | null;
  versions: { version: number; publishedAt: string; publishedBy: string }[];
}

async function views(tx: Tx, companyId: string, rows: (typeof scorecards.$inferSelect)[]): Promise<ScorecardView[]> {
  const out: ScorecardView[] = [];
  for (const r of rows) {
    const vs = await tx.select().from(scorecardVersions).where(and(eq(scorecardVersions.companyId, companyId), eq(scorecardVersions.scorecardId, r.id))).orderBy(desc(scorecardVersions.version));
    const n = (await tx.select({ id: scorecardEntries.id }).from(scorecardEntries).where(and(eq(scorecardEntries.companyId, companyId), eq(scorecardEntries.scorecardId, r.id))).limit(100000)).length;
    out.push({
      id: r.id, name: r.name, active: r.active, version: r.version, dirty: r.dirty, origin: r.origin,
      definition: r.definition as ScorecardDef, draft: (r.draft as ScorecardDef) ?? (r.definition as ScorecardDef), entries: n,
      updatedAt: (r.updatedAt ?? r.createdAt).toISOString(), updatedBy: r.updatedBy ?? r.createdBy,
      versions: vs.length ? vs.map((v) => ({ version: v.version, publishedAt: v.publishedAt.toISOString(), publishedBy: v.publishedBy })) : r.version > 0 ? [{ version: r.version, publishedAt: r.createdAt.toISOString(), publishedBy: r.createdBy || "system" }] : [],
    });
  }
  return out;
}

export async function listScorecards(a: Actor): Promise<ScorecardView[]> {
  return withTenant(a.tenant, async (tx) => views(tx, a.tenant, await tx.select().from(scorecards).where(eq(scorecards.companyId, a.tenant)).orderBy(desc(scorecards.active), asc(scorecards.createdAt))));
}

export async function getScorecard(a: Actor, id: string): Promise<ScorecardView | null> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, a.tenant), eq(scorecards.id, id))).limit(1))[0];
    return r ? (await views(tx, a.tenant, [r]))[0] : null;
  });
}

/** The company's library checklists, by library key → template id (to link checklist measures). */
async function templateIdsByKey(tx: Tx, companyId: string): Promise<Map<string, string>> {
  const rows = await tx.select({ id: templates.id, origin: templates.origin }).from(templates).where(eq(templates.companyId, companyId));
  return new Map(rows.filter((r) => r.origin.startsWith("library:")).map((r) => [r.origin.slice(8), r.id]));
}

export async function createScorecardIn(tx: Tx, companyId: string, by: string, input: { from?: string; libraryKey?: string; copyOf?: string; name?: string }, requestId?: string): Promise<Result<string>> {
  let def: ScorecardDef, origin: string;
  if (input.from === "library") {
    const e = scorecardEntry(String(input.libraryKey || ""));
    if (!e) return { ok: false, error: "That scorecard isn't in the library.", status: 404 };
    def = resolveLibraryScorecard(e, await templateIdsByKey(tx, companyId)); origin = `library:${e.key}`;
  } else if (input.from === "copy") {
    const src = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.id, String(input.copyOf || "")))).limit(1))[0];
    if (!src) return { ok: false, error: "Scorecard not found.", status: 404 };
    def = { ...structuredClone((src.draft ?? src.definition) as ScorecardDef), name: `${(src.definition as ScorecardDef).name} (copy)`.slice(0, 80) }; origin = `copy:${src.id}`;
  } else {
    def = { name: String(input.name || "New scorecard").slice(0, 80), target: 90, audit: false, overall: "overall", measures: [{ key: "measure1", label: "First measure", kind: "input", group: "Measures" }, { key: "overall", label: "Overall score", kind: "computed", of: ["measure1"] }], columns: [{ key: "overall", label: "Overall score" }] };
    origin = "custom";
  }
  const v = validateDefinition(def);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const id = randomUUID();
  await tx.insert(scorecards).values({ id, companyId, name: v.def.name, version: 0, definition: v.def, draft: v.def, dirty: true, active: false, origin, createdBy: by, updatedAt: new Date(), updatedBy: by });
  await record(tx, companyId, { actor: by, action: "scorecard.create", entityType: "scorecard", entityId: id, summary: `${v.def.name} created (${origin.split(":")[0]})`, after: { name: v.def.name, origin }, requestId });
  return { ok: true, value: id };
}

export async function createScorecard(a: Actor, input: { from?: string; libraryKey?: string; copyOf?: string; name?: string }, requestId?: string): Promise<Result<ScorecardView>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin designs scorecards.", status: 403 };
  const r = await withTenant(a.tenant, (tx) => createScorecardIn(tx, a.tenant, a.email, input, requestId));
  if (!r.ok) return r;
  return { ok: true, value: (await getScorecard(a, r.value))! };
}

export async function saveScorecardDraft(a: Actor, id: string, raw: unknown, requestId?: string): Promise<Result<ScorecardView>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin designs scorecards.", status: 403 };
  const v = validateDefinition(raw);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const r = await withTenant(a.tenant, async (tx) => {
    const s = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, a.tenant), eq(scorecards.id, id))).limit(1))[0];
    if (!s) return { ok: false as const, error: "Scorecard not found.", status: 404 };
    const same = JSON.stringify(s.draft ?? s.definition) === JSON.stringify(v.def);
    if (same) return { ok: true as const, value: true };
    const dirty = s.version === 0 || JSON.stringify(s.definition) !== JSON.stringify(v.def);
    await tx.update(scorecards).set({ draft: v.def, dirty, updatedAt: new Date(), updatedBy: a.email, ...(s.version === 0 ? { name: v.def.name, definition: v.def } : {}) }).where(eq(scorecards.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "scorecard.edit", entityType: "scorecard", entityId: id, summary: `${v.def.name}: draft changed (${v.def.measures.length} measures)`, before: { measures: ((s.draft ?? s.definition) as ScorecardDef).measures.length }, after: { measures: v.def.measures.length }, requestId });
    return { ok: true as const, value: true };
  });
  if (!r.ok) return r;
  return { ok: true, value: (await getScorecard(a, id))! };
}

/** Freeze the draft as the next version; it becomes what the dashboards and entries use. */
export async function publishScorecard(a: Actor, id: string, opts: { activate?: boolean } = {}, requestId?: string): Promise<Result<ScorecardView>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin publishes scorecards.", status: 403 };
  const r = await withTenant(a.tenant, async (tx) => {
    const s = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, a.tenant), eq(scorecards.id, id))).limit(1))[0];
    if (!s) return { ok: false as const, error: "Scorecard not found.", status: 404 };
    if (s.version > 0 && !s.dirty) return { ok: false as const, error: `Version ${s.version} is already the latest.`, status: 409 };
    const v = validateDefinition(s.draft ?? s.definition);
    if (!v.ok) return { ok: false as const, error: v.error, status: 400 };
    const have = await tx.select({ version: scorecardVersions.version }).from(scorecardVersions).where(and(eq(scorecardVersions.companyId, a.tenant), eq(scorecardVersions.scorecardId, id)));
    // A scorecard from before versioning gets its current definition recorded as the version it was.
    if (s.version > 0 && !have.some((h) => h.version === s.version)) await tx.insert(scorecardVersions).values({ id: randomUUID(), companyId: a.tenant, scorecardId: id, version: s.version, definition: s.definition, publishedBy: s.createdBy || "system", publishedAt: s.createdAt });
    const version = s.version + 1;
    await tx.insert(scorecardVersions).values({ id: randomUUID(), companyId: a.tenant, scorecardId: id, version, definition: v.def, publishedBy: a.email });
    if (opts.activate) await tx.update(scorecards).set({ active: false }).where(eq(scorecards.companyId, a.tenant));
    await tx.update(scorecards).set({ name: v.def.name, definition: v.def, draft: v.def, version, dirty: false, updatedAt: new Date(), updatedBy: a.email, ...(opts.activate ? { active: true } : {}) }).where(eq(scorecards.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "scorecard.publish", entityType: "scorecard", entityId: id, summary: `${v.def.name}: version ${version} published${opts.activate ? " and shown on the dashboards" : ""}`, after: { version }, requestId });
    return { ok: true as const, value: true };
  });
  if (!r.ok) return r;
  return { ok: true, value: (await getScorecard(a, id))! };
}

/** The scorecard the dashboards show (one at a time). */
export async function activateScorecard(a: Actor, id: string, requestId?: string): Promise<Result<ScorecardView>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin chooses the scorecard.", status: 403 };
  const r = await withTenant(a.tenant, async (tx) => {
    const s = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, a.tenant), eq(scorecards.id, id))).limit(1))[0];
    if (!s) return { ok: false as const, error: "Scorecard not found.", status: 404 };
    if (s.version === 0) return { ok: false as const, error: "Publish it first.", status: 409 };
    await tx.update(scorecards).set({ active: false }).where(eq(scorecards.companyId, a.tenant));
    await tx.update(scorecards).set({ active: true }).where(eq(scorecards.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "scorecard.activate", entityType: "scorecard", entityId: id, summary: `${s.name} is now the scorecard on the dashboards` });
    return { ok: true as const, value: true };
  });
  if (!r.ok) return r;
  return { ok: true, value: (await getScorecard(a, id))! };
}

/** After an inspection is approved: refresh the active scorecard's measures that read that checklist, for that site and month. */
export async function feedScorecardFromInspections(tx: Tx, companyId: string, templateId: string, unitId: string, period: string): Promise<void> {
  const card = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0];
  if (!card) return;
  const def = card.definition as ScorecardDef;
  const fed = def.measures.filter((m) => m.kind === "inspection" && m.source?.templateId === templateId);
  if (!fed.length) return;
  const rows = await tx.select({ score: inspections.score }).from(inspections).where(and(eq(inspections.companyId, companyId), eq(inspections.templateId, templateId), eq(inspections.unitId, unitId), eq(inspections.period, period), eq(inspections.status, "approved")));
  const scores = rows.map((r) => r.score as Score | null).filter((s): s is Score => !!s);
  if (!scores.length) return;
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 100) / 100 : null);
  const metric = (m: (typeof fed)[number]) => {
    const kind = m.source!.metric;
    if (kind === "passRate") return mean(scores.map((s) => (s.result === "pass" ? 100 : 0)));
    if (kind === "compliance") return mean(scores.map((s) => (s.items ? 100 * (1 - s.deviations / s.items) : s.opportunities ? 100 * (1 - s.defects / s.opportunities) : s.pct ?? 0)));
    return mean(scores.map((s) => s.pct).filter((x): x is number => x !== null));
  };
  const existing = (await tx.select().from(scorecardEntries).where(and(eq(scorecardEntries.companyId, companyId), eq(scorecardEntries.scorecardId, card.id), eq(scorecardEntries.period, period), eq(scorecardEntries.unitId, unitId))).limit(1))[0];
  const inputs: Record<string, number | null> = { ...((existing?.values as Record<string, number | null>) ?? {}) };
  for (const m of fed) inputs[m.key] = metric(m);
  const vals = evaluate(def, inputs, existing?.auditRaw ?? null);
  await tx.insert(scorecardEntries).values({ companyId, scorecardId: card.id, period: iso(period), unitId, values: vals, auditRaw: existing?.auditRaw ?? null, source: "inspection" })
    .onConflictDoUpdate({ target: [scorecardEntries.companyId, scorecardEntries.scorecardId, scorecardEntries.period, scorecardEntries.unitId], set: { values: vals, source: "inspection" } });
}
