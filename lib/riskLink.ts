// Quality → Pulsus Risk: a serious or recurring defect becomes a PROPOSED issue
// in Risk's review queue, where a Risk Officer accepts or rejects it ("nothing
// enters unreviewed"). The contract is docs/risk-contract.md; this module
// builds and validates the payload and owns the sending side.
//
// Sending is a stub until Risk's intake endpoint is live: with RISK_INTAKE_URL
// unset, a proposal is stored in the outbox as "stubbed" (visible in Settings →
// Integrations) and nothing leaves the app. With it set, the payload is POSTed
// there with the shared intake key, and the answer recorded.
import { createHash, randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { riskOutbox } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor } from "@/lib/roles";

export const RISK_SCHEMA = "pulsus.quality.proposed-issue/v1";

export interface ProposedIssue {
  schema: typeof RISK_SCHEMA;
  /** Idempotency key: the same source always gives the same id, so a resend is recognised. */
  id: string;
  sent_at: string;
  source: {
    app: "quality";
    company_id: string;
    record_type: "defect" | "recurring_issue" | "action";
    record_ref: string;
    url: string;
  };
  proposed: {
    kind: "issue" | "risk_event";
    title: string;
    description: string;
    severity: "critical" | "high" | "medium" | "low";
    category: "Operational";
    unit: { name: string; type: string };
    process_area: string | null;
    detected_at: string;
    recurrence: { months: number; first_period: string; last_period: string; defects: number } | null;
    linked_action: { ref: string; status: string; owner: string; due_date: string } | null;
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
  if (o.source?.app !== "quality" || !o.source?.company_id || !["defect", "recurring_issue", "action"].includes(o.source?.record_type) || !o.source?.record_ref || !/^https:\/\//.test(String(o.source?.url))) e.push("source");
  const pr = o.proposed || {};
  if (!["issue", "risk_event"].includes(pr.kind)) e.push("proposed.kind");
  if (!pr.title || String(pr.title).length > 200) e.push("proposed.title");
  if (typeof pr.description !== "string" || pr.description.length > 4000) e.push("proposed.description");
  if (!SEVERITIES.includes(pr.severity)) e.push("proposed.severity");
  if (!pr.unit?.name) e.push("proposed.unit");
  if (Number.isNaN(Date.parse(pr.detected_at))) e.push("proposed.detected_at");
  if (!o.raised_by?.email) e.push("raised_by");
  return e;
}

export function proposalId(companyId: string, recordType: string, recordRef: string): string {
  return createHash("sha256").update(`${companyId}|${recordType}|${recordRef}`).digest("hex");
}

const appUrl = () => (process.env.APP_URL || "https://quality.pulsus.tech").replace(/\/+$/, "");

/** Build the payload for a recurring issue or a defect/action the supervisor chose to send. */
export function buildProposal(a: Actor, input: {
  recordType: ProposedIssue["source"]["record_type"]; recordRef: string; title: string; description: string; severity: ProposedIssue["proposed"]["severity"];
  unitName: string; unitType: string; area: string | null; detectedAt: string; recurrence?: ProposedIssue["proposed"]["recurrence"]; action?: ProposedIssue["proposed"]["linked_action"]; path: string;
}): ProposedIssue {
  return {
    schema: RISK_SCHEMA,
    id: proposalId(a.tenant, input.recordType, input.recordRef),
    sent_at: new Date().toISOString(),
    source: { app: "quality", company_id: a.tenant, record_type: input.recordType, record_ref: input.recordRef, url: appUrl() + input.path },
    proposed: {
      kind: input.recurrence ? "risk_event" : "issue", title: input.title.slice(0, 200), description: input.description.slice(0, 4000), severity: input.severity,
      category: "Operational", unit: { name: input.unitName, type: input.unitType }, process_area: input.area, detected_at: input.detectedAt,
      recurrence: input.recurrence ?? null, linked_action: input.action ?? null,
    },
    raised_by: { email: a.email, name: a.name },
  };
}

/** Send (or, until Risk is live, stub) a proposal. */
export async function sendToRisk(a: Actor, p: ProposedIssue, requestId?: string): Promise<{ ok: true; status: string; id: string } | { ok: false; error: string; status?: number }> {
  if (!can.sendToRisk(a)) return { ok: false, error: "A supervisor sends items to Pulsus Risk.", status: 403 };
  const problems = validateProposal(p);
  if (problems.length) return { ok: false, error: `The proposal is incomplete: ${problems.join(", ")}.`, status: 400 };
  const url = (process.env.RISK_INTAKE_URL || "").trim();
  let status = "stubbed", response: unknown = { note: "RISK_INTAKE_URL is not set: stored, not sent." };
  if (url) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RISK_INTAKE_KEY || ""}`, "Idempotency-Key": p.id }, body: JSON.stringify(p), signal: AbortSignal.timeout(8000) });
      response = await r.json().catch(() => ({ status: r.status }));
      status = r.status === 202 || r.status === 200 || r.status === 409 ? "sent" : "failed";
    } catch (e) {
      status = "failed"; response = { error: e instanceof Error ? e.message : "unreachable" };
    }
  }
  const rowId = randomUUID();
  await withTenant(a.tenant, async (tx) => {
    await tx.insert(riskOutbox).values({ id: rowId, companyId: a.tenant, sourceType: p.source.record_type, sourceId: p.source.record_ref, payload: p, status, createdBy: a.email, sentAt: status === "sent" ? new Date() : null, response });
    await record(tx, a.tenant, { actor: a.email, action: "risk.propose", entityType: p.source.record_type, entityId: p.source.record_ref, summary: `Proposed to Pulsus Risk (${status}): ${p.proposed.title}`, after: { id: p.id, severity: p.proposed.severity, status }, requestId });
  });
  return { ok: true, status, id: rowId };
}

export async function outbox(companyId: string) {
  return withTenant(companyId, async (tx) => (await tx.select().from(riskOutbox).where(eq(riskOutbox.companyId, companyId)).orderBy(desc(riskOutbox.createdAt)).limit(50))
    .map((r) => ({ id: r.id, title: (r.payload as ProposedIssue).proposed.title, severity: (r.payload as ProposedIssue).proposed.severity, recordRef: r.sourceId, status: r.status, createdBy: r.createdBy, createdAt: r.createdAt.toISOString() })));
}
