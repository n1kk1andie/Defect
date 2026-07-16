// Inspector submissions and the supervisor approval gate.
//
// An inspector keys a review (a draft), submits it, and a supervisor for that branch
// approves (publishing it into the live dataset the metrics read) or returns it with a
// note. Nothing reaches Pulse/Heatmap/Register/Report until it is published — the whole
// point of the gate. Submissions live in Blob (submissions.json) next to the datasets.
import { randomUUID } from "node:crypto";
import { getStorage } from "@/lib/storage";
import type { Role, Session } from "@/lib/auth";
import { loadDatasetPayload, persistMergedDataset } from "@/lib/data";

const SUBMISSIONS_BLOB = "submissions.json";

export type SubStatus = "draft" | "submitted" | "published" | "returned";
export type SubDataset = "defects" | "opstd";

export interface SubEvent { status: SubStatus; by: string; at: string; note?: string; }
export interface Submission {
  id: string;
  dataset: SubDataset;
  branch: string;
  period: string;            // ISO yyyy-mm-01
  area: string | null;       // process area (defects only)
  values: Record<string, number | null>;
  audit: number | null;      // opstd raw audit score (drives the letter grade); null otherwise
  status: SubStatus;
  inspector: string;         // username who keyed it
  supervisor: string | null; // username who last acted as reviewer
  note: string;              // latest supervisor note (shown on a returned submission)
  history: SubEvent[];
  createdAt: string;
  updatedAt: string;
}

// The six defect counts, in the dataset's row order after [period, branch, area].
export const DEFECT_FIELDS = ["reviewed", "instances", "defects", "resolvable", "resolved", "recurring"] as const;

// ---- storage ----

async function readAll(): Promise<Submission[]> {
  try {
    const buf = await getStorage().read(SUBMISSIONS_BLOB);
    if (!buf) return [];
    const parsed = JSON.parse(buf.toString("utf8"));
    return Array.isArray(parsed?.submissions) ? parsed.submissions : [];
  } catch { return []; }
}
async function writeAll(list: Submission[]): Promise<void> {
  await getStorage().write(SUBMISSIONS_BLOB, Buffer.from(JSON.stringify({ submissions: list }, null, 2), "utf8"), "application/json");
}

// ---- visibility ----

/** Whether a session may see a submission. Inspectors see only their own; supervisors
 *  see their branch (all branches if their account has no branch); admins see all. */
export function canSee(s: Session, sub: Submission): boolean {
  if (s.role === "admin") return true;
  if (s.role === "supervisor") return !s.branch || sub.branch === s.branch;
  return sub.inspector === s.username; // inspector
}
/** Whether a session may review (approve/return) — supervisors for their branch, admins. */
export function canReview(s: Session, sub: Submission): boolean {
  if (s.role === "admin") return true;
  if (s.role === "supervisor") return !s.branch || sub.branch === s.branch;
  return false;
}

