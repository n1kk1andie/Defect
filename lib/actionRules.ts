// The action lifecycle's pure rules, shared by the server (lib/actions.ts) and the browser.
import { can, inScope, isSupervisor, verifyBlocker, type Actor } from "@/lib/roles";

export type ActionStatus = "open" | "in_progress" | "awaiting_verification" | "closed";
export type ActionPriority = "high" | "medium" | "low";
export const PRIORITIES: ActionPriority[] = ["high", "medium", "low"];
export const STATUS_LABEL: Record<ActionStatus, string> = { open: "Open", in_progress: "In progress", awaiting_verification: "Awaiting verification", closed: "Closed" };
export type ActionKind = "containment" | "corrective" | "preventive";
export const KIND_LABEL: Record<ActionKind, string> = { containment: "Containment", corrective: "Corrective", preventive: "Preventive" };
export const KIND_HINT: Record<ActionKind, string> = {
  containment: "Contain it now: stop the harm while the cause is found",
  corrective: "Correct the cause of what happened",
  preventive: "Prevent it happening again, here or elsewhere",
};
/** Fishbone (Ishikawa) categories, in words that suit any sector. */
export const FISHBONE: { key: string; label: string; hint: string }[] = [
  { key: "people", label: "People", hint: "Skills, training, staffing, supervision" },
  { key: "method", label: "Method", hint: "Procedure, policy, workflow" },
  { key: "equipment", label: "Equipment and systems", hint: "Tools, IT systems, machines, premises" },
  { key: "materials", label: "Materials and information", hint: "Forms, data, supplies, documents" },
  { key: "environment", label: "Environment", hint: "Workload, layout, time pressure, external factors" },
  { key: "measurement", label: "Measurement", hint: "Checks, monitoring, reporting" },
];
export interface Rca { whys: string[]; fishbone: Record<string, string[]> }
export type EffectivenessStatus = "pending" | "due" | "effective" | "ineffective";
export interface Effectiveness { days: number; due: string; status: EffectivenessStatus; templateId?: string | null; questionIds?: string[]; checkedAt?: string; by?: string; note?: string; inspectionRef?: string }
export const EFFECT_LABEL: Record<EffectivenessStatus, string> = { pending: "Check scheduled", due: "Re-check due", effective: "Effective", ineffective: "Not effective" };

/** Clean a submitted root cause analysis: up to five whys, up to five causes per fishbone category. */
export function cleanRca(raw: unknown): Rca | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as { whys?: unknown; fishbone?: unknown };
  const whys = (Array.isArray(o.whys) ? o.whys : []).map((w) => String(w ?? "").trim().slice(0, 300)).slice(0, 5);
  while (whys.length && !whys[whys.length - 1]) whys.pop();
  const fb = (o.fishbone && typeof o.fishbone === "object" ? o.fishbone : {}) as Record<string, unknown>;
  const fishbone: Record<string, string[]> = {};
  for (const c of FISHBONE) {
    const xs = (Array.isArray(fb[c.key]) ? (fb[c.key] as unknown[]) : []).map((x) => String(x ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 5);
    if (xs.length) fishbone[c.key] = xs;
  }
  return whys.length || Object.keys(fishbone).length ? { whys, fishbone } : null;
}

export interface ActionView {
  id: string; ref: string; kind: ActionKind; unitId: string; unitName: string; areaId: string | null;
  title: string; details: string; rootCause: string; priority: ActionPriority; ownerEmail: string | null; ownerName: string;
  dueDate: string; status: ActionStatus; closureNote: string; raisedBy: string; verifierEmail: string | null;
  verifiedBy: string | null; verifiedAt: string | null; submittedBy: string | null; sourceType: string; sourceId: string | null;
  createdAt: string; updatedAt: string; closedAt: string | null; overdue: boolean;
  rca: Rca | null; effectivenessDays: number; effectiveness: Effectiveness | null; reopenCount: number;
  history: { kind: string; status: string | null; by: string; at: string; note: string | null }[];
  evidence: { id: string; name: string; size: number; contentType: string; uploadedBy: string; uploadedAt: string }[];
}

export const isOverdue = (a: { status: string; dueDate: string }, on = new Date().toISOString().slice(0, 10)) => a.status !== "closed" && a.dueDate < on;

export type ActionStep = "start" | "submit" | "verify" | "return" | "reopen" | "effective" | "ineffective";

/** The steps this person may take on an action now (the server re-checks each). */
/** Why someone may not record an effectiveness check, or null when they may: a supervisor who neither owns the action nor submitted its closure. */
export function effectivenessBlocker(a: Pick<Actor, "email" | "roles">, x: { ownerEmail: string | null; submittedBy: string | null }): string | null {
  if (!isSupervisor(a)) return "A supervisor records whether the action worked.";
  const me = a.email.toLowerCase();
  if (x.ownerEmail?.toLowerCase() === me) return "You own this action, so someone else checks whether it worked.";
  if (x.submittedBy?.toLowerCase() === me) return "You submitted this closure, so someone else checks whether it worked.";
  return null;
}

export function allowedSteps(a: Actor, x: Pick<ActionView, "status" | "raisedBy" | "ownerEmail" | "submittedBy" | "unitId"> & { effectiveness?: Effectiveness | null }): ActionStep[] {
  const out: ActionStep[] = [];
  const worker = can.workActions(a) && inScope(a, x.unitId) || x.ownerEmail === a.email;
  if (x.status === "open" && worker) out.push("start");
  if ((x.status === "open" || x.status === "in_progress") && worker) out.push("submit");
  if (x.status === "awaiting_verification" && !verifyBlocker(a, x)) out.push("verify");
  if (x.status === "awaiting_verification" && isSupervisor(a)) out.push("return");
  if (x.status === "closed" && isSupervisor(a)) out.push("reopen");
  if (x.status === "closed" && x.effectiveness && (x.effectiveness.status === "pending" || x.effectiveness.status === "due") && !effectivenessBlocker(a, x)) out.push("effective", "ineffective");
  return out;
}

