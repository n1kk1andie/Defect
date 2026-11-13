// Inspection analytics for Insights: the most-failed questions (across every
// approved inspection, sampled items included), inspection scores by site and
// by template. Scoped to the person's sites.
import { and, eq, gte } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { inspections, templates, units } from "@/lib/db/schema";
import { inScope, type Actor } from "@/lib/roles";
import { loadVersion } from "@/lib/templates/store";
import { answerScore, isVisible, type Answers, type SampledItem, type TemplateDef } from "@/lib/templates/model";
import type { StoredScore } from "@/lib/inspections";

export interface InspectionStats {
  since: string;
  total: number;
  questions: { template: string; label: string; critical: boolean; fails: number; asked: number; rate: number; sites: string[] }[];
  sites: { unitId: string; name: string; n: number; avg: number | null; failed: number; critical: number }[];
  templates: { id: string; name: string; n: number; avg: number | null; passRate: number | null }[];
}

export async function inspectionStats(a: Actor, months = 6): Promise<InspectionStats> {
  const since = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - months + 1, 1)).toISOString().slice(0, 10);
  return withTenant(a.tenant, async (tx) => {
    const [rows, tpl, us] = await Promise.all([
      tx.select().from(inspections).where(and(eq(inspections.companyId, a.tenant), eq(inspections.status, "approved"), gte(inspections.period, since))),
      tx.select({ id: templates.id, name: templates.name }).from(templates).where(eq(templates.companyId, a.tenant)),
      tx.select({ id: units.id, name: units.name }).from(units).where(eq(units.companyId, a.tenant)),
    ]);
    const visible = rows.filter((r) => inScope(a, r.unitId));
    const tName = new Map(tpl.map((t) => [t.id, t.name])), uName = new Map(us.map((u) => [u.id, u.name]));
    const defs = new Map<string, TemplateDef | null>();
    const q = new Map<string, { template: string; label: string; critical: boolean; fails: number; asked: number; sites: Set<string> }>();
    const site = new Map<string, { n: number; sum: number; c: number; failed: number; critical: number }>();
    const byT = new Map<string, { n: number; sum: number; c: number; pass: number }>();
    for (const r of visible) {
      const k = `${r.templateId}@${r.templateVersion}`;
      if (!defs.has(k)) defs.set(k, await loadVersion(tx, a.tenant, r.templateId, r.templateVersion));
      const def = defs.get(k);
      const sc = r.score as StoredScore | null;
      const s = site.get(r.unitId) || { n: 0, sum: 0, c: 0, failed: 0, critical: 0 };
      s.n++; if (sc?.pct != null) { s.sum += sc.pct; s.c++; } if (sc?.result === "fail") s.failed++; s.critical += sc?.criticalFails ?? 0; site.set(r.unitId, s);
      const t = byT.get(r.templateId) || { n: 0, sum: 0, c: 0, pass: 0 };
      t.n++; if (sc?.pct != null) { t.sum += sc.pct; t.c++; } if (sc?.result === "pass") t.pass++; byT.set(r.templateId, t);
      if (!def) continue;
      const scopes: { sec: TemplateDef["sections"][number]; ans: Answers }[] = [];
      for (const sec of def.sections) {
        if (sec.perItem) for (const it of (r.items as SampledItem[]) || []) scopes.push({ sec, ans: it.answers || {} });
        else scopes.push({ sec, ans: (r.answers as Answers) || {} });
      }
      for (const { sec, ans } of scopes) for (const qq of sec.questions) {
        if (qq.weight <= 0 || !isVisible(qq, sec, ans)) continue;
        const o = answerScore(qq, ans[qq.id]).outcome;
        if (o !== "pass" && o !== "fail") continue;
        const key = `${r.templateId}|${qq.label}`;
        const e = q.get(key) || { template: tName.get(r.templateId) ?? "", label: qq.label, critical: qq.critical, fails: 0, asked: 0, sites: new Set<string>() };
        e.asked++; if (o === "fail") { e.fails++; e.sites.add(uName.get(r.unitId) ?? ""); }
        q.set(key, e);
      }
    }
    return {
      since, total: visible.length,
      questions: Array.from(q.values()).filter((x) => x.fails > 0).map((x) => ({ ...x, rate: x.fails / x.asked, sites: Array.from(x.sites) })).sort((x, y) => y.fails - x.fails || y.rate - x.rate).slice(0, 10),
      sites: Array.from(site.entries()).map(([id, s]) => ({ unitId: id, name: uName.get(id) ?? "—", n: s.n, avg: s.c ? s.sum / s.c : null, failed: s.failed, critical: s.critical })).sort((x, y) => (x.avg ?? 101) - (y.avg ?? 101)),
      templates: Array.from(byT.entries()).map(([id, t]) => ({ id, name: tName.get(id) ?? "", n: t.n, avg: t.c ? t.sum / t.c : null, passRate: t.n ? t.pass / t.n : null })).sort((x, y) => y.n - x.n),
    };
  });
}
