// The quality risk score: one transparent number per site (branch, ward,
// office, campus…), from 0 (low) to 100 (high), with the reasons behind it.
// Pure and tested (tests/risk.test.mjs). Design: docs/quality-model.md §6.
//
// Each driver turns what was observed into a risk from 0 to 100 on a stated
// scale; the score is the weighted average of the drivers that have data
// (a driver with no data is shown, but doesn't count). Recent inspections
// weigh more: each observation is weighted by ½^(age in months ÷ half-life).
// The score maps to the six Pulsus bands — lower is better — and the band
// sets how often the site should be visited.
import { BANDS, type BandKey } from "@/lib/bands";

export const DRIVER_KEYS = ["score", "critical", "deviation", "overdue", "repeat", "recency"] as const;
export type DriverKey = (typeof DRIVER_KEYS)[number];

export const DRIVER_INFO: Record<DriverKey, { label: string; scale: string }> = {
  score: { label: "Inspection scores", scale: "An average of 100% is no risk; 70% or lower is full risk" },
  critical: { label: "Critical failures", scale: "Critical failures per inspection: none is no risk; one in every two inspections is full risk" },
  deviation: { label: "Deviation rate", scale: "Sampled items with a deviation, from file reviews and sampling plans: 0% is no risk; 10% or more is full risk" },
  overdue: { label: "Overdue actions", scale: "Corrective actions past their due date: each one adds 25" },
  repeat: { label: "Repeat findings", scale: "Questions that failed again on the next inspection of the same checklist: each one adds 20" },
  recency: { label: "Time since the last visit", scale: "Up to 30 days is no risk; 150 days or more is full risk" },
};

export interface Factor { key: string; label: string; weight: number; help?: string }
export interface RiskConfig {
  weights: Record<DriverKey, number>;
  /** Organisation-specific factors entered per site, each 0–100 (100 = highest risk). */
  factors: Factor[];
  /** Upper bounds of the first five bands (score below the bound earns the band). */
  cutoffs: Record<Exclude<BandKey, "escalate">, number>;
  /** Visit every N days, by band (risk-based programmes). */
  frequency: Record<BandKey, number>;
  halfLifeMonths: number;
}

export const SECTOR_FACTORS: Record<string, Factor[]> = {
  banking: [{ key: "volume", label: "Transaction volume", weight: 1, help: "Busier branches carry more operational risk" }, { key: "turnover", label: "Staff turnover", weight: 1, help: "New staff make more errors" }],
  healthcare: [{ key: "acuity", label: "Patient acuity and bed occupancy", weight: 1 }, { key: "vacancy", label: "Nurse vacancy rate", weight: 1 }],
  government: [{ key: "caseload", label: "Caseload volume", weight: 1 }, { key: "turnover", label: "Staff turnover", weight: 1 }],
  higher_ed: [{ key: "population", label: "Student population", weight: 1 }, { key: "labs", label: "Labs and hazardous activities", weight: 1 }],
  general: [{ key: "volume", label: "Volume of activity", weight: 1 }, { key: "turnover", label: "Staff turnover", weight: 1 }],
};

export const DEFAULT_RISK: RiskConfig = {
  weights: { score: 3, critical: 2, deviation: 2, overdue: 1.5, repeat: 1.5, recency: 1 },
  factors: SECTOR_FACTORS.banking,
  cutoffs: { worldClass: 15, strong: 25, healthy: 40, watch: 55, attention: 70 },
  frequency: { worldClass: 180, strong: 180, healthy: 90, watch: 60, attention: 30, escalate: 30 },
  halfLifeMonths: 6,
};

