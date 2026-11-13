// The rules that run on their own, after an event or on the scheduled sweep:
//
//  • an inspection approved → webhook; a critical failure → a finding proposed
//    to Pulsus Risk; a sampling plan it evaluates as "not effective" → a KRI
//    breach proposed to Risk; then the band check;
//  • the band check → a site whose risk band changed → webhook; a site entering
//    Attention or Escalate (from a better band) → a KRI breach proposed to Risk;
//  • the sweep (GET /api/cron/sweep, and at most every ten minutes when someone
//    opens the app) → the band check, overdue actions (webhook once per due
//    date), effectiveness checks falling due, scheduled reports, and retries of
//    failed webhooks and proposals.
//
// Every proposal and delivery is idempotent (lib/riskLink.ts, lib/webhooks.ts),
// so running a rule twice changes nothing. They act as "Pulsus Quality
// automation", never as a person, so they can't approve or verify anything.
import { and, eq, inArray, ne } from "drizzle-orm";
import { listTenantIds, withTenant } from "@/lib/db/client";
import { actions, counters, inspections, samplingPlans, siteBands, templates, units } from "@/lib/db/schema";
import { loadSettings } from "@/lib/company";
import { riskBoard } from "@/lib/riskScore";
import { buildProposal, propose, retryFailed } from "@/lib/riskLink";
import { emit, retryDeliveries } from "@/lib/webhooks";
import { BANDS, type BandKey } from "@/lib/bands";
import { record } from "@/lib/audit";
import type { Actor } from "@/lib/roles";
import type { StoredScore } from "@/lib/inspections";
import type { Evaluation } from "@/lib/sampling";
import type { Effectiveness } from "@/lib/actionRules";

export const AUTOMATION = "automation@pulsus.quality";
const appUrl = () => (process.env.APP_URL || "https://quality.pulsus.tech").replace(/\/+$/, "");
const label = (b: string) => BANDS.find((x) => x.key === b)?.label ?? "No data";
const RANK: Record<string, number> = { none: -1, worldClass: 0, strong: 1, healthy: 2, watch: 3, attention: 4, escalate: 5 };

/** The automation's own identity: sees every site, holds no approving role. */
export function systemActor(companyId: string, tenantName = ""): Actor {
  return { tenant: companyId, tenantName, kind: companyId === "_own" ? "institution" : companyId === "_demo" ? "demo" : "company", email: AUTOMATION, name: "Pulsus Quality automation", roles: ["viewer"], unitIds: [], platformRole: "system", operator: false, plan: null };
}
const who = { email: AUTOMATION, name: "Pulsus Quality automation" };

async function proposeAndTell(companyId: string, p: ReturnType<typeof buildProposal>) {
  const r = await propose(companyId, AUTOMATION, p);
  if (r.ok && !r.duplicate) await emit(companyId, "risk.proposed", p.id, { title: `Proposed to Pulsus Risk: ${p.proposed.kind === "kri_breach" ? "KRI breach" : "finding"}`, text: p.proposed.title, url: p.source.url, facts: [["Severity", p.proposed.severity], ["Status", r.status === "stubbed" ? "stored until Risk is connected" : r.status]] });
  return r;
}

