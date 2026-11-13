// Moving the previous version's data into the database.
//
// Sources (read only; nothing in Blob is changed or deleted, so the previous
// version keeps working until the switch-over, and is the way back):
//   the institution  defects.json / opstd.json (else the bundled consolidated
//                    workbooks), submissions.json, actions.json and their
//                    attachment-<id> files, at the root of the store;
//   a company        companies/<id>/program.json, submissions.json,
//                    actions.json and attachments.
//
// 1. preview(): a dry run. Reads everything, builds the full plan, checks it,
//    and compares the dashboard figures the old app showed with the figures the
//    new one will show. Stored as an import in "preview".
// 2. commit(): only after an admin confirms that preview. Writes it all in one
//    transaction (all or nothing), then copies the evidence files.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { actionEvents, actions, evidence, imports, members, monthlyStats, reviewEvents, reviewItems, reviews, scorecardEntries, scorecards } from "@/lib/db/schema";
import { ensureAreas, ensureUnits, loadSettings, OWN, setAreaChecklist, writeSettings } from "@/lib/company";
import { record } from "@/lib/audit";
import { getStorage } from "@/lib/storage";
import { cleanSettings, type CompanySettings, type Severity } from "@/lib/settings";
import { OPERATIONAL_STANDARD } from "@/lib/scorecard";
import { AUDIT_POINTS } from "@/lib/bands";
import { record as recOf } from "@/lib/metrics";
import { nextRef } from "@/lib/refs";
import { isRole, type Actor, type Role } from "@/lib/roles";
import { INSTITUTION } from "@/institution";
import { seedDefects, seedOpstd } from "@/institution/data";

// ── plan ─────────────────────────────────────────────────────────────────────

export interface PlanReview {
  legacyId: string; kind: "checklist" | "scorecard"; unit: string; period: string; entryDate: string; status: string;
  inspector: string; supervisor: string | null; note: string; createdAt: string; updatedAt: string;
  items: { area: string; itemType: string; checks: Record<string, string>; defects: number; nature: string; recurring: boolean; status: string }[];
  values: Record<string, number | null> | null; auditGrade: string | null;
  history: { status: string; by: string; at: string; note?: string }[];
  files: { id: string; name: string; size: number; type: string }[];
}
export interface PlanAction {
  legacyId: string; ref: string; unit: string; area: string | null; title: string; details: string; priority: string; owner: string; dueDate: string;
  status: string; closureNote: string; createdBy: string; verifiedBy: string | null; createdAt: string; updatedAt: string;
  history: { status: string; by: string; at: string; note?: string }[];
  files: { id: string; name: string; size: number; type: string }[];
}
export interface Plan {
  source: string;
  settings: Partial<CompanySettings>;
  units: string[];
  areas: string[];
  checklists: { area: string; checks: { code: string; label: string; severity: Severity }[]; natures: string[] }[];
  members: { email: string; roles: Role[]; units: string[] }[];
  /** [period, unit, area, reviewed, instances, defects, resolvable, resolved, recurring] */
  stats: [string, string, string, number, number, number, number, number, number][];
  scorecard: { entries: [string, string, Record<string, number | null>, number | null][] } | null;
  reviews: PlanReview[];
  actions: PlanAction[];
  warnings: string[];
}

export interface PlanSummary {
  source: string;
  counts: Record<string, number>;
  /** Headline figures: as the previous version computed them, and as this one will. */
  figures: { label: string; before: string; after: string; same: boolean }[];
  warnings: string[];
  notCarried: string[];
}

// The institution's five control checks (the original register's columns).
const INSTITUTION_CHECKS: { code: string; label: string; severity: Severity }[] = [
  { code: "memberVerified", label: "Member verified", severity: "major" },
  { code: "cardKeyedCMS", label: "Card keyed to CMS", severity: "major" },
  { code: "cmsSigMatch", label: "CMS and signature match", severity: "major" },
  { code: "idCapture", label: "ID capture updated", severity: "major" },
  { code: "formCompleted", label: "Form completed", severity: "major" },
];
const OPSTD_COLUMN_KEYS = OPERATIONAL_STANDARD.columns.map((c) => c.key);
const LETTER_FOR_POINTS = Object.fromEntries(Object.entries(AUDIT_POINTS).map(([k, v]) => [v, k])) as Record<number, string>;

