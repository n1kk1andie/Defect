// Colour bands: the six Pulsus bands (World class → Escalate) with the
// platform's colours, cut where Quality's own measures need them. Pulsus
// Platform's OHI/Stability thresholds are NOT used here: they govern the
// platform's health indices only.
//
// Each measure family has a direction. Defect and recurring rates are better
// LOWER; resolution rate and the Operational Standard score are better HIGHER.
// A company admin can move the cut-offs (Settings → Colour bands and targets);
// the order must stay valid, and every change lands in the change history.
//
// Domain scales keep their own labels and borrow the band colours only: audit
// grades (A … F), the Operational Standard rating (1–5) and severities.

export const BAND_KEYS = ["worldClass", "strong", "healthy", "watch", "attention", "escalate"] as const;
export type BandKey = (typeof BAND_KEYS)[number];
export const CUT_KEYS = ["worldClass", "strong", "healthy", "watch", "attention"] as const;
export type CutKey = (typeof CUT_KEYS)[number];
export type Cutoffs = Record<CutKey, number>;

/** The six suite bands and the platform's colours for them. */
export const BANDS: { key: BandKey; label: string; colour: string }[] = [
  { key: "worldClass", label: "World class", colour: "#16A34A" },
  { key: "strong", label: "Strong", colour: "#22C55E" },
  { key: "healthy", label: "Healthy", colour: "#86EFAC" },
  { key: "watch", label: "Watch", colour: "#EAB308" },
  { key: "attention", label: "Attention", colour: "#F97316" },
  { key: "escalate", label: "Escalate", colour: "#DC2626" },
];
export const bandInfo = (k: BandKey) => BANDS.find((b) => b.key === k)!;

export type FamilyKey = "defectRate" | "recurringRate" | "resolutionRate" | "opStandard";

export interface Family {
  key: FamilyKey;
  label: string;
  /** "down": lower is better (a value at or below a cut-off earns that band); "up": higher is better. */
  direction: "up" | "down";
  /** "rate": a fraction shown as a percentage; "score": 0–100 shown as a number. */
  unit: "rate" | "score";
  /** The measures this set colours, as people see them. */
  appliesTo: string[];
  defaults: Cutoffs;
  /** Why these defaults. */
  basis: string;
}

export const FAMILIES: Family[] = [
  {
    key: "defectRate", label: "Defect rate", direction: "down", unit: "rate",
    appliesTo: ["Defect rate (failed checks ÷ possible instances)", "Branch watchlist", "Defect-rate history heat-map", "Branches by defect rate"],
    defaults: { worldClass: 0.01, strong: 0.02, healthy: 0.035, watch: 0.05, attention: 0.10 },
    basis: "Branch-review practice: under 2% of checks failing is on target; 5% is the usual tolerance and 10% a breach. The original 2/5/10% lines are kept as band edges.",
  },
  {
    key: "recurringRate", label: "Recurring rate", direction: "down", unit: "rate",
    appliesTo: ["Recurring rate (repeat defects ÷ defects)", "Recurring-rate history", "Systemic recurring"],
    defaults: { worldClass: 0.05, strong: 0.10, healthy: 0.175, watch: 0.25, attention: 0.50 },
    basis: "A repeat of a defect already found means the fix didn't hold. Under 10% is strong; a quarter recurring needs a root-cause review; half is an escalation.",
  },
  {
    key: "resolutionRate", label: "Resolution rate", direction: "up", unit: "rate",
    appliesTo: ["Resolution rate (resolved ÷ resolvable defects)", "Resolution gap", "Resolution-rate history"],
    defaults: { worldClass: 0.98, strong: 0.95, healthy: 0.90, watch: 0.80, attention: 0.60 },
    basis: "Defects found should be fixed: 95% resolved is strong, below 80% shows a backlog and below 60% needs escalation. The original 95/80/60% lines are kept.",
  },
  {
    key: "opStandard", label: "Operational Standard score", direction: "up", unit: "score",
    appliesTo: ["Operational Standard score (0–100)", "Each scorecard measure", "Operational Standard heat-map"],
    defaults: { worldClass: 95, strong: 92.5, healthy: 90, watch: 85, attention: 80 },
    basis: "The institution's scale: 95 is world class, 90 the industry average and below 80 unacceptable. Those lines are kept; Strong and Watch split the bands between them.",
  },
];
export const family = (k: FamilyKey) => FAMILIES.find((f) => f.key === k)!;

export type BandOverrides = Partial<Record<FamilyKey, Cutoffs>>;

/** The cut-offs in force for a family: the company's own if set, else the default. */
export function cutoffsFor(k: FamilyKey, overrides?: BandOverrides | null): Cutoffs {
  return overrides?.[k] ?? family(k).defaults;
}

