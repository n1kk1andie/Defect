// A company's templates on Postgres: create (blank, from the library, from an
// import, as a copy), edit the draft, publish a locked version, archive. Every
// change lands in the change history. Supervisors and admins build templates;
// everyone with access can read the published ones.
import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { withTenant, rowsOf, type Tx } from "@/lib/db/client";
import { inspections, scorecards, templateVersions, templates } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor } from "@/lib/roles";
import { loadProgram, loadSettings } from "@/lib/company";
import { validateTemplate, type TemplateDef } from "@/lib/templates/model";
import { libraryEntry } from "@/lib/templates/library";
import { defectsTemplate, scorecardTemplate } from "@/lib/templates/convert";
import type { ScorecardDef } from "@/lib/scorecard";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

export interface TemplateSummary {
  id: string; name: string; sector: string; category: string; description: string; status: "draft" | "published" | "archived";
  version: number; dirty: boolean; origin: string; questions: number; sections: number; sampled: boolean; binding: TemplateDef["binding"] | null;
  updatedAt: string; updatedBy: string | null; publishedAt: string | null; inspections: number;
}
export interface TemplateDetail extends TemplateSummary { draft: TemplateDef; versions: { version: number; publishedAt: string; publishedBy: string; note: string; sha256: string }[] }

const sha = (d: unknown) => createHash("sha256").update(JSON.stringify(d)).digest("hex");
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

function summary(r: typeof templates.$inferSelect, extra: { publishedAt?: Date | null; inspections?: number } = {}): TemplateSummary {
  const d = r.draft as TemplateDef;
  return {
    id: r.id, name: r.name, sector: r.sector, category: r.category, description: d.description || "", status: r.status as TemplateSummary["status"],
    version: r.version, dirty: r.dirty, origin: r.origin, questions: d.sections.reduce((t, s) => t + s.questions.length, 0), sections: d.sections.length,
    sampled: d.sections.some((s) => s.perItem), binding: d.binding ?? null, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedBy,
    publishedAt: extra.publishedAt ? extra.publishedAt.toISOString() : null, inspections: extra.inspections ?? 0,
  };
}

export async function listTemplates(a: Actor, opts: { includeDrafts?: boolean } = {}): Promise<TemplateSummary[]> {
  return withTenant(a.tenant, async (tx) => {
    const rows = await tx.select().from(templates).where(eq(templates.companyId, a.tenant)).orderBy(asc(templates.name));
    const pub = rowsOf<{ template_id: string; at: Date | string }>(await tx.execute(sql`select template_id, max(published_at) as at from template_versions group by template_id`));
    const cnt = rowsOf<{ template_id: string; n: number }>(await tx.execute(sql`select template_id, count(*)::int as n from inspections group by template_id`));
    const pubAt = new Map(pub.map((p) => [p.template_id, new Date(p.at)]));
    const n = new Map(cnt.map((c) => [c.template_id, Number(c.n)]));
    const drafts = opts.includeDrafts ?? can.buildTemplates(a);
    return rows.filter((r) => drafts || r.version > 0).map((r) => summary(r, { publishedAt: pubAt.get(r.id) ?? null, inspections: n.get(r.id) ?? 0 }));
  });
}

export async function getTemplate(a: Actor, id: string): Promise<TemplateDetail | null> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, id))).limit(1))[0];
    if (!r || (!can.buildTemplates(a) && r.version === 0)) return null;
    const versions = await tx.select().from(templateVersions).where(and(eq(templateVersions.companyId, a.tenant), eq(templateVersions.templateId, id))).orderBy(desc(templateVersions.version));
    const n = Number(rowsOf<{ n: number }>(await tx.execute(sql`select count(*)::int as n from inspections where template_id = ${id}`))[0]?.n ?? 0);
    return {
      ...summary(r, { publishedAt: versions[0]?.publishedAt ?? null, inspections: n }), draft: r.draft as TemplateDef,
      versions: versions.map((v) => ({ version: v.version, publishedAt: v.publishedAt.toISOString(), publishedBy: v.publishedBy, note: v.note, sha256: v.sha256 })),
    };
  });
}

/** A published version's definition (what an inspection is answered and scored against). */
export async function loadVersion(tx: Tx, companyId: string, templateId: string, version: number): Promise<TemplateDef | null> {
  const v = (await tx.select().from(templateVersions).where(and(eq(templateVersions.companyId, companyId), eq(templateVersions.templateId, templateId), eq(templateVersions.version, version))).limit(1))[0];
  return v ? (v.definition as TemplateDef) : null;
}