const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
const int = (v: unknown) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
const isoDate = (v: unknown, d: string) => { const s = str(v, 30); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s : d; };
const who = (v: unknown) => { const s = str(v, 120).toLowerCase(); return s.includes("@") ? s : s ? `${str(v, 120)} (previous sign-in)` : "unknown (previous sign-in)"; };

async function readJson(key: string): Promise<unknown | null> {
  const buf = await getStorage().read(key);
  if (!buf) return null;
  try { return JSON.parse(buf.toString("utf8")); } catch { return null; }
}

/** Read the previous version's data for a company and turn it into a plan. */
export async function buildPlan(companyId: string): Promise<Plan> {
  const own = companyId === OWN;
  const prefix = own ? "" : `companies/${companyId}/`;
  const warnings: string[] = [];
  const alias = (b: string) => (own ? INSTITUTION.branchAliases[b] || b : b);
  const plan: Plan = { source: own ? "The institution's previous Quality data" : `Company ${companyId}'s previous Quality data`, settings: {}, units: [], areas: [], checklists: [], members: [], stats: [], scorecard: null, reviews: [], actions: [], warnings };
  const addUnit = (u: string) => { if (u && !plan.units.includes(u)) plan.units.push(u); };
  const addArea = (a: string) => { if (a && !plan.areas.includes(a)) plan.areas.push(a); };

  if (own) {
    const stored = (await readJson("defects.json")) as typeof seedDefects | null;
    const D = stored && Array.isArray(stored.rows) ? stored : seedDefects;
    plan.source += stored ? " (uploaded Branch Defects workbook)" : D.rows.length ? " (bundled Branch Defects history)" : "";
    D.branches.forEach((b) => addUnit(alias(b)));
    D.areas.forEach(addArea);
    let capped = 0, cappedRec = 0;
    for (const r of D.rows) {
      const [p, b, a, reviewed, instances, defects, resolvable, resolved, recurring] = r.map(Number);
      if (!D.periods[p] || D.branches[b] == null || D.areas[a] == null) continue;
      if (resolved > resolvable) capped++;
      if (recurring > defects) cappedRec++;
      plan.stats.push([D.periods[p], alias(D.branches[b]), D.areas[a], int(reviewed), int(instances), int(defects), int(resolvable), Math.min(int(resolved), int(resolvable)), Math.min(int(recurring), int(defects))]);
    }
    if (capped) warnings.push(`${capped} history row${capped === 1 ? "" : "s"} recorded more defects resolved than were resolvable (the cause of the resolution rate once reading above 100%). Resolved is capped at resolvable for ${capped === 1 ? "it" : "them"}.`);
    if (cappedRec) warnings.push(`${cappedRec} history row${cappedRec === 1 ? "" : "s"} recorded more recurring defects than defects found. Recurring is capped at defects found.`);
    for (const area of plan.areas) plan.checklists.push({ area, checks: INSTITUTION_CHECKS, natures: [] });
    plan.settings = { instanceBasis: "item", unitLabel: "Branch", unitPlural: "Branches", itemLabel: "Transaction", itemTypes: ["Application", "Amendment", "Maintenance", "Other"], scorecard: true };

    const storedO = (await readJson("opstd.json")) as typeof seedOpstd | null;
    const O = storedO && Array.isArray(storedO.rows) ? storedO : seedOpstd;
    if (O.rows.length) {
      O.branches.forEach((b) => addUnit(alias(b)));
      const metricKeys = (O.metrics || []).map((m) => m.key);
      const entries: [string, string, Record<string, number | null>, number | null][] = [];
      O.rows.forEach((r, i) => {
        const period = O.periods[r[0] as number], unit = O.branches[r[1] as number];
        if (!period || unit == null) return;
        const values: Record<string, number | null> = {};
        OPSTD_COLUMN_KEYS.forEach((k, ci) => { const v = r[2 + ci]; values[k] = typeof v === "number" ? v : null; });
        if (metricKeys.length && metricKeys.length !== OPSTD_COLUMN_KEYS.length) warnings.push("The Operational Standard dataset's columns differ from the expected nine; check the scorecard after import.");
        entries.push([period, alias(unit), values, typeof O.auditRaw?.[i] === "number" ? (O.auditRaw[i] as number) : null]);
      });
      plan.scorecard = { entries };
    }
  } else {
    const prog = (await readJson(prefix + "program.json")) as Record<string, unknown> | null;
    if (prog) {
      plan.settings = cleanSettings({ unitLabel: prog.unitLabel, unitPlural: prog.unitPlural, itemLabel: prog.itemLabel, itemTypes: prog.itemTypes, instanceBasis: "check", scorecard: false });
      ((prog.units as string[]) || []).forEach((u) => addUnit(str(u, 80)));
      for (const a of (prog.areas as Record<string, unknown>[]) || []) {
        const name = str(a.name, 80);
        if (!name) continue;
        addArea(name);
        plan.checklists.push({
          area: name,
          checks: ((a.checks as Record<string, unknown>[]) || []).map((c) => ({ code: str(c.id, 40) || str(c.label, 40), label: str(c.label, 160), severity: (["critical", "major", "minor"].includes(String(c.severity)) ? c.severity : "major") as Severity })).filter((c) => c.label),
          natures: ((a.natures as string[]) || []).map((n) => str(n, 80)).filter(Boolean),
        });
      }
      for (const p of (prog.people as Record<string, unknown>[]) || []) {
        const email = str(p.email, 254).toLowerCase();
        if (!email.includes("@")) continue;
        const role = p.role === "supervisor" ? "supervisor" : "inspector";
        plan.members.push({ email, roles: [role].filter(isRole) as Role[], units: p.unit ? [str(p.unit, 80)] : [] });
      }
    } else {
      plan.settings = { instanceBasis: "check", scorecard: false };
    }
  }

  // Reviews (submissions).
  const subs = ((await readJson(prefix + "submissions.json")) as { submissions?: Record<string, unknown>[] } | null)?.submissions || [];
  let multiCell = 0;
  const cellCount = new Map<string, number>();
  for (const s of subs) {
    const kind = s.dataset === "opstd" ? "scorecard" : "checklist";
    const unit = alias(str(s.branch, 80));
    if (!unit) { warnings.push(`A review with no ${own ? "branch" : "unit"} was skipped.`); continue; }
    addUnit(unit);
    const period = isoDate(s.period, "").slice(0, 10);
    if (!/^\d{4}-\d{2}-01$/.test(period)) { warnings.push(`A review with no valid month was skipped.`); continue; }
    const items = kind === "checklist" ? ((s.items as Record<string, unknown>[]) || []).map((it) => {
      const area = str(it.area, 80); addArea(area);
      const checks = Object.fromEntries(Object.entries((it.checks as Record<string, string>) || {}).map(([k, v]) => [k, v === "no" ? "no" : v === "na" ? "na" : "yes"]));
      return { area, itemType: str(it.txnType, 40), checks, defects: int(it.defects), nature: str(it.defectArea, 120), recurring: !!it.recurring, status: it.status === "resolved" ? "resolved" : "open" };
    }) : [];
    if (kind === "checklist" && s.status === "published") {
      for (const a of new Set(items.map((i) => i.area))) { const k = `${period}|${unit}|${a}`; cellCount.set(k, (cellCount.get(k) || 0) + 1); }
    }
    const v = (s.values as Record<string, unknown>) || {};
    const audit = typeof s.audit === "number" ? s.audit : null;
    plan.reviews.push({
      legacyId: str(s.id, 80), kind, unit, period, entryDate: isoDate(s.entryDate, period), status: ["draft", "submitted", "returned", "published"].includes(String(s.status)) ? String(s.status) : "draft",
      inspector: who(s.inspector), supervisor: s.supervisor ? who(s.supervisor) : null, note: str(s.note, 2000),
      createdAt: str(s.createdAt, 40) || new Date().toISOString(), updatedAt: str(s.updatedAt, 40) || new Date().toISOString(),
      items, values: kind === "scorecard" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "number" ? x : null])) : null,
      auditGrade: audit != null ? LETTER_FOR_POINTS[audit] ?? null : null,
      history: ((s.history as Record<string, unknown>[]) || []).map((h) => ({ status: str(h.status, 30), by: who(h.by), at: str(h.at, 40), note: h.note ? str(h.note, 2000) : undefined })),
      files: ((s.attachments as Record<string, unknown>[]) || []).map((a) => ({ id: str(a.id, 80), name: str(a.name, 200) || "file", size: int(a.size), type: str(a.type, 120) || "application/octet-stream" })).filter((f) => /^[A-Za-z0-9_-]+$/.test(f.id)),
    });
  }
  for (const n of cellCount.values()) if (n > 1) multiCell++;
  if (multiCell) warnings.push(`${multiCell} branch-month-area cell${multiCell === 1 ? " has" : "s have"} more than one published review. The previous version showed only the last one approved; this version adds them up.`);

  // Corrective actions.
  const acts = ((await readJson(prefix + "actions.json")) as { actions?: Record<string, unknown>[] } | null)?.actions || [];
  for (const a of acts) {
    const unit = alias(str(a.branch, 80));
    if (!unit) continue;
    addUnit(unit);
    const area = a.area ? str(a.area, 80) : null;
    if (area) addArea(area);
    plan.actions.push({
      legacyId: str(a.id, 80), ref: str(a.ref, 20), unit, area, title: str(a.title, 160) || "(untitled)", details: str(a.details, 4000),
      priority: ["high", "medium", "low"].includes(String(a.priority)) ? String(a.priority) : "medium", owner: str(a.owner, 120),
      dueDate: isoDate(a.dueDate, new Date().toISOString().slice(0, 10)).slice(0, 10),
      status: ["open", "in_progress", "awaiting_verification", "closed"].includes(String(a.status)) ? String(a.status) : "open",
      closureNote: str(a.closureNote, 4000), createdBy: who(a.createdBy), verifiedBy: a.verifiedBy ? who(a.verifiedBy) : null,
      createdAt: str(a.createdAt, 40) || new Date().toISOString(), updatedAt: str(a.updatedAt, 40) || new Date().toISOString(),
      history: ((a.history as Record<string, unknown>[]) || []).map((h) => ({ status: str(h.status, 30), by: who(h.by), at: str(h.at, 40), note: h.note ? str(h.note, 2000) : undefined })),
      files: ((a.evidence as Record<string, unknown>[]) || []).map((f) => ({ id: str(f.id, 80), name: str(f.name, 200) || "file", size: int(f.size), type: str(f.type, 120) || "application/octet-stream" })).filter((f) => /^[A-Za-z0-9_-]+$/.test(f.id)),
    });
  }
  return plan;
}

