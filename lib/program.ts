// A company's quality program: what its reviewers check and where.
//
// Quality reviews follow the usual QA method — a reviewer samples items (files,
// transactions, records) in one unit (a branch, store, site or department) and
// tests each against the checklist for its process area. Each check is pass /
// fail / not applicable and carries a severity; failed checks are the defects.
// This deployment's own checklist is built into the review form; a Pulsus
// company defines its own here, so the form, scoring and dashboards all follow
// the company's program rather than anyone else's.
import { getStorage } from "@/lib/storage";
import type { CompanyContext } from "@/lib/company";
import { companyManager } from "@/lib/company";

export type Severity = "critical" | "major" | "minor";
export const SEVERITIES: Severity[] = ["critical", "major", "minor"];
/** Weight of a check in the compliance score: a critical check counts three times a minor one. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 3, major: 2, minor: 1 };

export interface ProgramCheck { id: string; label: string; severity: Severity }
export interface ProgramArea { name: string; checks: ProgramCheck[]; natures: string[] }
/** A member's Quality role beyond what their Command Center role gives: editors
 *  key reviews by default; one listed here as a supervisor approves them. */
export interface ProgramPerson { email: string; role: "inspector" | "supervisor"; unit: string | null }

export interface Program {
  unitLabel: string;    // "Branch", "Store", "Site", "Department"…
  unitPlural: string;   // "Branches", "Stores"…
  itemLabel: string;    // what is sampled: "Transaction", "File", "Record"…
  itemTypes: string[];  // kinds of item, e.g. New / Change / Maintenance
  units: string[];
  areas: ProgramArea[];
  people: ProgramPerson[];
  updatedAt?: string;
  updatedBy?: string;
}

const BLOB = "program.json";
const MAX = { units: 300, areas: 40, checks: 40, natures: 30, people: 500, text: 80, types: 12 };

/** A new company's program before an admin sets it up: nothing to review yet. */
export function emptyProgram(): Program {
  return { unitLabel: "Branch", unitPlural: "Branches", itemLabel: "Transaction", itemTypes: ["New", "Change", "Maintenance", "Other"], units: [], areas: [], people: [] };
}

const chk = (id: string, label: string, severity: Severity): ProgramCheck => ({ id, label, severity });

/** A neutral starting point an admin can load and then edit to fit their policies. */
export function sampleProgram(): Program {
  return {
    ...emptyProgram(),
    units: ["Head Office", "Branch 1", "Branch 2"],
    areas: [
      {
        name: "Customer onboarding",
        checks: [
          chk("id-verified", "Identity verified and copy on file", "critical"),
          chk("form-complete", "Application form fully completed", "major"),
          chk("signature", "Customer signature matches records", "critical"),
          chk("approval", "Approved within authority limits", "major"),
          chk("system-match", "System record matches the documents", "minor"),
        ],
        natures: ["Missing ID", "Incomplete form", "Signature mismatch", "Approval missing", "Data entry error"],
      },
      {
        name: "Cash handling",
        checks: [
          chk("dual-control", "Dual control at cash count", "critical"),
          chk("count-recorded", "Count recorded and signed", "major"),
          chk("limits", "Within cash holding limits", "major"),
          chk("variance-reported", "Variances reported the same day", "major"),
        ],
        natures: ["No dual control", "Unsigned count", "Over limit", "Late variance report"],
      },
      {
        name: "Complaints handling",
        checks: [
          chk("logged", "Complaint logged on receipt", "major"),
          chk("acknowledged", "Acknowledged within the service standard", "minor"),
          chk("resolved-on-time", "Resolved within the service standard", "major"),
          chk("root-cause", "Root cause recorded", "minor"),
        ],
        natures: ["Not logged", "Late acknowledgement", "Late resolution", "No root cause"],
      },
      {
        name: "Record keeping",
        checks: [
          chk("filed", "Documents filed in the right place", "minor"),
          chk("retention", "Retention period observed", "major"),
          chk("secure", "Records stored securely", "critical"),
        ],
        natures: ["Misfiled", "Retention breach", "Unsecured records"],
      },
    ],
  };
}

const text = (v: unknown, max = MAX.text) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));

