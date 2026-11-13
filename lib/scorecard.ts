// Configurable scorecards. A scorecard is a tree of measures: inputs keyed
// monthly per unit (0–100), and computed measures that average their children
// (optionally weighted, optionally rounded). The institution's Operational
// Standard is the first template, and it reproduces the bank's Metric
// Computation worksheet exactly:
//
//   Major Procedure  = round( mean of the 8 SOP standards )
//   Risk Metrics     = mean( Onboarding SLA, audit points, Audit Resolution )
//   Overall          = mean( Complaints, Procurement, Risk Metrics, Queue SLA, Major Procedure )
//   Avg Customer SLA = mean( Queue SLA, Onboarding SLA )
//
// "@audit" stands for the audit grade's points (A 100, B+ 80, B 60, C 40, D 20).

export interface Measure {
  key: string;
  label: string;
  /** input: keyed monthly; computed: averages other measures; inspection: taken from approved inspections of a template. */
  kind: "input" | "computed" | "inspection";
  /** For an inspection measure: which template, and which result (the average score, the pass rate, or 100 − the deviation rate). */
  source?: { templateId: string; metric: "score" | "passRate" | "compliance" };
  /** For a computed measure: the measures it averages ("@audit" = audit points). */
  of?: string[];
  /** Optional weights, one per entry of `of` (default equal). */
  weights?: number[];
  /** Round to a whole number before it feeds anything else. */
  round?: boolean;
  /** A short group name for the entry form. */
  group?: string;
}

export interface ScorecardDef {
  name: string;
  /** In evaluation order: a computed measure comes after everything it uses. */
  measures: Measure[];
  /** The headline measure. */
  overall: string;
  /** The columns dashboards show, in order (the first is the headline). */
  columns: { key: string; label: string }[];
  /** The target score: the gauge marker. */
  target: number;
  /** Whether the scorecard records an audit grade. */
  audit: boolean;
}

const sop = (key: string, label: string): Measure => ({ key, label, kind: "input", group: "Major procedures (SOP)" });

/** The institution's Operational Standard: template version 1. */
export const OPERATIONAL_STANDARD: ScorecardDef = {
  name: "Operational Standard",
  measures: [
    sop("screening", "Customer screening"), sop("wires", "Wire transfers"), sop("sourceOfFunds", "Source of funds"), sop("csl", "Customer service log"),
    sop("fees", "Fees and charges"), sop("declaration", "Declarations"), sop("salesService", "Sales and service"), sop("acknowledgement", "Acknowledgements"),
    { key: "complaints", label: "Complaints Resolved", kind: "input", group: "Service" },
    { key: "procurement", label: "Procurement", kind: "input", group: "Service" },
    { key: "queueSla", label: "Queue SLA", kind: "input", group: "Service" },
    { key: "onboardingSla", label: "Onboarding SLA", kind: "input", group: "Risk" },
    { key: "auditResolution", label: "Audit Resolution", kind: "input", group: "Risk" },
    { key: "majorProcedure", label: "Major Procedure", kind: "computed", of: ["screening", "wires", "sourceOfFunds", "csl", "fees", "declaration", "salesService", "acknowledgement"], round: true },
    { key: "riskMetrics", label: "Risk Metrics", kind: "computed", of: ["onboardingSla", "@audit", "auditResolution"] },
    { key: "overall", label: "Op Standard Score", kind: "computed", of: ["complaints", "procurement", "riskMetrics", "queueSla", "majorProcedure"] },
    { key: "avgCustomerSla", label: "Average Customer SLA", kind: "computed", of: ["queueSla", "onboardingSla"] },
    { key: "avgMajorProcedure", label: "Avg Procedure Compliance", kind: "computed", of: ["majorProcedure"] },
  ],
  overall: "overall",
  // The order of the original dataset's columns, which the platform feed reads by position.
  columns: [
    { key: "overall", label: "Op Standard Score" }, { key: "avgCustomerSla", label: "Average Customer SLA" }, { key: "queueSla", label: "Queue SLA" },
    { key: "onboardingSla", label: "Onboarding SLA" }, { key: "procurement", label: "Procurement" }, { key: "majorProcedure", label: "Major Procedure" },
    { key: "avgMajorProcedure", label: "Avg Procedure Compliance" }, { key: "complaints", label: "Complaints Resolved" }, { key: "auditResolution", label: "Audit Resolution" },
  ],
  target: 90,
  audit: true,
};