/** The previous version's headline figures (uncapped, as it showed them) next to the new ones. */
export function summarise(plan: Plan, legacyRows: number[][]): PlanSummary {
  const before = legacyRows.reduce((acc, r) => { acc.i += r[4]; acc.d += r[5]; acc.rv += r[6]; acc.rs += r[7]; acc.rc += r[8]; acc.n += r[3]; return acc; }, { n: 0, i: 0, d: 0, rv: 0, rs: 0, rc: 0 });
  const after = recOf(plan.stats.map((s) => [0, 0, 0, s[3], s[4], s[5], s[6], s[7], s[8]]));
  const p = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
  const fig = (label: string, b: string, a: string) => ({ label, before: b, after: a, same: b === a });
  const figures = plan.stats.length ? [
    fig("Items reviewed", before.n.toLocaleString("en-US"), after.reviewed.toLocaleString("en-US")),
    fig("Possible instances", before.i.toLocaleString("en-US"), after.instances.toLocaleString("en-US")),
    fig("Defects found", before.d.toLocaleString("en-US"), after.defects.toLocaleString("en-US")),
    fig("Defect rate", p(before.d, before.i), p(after.defects, after.instances)),
    fig("Resolution rate", p(before.rs, before.rv), p(after.resolved, after.resolvable)),
    fig("Recurring rate", p(before.rc, before.d), p(after.recurring, after.defects)),
  ] : [];
  if (plan.scorecard?.entries.length) {
    const vals = plan.scorecard.entries.map((e) => e[2].overall).filter((v): v is number => typeof v === "number");
    const mean = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—";
    figures.push(fig("Operational Standard score (all months)", mean, mean));
  }
  const files = plan.reviews.reduce((s, r) => s + r.files.length, 0) + plan.actions.reduce((s, a) => s + a.files.length, 0);
  return {
    source: plan.source,
    counts: {
      units: plan.units.length, areas: plan.areas.length, checks: plan.checklists.reduce((s, c) => s + c.checks.length, 0), members: plan.members.length,
      historyRows: plan.stats.length, scorecardEntries: plan.scorecard?.entries.length ?? 0, reviews: plan.reviews.length,
      reviewItems: plan.reviews.reduce((s, r) => s + r.items.length, 0), actions: plan.actions.length, files,
    },
    figures,
    warnings: plan.warnings,
    notCarried: [
      "Shared role passwords and password accounts: people now sign in as themselves through Pulsus, and an admin grants their Quality role under Settings → People and roles.",
    ],
  };
}

