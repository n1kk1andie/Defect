// The risk score for every site, from what Quality already holds: approved
// inspections (score, critical failures, sampled-item deviations, repeat
// findings), evaluated sampling plans, overdue actions, the last visit and the
// factors entered per site. The pure model is lib/risk.ts.
import { and, eq, inArray, lte, ne } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { actions, inspections, samplingPlans, templates, unitFactors, units } from "@/lib/db/schema";
import { loadSettings } from "@/lib/company";
import { record } from "@/lib/audit";
import { can, inScope, type Actor } from "@/lib/roles";
import { scoreSite, type RiskConfig, type SiteInput, type SiteRisk } from "@/lib/risk";
import type { StoredScore } from "@/lib/inspections";
import type { Evaluation } from "@/lib/sampling";

const DAY = 864e5;
const months = (from: Date, to: Date) => Math.max(0, (to.getTime() - from.getTime()) / (30.44 * DAY));

export interface RiskBoard { asOf: string; config: RiskConfig; unitLabel: string; sites: (SiteRisk & { previous: number | null; delta: number | null; factors: Record<string, number | null> })[] }

export async function siteInputs(tx: Tx, companyId: string, asOf: Date): Promise<{ inputs: SiteInput[]; factors: Map<string, Record<string, number | null>> }> {
  const since = new Date(asOf.getTime() - 365 * DAY);
  const [us, ins, plans, acts, fx, tpls] = await Promise.all([
    tx.select().from(units).where(and(eq(units.companyId, companyId), eq(units.active, true))),
    tx.select({ id: inspections.id, unitId: inspections.unitId, templateId: inspections.templateId, score: inspections.score, approvedAt: inspections.approvedAt, createdAt: inspections.createdAt, status: inspections.status })
      .from(inspections).where(and(eq(inspections.companyId, companyId), inArray(inspections.status, ["approved", "submitted"]), lte(inspections.createdAt, asOf))),
    tx.select({ unitId: samplingPlans.unitId, evaluation: samplingPlans.evaluation, inspectionId: samplingPlans.inspectionId, updatedAt: samplingPlans.updatedAt }).from(samplingPlans).where(and(eq(samplingPlans.companyId, companyId), eq(samplingPlans.status, "evaluated"))),
    tx.select({ unitId: actions.unitId, dueDate: actions.dueDate, createdAt: actions.createdAt, closedAt: actions.closedAt }).from(actions).where(and(eq(actions.companyId, companyId), ne(actions.status, "closed"))),
    tx.select().from(unitFactors).where(eq(unitFactors.companyId, companyId)),
    tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.companyId, companyId)),
  ]);
  const tName = new Map(tpls.map((t) => [t.id, t.name]));
  const factors = new Map(fx.map((f) => [f.unitId, f.data as Record<string, number | null>]));
  const asOfDay = asOf.toISOString().slice(0, 10);
  const inputs: SiteInput[] = us.map((u) => {
    const mine = ins.filter((i) => i.unitId === u.id);
    const approved = mine.filter((i) => i.status === "approved" && i.approvedAt && i.approvedAt <= asOf && i.approvedAt >= since);
    const last = mine.reduce<Date | null>((m, i) => (!m || i.createdAt > m ? i.createdAt : m), null);
    // Repeat findings: a question that failed on two consecutive approved inspections of the same checklist.
    const repeats: { label: string; template: string }[] = [];
    const byT = new Map<string, typeof approved>();
    for (const i of approved) (byT.get(i.templateId) || byT.set(i.templateId, []).get(i.templateId)!).push(i);
    for (const [tid, list] of byT) {
      const sorted = [...list].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 3);
      const seen = new Set<string>();
      for (let k = 0; k + 1 < sorted.length; k++) {
        const a = new Set(((sorted[k].score as StoredScore | null)?.findings ?? []).map((f) => f.label));
        for (const f of (sorted[k + 1].score as StoredScore | null)?.findings ?? []) if (a.has(f.label) && !seen.has(f.label)) { seen.add(f.label); repeats.push({ label: f.label, template: tName.get(tid) ?? "" }); }
      }
    }
    const planned = new Set(plans.map((p) => p.inspectionId).filter(Boolean));
    return {
      unitId: u.id, name: u.name, group: u.region,
      inspections: approved.map((i) => { const s = i.score as StoredScore | null; return { ageMonths: months(i.approvedAt!, asOf), pct: s?.pct ?? null, criticalFails: s?.criticalFails ?? 0, items: planned.has(i.id) ? 0 : s?.items ?? 0, deviations: planned.has(i.id) ? 0 : s?.deviations ?? 0 }; }),
      samples: plans.filter((p) => p.unitId === u.id && p.updatedAt <= asOf && p.evaluation).map((p) => { const e = p.evaluation as Evaluation; return { ageMonths: months(p.updatedAt, asOf), n: e.n, deviations: e.deviations }; }),
      overdueActions: acts.filter((x) => x.unitId === u.id && x.createdAt <= asOf && String(x.dueDate) < asOfDay).length,
      repeatFindings: repeats,
      daysSinceVisit: last ? Math.floor((asOf.getTime() - last.getTime()) / DAY) : null,
      factors: factors.get(u.id) ?? {},
    };
  });
  return { inputs, factors };
}

