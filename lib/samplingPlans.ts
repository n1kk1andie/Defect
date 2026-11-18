// Sampling plans on Postgres: create one (population, method, seeded
// selection), start the file review on its selected items, and evaluate it —
// automatically when that inspection is approved, or by entering the
// deviations found. Every step is recorded. Supervisors and admins plan;
// everyone in scope can read.
import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { inspections, samplingPlans, templates, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { can, inScope, type Actor } from "@/lib/roles";
import { evaluate, numbered, parsePopulation, sampleSize, select, methodText, type Allocation, type Evaluation, type PopItem } from "@/lib/sampling";
import { loadVersion } from "@/lib/templates/store";
import { saveInspection } from "@/lib/inspections";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const iso = (d: string | Date | null) => (d ? (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10)) : null);

export interface PlanView {
  id: string; ref: string; name: string; templateId: string | null; templateName: string | null; unitId: string | null; unitName: string | null; period: string | null;
  method: "statistical" | "judgmental"; confidence: number | null; tdr: number | null; edr: number | null; populationSize: number; listed: boolean; populationHash: string;
  stratify: boolean; censusAbove: number | null; sampleSize: number; seed: string; selection: (PopItem & { stratum: string })[]; allocation: Allocation[];
  status: "selected" | "evaluated"; inspectionId: string | null; inspectionRef: string | null; inspectionStatus: string | null; evaluation: (Evaluation & { source: "inspection" | "entered"; at: string; by: string }) | null;
  method_text: string; createdBy: string; createdAt: string;
}

export const populationHash = (items: PopItem[]) => createHash("sha256").update(JSON.stringify([...items].sort((a, b) => (a.id < b.id ? -1 : 1)))).digest("hex");

async function view(tx: Tx, companyId: string, rows: (typeof samplingPlans.$inferSelect)[], withPopulation = false): Promise<PlanView[]> {
  const [ts, us, ins] = await Promise.all([
    tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.companyId, companyId)),
    tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, companyId)),
    tx.select({ id: inspections.id, ref: inspections.ref, status: inspections.status }).from(inspections).where(eq(inspections.companyId, companyId)),
  ]);
  const tn = new Map(ts.map((t) => [t.id, t.name])), un = new Map(us.map((u) => [u.id, u.name])), im = new Map(ins.map((i) => [i.id, i]));
  return rows.map((r) => ({
    id: r.id, ref: r.ref, name: r.name, templateId: r.templateId, templateName: r.templateId ? tn.get(r.templateId) ?? null : null, unitId: r.unitId, unitName: r.unitId ? un.get(r.unitId) ?? null : null, period: iso(r.period),
    method: r.method as PlanView["method"], confidence: r.confidence, tdr: r.tdr, edr: r.edr, populationSize: r.populationSize, listed: (r.population as PopItem[]).length > 0 && withPopulation ? true : (r.population as PopItem[]).length > 0, populationHash: r.populationHash,
    stratify: r.stratify, censusAbove: r.censusAbove, sampleSize: r.sampleSize, seed: r.seed, selection: r.selection as PlanView["selection"], allocation: r.allocation as Allocation[],
    status: r.status as PlanView["status"], inspectionId: r.inspectionId, inspectionRef: r.inspectionId ? im.get(r.inspectionId)?.ref ?? null : null, inspectionStatus: r.inspectionId ? im.get(r.inspectionId)?.status ?? null : null,
    evaluation: (r.evaluation as PlanView["evaluation"]) ?? null,
    method_text: methodText({ method: r.method, confidence: r.confidence, tdr: r.tdr, edr: r.edr, seed: r.seed, stratify: r.stratify, censusAbove: r.censusAbove, size: r.sampleSize, population: r.populationSize }),
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }));
}

export async function listPlans(a: Actor): Promise<PlanView[]> {
  return withTenant(a.tenant, async (tx) => {
    const rows = (await tx.select().from(samplingPlans).where(eq(samplingPlans.companyId, a.tenant)).orderBy(desc(samplingPlans.createdAt))).filter((r) => !r.unitId || inScope(a, r.unitId));
    return view(tx, a.tenant, rows);
  });
}

export async function getPlan(a: Actor, id: string): Promise<{ plan: PlanView; population: PopItem[] } | null> {
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(samplingPlans).where(and(eq(samplingPlans.companyId, a.tenant), eq(samplingPlans.id, id))).limit(1))[0];
    if (!r || (r.unitId && !inScope(a, r.unitId))) return null;
    return { plan: (await view(tx, a.tenant, [r]))[0], population: r.population as PopItem[] };
  });
}

export interface PlanInput { name?: unknown; templateId?: unknown; unitId?: unknown; period?: unknown; method?: unknown; confidence?: unknown; tdr?: unknown; edr?: unknown; population?: unknown; populationSize?: unknown; stratify?: unknown; censusAbove?: unknown; size?: unknown; seed?: unknown }