async function legacyRowsFor(companyId: string): Promise<number[][]> {
  if (companyId !== OWN) return [];
  const stored = (await readJson("defects.json")) as typeof seedDefects | null;
  return (stored && Array.isArray(stored.rows) ? stored : seedDefects).rows.map((r) => r.map(Number));
}

/** Step 1: a dry run, stored for an admin to confirm. */
export async function preview(a: Actor, requestId?: string): Promise<{ id: string; summary: PlanSummary; alreadyImported: { at: string; by: string } | null }> {
  const plan = await buildPlan(a.tenant);
  const summary = summarise(plan, await legacyRowsFor(a.tenant));
  const id = randomUUID();
  const already = await withTenant(a.tenant, async (tx) => {
    await tx.update(imports).set({ status: "discarded" }).where(and(eq(imports.companyId, a.tenant), eq(imports.kind, "legacy"), eq(imports.status, "preview")));
    await tx.insert(imports).values({ id, companyId: a.tenant, kind: "legacy", status: "preview", summary, plan, createdBy: a.email });
    await record(tx, a.tenant, { actor: a.email, action: "migration.preview", entityType: "import", entityId: id, summary: `Dry run: ${summary.counts.historyRows} history rows, ${summary.counts.reviews} reviews, ${summary.counts.actions} actions`, after: summary.counts, requestId });
    return (await tx.select().from(imports).where(and(eq(imports.companyId, a.tenant), eq(imports.kind, "legacy"), eq(imports.status, "committed"))).limit(1))[0] ?? null;
  });
  return { id, summary, alreadyImported: already ? { at: already.committedAt?.toISOString() ?? "", by: already.committedBy ?? "" } : null };
}