export async function insertTemplate(tx: Tx, companyId: string, def: TemplateDef, origin: string, by: string): Promise<string> {
  const id = randomUUID();
  await tx.insert(templates).values({ id, companyId, name: def.name, sector: def.sector, category: def.category, draft: def, origin, createdBy: by, updatedBy: by, status: "draft", dirty: true });
  return id;
}

export async function publishIn(tx: Tx, companyId: string, id: string, by: string, note: string, requestId?: string): Promise<Result<number>> {
  const r = (await tx.select().from(templates).where(and(eq(templates.companyId, companyId), eq(templates.id, id))).limit(1))[0];
  if (!r) return { ok: false, error: "Template not found.", status: 404 };
  const v = validateTemplate(r.draft);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  if (r.version > 0 && !r.dirty) return { ok: false, error: `Version ${r.version} is already the latest: there's nothing new to publish.`, status: 409 };
  const version = r.version + 1;
  const hash = sha(v.def);
  await tx.insert(templateVersions).values({ id: randomUUID(), companyId, templateId: id, version, definition: v.def, sha256: hash, publishedBy: by, note: clean(note, 300) });
  await tx.update(templates).set({ version, dirty: false, status: "published", draft: v.def, name: v.def.name, sector: v.def.sector, category: v.def.category, updatedAt: new Date(), updatedBy: by }).where(eq(templates.id, id));
  await record(tx, companyId, { actor: by, action: "template.publish", entityType: "template", entityId: id, summary: `${v.def.name}: version ${version} published${note ? ` (${clean(note, 120)})` : ""}`, after: { version, sha256: hash }, requestId });
  return { ok: true, value: version };
}

export interface CreateInput { from?: "blank" | "library" | "import" | "copy"; libraryKey?: unknown; def?: unknown; copyOf?: unknown; name?: unknown; sector?: unknown }

export async function createTemplate(a: Actor, input: CreateInput, requestId?: string): Promise<Result<TemplateDetail>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins build templates.", status: 403 };
  let def: TemplateDef, origin: string;
  if (input.from === "library") {
    const e = libraryEntry(String(input.libraryKey || ""));
    if (!e) return { ok: false, error: "That template isn't in the library.", status: 404 };
    def = structuredClone(e.def); origin = `library:${e.key}`;
  } else if (input.from === "copy") {
    const src = await getTemplate(a, String(input.copyOf || ""));
    if (!src) return { ok: false, error: "Template not found.", status: 404 };
    def = { ...structuredClone(src.draft), name: `${src.draft.name} (copy)`.slice(0, 120) }; delete def.binding; origin = `copy:${src.id}`;
  } else if (input.from === "import" || input.def) {
    const v = validateTemplate(input.def);
    if (!v.ok) return { ok: false, error: v.error, status: 400 };
    def = v.def; delete def.binding; origin = "import";
  } else {
    const { blankTemplate } = await import("@/lib/templates/model");
    def = blankTemplate(clean(input.name, 120) || "Untitled template", (input.sector as TemplateDef["sector"]) || "general"); origin = "custom";
  }
  const v = validateTemplate(def);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const id = await withTenant(a.tenant, async (tx) => {
    const id = await insertTemplate(tx, a.tenant, v.def, origin, a.email);
    await record(tx, a.tenant, { actor: a.email, action: "template.create", entityType: "template", entityId: id, summary: `${v.def.name} created (${origin.split(":")[0]})`, after: { name: v.def.name, origin }, requestId });
    return id;
  });
  return { ok: true, value: (await getTemplate(a, id))! };
}

/** Save the draft (autosaved by the builder). Publishing is separate. */
export async function saveDraft(a: Actor, id: string, raw: unknown, requestId?: string): Promise<Result<TemplateDetail>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins build templates.", status: 403 };
  const v = validateTemplate(raw);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const res = await withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Template not found.", status: 404 };
    const prev = r.draft as TemplateDef;
    if (prev.binding) v.def.binding = prev.binding; // a binding is set by the system, never by an edit
    if (sha(prev) === sha(v.def)) return { ok: true as const, value: true };
    const latest = r.version ? await loadVersion(tx, a.tenant, id, r.version) : null;
    const dirty = !latest || sha(latest) !== sha(v.def);
    await tx.update(templates).set({ draft: v.def, name: v.def.name, sector: v.def.sector, category: v.def.category, dirty, updatedAt: new Date(), updatedBy: a.email }).where(eq(templates.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "template.edit", entityType: "template", entityId: id, summary: `${v.def.name}: draft changed`, before: { questions: prev.sections.reduce((t, s) => t + s.questions.length, 0), name: prev.name }, after: { questions: v.def.sections.reduce((t, s) => t + s.questions.length, 0), name: v.def.name }, requestId });
    return { ok: true as const, value: true };
  });
  if (!res.ok) return res;
  return { ok: true, value: (await getTemplate(a, id))! };
}

