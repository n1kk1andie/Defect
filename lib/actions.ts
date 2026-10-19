// Corrective actions: turning a finding into owned, dated work that is closed on evidence.
//
// A supervisor (or admin) raises an action against a branch — optionally one process
// area — with a priority, an owner and a due date. The branch's officers work it
// (in progress), then submit it for verification with a closure note and any evidence
// files. A supervisor verifies and closes it, or sends it back with a note. Nobody closes
// their own work: the maker-checker split mirrors the submission gate. Every step lands
// in an append-only history. Actions live in Blob (actions.json) next to submissions.
import { randomUUID } from "node:crypto";
import { getStorage } from "@/lib/storage";
import type { Session } from "@/lib/auth";
import type { Attachment } from "@/lib/submissions";

const ACTIONS_BLOB = "actions.json";

export type ActionStatus = "open" | "in_progress" | "awaiting_verification" | "closed";
export type ActionPriority = "high" | "medium" | "low";
export const PRIORITIES: ActionPriority[] = ["high", "medium", "low"];

export interface ActionEvent { status: ActionStatus | "edited"; by: string; at: string; note?: string; }

export interface CorrectiveAction {
  id: string;
  ref: string;               // human reference, ACT-0001 …
  branch: string;
  area: string | null;       // process area, or null for the branch as a whole
  title: string;
  details: string;
  priority: ActionPriority;
  owner: string;             // who is responsible — a person or team, free text
  dueDate: string;           // yyyy-mm-dd
  status: ActionStatus;
  closureNote: string;       // what was done, written when submitted for verification
  evidence: Attachment[];    // files supporting the closure
  createdBy: string;
  verifiedBy: string | null; // supervisor who closed it
  history: ActionEvent[];
  createdAt: string;
  updatedAt: string;
}

// ---- storage ----

async function readAll(): Promise<CorrectiveAction[]> {
  try {
    const buf = await getStorage().read(ACTIONS_BLOB);
    if (!buf) return [];
    const parsed = JSON.parse(buf.toString("utf8"));
    return Array.isArray(parsed?.actions) ? parsed.actions : [];
  } catch { return []; }
}
async function writeAll(list: CorrectiveAction[]): Promise<void> {
  await getStorage().write(ACTIONS_BLOB, Buffer.from(JSON.stringify({ actions: list }, null, 2), "utf8"), "application/json");
}

// ---- permissions ----

const isManager = (s: Session) => s.role === "supervisor" || s.role === "admin";

/** Supervisors and admins see every action; an officer sees the actions for their branch. */
export function canSeeAction(s: Session, a: CorrectiveAction): boolean {
  if (isManager(s)) return true;
  return !!s.branch && a.branch === s.branch;
}

/** Actions visible to this session: open work first (earliest due date), then closed. */
export async function listActionsForSession(s: Session): Promise<CorrectiveAction[]> {
  const all = await readAll();
  return all.filter((a) => canSeeAction(s, a)).sort((a, b) => {
    const ac = a.status === "closed" ? 1 : 0, bc = b.status === "closed" ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return ac ? b.updatedAt.localeCompare(a.updatedAt) : a.dueDate.localeCompare(b.dueDate);
  });
}

/** Whether an evidence attachment rides on an action this session may see. */
export async function actionAttachmentVisible(s: Session, attachmentId: string): Promise<boolean> {
  const all = await readAll();
  return all.some((a) => (a.evidence || []).some((e) => e.id === attachmentId) && canSeeAction(s, a));
}

// ---- validation ----

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };

const clean = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
function validDate(d: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")); }

interface ActionInput { branch?: unknown; area?: unknown; title?: unknown; details?: unknown; priority?: unknown; owner?: unknown; dueDate?: unknown; }
interface ActionFields { branch: string; area: string | null; title: string; details: string; priority: ActionPriority; owner: string; dueDate: string; }

function readFields(input: ActionInput): Result<ActionFields> {
  const branch = clean(input.branch, 120);
  if (!branch) return { ok: false, error: "Choose a branch." };
  const title = clean(input.title, 160);
  if (!title) return { ok: false, error: "Describe the issue in a short title." };
  const priority = clean(input.priority, 10) as ActionPriority;
  if (!PRIORITIES.includes(priority)) return { ok: false, error: "Choose a priority." };
  const owner = clean(input.owner, 120);
  if (!owner) return { ok: false, error: "Name an owner — the person or team responsible." };
  const dueDate = clean(input.dueDate, 10);
  if (!validDate(dueDate)) return { ok: false, error: "Set a due date." };
  const area = clean(input.area, 160) || null;
  return { ok: true, value: { branch, area, title, details: clean(input.details, 2000), priority, owner, dueDate } };
}

function normaliseEvidence(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const a of raw.slice(0, 20)) {
    const id = String((a as any)?.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
    out.push({
      id,
      name: String((a as any)?.name ?? "file").trim().slice(0, 200) || "file",
      size: Math.max(0, Math.round(Number((a as any)?.size) || 0)),
      type: String((a as any)?.type ?? "").trim().slice(0, 120),
    });
  }
  return out;
}

function nextRef(all: CorrectiveAction[]): string {
  let max = 0;
  for (const a of all) { const n = Number(String(a.ref).replace(/^ACT-/, "")); if (Number.isFinite(n) && n > max) max = n; }
  return "ACT-" + String(max + 1).padStart(4, "0");
}

// ---- operations ----

/** Raise a new action. Supervisors and admins only. */
export async function createAction(s: Session, input: ActionInput): Promise<Result<CorrectiveAction>> {
  if (!isManager(s)) return { ok: false, error: "Only supervisors and admins raise actions.", status: 403 };
  const f = readFields(input);
  if (!f.ok) return f;
  const all = await readAll();
  const now = new Date().toISOString();
  const action: CorrectiveAction = {
    id: randomUUID(), ref: nextRef(all), ...f.value, status: "open", closureNote: "", evidence: [],
    createdBy: s.username, verifiedBy: null, history: [{ status: "open", by: s.username, at: now }], createdAt: now, updatedAt: now,
  };
  all.push(action);
  await writeAll(all);
  return { ok: true, value: action };
}

/** Change the plan — title, details, priority, owner, due date. Supervisors and admins, while not closed. */
export async function editAction(s: Session, id: string, input: ActionInput): Promise<Result<CorrectiveAction>> {
  if (!isManager(s)) return { ok: false, error: "Only supervisors and admins change an action’s plan.", status: 403 };
  const all = await readAll();
  const a = all.find((x) => x.id === id);
  if (!a) return { ok: false, error: "Action not found.", status: 404 };
  if (a.status === "closed") return { ok: false, error: "This action is closed. Reopen it to change it." };
  const f = readFields({ ...input, branch: a.branch });
  if (!f.ok) return f;
  const changes: string[] = [];
  if (f.value.dueDate !== a.dueDate) changes.push("due " + f.value.dueDate);
  if (f.value.owner !== a.owner) changes.push("owner " + f.value.owner);
  if (f.value.priority !== a.priority) changes.push("priority " + f.value.priority);
  if (f.value.title !== a.title || f.value.details !== a.details || f.value.area !== a.area) changes.push("details");
  if (!changes.length) return { ok: true, value: a };
  Object.assign(a, { area: f.value.area, title: f.value.title, details: f.value.details, priority: f.value.priority, owner: f.value.owner, dueDate: f.value.dueDate });
  const now = new Date().toISOString();
  a.history.push({ status: "edited", by: s.username, at: now, note: "Changed " + changes.join(", ") });
  a.updatedAt = now;
  await writeAll(all);
  return { ok: true, value: a };
}

export type ActionStep = "start" | "submit" | "verify" | "return" | "reopen";

/**
 * Move an action through its lifecycle.
 *  start   open → in progress                     (branch officer, supervisor or admin)
 *  submit  open / in progress → awaiting verification, with a closure note (+ evidence)
 *  verify  awaiting verification → closed          (supervisor/admin, not the submitter)
 *  return  awaiting verification → in progress, with a note (supervisor/admin)
 *  reopen  closed → in progress, with a note       (supervisor/admin)
 */
export async function stepAction(s: Session, id: string, step: ActionStep, input: { note?: unknown; evidence?: unknown }): Promise<Result<CorrectiveAction>> {
  const all = await readAll();
  const a = all.find((x) => x.id === id);
  if (!a) return { ok: false, error: "Action not found.", status: 404 };
  if (!canSeeAction(s, a)) return { ok: false, error: "You can’t update this action.", status: 403 };
  const note = clean(input.note, 2000);
  const now = new Date().toISOString();
  const lastSubmitter = [...a.history].reverse().find((h) => h.status === "awaiting_verification")?.by;

  if (step === "start") {
    if (a.status !== "open") return { ok: false, error: "Only an open action can be started." };
    a.status = "in_progress";
  } else if (step === "submit") {
    if (a.status !== "open" && a.status !== "in_progress") return { ok: false, error: "This action isn’t open." };
    if (note.length < 10) return { ok: false, error: "Say what was done to resolve it (at least a sentence)." };
    a.status = "awaiting_verification";
    a.closureNote = note;
    a.evidence = normaliseEvidence(input.evidence);
  } else if (step === "verify") {
    if (!isManager(s)) return { ok: false, error: "A supervisor verifies and closes actions.", status: 403 };
    if (a.status !== "awaiting_verification") return { ok: false, error: "Only an action awaiting verification can be closed." };
    if (lastSubmitter === s.username) return { ok: false, error: "Someone other than the person who submitted it must verify the closure.", status: 403 };
    a.status = "closed";
    a.verifiedBy = s.username;
  } else if (step === "return" || step === "reopen") {
    if (!isManager(s)) return { ok: false, error: "A supervisor sends actions back.", status: 403 };
    if (step === "return" && a.status !== "awaiting_verification") return { ok: false, error: "Only an action awaiting verification can be sent back." };
    if (step === "reopen" && a.status !== "closed") return { ok: false, error: "Only a closed action can be reopened." };
    if (!note) return { ok: false, error: "Add a note saying what still needs doing." };
    a.status = "in_progress";
    a.verifiedBy = null;
  } else {
    return { ok: false, error: "Unknown step." };
  }
  a.history.push({ status: a.status, by: s.username, at: now, ...(note ? { note } : {}) });
  a.updatedAt = now;
  await writeAll(all);
  return { ok: true, value: a };
}

/** Delete an action raised in error. Admins only — everyone else closes or reopens. */
export async function deleteAction(s: Session, id: string): Promise<Result<true>> {
  if (s.role !== "admin") return { ok: false, error: "Only an admin can delete an action.", status: 403 };
  const all = await readAll();
  const i = all.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, error: "Action not found.", status: 404 };
  all.splice(i, 1);
  await writeAll(all);
  return { ok: true, value: true };
}