/** Every site's risk, worst first, with the change over the last 30 days. Scoped to the person's sites. */
export async function riskBoard(a: Actor, now = new Date()): Promise<RiskBoard> {
  return withTenant(a.tenant, async (tx) => {
    const s = await loadSettings(tx, a.tenant);
    const [{ inputs, factors }, prev] = await Promise.all([siteInputs(tx, a.tenant, now), siteInputs(tx, a.tenant, new Date(now.getTime() - 30 * DAY))]);
    const prevScore = new Map(prev.inputs.map((i) => [i.unitId, scoreSite(i, s.risk).score]));
    const sites = inputs.filter((i) => inScope(a, i.unitId)).map((i) => {
      const r = scoreSite(i, s.risk);
      const p = prevScore.get(i.unitId) ?? null;
      return { ...r, previous: p, delta: r.score !== null && p !== null ? Math.round((r.score - p) * 10) / 10 : null, factors: Object.fromEntries(s.risk.factors.map((f) => [f.key, factors.get(i.unitId)?.[f.key] ?? null])) };
    }).sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
    return { asOf: now.toISOString(), config: s.risk, unitLabel: s.unitLabel, sites };
  });
}

/** An admin enters the organisation-specific factors for sites (0–100 each). */
export async function setFactors(a: Actor, rows: unknown, requestId?: string): Promise<{ ok: true; value: number } | { ok: false; error: string; status?: number }> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin enters risk factors.", status: 403 };
  const list = (Array.isArray(rows) ? rows : []).slice(0, 1000) as { unitId?: unknown; data?: Record<string, unknown> }[];
  return withTenant(a.tenant, async (tx) => {
    const s = await loadSettings(tx, a.tenant);
    const keys = new Set(s.risk.factors.map((f) => f.key));
    const valid = new Set((await tx.select({ id: units.id }).from(units).where(eq(units.companyId, a.tenant))).map((u) => u.id));
    let n = 0;
    for (const r of list) {
      const unitId = String(r.unitId || "");
      if (!valid.has(unitId)) continue;
      const data: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(r.data || {})) { if (!keys.has(k)) continue; const x = v === "" || v == null ? null : Number(v); data[k] = x === null || !Number.isFinite(x) ? null : Math.max(0, Math.min(100, Math.round(x))); }
      await tx.insert(unitFactors).values({ companyId: a.tenant, unitId, data, updatedBy: a.email, updatedAt: new Date() }).onConflictDoUpdate({ target: [unitFactors.companyId, unitFactors.unitId], set: { data, updatedBy: a.email, updatedAt: new Date() } });
      n++;
    }
    await record(tx, a.tenant, { actor: a.email, action: "risk.factors", entityType: "risk", summary: `Risk factors entered for ${n} site${n === 1 ? "" : "s"}`, requestId });
    return { ok: true as const, value: n };
  });
}
