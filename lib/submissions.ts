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

// One sampled transaction from an officer's monthly Process Critical Review. The app
// computes the branch's sample/defect/resolution/recurring figures — and a compliance
// score — from these rows, then aggregates them into the dataset on publish.
export interface DefectItem {
  area: string;                       // process area
  txnType: string;                    // Application / Amendment / …
  checks: Record<string, string>;     // control checks: "yes" | "no" | "na"
  defects: number;                    // # of defects on this transaction (0 = clean)
  defectArea: string;                 // nature/category of the defect(s)
  recurring: boolean;                 // a repeat of a prior defect type
  status: string;                     // "open" | "resolved"
}
// A file attached to a submission (the audit sample findings). The bytes live in
// storage under `attachments/<id>`; only this metadata rides on the submission.
export interface Attachment { id: string; name: string; size: number; type: string; }

export interface Submission {
  id: string;
  dataset: SubDataset;
  branch: string;
  period: string;            // ISO yyyy-mm-01
  entryDate: string;         // ISO yyyy-mm-dd — the date the inspector recorded this entry
  attachments: Attachment[]; // audit sample-findings files (may be empty)
  area: string | null;       // single process area (opstd n/a; defects register spans all)
  items: DefectItem[];       // defects register rows (empty for opstd)
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

// ---- Operational Standard: the computed metric tree ----
// Officers key the raw measures; the app computes Major Procedure (mean of the 8 SOP
// standards), Risk Metrics (mean of onboarding SLA + audit points + audit resolution),
// the Overall % (mean of the five categories) and a 1–5 rating — matching the bank's
// Metric Computation worksheet.
export const OPSTD_SOP = ["screening", "wires", "sourceOfFunds", "csl", "fees", "declaration", "salesService", "acknowledgement"] as const;
export const OPSTD_TOP = ["complaints", "procurement", "queueSla", "onboardingSla", "auditResolution"] as const;
export const AUDIT_POINTS: Record<string, number> = { A: 100, "B+": 80, B: 60, C: 40, D: 20 };
function meanOf(xs: (number | null)[]): number | null { const v = xs.filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function opStdRating(overall: number | null): number | null { if (overall == null) return null; return overall >= 95 ? 5 : overall >= 80 ? 4 : overall >= 70 ? 3 : overall >= 60 ? 2 : 1; }
/** Compute the operational-standard tree from the raw measures + audit points. */
export function computeOpStd(values: Record<string, number | null>, auditPoints: number | null) {
  const n = (k: string) => (values[k] == null ? null : Number(values[k]));
  // Major Procedure is rounded to a whole number before it feeds the overall — matching
  // the Metric Computation worksheet.
  const mpRaw = meanOf(OPSTD_SOP.map((k) => n(k)));
  const majorProcedure = mpRaw == null ? null : Math.round(mpRaw);
  const riskMetrics = meanOf([n("onboardingSla"), auditPoints, n("auditResolution")]);
  const overall = meanOf([n("complaints"), n("procurement"), riskMetrics, n("queueSla"), majorProcedure]);
  const avgCustomerSla = meanOf([n("queueSla"), n("onboardingSla")]);
  return { majorProcedure, riskMetrics, overall, avgCustomerSla, rating: opStdRating(overall) };
}
// The control checks captured per transaction, used for per-control compliance.
export const DEFECT_CHECKS = ["memberVerified", "cardKeyedCMS", "cmsSigMatch", "idCapture", "formCompleted"] as const;

// Aggregate register rows for one area into the dataset's count fields.
function blankAgg() { return { reviewed: 0, instances: 0, defects: 0, resolvable: 0, resolved: 0, recurring: 0 }; }
function addItem(a: ReturnType<typeof blankAgg>, it: DefectItem) {
  const d = Math.max(0, Math.round(it.defects || 0));
  a.reviewed += 1; a.instances += 1; a.defects += d; a.resolvable += d;
  if (it.status === "resolved") a.resolved += d;
  if (it.recurring) a.recurring += d;
}
/** Per-area aggregates + overall totals + a compliance score, computed from the rows. */
export function summariseItems(items: DefectItem[]) {
  const byArea: Record<string, ReturnType<typeof blankAgg>> = {};
  const totals = blankAgg();
  let defectRows = 0;
  const controlPass: Record<string, { yes: number; applicable: number }> = {};
  DEFECT_CHECKS.forEach((c) => (controlPass[c] = { yes: 0, applicable: 0 }));
  (items || []).forEach((it) => {
    const a = (byArea[it.area] = byArea[it.area] || blankAgg());
    addItem(a, it); addItem(totals, it);
    if ((it.defects || 0) > 0) defectRows += 1;
    DEFECT_CHECKS.forEach((c) => { const v = it.checks?.[c]; if (v === "yes" || v === "no") { controlPass[c].applicable += 1; if (v === "yes") controlPass[c].yes += 1; } });
  });
  const sample = totals.reviewed;
  // Accuracy = share of sampled transactions with no defect. Control compliance = mean
  // pass rate across the applicable control checks. Overall score is their average.
  const accuracy = sample ? (sample - defectRows) / sample : null;
  const controlRates = DEFECT_CHECKS.map((c) => (controlPass[c].applicable ? controlPass[c].yes / controlPass[c].applicable : null));
  const measured = controlRates.filter((r): r is number => r != null);
  const compliance = measured.length ? measured.reduce((s, r) => s + r, 0) / measured.length : null;
  const score = accuracy != null && compliance != null ? Math.round((accuracy + compliance) / 2 * 100) : accuracy != null ? Math.round(accuracy * 100) : null;
  return { byArea, totals, sample, defectRows, accuracy, compliance, controlRates, score };
}

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
 *  and admins see every submission (across all branches). */
export function canSee(s: Session, sub: Submission): boolean {
  if (s.role === "admin" || s.role === "supervisor") return true;
  return sub.inspector === s.username; // inspector
}
/** Whether a session may review (approve/return) — every supervisor and admin, any branch. */
export function canReview(s: Session, sub: Submission): boolean {
  return s.role === "admin" || s.role === "supervisor";
}

/** Submissions visible to this session, newest activity first. */
export async function listForSession(s: Session): Promise<Submission[]> {
  const all = await readAll();
  return all.filter((sub) => canSee(s, sub)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Whether this session may access an attachment: true if it rides on any submission
 *  the session is allowed to see. (The uploader case is checked separately from the
 *  blob metadata, so a freshly-uploaded, not-yet-saved attachment stays reachable.) */
export async function attachmentOwnerOrVisible(s: Session, attachmentId: string): Promise<boolean> {
  const all = await readAll();
  return all.some((sub) => (sub.attachments || []).some((a) => a.id === attachmentId) && canSee(s, sub));
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

interface RawInput { dataset?: string; branch?: string; period?: string; entryDate?: string; attachments?: any; area?: string | null; values?: any; audit?: any; items?: any; }
interface Parsed { dataset: SubDataset; branch: string; period: string; entryDate: string; attachments: Attachment[]; area: string | null; items: DefectItem[]; values: Record<string, number | null>; audit: number | null; }

// Sanitise the attachment metadata a client sends. The bytes are already in storage
// (uploaded via /api/attachment); here we just keep well-formed references, capped in count.
function normaliseAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const a of raw.slice(0, 20)) {
    const id = String((a as any)?.id ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
    const name = String((a as any)?.name ?? "file").trim().slice(0, 200) || "file";
    const size = Math.max(0, Math.round(Number((a as any)?.size) || 0));
    const type = String((a as any)?.type ?? "").trim().slice(0, 120);
    out.push({ id, name, size, type });
  }
  return out;
}

// The date the inspector says they recorded the entry (yyyy-mm-dd). Defaults to today
// (server date) when absent or malformed — it's descriptive metadata, not a metric key.
function normaliseEntryDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

function normaliseItem(raw: any): DefectItem | { error: string } {
  const area = (raw?.area || "").trim();
  if (!area) return { error: "Each reviewed transaction needs a process area." };
  const defects = Math.max(0, Math.round(Number(raw?.defects) || 0));
  const checks: Record<string, string> = {};
  DEFECT_CHECKS.forEach((c) => { const v = raw?.checks?.[c]; checks[c] = v === "no" ? "no" : v === "na" ? "na" : "yes"; });
  const status = raw?.status === "resolved" ? "resolved" : "open";
  return { area, txnType: (raw?.txnType || "").trim(), checks, defects, defectArea: (raw?.defectArea || "").trim(), recurring: !!raw?.recurring, status };
}

function normalise(input: RawInput, session: Session): { ok: true; parsed: Parsed } | { ok: false; error: string } {
  const dataset = input.dataset === "opstd" ? "opstd" : "defects";
  const branch = (input.branch || "").trim();
  if (!branch) return { ok: false, error: "Choose a branch." };
  // Branch is chosen on the form (a dropdown), so officers may key for any branch —
  // the assigned branch is only the default selection, not a restriction.
  const period = (input.period || "").trim();
  if (!/^\d{4}-\d{2}-01$/.test(period)) return { ok: false, error: "Choose a valid month." };
  const entryDate = normaliseEntryDate(input.entryDate);
  const attachments = normaliseAttachments(input.attachments);

  if (dataset === "defects") {
    // A monthly Process Critical Review — one row per sampled transaction across areas.
    const rawItems = Array.isArray(input.items) ? input.items : [];
    if (!rawItems.length) return { ok: false, error: "Add at least one reviewed transaction." };
    const items: DefectItem[] = [];
    for (const r of rawItems) {
      const it = normaliseItem(r);
      if ("error" in it) return { ok: false, error: it.error };
      if (it.defects > 0 && !it.defectArea) return { ok: false, error: "Name the defect area for each transaction with a defect." };
      items.push(it);
    }
    return { ok: true, parsed: { dataset, branch, period, entryDate, attachments, area: null, items, values: {}, audit: null } };
  }
  // opstd — the raw measures the officer keys (8 SOP standards + complaints, procurement,
  // queue SLA, onboarding SLA, audit resolution — all 0–100) plus an audit letter grade.
  const values: Record<string, number | null> = {};
  for (const k of [...OPSTD_SOP, ...OPSTD_TOP]) {
    const raw = input.values?.[k];
    if (raw === "" || raw == null) { values[k] = null; continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: "Scores must be between 0 and 100." };
    values[k] = n;
  }
  // Audit grade comes in as a letter; store its points (drives Risk Metrics + the grade).
  let audit: number | null = null;
  const letter = String(input.audit ?? "").trim();
  if (letter) {
    if (AUDIT_POINTS[letter] == null) return { ok: false, error: "Audit grade must be A, B+, B, C or D." };
    audit = AUDIT_POINTS[letter];
  }
  return { ok: true, parsed: { dataset, branch, period, entryDate, attachments, area: null, items: [], values, audit } };
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
      id: randomUUID(), dataset: norm.parsed.dataset, branch: norm.parsed.branch, period: norm.parsed.period, entryDate: norm.parsed.entryDate, attachments: [],
      area: norm.parsed.area, items: [], values: {}, audit: null, status: "draft", inspector: session.username,
      supervisor: null, note: "", history: [{ status: "draft", by: session.username, at: now }], createdAt: now, updatedAt: now,
    };
    list.push(sub);
  }
  sub.dataset = norm.parsed.dataset; sub.branch = norm.parsed.branch; sub.period = norm.parsed.period; sub.entryDate = norm.parsed.entryDate; sub.attachments = norm.parsed.attachments;
  sub.area = norm.parsed.area; sub.items = norm.parsed.items; sub.values = norm.parsed.values; sub.audit = norm.parsed.audit; sub.updatedAt = now;

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
  // Best-effort cleanup of the attachment blobs (bytes + metadata sidecar).
  for (const a of sub.attachments || []) {
    await getStorage().remove(`attachment-${a.id}`).catch(() => {});
    await getStorage().remove(`attachment-${a.id}.json`).catch(() => {});
  }
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

// ---- resolution: mark individual defects resolved / reopened ----

export interface DefectRef { id: string; index: number; }

/** Set the resolution status of individual defect line items (by submission id + item
 *  index) and re-aggregate the affected published reviews into the live dataset, so the
 *  resolution rate reflects the change. Supervisors (their branch) and admins only. */
export async function resolveDefects(session: Session, refs: DefectRef[], resolved: boolean): Promise<{ ok: true; submissions: Submission[]; changed: number } | { ok: false; error: string; status?: number }> {
  if (session.role !== "supervisor" && session.role !== "admin") return { ok: false, error: "Only supervisors and admins can change resolution status.", status: 403 };
  const list = await readAll();
  const byId = new Map<string, number[]>();
  for (const r of refs || []) { const i = Math.trunc(Number(r?.index)); const id = String(r?.id || ""); if (!id || !Number.isFinite(i) || i < 0) continue; (byId.get(id) || byId.set(id, []).get(id)!).push(i); }

  const affected: Submission[] = [];
  let changed = 0;
  const now = new Date().toISOString();
  for (const [id, idxs] of byId) {
    const sub = findById(list, id);
    if (!sub) continue;
    if (!canReview(session, sub)) return { ok: false, error: "You can’t change resolution for this submission.", status: 403 };
    if (sub.dataset !== "defects") continue;
    if (sub.status !== "published") return { ok: false, error: "Only published defects can be marked resolved.", status: 409 };
    let subChanged = 0;
    for (const i of idxs) {
      const it = sub.items[i];
      if (it && (it.defects || 0) > 0) { const ns = resolved ? "resolved" : "open"; if (it.status !== ns) { it.status = ns; subChanged += 1; } }
    }
    if (subChanged) {
      changed += subChanged;
      sub.updatedAt = now;
      sub.history.push({ status: "published", by: session.username, at: now, note: (resolved ? "Marked " : "Reopened ") + subChanged + " defect" + (subChanged === 1 ? "" : "s") + (resolved ? " resolved" : "") });
      affected.push(sub);
    }
  }
  for (const sub of affected) { const r = await publishToDataset(sub); if (!r.ok) return { ok: false, error: r.error, status: 400 }; }
  if (affected.length) await writeAll(list);
  return { ok: true, submissions: await listForSession(session), changed };
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
    // Aggregate the register rows by process area, then upsert one dataset row per area.
    const { byArea } = summariseItems(sub.items || []);
    for (const areaName of Object.keys(byArea)) {
      const ai = payload.areas.indexOf(areaName);
      if (ai < 0) return { ok: false, error: "Unknown process area “" + areaName + "”." };
      const v = byArea[areaName];
      const row = [pi, bi, ai, v.reviewed, v.instances, v.defects, v.resolvable, v.resolved, v.recurring];
      const at = payload.rows.findIndex((r: any[]) => r[0] === pi && r[1] === bi && r[2] === ai);
      if (at >= 0) payload.rows[at] = row; else payload.rows.push(row);
    }
  } else {
    // Compute the tree, then map onto the dataset's metric columns (order below).
    const c = computeOpStd(sub.values, sub.audit);
    const g = (k: string) => (sub.values[k] == null ? null : sub.values[k]);
    // [Op Standard Score, Average Customer SLA, Queue SLA, Onboarding SLA, Procurement,
    //  Compliance to Major Procedure, Avg Procedure Compliance, Complaints, Audit Resolution]
    const vals = [c.overall, c.avgCustomerSla, g("queueSla"), g("onboardingSla"), g("procurement"), c.majorProcedure, c.majorProcedure, g("complaints"), g("auditResolution")];
    const row = [pi, bi, ...vals];
    const at = payload.rows.findIndex((r: any[]) => r[0] === pi && r[1] === bi);
    if (at >= 0) { payload.rows[at] = row; payload.auditRaw[at] = sub.audit ?? null; }
    else { payload.rows.push(row); payload.auditRaw.push(sub.audit ?? null); }
  }
  await persistMergedDataset(sub.dataset, payload);
  return { ok: true };
}
