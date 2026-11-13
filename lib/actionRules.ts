// The action lifecycle's pure rules, shared by the server (lib/actions.ts) and the browser.
import { can, inScope, isSupervisor, verifyBlocker, type Actor } from "@/lib/roles";

export type ActionStatus = "open" | "in_progress" | "awaiting_verification" | "closed";
export type ActionPriority = "high" | "medium" | "low";
export const PRIORITIES: ActionPriority[] = ["high", "medium", "low"];
export const STATUS_LABEL: Record<ActionStatus, string> = { open: "Open", in_progress: "In progress", awaiting_verification: "Awaiting verification", closed: "Closed" };
export interface ActionView {
  id: string; ref: string; kind: "corrective" | "preventive"; unitId: string; unitName: string; areaId: string | null;
  title: string; details: string; rootCause: string; priority: ActionPriority; ownerEmail: string | null; ownerName: string;
  dueDate: string; status: ActionStatus; closureNote: string; raisedBy: string; verifierEmail: string | null;
  verifiedBy: string | null; verifiedAt: string | null; submittedBy: string | null; sourceType: string; sourceId: string | null;
  createdAt: string; updatedAt: string; closedAt: string | null; overdue: boolean;
  history: { kind: string; status: string | null; by: string; at: string; note: string | null }[];
  evidence: { id: string; name: string; size: number; contentType: string; uploadedBy: string; uploadedAt: string }[];
}

export const isOverdue = (a: { status: string; dueDate: string }, on = new Date().toISOString().slice(0, 10)) => a.status !== "closed" && a.dueDate < on;

export type ActionStep = "start" | "submit" | "verify" | "return" | "reopen";

/** The steps this person may take on an action now (the server re-checks each). */
export function allowedSteps(a: Actor, x: Pick<ActionView, "status" | "raisedBy" | "ownerEmail" | "submittedBy" | "unitId">): ActionStep[] {
  const out: ActionStep[] = [];
  const worker = can.workActions(a) && inScope(a, x.unitId) || x.ownerEmail === a.email;
  if (x.status === "open" && worker) out.push("start");
  if ((x.status === "open" || x.status === "in_progress") && worker) out.push("submit");
  if (x.status === "awaiting_verification" && !verifyBlocker(a, x)) out.push("verify");
  if (x.status === "awaiting_verification" && isSupervisor(a)) out.push("return");
  if (x.status === "closed" && isSupervisor(a)) out.push("reopen");
  return out;
}