/** The band a value falls in, or null when there is no value. */
export function classify(k: FamilyKey, value: number | null | undefined, overrides?: BandOverrides | null): BandKey | null {
  if (value == null || !Number.isFinite(value)) return null;
  const f = family(k);
  const c = cutoffsFor(k, overrides);
  for (const key of CUT_KEYS) {
    if (f.direction === "down" ? value <= c[key] : value >= c[key]) return key;
  }
  return "escalate";
}

/** Validate an admin's cut-offs: numbers in range, in the right order. */
export function validateCutoffs(k: FamilyKey, raw: unknown): { ok: true; cutoffs: Cutoffs } | { ok: false; error: string } {
  const f = family(k);
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = {} as Cutoffs;
  for (const key of CUT_KEYS) {
    const n = Number(o[key]);
    if (!Number.isFinite(n)) return { ok: false, error: `Enter a number for ${bandInfo(key).label}.` };
    if (f.unit === "rate" && (n < 0 || n > 1)) return { ok: false, error: `${bandInfo(key).label} must be between 0% and 100%.` };
    if (f.unit === "score" && (n < 0 || n > 100)) return { ok: false, error: `${bandInfo(key).label} must be between 0 and 100.` };
    out[key] = Math.round(n * 10000) / 10000;
  }
  for (let i = 1; i < CUT_KEYS.length; i++) {
    const a = out[CUT_KEYS[i - 1]], b = out[CUT_KEYS[i]];
    const ordered = f.direction === "down" ? a < b : a > b;
    if (!ordered) {
      return { ok: false, error: `${bandInfo(CUT_KEYS[i - 1]).label} must be ${f.direction === "down" ? "lower" : "higher"} than ${bandInfo(CUT_KEYS[i]).label}.` };
    }
  }
  return { ok: true, cutoffs: out };
}

/** "≤ 2.0%", "≥ 95", the edge of one band, as people read it. */
export function edgeLabel(k: FamilyKey, v: number): string {
  const f = family(k);
  const s = f.unit === "rate" ? `${+(v * 100).toFixed(1)}%` : `${+v.toFixed(1)}`;
  return `${f.direction === "down" ? "≤" : "≥"} ${s}`;
}

/** The legend for a family: each band with its range. */
export function legend(k: FamilyKey, overrides?: BandOverrides | null): { key: BandKey; label: string; colour: string; range: string }[] {
  const f = family(k);
  const c = cutoffsFor(k, overrides);
  return BANDS.map((b) => {
    if (b.key === "escalate") {
      const last = c.attention;
      return { ...b, range: f.direction === "down" ? `> ${edgeLabel(k, last).slice(2)}` : `< ${edgeLabel(k, last).slice(2)}` };
    }
    return { ...b, range: edgeLabel(k, c[b.key as CutKey]) };
  });
}

// ── Domain scales: their own labels, the band colours ─────────────────────────

/** Audit grades, as the institution records them (1–5 in 2024, A–D from 2025). */
export const AUDIT_GRADES: { grade: string; band: BandKey }[] = [
  { grade: "A", band: "worldClass" },
  { grade: "B+", band: "strong" },
  { grade: "B", band: "healthy" },
  { grade: "C", band: "watch" },
  { grade: "D", band: "attention" },
  { grade: "F", band: "escalate" },
];
export const gradeBand = (g: string | null): BandKey | null => AUDIT_GRADES.find((x) => x.grade === g)?.band ?? null;

/** The letter grade for a raw audit score on either scale: 1–5 (2024) or points 0–100 (from 2025). */
export function auditGrade(s: number | null | undefined): string | null {
  if (s == null || !Number.isFinite(s)) return null;
  if (s <= 5) return ({ 5: "A", 4: "B", 3: "C", 2: "D", 1: "F" } as Record<number, string>)[Math.round(s)] ?? null;
  if (s >= 100) return "A";
  if (s >= 80) return "B+";
  if (s >= 60) return "B";
  if (s >= 40) return "C";
  if (s >= 20) return "D";
  return "F";
}

/** Points for a letter grade keyed in a review (drives the scorecard's risk metrics). */
export const AUDIT_POINTS: Record<string, number> = { A: 100, "B+": 80, B: 60, C: 40, D: 20 };

/** The Operational Standard rating (1–5) and its band colour. */
export function opStdRating(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v >= 95 ? 5 : v >= 80 ? 4 : v >= 70 ? 3 : v >= 60 ? 2 : 1;
}
export const ratingBand = (r: number | null): BandKey | null => (r == null ? null : (["escalate", "attention", "watch", "strong", "worldClass"] as BandKey[])[r - 1] ?? null);

/** Severities keep their own words. */
export const SEVERITY_BAND: Record<string, BandKey> = { critical: "escalate", major: "attention", minor: "watch" };