const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export function cleanRisk(raw: unknown, sector = "banking"): RiskConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const d = DEFAULT_RISK;
  const weights = Object.fromEntries(DRIVER_KEYS.map((k) => [k, num(o.weights?.[k], d.weights[k], 0, 10)])) as RiskConfig["weights"];
  const fx: Factor[] = Array.isArray(o.factors)
    ? o.factors.slice(0, 8).map((f: any) => ({ key: String(f?.key || "").replace(/[^a-z0-9_]/gi, "").slice(0, 30), label: String(f?.label || "").trim().slice(0, 60), weight: num(f?.weight, 1, 0, 10), ...(f?.help ? { help: String(f.help).slice(0, 160) } : {}) })).filter((f: Factor) => f.key && f.label)
    : SECTOR_FACTORS[sector] ?? d.factors;
  const c = o.cutoffs || {};
  let cut = { worldClass: num(c.worldClass, d.cutoffs.worldClass, 1, 99), strong: num(c.strong, d.cutoffs.strong, 1, 99), healthy: num(c.healthy, d.cutoffs.healthy, 1, 99), watch: num(c.watch, d.cutoffs.watch, 1, 99), attention: num(c.attention, d.cutoffs.attention, 1, 99) };
  const vals = [cut.worldClass, cut.strong, cut.healthy, cut.watch, cut.attention];
  if (vals.some((v, i) => i && v <= vals[i - 1])) cut = { ...d.cutoffs };
  const frequency = Object.fromEntries(BANDS.map((b) => [b.key, Math.round(num(o.frequency?.[b.key], d.frequency[b.key], 7, 730))])) as RiskConfig["frequency"];
  return { weights, factors: fx, cutoffs: cut, frequency, halfLifeMonths: num(o.halfLifeMonths, d.halfLifeMonths, 1, 24) };
}

export function riskBand(score: number | null, cfg: RiskConfig): BandKey | "none" {
  if (score === null) return "none";
  const c = cfg.cutoffs;
  return score < c.worldClass ? "worldClass" : score < c.strong ? "strong" : score < c.healthy ? "healthy" : score < c.watch ? "watch" : score < c.attention ? "attention" : "escalate";
}

/** What was observed at one site. Ages are in months before the as-of date. */
export interface SiteInput {
  unitId: string;
  name: string;
  group?: string | null;
  inspections: { ageMonths: number; pct: number | null; criticalFails: number; items: number; deviations: number }[];
  /** Sampling-plan evaluations (file reviews tested outside an inspection). */
  samples: { ageMonths: number; n: number; deviations: number }[];
  overdueActions: number;
  repeatFindings: { label: string; template: string }[];
  daysSinceVisit: number | null;
  factors: Record<string, number | null | undefined>;
}

export interface Driver { key: string; label: string; detail: string; risk: number | null; weight: number; contribution: number }
export interface SiteRisk { unitId: string; name: string; group: string | null; score: number | null; band: BandKey | "none"; drivers: Driver[]; top: Driver | null; frequencyDays: number | null; observed: number }

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const pc = (x: number) => `${(x * 100).toFixed(1).replace(/\.0$/, "")}%`;