/** After an inspection is approved. */
export async function afterInspectionApproved(companyId: string, inspectionId: string, now = new Date()): Promise<void> {
  const info = await withTenant(companyId, async (tx) => {
    const r = (await tx.select().from(inspections).where(and(eq(inspections.companyId, companyId), eq(inspections.id, inspectionId))).limit(1))[0];
    if (!r || r.status !== "approved") return null;
    const unit = (await tx.select().from(units).where(and(eq(units.companyId, companyId), eq(units.id, r.unitId))).limit(1))[0];
    const tpl = (await tx.select({ name: templates.name }).from(templates).where(and(eq(templates.companyId, companyId), eq(templates.id, r.templateId))).limit(1))[0];
    const plans = await tx.select({ id: samplingPlans.id }).from(samplingPlans).where(and(eq(samplingPlans.companyId, companyId), eq(samplingPlans.inspectionId, inspectionId)));
    return { r, unit, template: tpl?.name ?? "Checklist", settings: await loadSettings(tx, companyId), plans: plans.map((p) => p.id) };
  });
  if (!info) return;
  const { r, unit, template, settings } = info;
  const s = (r.score as StoredScore | null);
  const pct = s?.pct == null ? "—" : `${Math.round(s.pct)}%`;
  await emit(companyId, "inspection.approved", inspectionId, {
    title: `${r.ref} approved: ${unit?.name ?? ""}`, text: `${template} at ${unit?.name ?? "—"} scored ${pct}${s?.criticalFails ? `, with ${s.criticalFails} critical failure${s.criticalFails === 1 ? "" : "s"}` : ""}.`,
    url: `${appUrl()}/inspect/${inspectionId}`, facts: [[settings.unitLabel, unit?.name ?? "—"], ["Checklist", template], ["Score", pct], ["Result", s?.result ?? "—"], ["Approved by", r.supervisorEmail ?? "—"]],
    inspection: { id: r.id, ref: r.ref, unitId: r.unitId, templateId: r.templateId, score: s?.pct ?? null, result: s?.result ?? null, criticalFails: s?.criticalFails ?? 0, approvedAt: r.approvedAt?.toISOString() ?? null },
  });
  if (s && s.criticalFails > 0) {
    const crit = (s.findings || []).filter((f) => f.critical);
    const labels = Array.from(new Set((crit.length ? crit : s.findings || []).map((f) => f.label))).slice(0, 5);
    await proposeAndTell(companyId, buildProposal({ tenant: companyId, ...who }, {
      recordType: "inspection", recordRef: inspectionId, kind: "finding", rule: "critical_failure",
      title: `Critical failure at ${unit?.name ?? "a site"}: ${labels[0] ?? template}`.slice(0, 200),
      description: `${r.ref} (${template}) at ${unit?.name ?? "—"} was approved with ${s.criticalFails} critical failure${s.criticalFails === 1 ? "" : "s"}: ${labels.join("; ")}. Score ${pct}. Corrective actions were raised in Pulsus Quality.`,
      severity: s.criticalFails >= 3 ? "critical" : "high", unitName: unit?.name ?? "—", unitType: settings.unitLabel, area: template, detectedAt: (r.approvedAt ?? now).toISOString(), path: `/inspect/${inspectionId}`,
    }));
  }
  for (const id of info.plans) await afterPlanEvaluated(companyId, id);
  await checkBands(companyId, now);
}

/** After a sampling plan is evaluated: a control found not effective is proposed to Risk as a KRI breach. */
export async function afterPlanEvaluated(companyId: string, planId: string): Promise<void> {
  const row = await withTenant(companyId, async (tx) => {
    const p = (await tx.select().from(samplingPlans).where(and(eq(samplingPlans.companyId, companyId), eq(samplingPlans.id, planId))).limit(1))[0];
    if (!p) return null;
    const unit = p.unitId ? (await tx.select().from(units).where(and(eq(units.companyId, companyId), eq(units.id, p.unitId))).limit(1))[0] : null;
    return { p, unit, settings: await loadSettings(tx, companyId) };
  });
  const ev = row?.p.evaluation as Evaluation | null | undefined;
  if (!row || !ev || ev.effective) return;
  const { p, unit, settings } = row;
  const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
  await proposeAndTell(companyId, buildProposal({ tenant: companyId, ...who }, {
    recordType: "sampling_plan", recordRef: `${planId}|${p.populationHash.slice(0, 12)}|${ev.deviations}`, kind: "kri_breach", rule: "sampling_failed",
    title: `Control not effective: ${p.name}`.slice(0, 200),
    description: `Sampling plan ${p.ref} found ${ev.deviations} deviation${ev.deviations === 1 ? "" : "s"} in ${ev.n} items. The upper deviation limit at ${Math.round(ev.confidence * 100)}% confidence is ${pc(ev.upper)}, above the tolerable rate of ${pc(ev.tdr)}, so the control cannot be relied on. Seed "${p.seed}"; the selection can be re-run in Pulsus Quality.`,
    severity: ev.upper >= ev.tdr * 2 ? "high" : "medium", unitName: unit?.name ?? "All", unitType: settings.unitLabel, area: p.name, detectedAt: new Date().toISOString(), path: `/sampling/${planId}`,
    kri: { key: "quality.sampling.upper_deviation_limit", name: "Upper deviation limit (sampled control)", value: Math.round(ev.upper * 1000) / 10, threshold: Math.round(ev.tdr * 1000) / 10, direction: "above", unit: "percent", period: (p.period ? String(p.period).slice(0, 7) : new Date().toISOString().slice(0, 7)) },
  }));
}