export async function publishTemplate(a: Actor, id: string, note: string, requestId?: string): Promise<Result<TemplateDetail>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins publish templates.", status: 403 };
  const r = await withTenant(a.tenant, (tx) => publishIn(tx, a.tenant, id, a.email, note, requestId));
  if (!r.ok) return r;
  return { ok: true, value: (await getTemplate(a, id))! };
}

export async function setArchived(a: Actor, id: string, archived: boolean, requestId?: string): Promise<Result<TemplateDetail>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins archive templates.", status: 403 };
  const r = await withTenant(a.tenant, async (tx) => {
    const t = (await tx.select().from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, id))).limit(1))[0];
    if (!t) return { ok: false as const, error: "Template not found.", status: 404 };
    const status = archived ? "archived" : t.version > 0 ? "published" : "draft";
    await tx.update(templates).set({ status, updatedAt: new Date(), updatedBy: a.email }).where(eq(templates.id, id));
    await record(tx, a.tenant, { actor: a.email, action: archived ? "template.archive" : "template.restore", entityType: "template", entityId: id, summary: `${t.name} ${archived ? "archived" : "restored"}`, before: { status: t.status }, after: { status }, requestId });
    return { ok: true as const, value: true };
  });
  if (!r.ok) return r;
  return { ok: true, value: (await getTemplate(a, id))! };
}

/** Delete a template that has never been used (no inspections). Otherwise archive it. */
export async function deleteTemplate(a: Actor, id: string, requestId?: string): Promise<Result<true>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins remove templates.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const t = (await tx.select().from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, id))).limit(1))[0];
    if (!t) return { ok: true as const, value: true as const };
    const used = (await tx.select({ id: inspections.id }).from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.templateId, id))).limit(1)).length;
    if (used || t.version > 0) return { ok: false as const, error: "This template has been published, so its history is kept. Archive it instead.", status: 409 };
    await tx.delete(templates).where(eq(templates.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "template.delete", entityType: "template", entityId: id, summary: `${t.name} deleted (never published)`, before: { name: t.name }, requestId });
    return { ok: true as const, value: true as const };
  });
}

/**
 * The institution's own reviews as templates: one Branch Defects template per
 * process area and the active scorecard, published as version 1. Idempotent
 * (keyed by origin); a programme area added later gets its template next time.
 */
export async function ensureProgramTemplates(tx: Tx, companyId: string, by = "system"): Promise<number> {
  const [program, settings] = await Promise.all([loadProgram(tx, companyId), loadSettings(tx, companyId)]);
  const have = new Set((await tx.select({ origin: templates.origin }).from(templates).where(eq(templates.companyId, companyId))).map((r) => r.origin));
  let made = 0;
  for (const area of program.areas) {
    const origin = `migrated:defects:${area.id}`;
    if (have.has(origin) || !area.checks.length) continue;
    const id = await insertTemplate(tx, companyId, defectsTemplate(area, settings), origin, by);
    await publishIn(tx, companyId, id, by, "Converted from the programme");
    made++;
  }
  if (settings.scorecard) {
    const card = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.active, true))).orderBy(asc(scorecards.createdAt)).limit(1))[0];
    const origin = card ? `migrated:scorecard:${card.id}` : "";
    if (card && !have.has(origin)) {
      const id = await insertTemplate(tx, companyId, scorecardTemplate(card.definition as ScorecardDef), origin, by);
      await publishIn(tx, companyId, id, by, "Converted from the scorecard");
      made++;
    }
  }
  if (made) await record(tx, companyId, { actor: by, action: "template.convert", entityType: "template", summary: `${made} template${made === 1 ? "" : "s"} created from the existing programme and scorecard` });
  return made;
}

export async function ensureProgramTemplatesFor(companyId: string): Promise<number> {
  return withTenant(companyId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"tpl:" + companyId}))`);
    return ensureProgramTemplates(tx, companyId);
  });
}