/** Submissions visible to this session, newest activity first. */
export async function listForSession(s: Session): Promise<Submission[]> {
  const all = await readAll();
  return all.filter((sub) => canSee(s, sub)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---- validation ----

function toIntMap(input: any, keys: readonly string[]): { ok: true; values: Record<string, number | null> } | { ok: false; error: string } {
  const values: Record<string, number | null> = {};
  for (const k of keys) {
    const raw = input?.[k];
    if (raw === "" || raw == null) { values[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `“${k}” must be a number of 0 or more.` };
    values[k] = Math.round(n);
  }
  return { ok: true, values };
}

/** Defect-count invariants the data-quality layer assumes. Returns null when valid. */
function defectRuleError(v: Record<string, number | null>): string | null {
  const g = (k: string) => v[k] ?? 0;
  if (g("defects") > g("instances")) return "Defects can’t exceed possible instances.";
  if (g("resolved") > g("resolvable")) return "Resolved can’t exceed resolvable defects.";
  if (g("recurring") > g("defects")) return "Recurring can’t exceed defects found.";
  return null;
}

// ---- normalisation from a client payload ----

interface RawInput { dataset?: string; branch?: string; period?: string; area?: string | null; values?: any; audit?: any; }

function normalise(input: RawInput, session: Session): { ok: true; parsed: { dataset: SubDataset; branch: string; period: string; area: string | null; values: Record<string, number | null>; audit: number | null } } | { ok: false; error: string } {
  const dataset = input.dataset === "opstd" ? "opstd" : "defects";
  const branch = (input.branch || "").trim();
  if (!branch) return { ok: false, error: "Choose a branch." };
  // An inspector may only key for their assigned branch (if their account has one).
  if (session.role === "inspector" && session.branch && branch !== session.branch) {
    return { ok: false, error: "You can only submit for your branch (" + session.branch + ")." };
  }
  const period = (input.period || "").trim();
  if (!/^\d{4}-\d{2}-01$/.test(period)) return { ok: false, error: "Choose a valid month." };
  const area = dataset === "defects" ? (input.area || "").trim() : null;
  if (dataset === "defects" && !area) return { ok: false, error: "Choose a process area." };

  if (dataset === "defects") {
    const r = toIntMap(input.values, DEFECT_FIELDS);
    if (!r.ok) return r;
    const ruleErr = defectRuleError(r.values);
    if (ruleErr) return { ok: false, error: ruleErr };
    return { ok: true, parsed: { dataset, branch, period, area, values: r.values, audit: null } };
  }
  // opstd — nine 0–100 component scores by index, plus an optional raw audit score.
  const values: Record<string, number | null> = {};
  for (let i = 0; i < 9; i++) {
    const raw = input.values?.[i];
    if (raw === "" || raw == null) { values[i] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: "Scores must be between 0 and 100." };
    values[i] = n;
  }
  let audit: number | null = null;
  if (input.audit !== "" && input.audit != null) {
    const a = Number(input.audit);
    if (!Number.isFinite(a) || a < 0) return { ok: false, error: "Audit score must be a number." };
    audit = a;
  }
  return { ok: true, parsed: { dataset, branch, period, area: null, values, audit } };
}

// ---- create / update / submit / delete ----

function findById(list: Submission[], id: string): Submission | undefined { return list.find((s) => s.id === id); }

/** Create or update a submission. `submit` moves it from draft/returned to submitted
 *  (after validation). Only the owning inspector (or an admin) may edit a submission,
 *  and only while it is a draft or returned. */
export async function saveSubmission(session: Session, input: RawInput & { id?: string; submit?: boolean }): Promise<{ ok: true; submission: Submission } | { ok: false; error: string; status?: number }> {
  const norm = normalise(input, session);
  if (!norm.ok) return { ok: false, error: norm.error, status: 400 };
  const list = await readAll();
  const now = new Date().toISOString();

  let sub = input.id ? findById(list, input.id) : undefined;
  if (sub) {
    if (sub.inspector !== session.username && session.role !== "admin") return { ok: false, error: "You can only edit your own submissions.", status: 403 };
    if (sub.status === "submitted" || sub.status === "published") return { ok: false, error: "This submission is locked — it’s already " + sub.status + ".", status: 409 };
  } else {
    sub = {
      id: randomUUID(), dataset: norm.parsed.dataset, branch: norm.parsed.branch, period: norm.parsed.period,
      area: norm.parsed.area, values: {}, audit: null, status: "draft", inspector: session.username,
      supervisor: null, note: "", history: [{ status: "draft", by: session.username, at: now }], createdAt: now, updatedAt: now,
    };
    list.push(sub);
  }
  sub.dataset = norm.parsed.dataset; sub.branch = norm.parsed.branch; sub.period = norm.parsed.period;
  sub.area = norm.parsed.area; sub.values = norm.parsed.values; sub.audit = norm.parsed.audit; sub.updatedAt = now;

  if (input.submit) {
    sub.status = "submitted"; sub.note = "";
    sub.history.push({ status: "submitted", by: session.username, at: now });
  }
  await writeAll(list);
  return { ok: true, submission: sub };
}

export async function deleteSubmission(session: Session, id: string): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const list = await readAll();
  const sub = findById(list, id);
  if (!sub) return { ok: true };
  if (sub.inspector !== session.username && session.role !== "admin") return { ok: false, error: "You can only delete your own submissions.", status: 403 };
  if (sub.status === "published") return { ok: false, error: "Published submissions can’t be deleted.", status: 409 };
  await writeAll(list.filter((s) => s.id !== id));
  return { ok: true };
}

// ---- review: approve (publish) / return ----

export async function reviewSubmission(session: Session, id: string, decision: "approve" | "return", note: string): Promise<{ ok: true; submission: Submission } | { ok: false; error: string; status?: number }> {
  const list = await readAll();
  const sub = findById(list, id);
  if (!sub) return { ok: false, error: "Submission not found.", status: 404 };
  if (!canReview(session, sub)) return { ok: false, error: "You can’t review this submission.", status: 403 };
  if (sub.status !== "submitted") return { ok: false, error: "Only submitted work can be reviewed.", status: 409 };
  const now = new Date().toISOString();

  if (decision === "return") {
    sub.status = "returned"; sub.supervisor = session.username; sub.note = (note || "").trim();
    sub.updatedAt = now; sub.history.push({ status: "returned", by: session.username, at: now, note: sub.note });
    await writeAll(list);
    return { ok: true, submission: sub };
  }

  // approve → merge into the live dataset, then mark published.
  const merged = await publishToDataset(sub);
  if (!merged.ok) return { ok: false, error: merged.error, status: 400 };
  sub.status = "published"; sub.supervisor = session.username; sub.note = (note || "").trim();
  sub.updatedAt = now; sub.history.push({ status: "published", by: session.username, at: now, note: sub.note || undefined });
  await writeAll(list);
  return { ok: true, submission: sub };
}

/** Ensure `iso` exists in the period list, inserting it in chronological order and
 *  re-indexing existing rows so period indices stay correct. Returns its index. */
function ensurePeriod(payload: any, iso: string): number {
  const idx = payload.periods.indexOf(iso);
  if (idx >= 0) return idx;
  let k = payload.periods.findIndex((p: string) => p > iso);
  if (k < 0) { payload.periods.push(iso); return payload.periods.length - 1; }
  payload.periods.splice(k, 0, iso);
  payload.rows.forEach((r: any[]) => { if ((r[0] as number) >= k) r[0] = (r[0] as number) + 1; });
  return k;
}

/** Merge one approved submission into its dataset payload and persist it. */
async function publishToDataset(sub: Submission): Promise<{ ok: true } | { ok: false; error: string }> {
  const payload = await loadDatasetPayload(sub.dataset);
  const bi = payload.branches.indexOf(sub.branch);
  if (bi < 0) return { ok: false, error: "Unknown branch “" + sub.branch + "” for this dataset." };
  const pi = ensurePeriod(payload, sub.period);

  if (sub.dataset === "defects") {
    const ai = payload.areas.indexOf(sub.area);
    if (ai < 0) return { ok: false, error: "Unknown process area “" + sub.area + "”." };
    const v = sub.values;
    const row = [pi, bi, ai, v.reviewed ?? 0, v.instances ?? 0, v.defects ?? 0, v.resolvable ?? 0, v.resolved ?? 0, v.recurring ?? 0];
    const at = payload.rows.findIndex((r: any[]) => r[0] === pi && r[1] === bi && r[2] === ai);
    if (at >= 0) payload.rows[at] = row; else payload.rows.push(row);
  } else {
    const vals = [];
    for (let i = 0; i < payload.metrics.length; i++) vals.push(sub.values[i] ?? null);
    const row = [pi, bi, ...vals];
    const at = payload.rows.findIndex((r: any[]) => r[0] === pi && r[1] === bi);
    if (at >= 0) { payload.rows[at] = row; payload.auditRaw[at] = sub.audit ?? null; }
    else { payload.rows.push(row); payload.auditRaw.push(sub.audit ?? null); }
  }
  await persistMergedDataset(sub.dataset, payload);
  return { ok: true };
}
