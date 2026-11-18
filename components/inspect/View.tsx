"use client";
// A submitted or approved inspection: the score and result, what failed, the
// actions it raised, check-in and signatures, every answer as recorded, and —
// for a supervisor who didn't carry it out — approve or return.
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Field, Msg, fmtDateTime } from "@/components/ui";
import { Icon } from "@/components/icons";
import { InspectionForm } from "@/components/inspect/Form";
import { approveBlocker } from "@/lib/roles";
import { monthLabel } from "@/lib/metrics";
import type { InspectionView as IV } from "@/lib/inspections";
import type { TemplateDef } from "@/lib/templates/model";

export const INSPECTION_STATUS: Record<string, string> = { draft: "Draft", submitted: "Awaiting approval", returned: "Returned", approved: "Approved" };
const statusCls = (s: string) => (s === "approved" ? "published" : s);

export function InspectionView({ inspection: r, def }: { inspection: IV; def: TemplateDef }) {
  const app = useApp();
  const router = useRouter();
  const justSubmitted = useSearchParams()?.get("submitted") === "1";
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(justSubmitted && r.status === "submitted" ? { kind: "ok", text: `${r.ref} is submitted. A supervisor who didn't carry it out will approve it.` } : null);
  const block = approveBlocker(app.actor, r, "inspection");
  const canDecide = r.status === "submitted" && !block;
  const sc = r.score;
  const band = !sc || sc.pct === null ? "none" : sc.result === "fail" ? "escalate" : sc.pct >= 95 ? "worldClass" : "strong";
  const onSite = r.checkin && r.submittedAt ? Math.max(0, Math.round((Date.parse(r.submittedAt) - Date.parse(r.checkin.at)) / 60000)) : null;
  const decide = async (decision: "approve" | "return") => {
    setBusy(true); setMsg(null);
    try { await api(`/api/inspections/${r.id}/decision`, "POST", { decision, note }); setMsg({ kind: "ok", text: decision === "approve" ? "Approved. Failed items that ask for it have become corrective actions." : "Returned to the inspector with your note." }); router.refresh(); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <div className="capture">
      <div className="row wrap" style={{ marginBottom: 10 }}><Link href="/inspect" className="btn sm ghost"><Icon name="back" />Inspections</Link></div>
      <header className="row wrap" style={{ alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
        <div className="grow" style={{ minWidth: 240 }}>
          <div className="eyebrow">{r.ref} · {def.category} · version {r.templateVersion}</div>
          <h1 className="headline" style={{ fontSize: 24 }}>{def.name}</h1>
          <p className="sub" style={{ margin: "4px 0 0" }}>{r.unitName} · {monthLabel(r.period)} · by {r.inspectorEmail}{r.submittedAt ? ` · submitted ${fmtDateTime(r.submittedAt)}` : ""}</p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <div className="scorering" data-band={band} style={{ ["--v" as string]: sc?.pct ?? 0, width: 76, height: 76 }}><span style={{ width: 60, height: 60, fontSize: 17 }}>{sc?.pct == null ? "—" : `${Math.round(sc.pct)}%`}</span></div>
          <div><span className={`status st-${statusCls(r.status)}`}>{INSPECTION_STATUS[r.status]}</span><div className="mt" style={{ marginTop: 6 }}>{sc && <span className="pill" data-band={sc.result === "pass" ? "strong" : "escalate"}>{sc.result === "pass" ? "Pass" : sc.result === "fail" ? (sc.criticalFails ? "Fail · critical" : "Fail") : "Incomplete"}</span>}</div></div>
        </div>
      </header>
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
      {r.note && <Msg kind="info">Supervisor's note: {r.note}</Msg>}

      <div className="grid g3 statrow" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="stat-v">{sc?.findings.length ?? 0}</div><div className="stat-l">Failed{sc?.criticalFails ? ` · ${sc.criticalFails} critical` : ""}</div></div>
        <div className="stat"><div className="stat-v">{sc?.items ? `${sc.deviations}/${sc.items}` : `${sc?.answered ?? 0}`}</div><div className="stat-l">{sc?.items ? `${(def.sampling?.itemLabel ?? "item").toLowerCase()}s with a deviation` : "Answers"}</div></div>
        <div className="stat"><div className="stat-v">{onSite !== null ? `${onSite} min` : r.checkin ? "Checked in" : "—"}</div><div className="stat-l">{onSite !== null ? "Time on site" : "Check-in"}{r.checkin?.lat !== undefined ? ` · ${r.checkin.lat.toFixed(3)}, ${r.checkin.lng!.toFixed(3)}` : ""}</div></div>
      </div>

      {sc && sc.findings.length > 0 && (
        <Card title="What failed" sub="In the order of the template">
          <ul className="list">{sc.findings.map((f, i) => (
            <li key={i}><span className="ibadge bad" aria-hidden="true" style={{ width: 24, height: 24 }}><Icon name="close" /></span>
              <span className="grow"><strong>{f.label}</strong>{f.critical && <span className="pill sm" data-band="escalate" style={{ marginLeft: 6 }}>Critical</span>}<span className="sub" style={{ display: "block" }}>{def.sections.find((x) => x.id === f.sectionId)?.title}{f.item !== null ? ` · ${(def.sampling?.itemLabel ?? "item")} ${f.item + 1}${f.itemRef ? ` (${f.itemRef})` : ""}` : ""}{f.note ? ` · “${f.note}”` : ""}{f.photos ? ` · ${f.photos} photo${f.photos === 1 ? "" : "s"}` : ""}</span></span></li>
          ))}</ul>
        </Card>
      )}
      {r.actions.length > 0 && (
        <Card className="mt" title="Corrective actions raised" sub="Verified by someone other than whoever raised them">
          <ul className="list">{r.actions.map((x) => <li key={x.id}><Icon name="actions" /><span className="grow"><strong>{x.ref}</strong> · {x.title}</span><span className={`status st-${x.status}`}>{x.status.replace(/_/g, " ")}</span></li>)}</ul>
          <Link className="btn sm mt" href="/actions">Open the action register</Link>
        </Card>
      )}

      {canDecide && (
        <Card className="mt" title="Your decision" sub="Approving publishes the score, feeds the dashboards and raises the corrective actions.">
          <Field label="Note to the inspector (required to return)"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="row wrap mt" style={{ justifyContent: "flex-end" }}>
            <button className="btn" disabled={busy} onClick={() => decide("return")}>Return with note</button>
            <button className="btn primary" disabled={busy} onClick={() => decide("approve")}><Icon name="check" />Approve</button>
          </div>
        </Card>
      )}
      {r.status === "submitted" && block && app.actor.roles.some((x) => x === "admin" || x === "supervisor") && <Msg kind="info">{block}</Msg>}

      <div className="mt2"><InspectionForm def={def} state={{ answers: r.answers, items: r.items }} readOnly photoUrl={(id) => (id.startsWith("local-") ? null : `/api/evidence/${id}?inline=1`)} /></div>

      {(r.signatures.inspector || r.signatures.site) && (
        <Card className="mt2" title="Signed">
          <div className="grid g2">
            {r.signatures.inspector && <figure style={{ margin: 0 }}><img className="isig" src={r.signatures.inspector.data} alt={`Signature of ${r.signatures.inspector.name}`} /><figcaption className="sub mt" style={{ marginTop: 6 }}>Inspector · {r.signatures.inspector.name} · {fmtDateTime(r.signatures.inspector.at)}</figcaption></figure>}
            {r.signatures.site && <figure style={{ margin: 0 }}><img className="isig" src={r.signatures.site.data} alt={`Signature of ${r.signatures.site.name}`} /><figcaption className="sub" style={{ marginTop: 6 }}>{app.settings.unitLabel} manager · {r.signatures.site.name} · {fmtDateTime(r.signatures.site.at)}</figcaption></figure>}
          </div>
        </Card>
      )}
      <Card className="mt2" title="History">
        <ol className="timeline">{r.history.slice().reverse().map((h, i) => <li key={i}><strong>{INSPECTION_STATUS[h.status] || h.status}</strong> · {h.by}<br /><span className="sub">{fmtDateTime(h.at)}</span>{h.note && <div>{h.note}</div>}</li>)}</ol>
      </Card>
    </div>
  );
}