/** A neutral starting scorecard for a company that has none. */
export const BRANCH_STANDARDS: ScorecardDef = {
  name: "Branch Standards",
  measures: [
    { key: "service", label: "Service standards", kind: "input", group: "Standards" },
    { key: "compliance", label: "Procedure compliance", kind: "input", group: "Standards" },
    { key: "sla", label: "Turnaround (SLA met)", kind: "input", group: "Standards" },
    { key: "complaints", label: "Complaints resolved", kind: "input", group: "Standards" },
    { key: "overall", label: "Branch standards score", kind: "computed", of: ["service", "compliance", "sla", "complaints"] },
  ],
  overall: "overall",
  columns: [{ key: "overall", label: "Standards score" }, { key: "service", label: "Service" }, { key: "compliance", label: "Compliance" }, { key: "sla", label: "SLA met" }, { key: "complaints", label: "Complaints" }],
  target: 90,
  audit: false,
};

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Evaluate every measure from the keyed inputs and the audit points. */
export function evaluate(def: ScorecardDef, inputs: Record<string, number | null | undefined>, auditPoints: number | null): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const m of def.measures) {
    if (m.kind !== "computed") { const v = inputs[m.key]; out[m.key] = fin(v) ? v : null; continue; }
    let s = 0, w = 0;
    (m.of || []).forEach((k, i) => {
      const v = k === "@audit" ? auditPoints : out[k];
      if (!fin(v)) return;
      const wt = m.weights?.[i] ?? 1;
      s += v * wt; w += wt;
    });
    const v = w ? s / w : null;
    out[m.key] = v == null ? null : m.round ? Math.round(v) : v;
  }
  return out;
}

/** Validate a scorecard definition an admin edits: unique keys, computed measures only use earlier ones. */
export function validateDefinition(raw: unknown): { ok: true; def: ScorecardDef } | { ok: false; error: string } {
  const d = (raw && typeof raw === "object" ? raw : {}) as Partial<ScorecardDef>;
  const name = String(d.name || "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the scorecard." };
  if (!Array.isArray(d.measures) || !d.measures.length) return { ok: false, error: "Add at least one measure." };
  if (d.measures.length > 60) return { ok: false, error: "Up to 60 measures." };
  const seen = new Set<string>();
  const measures: Measure[] = [];
  for (const m of d.measures) {
    const key = String(m?.key || "").trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) return { ok: false, error: `“${key}” isn't a valid measure key.` };
    if (seen.has(key)) return { ok: false, error: `“${key}” is listed twice.` };
    const label = String(m?.label || "").trim().slice(0, 80);
    if (!label) return { ok: false, error: `Give “${key}” a label.` };
    if (m.kind === "computed") {
      const of = Array.isArray(m.of) ? m.of.map(String) : [];
      if (!of.length) return { ok: false, error: `“${label}” averages nothing.` };
      for (const k of of) if (k !== "@audit" && !seen.has(k)) return { ok: false, error: `“${label}” uses “${k}”, which must come before it.` };
      const weights = Array.isArray(m.weights) ? m.weights.map(Number) : undefined;
      if (weights && (weights.length !== of.length || weights.some((x) => !Number.isFinite(x) || x < 0))) return { ok: false, error: `“${label}” has invalid weights.` };
      measures.push({ key, label, kind: "computed", of, ...(weights ? { weights } : {}), ...(m.round ? { round: true } : {}) });
    } else if (m.kind === "inspection") {
      const templateId = String(m.source?.templateId || "").slice(0, 80);
      if (!templateId) return { ok: false, error: `Choose the checklist “${label}” comes from.` };
      const metric = m.source?.metric === "passRate" || m.source?.metric === "compliance" ? m.source.metric : "score";
      measures.push({ key, label, kind: "inspection", source: { templateId, metric }, ...(m.group ? { group: String(m.group).slice(0, 40) } : {}) });
    } else {
      measures.push({ key, label, kind: "input", ...(m.group ? { group: String(m.group).slice(0, 40) } : {}) });
    }
    seen.add(key);
  }
  const overall = String(d.overall || "");
  if (!seen.has(overall)) return { ok: false, error: "Choose the headline measure." };
  const columns = (Array.isArray(d.columns) && d.columns.length ? d.columns : [{ key: overall, label: measures.find((m) => m.key === overall)!.label }])
    .filter((c) => seen.has(String(c?.key))).map((c) => ({ key: String(c.key), label: String(c.label || c.key).slice(0, 60) }));
  const target = Number(d.target);
  return { ok: true, def: { name, measures, overall, columns, target: Number.isFinite(target) && target > 0 && target <= 100 ? target : 90, audit: !!d.audit } };
}
