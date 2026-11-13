// A company's Quality settings: its labels, how possible instances are counted,
// severity weights, colour bands and recurring-issue rules. Pure types and
// defaults (the browser reads them too); persisted in company_settings.
import type { BandOverrides } from "@/lib/bands";

export type Severity = "critical" | "major" | "minor";
export const SEVERITIES: Severity[] = ["critical", "major", "minor"];

export interface CompanySettings {
  unitLabel: string;       // Branch, Store, Site, Department…
  unitPlural: string;
  itemLabel: string;       // what is sampled: Transaction, File, Record…
  itemTypes: string[];
  /** "item": each sampled item is one possible instance (the institution's register);
   *  "check": each check performed is one (a company's checklist). */
  instanceBasis: "item" | "check";
  severityWeights: Record<Severity, number>;
  bands: BandOverrides;
  /** When the same defect nature recurs at the same unit this many months running, it is a recurring issue. */
  recurringMonths: number;
  /** Whether the scorecard (Operational Standard) section is on. */
  scorecard: boolean;
  /** The organisation's sector: sets the starting labels, template library and risk factors (all editable). */
  sector: "banking" | "healthcare" | "government" | "higher_ed" | "general";
  /** What groups sites: Region, Hospital, Agency, Faculty… */
  groupLabel: string;
  /** Set when an admin finishes (or skips) the set-up wizard. */
  setupDone: boolean;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  unitLabel: "Branch",
  unitPlural: "Branches",
  itemLabel: "Transaction",
  itemTypes: ["New", "Change", "Maintenance", "Other"],
  instanceBasis: "check",
  severityWeights: { critical: 3, major: 2, minor: 1 },
  bands: {},
  recurringMonths: 3,
  scorecard: true,
  sector: "banking",
  groupLabel: "Region",
  setupDone: false,
};

/** English plural of a unit label: Branch → Branches, Agency → Agencies, Store → Stores. */
export function plural(w: string): string {
  if (/(s|x|z|ch|sh)$/i.test(w)) return w + "es";
  if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

const text = (v: unknown, max: number, d: string) => { const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max); return s || d; };

/** Clean stored or submitted settings onto the defaults. */
export function cleanSettings(raw: unknown): CompanySettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const unitLabel = text(o.unitLabel, 30, d.unitLabel);
  const types = Array.isArray(o.itemTypes) ? Array.from(new Set(o.itemTypes.map((t) => text(t, 40, "")).filter(Boolean))).slice(0, 12) : d.itemTypes;
  const w = (o.severityWeights && typeof o.severityWeights === "object" ? o.severityWeights : {}) as Record<string, unknown>;
  const weight = (k: Severity) => { const n = Number(w[k]); return Number.isFinite(n) && n > 0 && n <= 10 ? Math.round(n * 10) / 10 : d.severityWeights[k]; };
  const rm = Math.round(Number(o.recurringMonths));
  return {
    unitLabel,
    unitPlural: text(o.unitPlural, 30, plural(unitLabel)),
    itemLabel: text(o.itemLabel, 30, d.itemLabel),
    itemTypes: types.length ? types : d.itemTypes,
    instanceBasis: o.instanceBasis === "item" ? "item" : "check",
    severityWeights: { critical: weight("critical"), major: weight("major"), minor: weight("minor") },
    bands: (o.bands && typeof o.bands === "object" ? o.bands : {}) as BandOverrides,
    recurringMonths: Number.isFinite(rm) && rm >= 2 && rm <= 12 ? rm : d.recurringMonths,
    scorecard: o.scorecard !== false,
    sector: (["banking", "healthcare", "government", "higher_ed", "general"] as const).find((x) => x === o.sector) ?? d.sector,
    groupLabel: text(o.groupLabel, 30, d.groupLabel),
    setupDone: o.setupDone === true,
  };
}