/** The latest import of each kind, for Settings. */
export async function latestImports(companyId: string) {
  return withTenant(companyId, async (tx) => (await tx.select({ id: imports.id, kind: imports.kind, status: imports.status, summary: imports.summary, createdBy: imports.createdBy, createdAt: imports.createdAt, committedBy: imports.committedBy, committedAt: imports.committedAt })
    .from(imports).where(eq(imports.companyId, companyId)).orderBy(sql`created_at desc`).limit(20)).map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), committedAt: r.committedAt?.toISOString() ?? null })));
}

async function insertChunks<T>(rows: T[], size: number, fn: (chunk: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }

/** Write a plan into a company, in the caller's transaction. Returns how many evidence files to copy. */
export async function applyPlan(tx: Tx, companyId: string, plan: Plan, by: string, batchId: string): Promise<{ id: string; key: string; entityType: "review" | "action"; entityId: string; name: string; size: number; type: string }[]> {
  const settings = await loadSettings(tx, companyId);
  await writeSettings(tx, companyId, cleanSettings({ ...settings, ...plan.settings }), by);
  const unitIds = await ensureUnits(tx, companyId, plan.units);
  const areaIds = await ensureAreas(tx, companyId, plan.areas);
  for (const c of plan.checklists) if (c.checks.length) await setAreaChecklist(tx, companyId, areaIds.get(c.area)!, c.checks, c.natures.map((label) => ({ label })));
  for (const m of plan.members) {
    await tx.insert(members).values({ companyId, email: m.email, roles: m.roles, unitIds: m.units.map((u) => unitIds.get(u)).filter((x): x is string => !!x), source: "migrated" }).onConflictDoNothing();
  }
  await tx.delete(monthlyStats).where(and(eq(monthlyStats.companyId, companyId), eq(monthlyStats.source, "import")));
  await insertChunks(plan.stats, 500, (chunk) => tx.insert(monthlyStats).values(chunk.map((s) => ({
    companyId, period: s[0], unitId: unitIds.get(s[1])!, areaId: areaIds.get(s[2])!, reviewed: s[3], instances: s[4], defects: s[5], resolvable: s[6], resolved: s[7], recurring: s[8], source: "import", batchId,
  }))));
  if (plan.scorecard) {
    let card = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, companyId), eq(scorecards.active, true))).limit(1))[0];
    if (!card) {
      const id = randomUUID();
      await tx.insert(scorecards).values({ id, companyId, name: OPERATIONAL_STANDARD.name, definition: OPERATIONAL_STANDARD, createdBy: by });
      card = (await tx.select().from(scorecards).where(eq(scorecards.id, id)).limit(1))[0];
    }
    await tx.delete(scorecardEntries).where(and(eq(scorecardEntries.companyId, companyId), eq(scorecardEntries.scorecardId, card.id), eq(scorecardEntries.source, "import")));
    await insertChunks(plan.scorecard.entries, 500, (chunk) => tx.insert(scorecardEntries).values(chunk.map((e) => ({ companyId, scorecardId: card.id, period: e[0], unitId: unitIds.get(e[1])!, values: e[2], auditRaw: e[3], source: "import" }))).onConflictDoNothing());
  }
  const files: Awaited<ReturnType<typeof applyPlan>> = [];
  const legacyPrefix = companyId === OWN ? "" : `companies/${companyId}/`;
  const areaCodes = new Map(plan.checklists.map((c) => [c.area, c.checks.map((k) => k.code)]));
  for (const r of plan.reviews.sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    const id = randomUUID();
    const ref = await nextRef(tx, companyId, "review", "REV");
    await tx.insert(reviews).values({
      id, companyId, ref, kind: r.kind, unitId: unitIds.get(r.unit)!, period: r.period, entryDate: r.entryDate.slice(0, 10), status: r.status,
      inspectorEmail: r.inspector, supervisorEmail: r.supervisor, note: r.note, scorecardValues: r.values, auditGrade: r.auditGrade,
      createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt), publishedAt: r.status === "published" ? new Date(r.updatedAt) : null,
    });
    let idx = 0;
    for (const it of r.items) {
      const codes = areaCodes.get(it.area);
      const checks = codes ? Object.fromEntries(codes.map((c) => [c, it.checks[c] ?? "yes"])) : it.checks;
      await tx.insert(reviewItems).values({ id: randomUUID(), companyId, reviewId: id, idx: idx++, areaId: areaIds.get(it.area)!, itemType: it.itemType, checks, defects: it.defects, nature: it.nature, recurring: it.recurring, status: it.status });
    }
    for (const h of r.history) await tx.insert(reviewEvents).values({ companyId, reviewId: id, status: h.status, by: h.by, at: new Date(h.at || r.createdAt), note: h.note ?? null });
    for (const f of r.files) files.push({ id: randomUUID(), key: `${legacyPrefix}attachment-${f.id}`, entityType: "review", entityId: id, name: f.name, size: f.size, type: f.type });
  }
  const maxRef = plan.actions.reduce((m, a) => Math.max(m, Number(a.ref.replace(/^ACT-/, "")) || 0), 0);
  for (const a of plan.actions) {
    const id = randomUUID();
    const ref = /^ACT-\d+$/.test(a.ref) ? a.ref : await nextRef(tx, companyId, "action", "ACT", maxRef);
    const closed = a.status === "closed";
    await tx.insert(actions).values({
      id, companyId, ref, kind: "corrective", unitId: unitIds.get(a.unit)!, areaId: a.area ? areaIds.get(a.area) ?? null : null, title: a.title, details: a.details,
      priority: a.priority, ownerName: a.owner || "—", dueDate: a.dueDate, status: a.status, closureNote: a.closureNote, raisedBy: a.createdBy,
      verifiedBy: a.verifiedBy, verifiedAt: closed ? new Date(a.updatedAt) : null, closedAt: closed ? new Date(a.updatedAt) : null,
      sourceType: "migrated", sourceId: a.legacyId, createdAt: new Date(a.createdAt), updatedAt: new Date(a.updatedAt),
    });
    for (const h of a.history) await tx.insert(actionEvents).values({ companyId, actionId: id, kind: h.status === "edited" ? "edited" : "status", status: h.status === "edited" ? null : h.status, by: h.by, at: new Date(h.at || a.createdAt), note: h.note ?? null });
    for (const f of a.files) files.push({ id: randomUUID(), key: `${legacyPrefix}attachment-${f.id}`, entityType: "action", entityId: id, name: f.name, size: f.size, type: f.type });
  }
  if (maxRef) await tx.execute(sql`insert into counters (company_id, name, value) values (${companyId}, 'action', ${maxRef}) on conflict (company_id, name) do update set value = greatest(counters.value, ${maxRef})`);
  return files;
}