/** Work out a plan from its inputs (shared by the preview and the save). */
export function planFrom(input: PlanInput): { ok: true; value: { items: PopItem[]; listed: boolean; size: number; method: "statistical" | "judgmental"; confidence: number | null; tdr: number | null; edr: number | null; seed: string; stratify: boolean; censusAbove: number | null; note: string } } | { ok: false; error: string } {
  const text = typeof input.population === "string" ? input.population : "";
  const listed = text.trim().length > 0;
  let items = listed ? parsePopulation(text) : numbered(Number(input.populationSize) || 0, "ITEM");
  if (!items.length) return { ok: false, error: "Paste the population (one id per line), or give its size." };
  const method = input.method === "judgmental" ? "judgmental" : "statistical";
  const stratify = !!input.stratify && listed && items.some((i) => i.stratum);
  const cRaw = input.censusAbove;
  const censusAbove = cRaw !== undefined && cRaw !== null && cRaw !== "" && Number.isFinite(Number(cRaw)) && listed ? Number(cRaw) : null;
  let size: number, confidence: number | null = null, tdr: number | null = null, edr: number | null = null, note = "";
  // Items at or above the census value are all tested; the sample is drawn from the rest.
  const census = censusAbove != null ? items.filter((i) => (i.value ?? -Infinity) >= censusAbove).length : 0;
  const rest = items.length - census;
  if (method === "statistical") {
    confidence = Number(input.confidence); tdr = Number(input.tdr); edr = Number(input.edr ?? 0);
    if (rest > 0) { try { const s = sampleSize({ confidence, tdr, edr, population: rest }); size = s.n; note = s.note; } catch (e) { return { ok: false, error: (e as Error).message }; } } else size = 0;
    if (census) note = `${note} Plus all ${census} item${census === 1 ? "" : "s"} at or above ${censusAbove}.`.trim();
  } else {
    size = Math.round(Number(input.size));
    if (!(size >= 1)) return { ok: false, error: "Say how many items to test." };
  }
  size = Math.min(items.length, (method === "statistical" ? size : Math.max(0, size - census)) + census);
  const seed = String(input.seed || "").replace(/\s+/g, " ").trim().slice(0, 60) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  items = items.slice(0, 50000);
  return { ok: true, value: { items, listed, size, method, confidence, tdr, edr, seed, stratify, censusAbove, note } };
}

export async function createPlan(a: Actor, input: PlanInput, requestId?: string): Promise<Result<PlanView>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins plan samples.", status: 403 };
  const name = String(input.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return { ok: false, error: "Name the sampling plan.", status: 400 };
  const p = planFrom(input);
  if (!p.ok) return { ok: false, error: p.error, status: 400 };
  const v = p.value;
  const sel = select(v.items, v.size, v.seed, { stratify: v.stratify, censusAbove: v.censusAbove });
  return withTenant(a.tenant, async (tx) => {
    const unitId = String(input.unitId || "") || null;
    if (unitId) {
      const u = (await tx.select().from(units).where(and(eq(units.companyId, a.tenant), eq(units.id, unitId))).limit(1))[0];
      if (!u) return { ok: false as const, error: "Choose a site.", status: 400 };
      if (!inScope(a, unitId)) return { ok: false as const, error: `${u.name} is outside your sites.`, status: 403 };
    }
    const templateId = String(input.templateId || "") || null;
    if (templateId && !(await tx.select({ id: templates.id }).from(templates).where(and(eq(templates.companyId, a.tenant), eq(templates.id, templateId))).limit(1)).length) return { ok: false as const, error: "Choose a template.", status: 400 };
    const period = /^\d{4}-\d{2}-01$/.test(String(input.period || "")) ? String(input.period) : null;
    const id = randomUUID();
    const ref = await nextRef(tx, a.tenant, "sampling", "SMP");
    const hash = populationHash(v.items);
    await tx.insert(samplingPlans).values({
      id, companyId: a.tenant, ref, name, templateId, unitId, period, method: v.method, confidence: v.confidence, tdr: v.tdr, edr: v.edr,
      populationSize: v.items.length, population: v.listed ? v.items : [], populationHash: hash, stratify: v.stratify, censusAbove: v.censusAbove,
      sampleSize: sel.items.length, seed: v.seed, selection: sel.items, allocation: sel.allocation, status: "selected", createdBy: a.email,
    });
    await record(tx, a.tenant, { actor: a.email, action: "sampling.create", entityType: "sampling_plan", entityId: id, summary: `${ref} ${name}: ${sel.items.length} of ${v.items.length} selected (seed “${v.seed}”)`, after: { method: v.method, confidence: v.confidence, tdr: v.tdr, edr: v.edr, size: sel.items.length, population: v.items.length, populationHash: hash, seed: v.seed }, requestId });
    const r = (await tx.select().from(samplingPlans).where(eq(samplingPlans.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [r]))[0] };
  });
}