/** Clean an admin's program, or say what's wrong with it. */
export function normaliseProgram(raw: any): { ok: true; program: Program } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Send the program as an object." };
  const unitLabel = text(raw.unitLabel, 30) || "Branch";
  const unitPlural = text(raw.unitPlural, 30) || unitLabel + "s";
  const itemLabel = text(raw.itemLabel, 30) || "Transaction";
  const itemTypes = uniq((Array.isArray(raw.itemTypes) ? raw.itemTypes : []).map((t: unknown) => text(t, 40))).slice(0, MAX.types);
  const units = uniq((Array.isArray(raw.units) ? raw.units : []).map((u: unknown) => text(u)));
  if (units.length > MAX.units) return { ok: false, error: `Up to ${MAX.units} ${unitPlural.toLowerCase()}.` };

  const rawAreas = Array.isArray(raw.areas) ? raw.areas : [];
  if (rawAreas.length > MAX.areas) return { ok: false, error: `Up to ${MAX.areas} process areas.` };
  const areas: ProgramArea[] = [];
  for (const a of rawAreas) {
    const name = text(a?.name);
    if (!name) return { ok: false, error: "Every process area needs a name." };
    if (areas.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `“${name}” is listed twice.` };
    const rawChecks = Array.isArray(a?.checks) ? a.checks : [];
    if (!rawChecks.length) return { ok: false, error: `Add at least one check to “${name}”.` };
    if (rawChecks.length > MAX.checks) return { ok: false, error: `Up to ${MAX.checks} checks per area.` };
    const checks: ProgramCheck[] = [];
    for (const c of rawChecks) {
      const label = text(c?.label, 120);
      if (!label) return { ok: false, error: `A check in “${name}” has no wording.` };
      let id = slug(String(c?.id || "")) || slug(label) || "check";
      while (checks.some((x) => x.id === id)) id = (id + "-2").slice(0, 40);
      const severity: Severity = SEVERITIES.includes(c?.severity) ? c.severity : "major";
      checks.push({ id, label, severity });
    }
    const natures = uniq((Array.isArray(a?.natures) ? a.natures : []).map((n: unknown) => text(n))).slice(0, MAX.natures);
    areas.push({ name, checks, natures });
  }

  const rawPeople = Array.isArray(raw.people) ? raw.people : [];
  if (rawPeople.length > MAX.people) return { ok: false, error: `Up to ${MAX.people} people.` };
  const people: ProgramPerson[] = [];
  for (const p of rawPeople) {
    const email = text(p?.email, 254).toLowerCase();
    if (!email) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: `“${email}” isn't an email address.` };
    if (people.some((x) => x.email === email)) continue;
    const unit = text(p?.unit) || null;
    if (unit && !units.includes(unit)) return { ok: false, error: `${email}: “${unit}” isn't one of your ${unitPlural.toLowerCase()}.` };
    people.push({ email, role: p?.role === "supervisor" ? "supervisor" : "inspector", unit });
  }
  return { ok: true, program: { unitLabel, unitPlural, itemLabel, itemTypes: itemTypes.length ? itemTypes : emptyProgram().itemTypes, units, areas, people } };
}

/** The request's company program (read from its own folder), or a blank one. */
export async function loadProgram(): Promise<Program> {
  try {
    const buf = await getStorage().read(BLOB);
    if (!buf) return emptyProgram();
    const parsed = normaliseProgram(JSON.parse(buf.toString("utf8")));
    if (!parsed.ok) return emptyProgram();
    const stored = JSON.parse(buf.toString("utf8"));
    return { ...parsed.program, updatedAt: stored.updatedAt, updatedBy: stored.updatedBy };
  } catch {
    return emptyProgram();
  }
}

export async function saveProgram(program: Program, by: string): Promise<Program> {
  const stamped = { ...program, updatedAt: new Date().toISOString(), updatedBy: by };
  await getStorage().write(BLOB, Buffer.from(JSON.stringify(stamped), "utf8"), "application/json");
  return stamped;
}

/** The Quality role a company member works as: owners and admins run everything;
 *  an editor keys reviews, or approves them when the program lists them as a
 *  supervisor; a viewer reads the dashboards only (null — no working session). */
export function companyRole(c: CompanyContext, program: Program): { role: "admin" | "supervisor" | "inspector"; unit: string | null } | null {
  const person = program.people.find((p) => p.email === c.email);
  if (companyManager(c)) return { role: "admin", unit: person?.unit ?? null };
  if (c.role !== "editor") return null;
  return { role: person?.role === "supervisor" ? "supervisor" : "inspector", unit: person?.unit ?? null };
}

/** Severity weight of each check, by process area then check id, for the compliance score. */
export type CheckWeights = Record<string, Record<string, number>>;
export function checkWeights(program: Program): CheckWeights {
  const w: CheckWeights = {};
  for (const a of program.areas) { w[a.name] = {}; for (const c of a.checks) w[a.name][c.id] = SEVERITY_WEIGHT[c.severity]; }
  return w;
}
