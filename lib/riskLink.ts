// Quality → Pulsus Risk: findings and KRI breaches become PROPOSED records in
// Risk's review queue, where a Risk Officer accepts or rejects them ("nothing
// enters unreviewed"). The contract is docs/risk-contract.md; this module
// builds and validates the payload and owns the sending side.
//
// Two ways in:
//  • a supervisor sends a serious or recurring defect (Insights), and
//  • the automatic rules (lib/automation.ts): a site entering Attention or
//    Escalate (KRI breach), a critical failure in an approved inspection
//    (finding), a sampling plan concluding "not effective" (KRI breach).
// Either way the proposal id is SHA-256(company|record type|record ref), so the
// same source is proposed once: a repeat returns the existing row, and only a
// failed send is retried. Risk's decision comes back to /api/risk/status.
//
// Sending is a stub until Risk's intake endpoint is live: with RISK_INTAKE_URL
// unset, a proposal is stored as "stubbed" and nothing leaves the app.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { riskOutbox } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor } from "@/lib/roles";

export const RISK_SCHEMA = "pulsus.quality.proposed-issue/v1";

export const RECORD_TYPES = ["defect", "recurring_issue", "action", "inspection", "site_risk", "sampling_plan"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
export const KINDS = ["issue", "risk_event", "finding", "kri_breach"] as const;
export type ProposalKind = (typeof KINDS)[number];

export interface KriReading { key: string; name: string; value: number; threshold: number; direction: "above" | "below"; unit: "score" | "percent"; period: string }

export interface ProposedIssue {
  schema: typeof RISK_SCHEMA;
  /** Idempotency key: the same source always gives the same id, so a resend is recognised. */
  id: string;
  sent_at: string;
  source: {
    app: "quality";
    company_id: string;
    record_type: RecordType;
    record_ref: string;
    url: string;
    /** The automatic rule that raised it, or null when a person sent it. */
    rule?: "site_band" | "critical_failure" | "sampling_failed" | null;
  };
  proposed: {
    kind: ProposalKind;
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
    category: "Operational";
    unit: { name: string; type: string };
    process_area: string | null;
    detected_at: string;
    recurrence: { months: number; first_period: string; last_period: string; defects: number } | null;
    linked_action: { ref: string; status: string; owner: string; due_date: string } | null;
    /** For a KRI breach: the indicator, its value and the threshold it crossed. */
    kri?: KriReading | null;
  };
  raised_by: { email: string; name: string };
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

/** Check a payload against the contract. Returns the problems (empty when valid). */
export function validateProposal(p: unknown): string[] {
  const e: string[] = [];
  const o = (p && typeof p === "object" ? p : {}) as Record<string, any>;
  if (o.schema !== RISK_SCHEMA) e.push("schema");
  if (!/^[0-9a-f]{64}$/.test(String(o.id))) e.push("id");
  if (Number.isNaN(Date.parse(o.sent_at))) e.push("sent_at");
  if (o.source?.app !== "quality" || !o.source?.company_id || !RECORD_TYPES.includes(o.source?.record_type) || !o.source?.record_ref || !/^https:\/\//.test(String(o.source?.url))) e.push("source");
  const pr = o.proposed || {};
  if (!KINDS.includes(pr.kind)) e.push("proposed.kind");
  if (!pr.title || String(pr.title).length > 200) e.push("proposed.title");
  if (typeof pr.description !== "string" || pr.description.length > 4000) e.push("proposed.description");
  if (!SEVERITIES.includes(pr.severity)) e.push("proposed.severity");
  if (!pr.unit?.name) e.push("proposed.unit");
  if (Number.isNaN(Date.parse(pr.detected_at))) e.push("proposed.detected_at");
  if (pr.kind === "kri_breach") {
    const k = pr.kri || {};
    if (!k.key || !k.name || !Number.isFinite(k.value) || !Number.isFinite(k.threshold) || !["above", "below"].includes(k.direction) || !k.period) e.push("proposed.kri");
  }
  if (!o.raised_by?.email) e.push("raised_by");
  return e;
}

export function proposalId(companyId: string, recordType: string, recordRef: string): string {
  return createHash("sha256").update(`${companyId}|${recordType}|${recordRef}`).digest("hex");
}

const appUrl = () => (process.env.APP_URL || "https://quality.pulsus.tech").replace(/\/+$/, "");

/** Build the payload. */
export function buildProposal(a: Pick<Actor, "tenant" | "email" | "name">, input: {
  recordType: RecordType; recordRef: string; title: string; description: string; severity: ProposedIssue["proposed"]["severity"];
  unitName: string; unitType: string; area: string | null; detectedAt: string; recurrence?: ProposedIssue["proposed"]["recurrence"]; action?: ProposedIssue["proposed"]["linked_action"]; path: string;
  kind?: ProposalKind; kri?: KriReading | null; rule?: ProposedIssue["source"]["rule"];
}): ProposedIssue {
  return {
    schema: RISK_SCHEMA,
    id: proposalId(a.tenant, input.recordType, input.recordRef),
    sent_at: new Date().toISOString(),
    source: { app: "quality", company_id: a.tenant, record_type: input.recordType, record_ref: input.recordRef, url: appUrl() + input.path, rule: input.rule ?? null },
    proposed: {
      kind: input.kind ?? (input.recurrence ? "risk_event" : "issue"), title: input.title.slice(0, 200), description: input.description.slice(0, 4000), severity: input.severity,
      category: "Operational", unit: { name: input.unitName, type: input.unitType }, process_area: input.area, detected_at: input.detectedAt,
      recurrence: input.recurrence ?? null, linked_action: input.action ?? null, kri: input.kri ?? null,
    },
    raised_by: { email: a.email, name: a.name },
  };
}

/** POST the payload to Risk's intake, or stub it when RISK_INTAKE_URL is unset. Never throws. */
async function deliver(p: ProposedIssue): Promise<{ status: "sent" | "failed" | "stubbed"; response: unknown; riskRef: string | null }> {
  const url = (process.env.RISK_INTAKE_URL || "").trim();
  if (!url) return { status: "stubbed", response: { note: "RISK_INTAKE_URL is not set: stored, not sent." }, riskRef: null };
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RISK_INTAKE_KEY || ""}`, "Idempotency-Key": p.id }, body: JSON.stringify(p), signal: AbortSignal.timeout(8000) });
    const response = await r.json().catch(() => ({ status: r.status }));
    const ok = r.status === 202 || r.status === 200 || r.status === 409;
    const ref = ok && response && typeof response === "object" && typeof (response as { risk_ref?: unknown }).risk_ref === "string" ? String((response as { risk_ref: string }).risk_ref).slice(0, 60) : null;
    return { status: ok ? "sent" : "failed", response, riskRef: ref };
  } catch (e) {
    return { status: "failed", response: { error: e instanceof Error ? e.message : "unreachable" }, riskRef: null };
  }
}

export type ProposeResult = { ok: true; status: string; id: string; duplicate: boolean } | { ok: false; error: string; status?: number };

/**
 * Propose once. If this proposal id is already in the outbox and was sent (or
 * stored as a stub), nothing is sent again; a failed one is retried.
 */
export async function propose(companyId: string, by: string, p: ProposedIssue, requestId?: string): Promise<ProposeResult> {
  const problems = validateProposal(p);
  if (problems.length) return { ok: false, error: `The proposal is incomplete: ${problems.join(", ")}.`, status: 400 };
  const existing = await withTenant(companyId, async (tx) => (await tx.select().from(riskOutbox).where(and(eq(riskOutbox.companyId, companyId), eq(riskOutbox.proposalId, p.id))).limit(1))[0]);
  if (existing && existing.status !== "failed") return { ok: true, status: existing.status, id: existing.id, duplicate: true };
  const d = await deliver(p);
  const rowId = existing?.id ?? randomUUID();
  await withTenant(companyId, async (tx) => {
    if (existing) {
      await tx.update(riskOutbox).set({ payload: p, status: d.status, response: d.response, sentAt: d.status === "sent" ? new Date() : null, attempts: existing.attempts + 1, riskRef: d.riskRef ?? existing.riskRef }).where(eq(riskOutbox.id, existing.id));
    } else {
      await tx.insert(riskOutbox).values({ id: rowId, companyId, sourceType: p.source.record_type, sourceId: p.source.record_ref, payload: p, status: d.status, createdBy: by, sentAt: d.status === "sent" ? new Date() : null, response: d.response, proposalId: p.id, kind: p.proposed.kind, rule: p.source.rule ?? null, riskRef: d.riskRef });
    }
    await record(tx, companyId, { actor: by, action: "risk.propose", entityType: p.source.record_type, entityId: p.source.record_ref, summary: `${existing ? "Resent" : "Proposed"} to Pulsus Risk as ${p.proposed.kind.replace("_", " ")} (${d.status}): ${p.proposed.title}`, after: { id: p.id, kind: p.proposed.kind, severity: p.proposed.severity, status: d.status, rule: p.source.rule ?? null }, requestId });
  });
  return { ok: true, status: d.status, id: rowId, duplicate: false };
}

/** A supervisor sends an item to Risk. */
export async function sendToRisk(a: Actor, p: ProposedIssue, requestId?: string): Promise<ProposeResult> {
  if (!can.sendToRisk(a)) return { ok: false, error: "A supervisor sends items to Pulsus Risk.", status: 403 };
  return propose(a.tenant, a.email, p, requestId);
}

/** Retry proposals whose send failed (the sweep calls this). */
export async function retryFailed(companyId: string): Promise<number> {
  const rows = await withTenant(companyId, async (tx) => tx.select().from(riskOutbox).where(and(eq(riskOutbox.companyId, companyId), eq(riskOutbox.status, "failed"))).limit(20));
  let n = 0;
  for (const r of rows) if (r.attempts < 6 && r.proposalId) { const res = await propose(companyId, "automation", r.payload as ProposedIssue); if (res.ok && res.status === "sent") n++; }
  return n;
}

export interface OutboxRow { id: string; title: string; severity: string; kind: string; rule: string | null; recordType: string; recordRef: string; status: string; decision: string | null; riskRef: string | null; attempts: number; createdBy: string; createdAt: string }

export async function outbox(companyId: string, limit = 50): Promise<OutboxRow[]> {
  return withTenant(companyId, async (tx) => (await tx.select().from(riskOutbox).where(eq(riskOutbox.companyId, companyId)).orderBy(desc(riskOutbox.createdAt)).limit(limit))
    .map((r) => {
      const p = r.payload as ProposedIssue;
      return { id: r.id, title: p.proposed.title, severity: p.proposed.severity, kind: r.kind ?? p.proposed.kind, rule: r.rule, recordType: r.sourceType, recordRef: r.sourceId, status: r.status, decision: r.decision, riskRef: r.riskRef, attempts: r.attempts, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() };
    }));
}

/** Risk's decision on a proposal (POST /api/risk/status, with the intake key). */
export async function recordDecision(input: { id?: unknown; company_id?: unknown; risk_ref?: unknown; status?: unknown; reason?: unknown; decided_by?: unknown; decided_at?: unknown }): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const id = String(input.id || ""), company = String(input.company_id || "");
  if (!/^[0-9a-f]{64}$/.test(id) || !/^(?:_own|_demo|[a-z0-9][a-z0-9-]{0,39})$/.test(company)) return { ok: false, error: "id and company_id are required.", status: 400 };
  const decision = input.status === "accepted" || input.status === "rejected" ? input.status : null;
  if (!decision) return { ok: false, error: "status must be accepted or rejected.", status: 400 };
  const at = Date.parse(String(input.decided_at || "")) || Date.now();
  return withTenant(company, async (tx) => {
    const row = (await tx.select().from(riskOutbox).where(and(eq(riskOutbox.companyId, company), eq(riskOutbox.proposalId, id))).limit(1))[0];
    if (!row) return { ok: false as const, error: "Unknown proposal.", status: 404 };
    const ref = typeof input.risk_ref === "string" ? input.risk_ref.slice(0, 60) : row.riskRef;
    await tx.update(riskOutbox).set({ decision, decidedAt: new Date(at), riskRef: ref, status: "sent" }).where(eq(riskOutbox.id, row.id));
    await record(tx, company, { actor: `pulsus-risk:${String(input.decided_by || "risk officer").slice(0, 80)}`, action: "risk.decision", entityType: row.sourceType, entityId: row.sourceId, summary: `Pulsus Risk ${decision} ${ref ?? "the proposal"}${input.reason ? `: ${String(input.reason).slice(0, 200)}` : ""}`, after: { decision, riskRef: ref } });
    return { ok: true as const };
  });
}

/** The intake key check for Risk's callback (constant time). */
export function riskKeyMatches(header: string | null): boolean {
  const want = (process.env.RISK_INTAKE_KEY || "").trim();
  const got = (header || "").replace(/^Bearer\s+/i, "").trim();
  if (!want || !got) return false;
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}
