// The additive "inspections" block of GET /api/pulse (docs/platform-feed.md):
// inspection results, the site risk scores and missed visits, for Pulsus
// Platform's brief and for Pulsus Risk to use as key risk indicators.
import { and, eq, gte } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { inspections, samplingPlans } from "@/lib/db/schema";
import { loadSettings } from "@/lib/company";
import { scoreSite } from "@/lib/risk";
import { siteInputs } from "@/lib/riskScore";
import { visits } from "@/lib/schedule";
import type { Actor } from "@/lib/roles";
import type { StoredScore } from "@/lib/inspections";
import type { Evaluation } from "@/lib/sampling";

export async function inspectionsBlock(companyId: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * 864e5);
  const base = await withTenant(companyId, async (tx) => {
    const s = await loadSettings(tx, companyId);
    const ins = await tx.select({ score: inspections.score }).from(inspections).where(and(eq(inspections.companyId, companyId), eq(inspections.status, "approved"), gte(inspections.approvedAt, since)));
    const scores = ins.map((i) => i.score as StoredScore | null).filter((x): x is StoredScore => !!x);
    const pcts = scores.map((x) => x.pct).filter((x): x is number => x !== null);
    const plans = await tx.select({ evaluation: samplingPlans.evaluation }).from(samplingPlans).where(and(eq(samplingPlans.companyId, companyId), eq(samplingPlans.status, "evaluated")));
    const evals = plans.map((p) => p.evaluation as Evaluation);
    const sites = (await siteInputs(tx, companyId, now)).inputs.map((i) => scoreSite(i, s.risk)).filter((r) => r.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const bandCounts: Record<string, number> = {};
    for (const r of sites) bandCounts[r.band] = (bandCounts[r.band] || 0) + 1;
    return {
      unitLabel: s.unitLabel,
      last90Days: { approved: scores.length, averageScore: pcts.length ? Math.round((pcts.reduce((t, x) => t + x, 0) / pcts.length) * 10) / 10 : null, failed: scores.filter((x) => x.result === "fail").length, criticalFailures: scores.reduce((t, x) => t + x.criticalFails, 0) },
      sampling: { evaluated: evals.length, notEffective: evals.filter((e) => !e.effective).length },
      risk: { bands: bandCounts, sites: sites.map((r) => ({ name: r.name, score: r.score, band: r.band, topDriver: r.top ? { label: r.top.label, detail: r.top.detail, contribution: r.top.contribution } : null })) },
    };
  });
  const system: Actor = { tenant: companyId, tenantName: companyId, kind: "company", email: "pulse@pulsus.tech", name: "Pulsus", roles: ["admin"], unitIds: [], platformRole: "service", operator: false, plan: null };
  const vs = await visits(system, { now, fromDay: new Date(now.getTime() - 90 * 864e5).toISOString().slice(0, 10) });
  return { schema: "pulsus.quality.inspections/v1", ...base, visits: { overdue: vs.filter((v) => v.status === "overdue").length, dueNow: vs.filter((v) => v.status === "due").length, done: vs.filter((v) => v.status === "done").length } };
}
