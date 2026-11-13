"use client";
// What Quality has proposed to Pulsus Risk and where each stands: stored until
// Risk is connected, sent, accepted or rejected by a Risk Officer, or failed
// (retried by the sweep). Used on Risk and in Settings → Integrations.
import { fmtDateTime } from "@/components/ui";
import type { OutboxRow } from "@/lib/riskLink";

const RULE: Record<string, string> = { site_band: "Site entered Attention or Escalate", critical_failure: "Critical failure", sampling_failed: "Sampled control not effective" };
const KIND: Record<string, string> = { kri_breach: "KRI breach", finding: "Finding", issue: "Issue", risk_event: "Risk event" };

export function proposalState(o: Pick<OutboxRow, "status" | "decision" | "riskRef" | "attempts">): { label: string; cls: string } {
  if (o.decision === "accepted") return { label: `Accepted by Risk${o.riskRef ? ` · ${o.riskRef}` : ""}`, cls: "st-closed" };
  if (o.decision === "rejected") return { label: "Rejected by Risk", cls: "st-open" };
  if (o.status === "sent") return { label: `With Risk for review${o.riskRef ? ` · ${o.riskRef}` : ""}`, cls: "st-in_progress" };
  if (o.status === "failed") return { label: `Not delivered · retrying (${o.attempts})`, cls: "st-overdue" };
  return { label: "Stored until Risk connects", cls: "st-draft" };
}

export function RiskFeed({ rows, empty }: { rows: OutboxRow[]; empty: string }) {
  if (!rows.length) return <p className="sub" style={{ margin: 0 }}>{empty}</p>;
  return (
    <ul className="list">{rows.map((o) => {
      const st = proposalState(o);
      return (
        <li key={o.id} style={{ alignItems: "flex-start" }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <strong>{o.title}</strong>
            <span className="sub" style={{ display: "block", fontSize: 12.5 }}>{KIND[o.kind] ?? o.kind} · {o.rule ? RULE[o.rule] ?? o.rule : `sent by ${o.createdBy}`} · {o.severity} · {fmtDateTime(o.createdAt)}</span>
          </span>
          <span className={`status ${st.cls}`}>{st.label}</span>
        </li>
      );
    })}</ul>
  );
}