export function scoreSite(s: SiteInput, cfg: RiskConfig): SiteRisk {
  const w = (age: number) => Math.pow(0.5, Math.max(0, age) / cfg.halfLifeMonths);
  const ins = s.inspections;
  const drivers: Omit<Driver, "contribution">[] = [];
  // Inspection scores.
  const scored = ins.filter((i) => i.pct !== null);
  if (scored.length) {
    const tw = scored.reduce((t, i) => t + w(i.ageMonths), 0);
    const avg = scored.reduce((t, i) => t + (i.pct as number) * w(i.ageMonths), 0) / tw;
    drivers.push({ key: "score", label: DRIVER_INFO.score.label, detail: `${avg.toFixed(1)}% average over ${scored.length} inspection${scored.length === 1 ? "" : "s"} (recent ones weigh more)`, risk: clamp(((100 - avg) / 30) * 100), weight: cfg.weights.score });
  } else drivers.push({ key: "score", label: DRIVER_INFO.score.label, detail: "No approved inspections yet", risk: null, weight: cfg.weights.score });
  // Critical failures.
  if (ins.length) {
    const tw = ins.reduce((t, i) => t + w(i.ageMonths), 0);
    const per = ins.reduce((t, i) => t + i.criticalFails * w(i.ageMonths), 0) / tw;
    const n = ins.reduce((t, i) => t + i.criticalFails, 0);
    drivers.push({ key: "critical", label: DRIVER_INFO.critical.label, detail: n ? `${n} critical failure${n === 1 ? "" : "s"} in ${ins.length} inspections` : "None", risk: clamp(per * 200), weight: cfg.weights.critical });
  } else drivers.push({ key: "critical", label: DRIVER_INFO.critical.label, detail: "No approved inspections yet", risk: null, weight: cfg.weights.critical });
  // Deviation rate across sampled items and sampling plans.
  const obs = [...ins.filter((i) => i.items > 0).map((i) => ({ age: i.ageMonths, n: i.items, d: i.deviations })), ...s.samples.map((x) => ({ age: x.ageMonths, n: x.n, d: x.deviations }))];
  if (obs.length) {
    const nn = obs.reduce((t, o) => t + o.n * w(o.age), 0), dd = obs.reduce((t, o) => t + o.d * w(o.age), 0);
    const rate = nn ? dd / nn : 0;
    const raw = obs.reduce((t, o) => t + o.d, 0), rawN = obs.reduce((t, o) => t + o.n, 0);
    drivers.push({ key: "deviation", label: DRIVER_INFO.deviation.label, detail: `${raw} of ${rawN} sampled items with a deviation (${pc(rate)} weighted)`, risk: clamp((rate / 0.1) * 100), weight: cfg.weights.deviation });
  } else drivers.push({ key: "deviation", label: DRIVER_INFO.deviation.label, detail: "No sampled items yet", risk: null, weight: cfg.weights.deviation });
  drivers.push({ key: "overdue", label: DRIVER_INFO.overdue.label, detail: s.overdueActions ? `${s.overdueActions} overdue` : "None overdue", risk: clamp(s.overdueActions * 25), weight: cfg.weights.overdue });
  drivers.push({ key: "repeat", label: DRIVER_INFO.repeat.label, detail: s.repeatFindings.length ? `${s.repeatFindings.length} repeated: ${s.repeatFindings.slice(0, 2).map((r) => `“${r.label.slice(0, 50)}”`).join(", ")}${s.repeatFindings.length > 2 ? "…" : ""}` : "None", risk: clamp(s.repeatFindings.length * 20), weight: cfg.weights.repeat });
  drivers.push({ key: "recency", label: DRIVER_INFO.recency.label, detail: s.daysSinceVisit === null ? "Never visited" : `${s.daysSinceVisit} day${s.daysSinceVisit === 1 ? "" : "s"} since the last inspection`, risk: s.daysSinceVisit === null ? 100 : clamp(((s.daysSinceVisit - 30) / 120) * 100), weight: cfg.weights.recency });
  for (const f of cfg.factors) {
    const v = s.factors[f.key];
    drivers.push({ key: `f:${f.key}`, label: f.label, detail: v == null ? "Not entered" : `${Math.round(v)} out of 100 (entered)`, risk: v == null ? null : clamp(v), weight: f.weight });
  }
  const live = drivers.filter((d) => d.risk !== null && d.weight > 0);
  const tw = live.reduce((t, d) => t + d.weight, 0);
  const score = tw ? Math.round((live.reduce((t, d) => t + d.weight * (d.risk as number), 0) / tw) * 10) / 10 : null;
  const out: Driver[] = drivers.map((d) => ({ ...d, contribution: d.risk !== null && tw ? Math.round(((d.weight * d.risk) / tw) * 10) / 10 : 0 })).sort((a, b) => b.contribution - a.contribution);
  const band = riskBand(score, cfg);
  return { unitId: s.unitId, name: s.name, group: s.group ?? null, score, band, drivers: out, top: out[0]?.contribution ? out[0] : null, frequencyDays: band === "none" ? null : cfg.frequency[band], observed: ins.length + s.samples.length };
}

/** "Why this ward is Escalate": the band and the two biggest drivers, in words. */
export function why(r: SiteRisk, unitLabel: string): string {
  if (r.score === null) return `No data yet for this ${unitLabel.toLowerCase()}.`;
  const label = BANDS.find((b) => b.key === r.band)?.label ?? "";
  const top = r.drivers.filter((d) => d.contribution > 0).slice(0, 2);
  return `${r.name} is ${label} (${r.score}) mainly because of ${top.map((d) => `${d.label.toLowerCase()} (+${d.contribution}): ${d.detail.charAt(0).toLowerCase()}${d.detail.slice(1)}`).join("; and ")}.`;
}