/** Compare each site's band with the last one seen. A change → webhook; entering Attention or Escalate from a better band → KRI breach to Risk. */
export async function checkBands(companyId: string, now = new Date()): Promise<{ changed: number; proposed: number }> {
  const board = await riskBoard(systemActor(companyId), now);
  const known = await withTenant(companyId, async (tx) => new Map((await tx.select().from(siteBands).where(eq(siteBands.companyId, companyId))).map((b) => [b.unitId, b])));
  const s = await withTenant(companyId, (tx) => loadSettings(tx, companyId));
  let changed = 0, proposed = 0;
  for (const site of board.sites) {
    if (site.band === "none") continue;
    const was = known.get(site.unitId);
    if (was && was.band === site.band) continue;
    const day = now.toISOString().slice(0, 10);
    await withTenant(companyId, async (tx) => {
      await tx.insert(siteBands).values({ companyId, unitId: site.unitId, band: site.band, score: site.score, since: now })
        .onConflictDoUpdate({ target: [siteBands.companyId, siteBands.unitId], set: { band: site.band, score: site.score, since: now } });
      await record(tx, companyId, { actor: AUTOMATION, action: "risk.band", entityType: "unit", entityId: site.unitId, summary: `${site.name}: ${was ? `${label(was.band)} → ` : ""}${label(site.band)} (${site.score})`, before: was ? { band: was.band } : null, after: { band: site.band, score: site.score } });
    });
    changed++;
    const top = site.top ? `${site.top.label}: ${site.top.detail}` : "—";
    if (was) await emit(companyId, "site.band_changed", `${site.unitId}:${site.band}:${day}`, {
      title: `${site.name} moved to ${label(site.band)}`, text: `${site.name}'s quality risk score is ${site.score} (was ${label(was.band)}). Biggest driver: ${top}.`, url: `${appUrl()}/risk`,
      facts: [[s.unitLabel, site.name], ["Band", `${label(was.band)} → ${label(site.band)}`], ["Score", String(site.score)], ["Biggest driver", top]],
      site: { unitId: site.unitId, from: was.band, to: site.band, score: site.score },
    });
    const worse = RANK[site.band] > RANK[was?.band ?? "none"];
    if ((site.band === "attention" || site.band === "escalate") && worse) {
      const threshold = site.band === "escalate" ? board.config.cutoffs.attention : board.config.cutoffs.watch;
      const r = await proposeAndTell(companyId, buildProposal({ tenant: companyId, ...who }, {
        recordType: "site_risk", recordRef: `${site.unitId}|${site.band}|${day}`, kind: "kri_breach", rule: "site_band",
        title: `${site.name} entered ${label(site.band)} (quality risk ${site.score})`,
        description: `${site.name}'s quality risk score is ${site.score} of 100, at or above the ${label(site.band)} threshold of ${threshold}${was ? ` (it was ${label(was.band)})` : ""}. Drivers: ${site.drivers.filter((d) => d.contribution > 0).slice(0, 4).map((d) => `${d.label} +${d.contribution} (${d.detail})`).join("; ")}.`,
        severity: site.band === "escalate" ? "high" : "medium", unitName: site.name, unitType: s.unitLabel, area: null, detectedAt: now.toISOString(), path: "/risk",
        kri: { key: "quality.site_risk_score", name: `${s.unitLabel} quality risk score`, value: site.score ?? 0, threshold, direction: "above", unit: "score", period: day.slice(0, 7) },
      }));
      if (r.ok && !r.duplicate) proposed++;
    }
  }
  return { changed, proposed };
}