/** Step 2: commit a confirmed preview. All or nothing; then the evidence files are copied. */
export async function commit(a: Actor, importId: string, requestId?: string): Promise<{ ok: true; summary: PlanSummary; files: { copied: number; missing: number } } | { ok: false; error: string; status?: number }> {
  const res = await withTenant(a.tenant, async (tx) => {
    const imp = (await tx.select().from(imports).where(and(eq(imports.companyId, a.tenant), eq(imports.id, importId))).limit(1))[0];
    if (!imp || imp.kind !== "legacy") return { ok: false as const, error: "That preview wasn't found. Run the preview again.", status: 404 };
    if (imp.status !== "preview") return { ok: false as const, error: `That preview was already ${imp.status}. Run the preview again.`, status: 409 };
    if (imp.createdAt.getTime() < Date.now() - 24 * 3600_000) return { ok: false as const, error: "That preview is more than a day old. Run it again so you confirm current data.", status: 409 };
    const done = (await tx.select({ id: imports.id }).from(imports).where(and(eq(imports.companyId, a.tenant), eq(imports.kind, "legacy"), eq(imports.status, "committed"))).limit(1))[0];
    const existing = Number(((await tx.execute(sql`select (select count(*) from reviews) + (select count(*) from actions) as n`)) as unknown as { rows: { n: string }[] }).rows[0]?.n ?? 0);
    if (done || existing > 0) return { ok: false as const, error: "This company already has data in the new version, so the previous version's data can't be imported over it.", status: 409 };
    const plan = imp.plan as Plan;
    const files = await applyPlan(tx, a.tenant, plan, a.email, importId);
    await tx.update(imports).set({ status: "committed", committedBy: a.email, committedAt: new Date() }).where(eq(imports.id, importId));
    await record(tx, a.tenant, { actor: a.email, action: "migration.commit", entityType: "import", entityId: importId, summary: `Imported the previous version's data (confirmed by ${a.email})`, after: (imp.summary as PlanSummary).counts, requestId });
    return { ok: true as const, summary: imp.summary as PlanSummary, files };
  });
  if (!res.ok) return res;
  let copied = 0, missing = 0;
  const store = getStorage();
  for (const f of res.files) {
    const bytes = await store.read(f.key);
    if (!bytes) { missing++; continue; }
    const blobKey = `evidence/${a.tenant}/${f.entityType}/${f.entityId}/${f.id}`;
    await store.write(blobKey, bytes, f.type);
    const { createHash } = await import("node:crypto");
    await withTenant(a.tenant, (tx) => tx.insert(evidence).values({ id: f.id, companyId: a.tenant, entityType: f.entityType, entityId: f.entityId, name: f.name, size: bytes.length, contentType: f.type, sha256: createHash("sha256").update(bytes).digest("hex"), blobKey, uploadedBy: "migration" }));
    copied++;
  }
  return { ok: true, summary: res.summary, files: { copied, missing } };
}

/** Whether a company has anything in the previous version's store worth importing (cheap check for a prompt). */
export async function legacyAvailable(companyId: string): Promise<boolean> {
  if (companyId === OWN) return seedDefects.rows.length > 0 || !!(await getStorage().read("defects.json"));
  return !!(await getStorage().read(`companies/${companyId}/program.json`)) || !!(await getStorage().read(`companies/${companyId}/submissions.json`));
}

