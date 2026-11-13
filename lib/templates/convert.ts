// The institution's existing reviews, as templates. Pure.
//
//   Branch Defects       one sampled template per process area: each sampled
//                        item is tested against the area's checks (pass/fail,
//                        severity kept, check code as the key). Approving an
//                        inspection of it feeds the Branch Defects figures at
//                        month × site × area, as a review does.
//   Operational Standard a template bound to the scorecard: one number question
//                        (0–100) per input measure, keyed to the measure, and
//                        the audit grade. Approving one writes the scorecard
//                        entry, as the old entry form did.
import { TEMPLATE_SCHEMA, type Question, type TemplateDef } from "@/lib/templates/model";
import type { ProgramArea } from "@/lib/company";
import type { ScorecardDef } from "@/lib/scorecard";
import type { CompanySettings } from "@/lib/settings";
import { SEVERITY_WEIGHT_DEFAULT } from "@/lib/templates/severity";

const safeId = (s: string, i: number) => (s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30) || "c") + "_" + i;

export function defectsTemplate(area: ProgramArea, settings: Pick<CompanySettings, "unitLabel" | "itemLabel" | "itemTypes" | "severityWeights">): TemplateDef {
  const w = settings.severityWeights || SEVERITY_WEIGHT_DEFAULT;
  const checks: Question[] = area.checks.map((c, i) => ({
    id: safeId(c.code, i), type: "passfail", label: c.label, required: true, allowNA: true, weight: w[c.severity] ?? 1,
    severity: c.severity, critical: false, key: c.code,
    ...(c.severity === "critical" ? { action: { auto: true, priority: "high" as const, dueDays: 14 } } : {}),
  }));
  return {
    schema: TEMPLATE_SCHEMA,
    name: `${settings.unitLabel} Defects · ${area.name}`,
    description: `The ${area.name} review: each sampled ${settings.itemLabel.toLowerCase()} is tested against the area's checklist. Failed checks are defects and feed the ${settings.unitLabel} Defects register.`,
    sector: "banking", category: "Branch Defects",
    sampling: { itemLabel: settings.itemLabel, min: 1, max: 200 },
    scoring: { passMark: 95, critical: "fail" },
    binding: { kind: "defects", areaId: area.id },
    signatures: { inspector: false, site: false }, checkin: false,
    sections: [{
      id: "items", title: `Each ${settings.itemLabel.toLowerCase()}`, perItem: true,
      questions: [
        { id: "ref", type: "reference", label: `${settings.itemLabel} reference`, required: false, allowNA: false, weight: 0, severity: "minor", critical: false },
        { id: "itemType", type: "choice", label: "Type", required: false, allowNA: false, weight: 0, severity: "minor", critical: false, key: "@itemType", options: settings.itemTypes.map((t, i) => ({ id: `t${i + 1}`, label: t, score: 1 })) },
        ...checks,
        { id: "nature", type: "text", label: "Nature of the defect", required: false, allowNA: false, weight: 0, severity: "minor", critical: false, key: "@nature", guidance: area.natures.map((n) => n.label).join(" · ") || undefined },
        { id: "recurring", type: "yesno", label: "Is this a recurring defect?", required: false, allowNA: false, weight: 0, severity: "minor", critical: false, key: "@recurring" },
      ],
    }],
  };
}

export function scorecardTemplate(card: ScorecardDef): TemplateDef {
  const inputs = card.measures.filter((m) => m.kind === "input");
  const groups = Array.from(new Set(inputs.map((m) => m.group || "Measures")));
  const sections = groups.map((g, gi) => ({
    id: `g${gi + 1}`, title: g,
    questions: inputs.filter((m) => (m.group || "Measures") === g).map((m): Question => ({
      id: safeId(m.key, 0), type: "number", label: m.label, required: false, allowNA: true, weight: 1, severity: "major", critical: false, key: m.key,
      range: { min: card.target, max: 100, unit: "score" },
      guidance: `Score from 0 to 100. Below the target of ${card.target} counts as a miss.`,
    })),
  }));
  if (card.audit) sections.push({ id: "audit", title: "Audit", questions: [{ id: "auditGrade", type: "choice", label: "Audit grade this month", required: false, allowNA: true, weight: 0, severity: "major", critical: false, key: "@audit", options: ["A", "B+", "B", "C", "D"].map((g, i) => ({ id: g.replace("+", "p"), label: g, score: [1, 0.8, 0.6, 0.4, 0.2][i] })) }] });
  return {
    schema: TEMPLATE_SCHEMA, name: card.name, description: `The monthly ${card.name} scorecard for each site. Approving an entry updates the ${card.name} dashboards.`,
    sector: "banking", category: "Scorecard", scoring: { passMark: card.target, critical: "fail" }, binding: { kind: "scorecard" },
    signatures: { inspector: false, site: false }, checkin: false, sections,
  };
}
