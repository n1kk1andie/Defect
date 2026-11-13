// Workbook uploads: preview first, commit after an admin confirms. A Branch
// Defects workbook replaces the imported history (published reviews are kept
// and still take precedence in the cells they cover); an Operational Standards
// workbook replaces the imported scorecard entries.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { imports, monthlyStats, scorecardEntries, scorecards } from "@/lib/db/schema";
import { ensureAreas, ensureUnits, loadProgram } from "@/lib/company";
import { record } from "@/lib/audit";
import { record as recOf, pct } from "@/lib/metrics";
import { OPERATIONAL_STANDARD } from "@/lib/scorecard";
import { parseUpload, type DefectsUpload, type OpstdUpload } from "@/lib/workbook";
import { OWN } from "@/lib/company";
import { INSTITUTION } from "@/institution";
import type { Actor } from "@/lib/roles";

export interface UploadPreview {
  id: string; kind: "workbook_defects" | "workbook_opstd"; fileName: string;
  rows: number; periods: [string, string] | null; newUnits: string[]; newAreas: string[];
  problems: { row: number; message: string }[];
  figures: { label: string; value: string }[];
  sample: (string | number | null)[][];
}

export async function previewUpload(a: Actor, fileName: string, buf: Buffer, requestId?: string): Promise<UploadPreview> {
  const parsed = await parseUpload(buf, a.tenant === OWN ? INSTITUTION.branchAliases : {});
  const program = await withTenant(a.tenant, (tx) => loadProgram(tx, a.tenant));
  const unitNames = new Set(program.units.map((u) => u.name)), areaNames = new Set(program.areas.map((x) => x.name));
  const id = randomUUID();
  let preview: UploadPreview;
  if (parsed.kind === "defects") {
    const ps = parsed.rows.map((r) => r[0]).sort();
    const rec = recOf(parsed.rows.map((r) => [0, 0, 0, r[3], r[4], r[5], r[6], r[7], r[8]]));
    preview = {
      id, kind: "workbook_defects", fileName, rows: parsed.rows.length, periods: ps.length ? [ps[0], ps[ps.length - 1]] : null,
      newUnits: Array.from(new Set(parsed.rows.map((r) => r[1]))).filter((u) => !unitNames.has(u)),
      newAreas: Array.from(new Set(parsed.rows.map((r) => r[2]))).filter((x) => !areaNames.has(x)),
      problems: parsed.problems.slice(0, 200),
      figures: [{ label: "Defects", value: rec.defects.toLocaleString("en-US") }, { label: "Possible instances", value: rec.instances.toLocaleString("en-US") }, { label: "Defect rate", value: pct(rec.defectRate) }, { label: "Resolution rate", value: pct(rec.resolutionRate) }, { label: "Recurring rate", value: pct(rec.recurringRate) }],
      sample: parsed.rows.slice(0, 8),
    };
  } else {
    const ps = parsed.entries.map((e) => e[0]).sort();
    preview = {
      id, kind: "workbook_opstd", fileName, rows: parsed.entries.length, periods: ps.length ? [ps[0], ps[ps.length - 1]] : null,
      newUnits: Array.from(new Set(parsed.entries.map((e) => e[1]))).filter((u) => !unitNames.has(u)), newAreas: [],
      problems: parsed.problems.slice(0, 200),
      figures: [{ label: "Branch-months", value: String(parsed.entries.length) }],
      sample: parsed.entries.slice(0, 8).map((e) => [e[0], e[1], e[2].overall ?? null, e[3]]),
    };
  }
  await withTenant(a.tenant, async (tx) => {
    await tx.insert(imports).values({ id, companyId: a.tenant, kind: preview.kind, status: "preview", summary: preview, plan: parsed, createdBy: a.email });
    await record(tx, a.tenant, { actor: a.email, action: "import.preview", entityType: "import", entityId: id, summary: `Previewed ${fileName}: ${preview.rows} rows`, requestId });
  });
  return preview;
}

export async function commitUpload(a: Actor, id: string, requestId?: string): Promise<{ ok: true; rows: number } | { ok: false; error: string; status?: number }> {
  return withTenant(a.tenant, async (tx) => {
    const imp = (await tx.select().from(imports).where(and(eq(imports.companyId, a.tenant), eq(imports.id, id))).limit(1))[0];
    if (!imp || !imp.kind.startsWith("workbook_")) return { ok: false as const, error: "That preview wasn't found.", status: 404 };
    if (imp.status !== "preview") return { ok: false as const, error: `That upload was already ${imp.status}.`, status: 409 };
    const plan = imp.plan as DefectsUpload | OpstdUpload;
    let rows = 0;
    if (plan.kind === "defects") {
      const unitIds = await ensureUnits(tx, a.tenant, Array.from(new Set(plan.rows.map((r) => r[1]))));
      const areaIds = await ensureAreas(tx, a.tenant, Array.from(new Set(plan.rows.map((r) => r[2]))));
      await tx.delete(monthlyStats).where(and(eq(monthlyStats.companyId, a.tenant), eq(monthlyStats.source, "import")));
      const merged = new Map<string, number[]>();
      for (const r of plan.rows) { const k = `${r[0]}|${r[1]}|${r[2]}`; const m = merged.get(k) || [0, 0, 0, 0, 0, 0]; for (let i = 0; i < 6; i++) m[i] += Number(r[3 + i]); merged.set(k, m); }
      const vals = Array.from(merged, ([k, v]) => { const [p, u, ar] = k.split("|"); return { companyId: a.tenant, period: p, unitId: unitIds.get(u)!, areaId: areaIds.get(ar)!, reviewed: v[0], instances: v[1], defects: v[2], resolvable: v[3], resolved: Math.min(v[4], v[3]), recurring: Math.min(v[5], v[2]), source: "import", batchId: id }; });
      for (let i = 0; i < vals.length; i += 500) await tx.insert(monthlyStats).values(vals.slice(i, i + 500));
      rows = vals.length;
    } else {
      const unitIds = await ensureUnits(tx, a.tenant, Array.from(new Set(plan.entries.map((e) => e[1]))));
      let card = (await tx.select().from(scorecards).where(and(eq(scorecards.companyId, a.tenant), eq(scorecards.active, true))).limit(1))[0];
      if (!card) { const cid = randomUUID(); await tx.insert(scorecards).values({ id: cid, companyId: a.tenant, name: OPERATIONAL_STANDARD.name, definition: OPERATIONAL_STANDARD, createdBy: a.email }); card = (await tx.select().from(scorecards).where(eq(scorecards.id, cid)).limit(1))[0]; }
      await tx.delete(scorecardEntries).where(and(eq(scorecardEntries.companyId, a.tenant), eq(scorecardEntries.scorecardId, card.id), eq(scorecardEntries.source, "import")));
      const vals = plan.entries.map((e) => ({ companyId: a.tenant, scorecardId: card.id, period: e[0], unitId: unitIds.get(e[1])!, values: e[2], auditRaw: e[3], source: "import" }));
      for (let i = 0; i < vals.length; i += 500) await tx.insert(scorecardEntries).values(vals.slice(i, i + 500)).onConflictDoNothing();
      rows = vals.length;
    }
    await tx.update(imports).set({ status: "committed", committedBy: a.email, committedAt: new Date() }).where(eq(imports.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "import.commit", entityType: "import", entityId: id, summary: `Imported ${(imp.summary as UploadPreview).fileName}: ${rows} rows replace the previous ${plan.kind === "defects" ? "Branch Defects history" : "Operational Standard entries"}`, requestId });
    return { ok: true as const, rows };
  });
}