/** Overdue actions → one webhook per action per due date. */
export async function checkOverdue(companyId: string, now = new Date()): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  const rows = await withTenant(companyId, async (tx) => {
    const xs = (await tx.select().from(actions).where(and(eq(actions.companyId, companyId), ne(actions.status, "closed")))).filter((x) => String(x.dueDate) < today);
    const us = xs.length ? await tx.select({ id: units.id, name: units.name }).from(units).where(and(eq(units.companyId, companyId), inArray(units.id, Array.from(new Set(xs.map((x) => x.unitId)))))) : [];
    const un = new Map(us.map((u) => [u.id, u.name]));
    return xs.map((x) => ({ ...x, unitName: un.get(x.unitId) ?? "—" }));
  });
  let n = 0;
  for (const x of rows) {
    const due = String(x.dueDate).slice(0, 10);
    const days = Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
    n += await emit(companyId, "action.overdue", `${x.id}:${due}`, {
      title: `${x.ref} is overdue`, text: `${x.title} at ${x.unitName}: due ${due}, ${days} day${days === 1 ? "" : "s"} ago. Owner: ${x.ownerName || x.ownerEmail || "unassigned"}.`, url: `${appUrl()}/actions?open=${x.id}`,
      facts: [["Site", x.unitName], ["Owner", x.ownerName || x.ownerEmail || "—"], ["Due", due], ["Priority", x.priority]],
      action: { id: x.id, ref: x.ref, unitId: x.unitId, dueDate: due, status: x.status, priority: x.priority },
    });
  }
  return n;
}

/** Effectiveness checks whose date has passed without a re-inspection become "due". */
export async function checkEffectivenessDue(companyId: string, now = new Date()): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  return withTenant(companyId, async (tx) => {
    const xs = (await tx.select().from(actions).where(and(eq(actions.companyId, companyId), eq(actions.status, "closed")))).filter((x) => { const e = x.effectiveness as Effectiveness | null; return e?.status === "pending" && e.due <= today; });
    for (const x of xs) await tx.update(actions).set({ effectiveness: { ...(x.effectiveness as Effectiveness), status: "due" } }).where(eq(actions.id, x.id));
    return xs.length;
  });
}

export interface SweepResult { companyId: string; bands: { changed: number; proposed: number }; overdue: number; effectivenessDue: number; reports: number; retried: number; error?: string }

/** Everything that runs on a schedule, for one company. */
export async function sweep(companyId: string, now = new Date()): Promise<SweepResult> {
  const out: SweepResult = { companyId, bands: { changed: 0, proposed: 0 }, overdue: 0, effectivenessDue: 0, reports: 0, retried: 0 };
  try {
    out.bands = await checkBands(companyId, now);
    out.overdue = await checkOverdue(companyId, now);
    out.effectivenessDue = await checkEffectivenessDue(companyId, now);
    const { runDueReports } = await import("@/lib/reportBuilder");
    out.reports = await runDueReports(companyId, now);
    out.retried = (await retryDeliveries(companyId)) + (await retryFailed(companyId));
    await withTenant(companyId, async (tx) => {
      await tx.insert(counters).values({ companyId, name: "sweep_at", value: Math.floor(now.getTime() / 60000) }).onConflictDoUpdate({ target: [counters.companyId, counters.name], set: { value: Math.floor(now.getTime() / 60000) } });
    });
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }
  return out;
}

/** The scheduled sweep across every company. */
export async function sweepAll(now = new Date()): Promise<SweepResult[]> {
  const ids = await listTenantIds();
  const out: SweepResult[] = [];
  for (const id of ids) out.push(await sweep(id, now));
  return out;
}

/** Sweep this company if it hasn't been swept in the last ten minutes (called after a page is served). */
export async function maybeSweep(companyId: string, now = new Date()): Promise<boolean> {
  const last = await withTenant(companyId, async (tx) => (await tx.select({ v: counters.value }).from(counters).where(and(eq(counters.companyId, companyId), eq(counters.name, "sweep_at"))).limit(1))[0]?.v ?? 0);
  if (Math.floor(now.getTime() / 60000) - last < 10) return false;
  await sweep(companyId, now);
  return true;
}

export type { BandKey };