/** Start the review of the selected items as a draft inspection of the plan's (sampled) template. */
export async function startPlanInspection(a: Actor, id: string, requestId?: string): Promise<Result<{ inspectionId: string }>> {
  const got = await getPlan(a, id);
  if (!got) return { ok: false, error: "Sampling plan not found.", status: 404 };
  const p = got.plan;
  if (p.inspectionId) return { ok: true, value: { inspectionId: p.inspectionId } };
  if (!p.templateId || !p.unitId) return { ok: false, error: "Link the plan to a sampled template and a site first.", status: 400 };
  const def = await withTenant(a.tenant, async (tx) => { const t = (await tx.select().from(templates).where(eq(templates.id, p.templateId!)).limit(1))[0]; return t?.version ? loadVersion(tx, a.tenant, t.id, t.version) : null; });
  if (!def?.sections.some((s) => s.perItem)) return { ok: false, error: "That template has no repeating section for sampled items.", status: 400 };
  const r = await saveInspection(a, { clientId: `plan-${p.id}`, templateId: p.templateId, unitId: p.unitId, period: p.period || new Date().toISOString().slice(0, 7) + "-01", items: p.selection.map((s) => ({ ref: s.id, answers: {} })) }, requestId);
  if (!r.ok) return r;
  await withTenant(a.tenant, async (tx) => {
    await tx.update(samplingPlans).set({ inspectionId: r.value.id, updatedAt: new Date() }).where(eq(samplingPlans.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "sampling.start", entityType: "sampling_plan", entityId: id, summary: `${p.ref}: review started as ${r.value.ref}`, requestId });
  });
  return { ok: true, value: { inspectionId: r.value.id } };
}

/** Enter the deviations found (for a plan reviewed outside an inspection). */
export async function evaluatePlan(a: Actor, id: string, deviations: unknown, requestId?: string): Promise<Result<PlanView>> {
  if (!can.buildTemplates(a)) return { ok: false, error: "Supervisors and admins evaluate samples.", status: 403 };
  const d = Math.round(Number(deviations));
  return withTenant(a.tenant, async (tx) => {
    const r = (await tx.select().from(samplingPlans).where(and(eq(samplingPlans.companyId, a.tenant), eq(samplingPlans.id, id))).limit(1))[0];
    if (!r) return { ok: false as const, error: "Sampling plan not found.", status: 404 };
    if (!(d >= 0 && d <= r.sampleSize)) return { ok: false as const, error: `Enter a number from 0 to ${r.sampleSize}.`, status: 400 };
    const ev = { ...evaluate(r.sampleSize, d, r.confidence ?? 0.95, r.tdr ?? 0.05, r.populationSize), source: "entered" as const, at: new Date().toISOString(), by: a.email };
    await tx.update(samplingPlans).set({ evaluation: ev, status: "evaluated", updatedAt: new Date() }).where(eq(samplingPlans.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "sampling.evaluate", entityType: "sampling_plan", entityId: id, summary: `${r.ref}: ${d} deviation${d === 1 ? "" : "s"} in ${r.sampleSize}; upper limit ${(ev.upper * 100).toFixed(1)}%`, before: { evaluation: r.evaluation }, after: { deviations: d, upper: ev.upper, effective: ev.effective }, requestId });
    const f = (await tx.select().from(samplingPlans).where(eq(samplingPlans.id, id)).limit(1))[0];
    return { ok: true as const, value: (await view(tx, a.tenant, [f]))[0] };
  });
}

/** When an inspection is approved: evaluate any plan it reviews, from its sampled items' deviations. */
export async function evaluateFromInspection(tx: Tx, companyId: string, inspectionId: string, items: number, deviations: number, by: string): Promise<void> {
  const plans = await tx.select().from(samplingPlans).where(and(eq(samplingPlans.companyId, companyId), eq(samplingPlans.inspectionId, inspectionId)));
  for (const r of plans) {
    const n = items || r.sampleSize;
    const ev = { ...evaluate(n, Math.min(n, deviations), r.confidence ?? 0.95, r.tdr ?? 0.05, r.populationSize), source: "inspection" as const, at: new Date().toISOString(), by };
    await tx.update(samplingPlans).set({ evaluation: ev, status: "evaluated", updatedAt: new Date() }).where(eq(samplingPlans.id, r.id));
    await record(tx, companyId, { actor: by, action: "sampling.evaluate", entityType: "sampling_plan", entityId: r.id, summary: `${r.ref}: evaluated from the approved review: ${deviations} deviation${deviations === 1 ? "" : "s"} in ${n}`, after: { deviations, n, upper: ev.upper, effective: ev.effective } });
  }
}
