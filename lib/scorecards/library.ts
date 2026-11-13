// Ready-made scorecards by sector, to copy and adapt in the scorecard
// designer. Pure. A measure may come from a library checklist ("templateKey"):
// when the company has added that checklist, the measure reads its approved
// inspections; otherwise it becomes a monthly entered measure.
import { OPERATIONAL_STANDARD, BRANCH_STANDARDS, type Measure, type ScorecardDef } from "@/lib/scorecard";
import type { Sector } from "@/lib/templates/model";

export type LibraryMeasure = Measure & { templateKey?: string };
export interface ScorecardEntry { key: string; sector: Sector; blurb: string; def: Omit<ScorecardDef, "measures"> & { measures: LibraryMeasure[] } }

const inp = (key: string, label: string, group?: string): LibraryMeasure => ({ key, label, kind: "input", ...(group ? { group } : {}) });
const fromChecklist = (key: string, label: string, templateKey: string, group?: string): LibraryMeasure => ({ key, label, kind: "inspection", source: { templateId: "", metric: "score" }, templateKey, ...(group ? { group } : {}) });
const avg = (key: string, label: string, of: string[], weights?: number[]): LibraryMeasure => ({ key, label, kind: "computed", of, ...(weights ? { weights } : {}) });

export const SCORECARD_LIBRARY: ScorecardEntry[] = [
  { key: "op-standard", sector: "banking", blurb: "The monthly branch standard: eight SOP measures, service SLAs, complaints, procurement and the audit grade, as one score.", def: OPERATIONAL_STANDARD },
  { key: "branch-standards", sector: "banking", blurb: "A lighter branch scorecard: service, procedure compliance, SLA and complaints.", def: BRANCH_STANDARDS },
  {
    key: "ward-quality", sector: "healthcare", blurb: "A ward quality score from hand hygiene, infection control, medicines safety and the chart review, plus falls and patient experience.",
    def: {
      name: "Ward quality score", target: 90, audit: false, overall: "overall",
      measures: [
        fromChecklist("handHygiene", "Hand hygiene compliance", "hc-hand-hygiene", "Infection prevention"),
        fromChecklist("ipc", "Infection control audit", "hc-infection-control", "Infection prevention"),
        fromChecklist("meds", "Medication storage and safety", "hc-medication", "Safety"),
        fromChecklist("records", "Clinical record standards", "hc-chart-review", "Safety"),
        inp("falls", "Falls prevention (harm-free %)", "Outcomes"),
        inp("experience", "Patient experience (% positive)", "Outcomes"),
        avg("ipcScore", "Infection prevention", ["handHygiene", "ipc"]),
        avg("safetyScore", "Patient safety", ["meds", "records", "falls"]),
        avg("overall", "Ward quality score", ["ipcScore", "safetyScore", "experience"], [2, 2, 1]),
      ],
      columns: [{ key: "overall", label: "Ward quality" }, { key: "ipcScore", label: "Infection prevention" }, { key: "safetyScore", label: "Patient safety" }, { key: "experience", label: "Experience" }],
    },
  },
  {
    key: "public-service", sector: "government", blurb: "A service standard score for offices: front-office standards, records, safety and turnaround.",
    def: {
      name: "Public service standard", target: 90, audit: false, overall: "overall",
      measures: [
        fromChecklist("frontOffice", "Front-office standards", "gov-front-office", "Service"),
        inp("turnaround", "Cases closed within the service standard (%)", "Service"),
        fromChecklist("records", "Records management", "gov-records", "Compliance"),
        fromChecklist("safety", "Facilities and health and safety", "gov-facilities-hs", "Compliance"),
        avg("service", "Service", ["frontOffice", "turnaround"]),
        avg("compliance", "Compliance", ["records", "safety"]),
        avg("overall", "Public service standard", ["service", "compliance"], [3, 2]),
      ],
      columns: [{ key: "overall", label: "Service standard" }, { key: "service", label: "Service" }, { key: "compliance", label: "Compliance" }],
    },
  },
  {
    key: "campus-safety", sector: "higher_ed", blurb: "A campus safety and experience score: campus, lab and residence safety, accessibility and student services.",
    def: {
      name: "Campus safety score", target: 90, audit: false, overall: "overall",
      measures: [
        fromChecklist("campus", "Campus safety walk", "he-campus-safety", "Safety"),
        fromChecklist("labs", "Laboratory safety", "he-lab-safety", "Safety"),
        fromChecklist("residence", "Residence halls", "he-residence", "Safety"),
        fromChecklist("access", "Accessibility", "he-accessibility", "Experience"),
        inp("satisfaction", "Student satisfaction (%)", "Experience"),
        avg("safety", "Safety", ["campus", "labs", "residence"]),
        avg("experience", "Experience", ["access", "satisfaction"]),
        avg("overall", "Campus safety score", ["safety", "experience"], [2, 1]),
      ],
      columns: [{ key: "overall", label: "Campus score" }, { key: "safety", label: "Safety" }, { key: "experience", label: "Experience" }],
    },
  },
  {
    key: "site-quality", sector: "general", blurb: "A site score from the health and safety inspection, 5S and the customer experience review.",
    def: {
      name: "Site quality score", target: 85, audit: false, overall: "overall",
      measures: [
        fromChecklist("hs", "Health and safety", "gen-health-safety"),
        fromChecklist("fiveS", "5S", "gen-5s"),
        fromChecklist("cx", "Customer experience", "gen-cx"),
        avg("overall", "Site quality score", ["hs", "fiveS", "cx"], [2, 1, 1]),
      ],
      columns: [{ key: "overall", label: "Site score" }, { key: "hs", label: "H&S" }, { key: "fiveS", label: "5S" }, { key: "cx", label: "CX" }],
    },
  },
];

export const scorecardEntry = (key: string) => SCORECARD_LIBRARY.find((e) => e.key === key) || null;

/** Turn a library scorecard into the company's own: link checklist measures to the company's copies, or make them entered measures. */
export function resolveLibraryScorecard(e: ScorecardEntry, templateIdByKey: Map<string, string>): ScorecardDef {
  const measures: Measure[] = e.def.measures.map(({ templateKey, ...m }) => {
    if (m.kind !== "inspection") return m;
    const id = templateKey ? templateIdByKey.get(templateKey) : undefined;
    return id ? { ...m, source: { templateId: id, metric: m.source?.metric ?? "score" } } : { key: m.key, label: m.label, kind: "input", ...(m.group ? { group: m.group } : {}) };
  });
  return { ...e.def, measures };
}
