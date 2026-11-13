"use client";
// Actions: the corrective and preventive action register. Assign and
// prioritise, set due dates, track progress across branches, and close the
// loop with evidence, verified by someone other than whoever raised it.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, fmtDate, fmtDateTime, Msg, PageHead, Seg, Sheet, Stat } from "@/components/ui";
import { RaiseAction } from "@/components/screens/RaiseAction";
import { allowedSteps, STATUS_LABEL, type ActionStep, type ActionView } from "@/lib/actionRules";
import { can, verifyBlocker } from "@/lib/roles";
import { Icon } from "@/components/icons";

type Tab = "open" | "awaiting" | "overdue" | "closed" | "all";
const PRI_BAND = { high: "escalate", medium: "watch", low: "healthy" } as const;

export function StatusPill({ a }: { a: Pick<ActionView, "status" | "overdue"> }) {
  return a.overdue ? <span className="status st-overdue">Overdue</span> : <span className={`status st-${a.status}`}>{STATUS_LABEL[a.status]}</span>;
}

export function Actions({ actions }: { actions: ActionView[] }) {
  const app = useApp();
  const { settings, actor, data, filters, setFilters } = app;
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>("open");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [raise, setRaise] = useState(false);
  const unitId = filters.unit >= 0 ? data.units[filters.unit]?.id : null;
  const scoped = actions.filter((a) => !unitId || a.unitId === unitId);
  const k = {
    open: scoped.filter((a) => a.status === "open" || a.status === "in_progress").length,
    overdue: scoped.filter((a) => a.overdue).length,
    awaiting: scoped.filter((a) => a.status === "awaiting_verification").length,
    closed: scoped.filter((a) => a.status === "closed").length,
  };
  const list = scoped.filter((a) => (tab === "all" || (tab === "open" ? a.status === "open" || a.status === "in_progress" : tab === "awaiting" ? a.status === "awaiting_verification" : tab === "overdue" ? a.overdue : a.status === "closed"))
    && (!q || `${a.ref} ${a.title} ${a.unitName} ${a.ownerName} ${a.ownerEmail ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const byUnitOpen = useMemo(() => {
    const m = new Map<string, { name: string; n: number; overdue: number }>();
    for (const a of actions) if (a.status !== "closed") { const e = m.get(a.unitId) || { name: a.unitName, n: 0, overdue: 0 }; e.n++; if (a.overdue) e.overdue++; m.set(a.unitId, e); }
    return Array.from(m.values()).sort((a, b) => b.overdue - a.overdue || b.n - a.n);
  }, [actions]);
  const current = actions.find((a) => a.id === openId) || null;
  return (
    <>
      <PageHead eyebrow={`Actions · ${filters.unit >= 0 ? data.units[filters.unit]?.name : `All ${settings.unitPlural.toLowerCase()}`}`} title="Turn findings" accent="into action."
        lede={`${k.open + k.awaiting} open, ${k.overdue} overdue and ${k.awaiting} awaiting verification. Whoever raises an action never verifies it.`}
        right={<>{can.raiseActions(actor) && <button className="btn primary" onClick={() => setRaise(true)}><Icon name="plus" />Raise action</button>}<a className="btn" href="/api/export?what=actions&format=xlsx"><Icon name="download" />Excel</a></>} />
      <div className="grid g4">
        <Stat icon="actions" value={k.open} label="Open" onClick={() => setTab("open")} />
        <Stat icon="clock" value={k.overdue} label="Overdue" band={k.overdue ? "escalate" : "worldClass"} onClick={() => setTab("overdue")} />
        <Stat icon="stamp" value={k.awaiting} label="Awaiting verification" band={k.awaiting ? "watch" : undefined} onClick={() => setTab("awaiting")} />
        <Stat icon="check" value={k.closed} label="Closed" band="worldClass" onClick={() => setTab("closed")} />
      </div>
      <div className="grid g-2-1 mt">
        <Card flush title="Action register" actions={<div className="row wrap">
          <Seg label="Show" value={tab} onChange={setTab} options={[{ value: "open", label: "Open" }, { value: "awaiting", label: "Verify" }, { value: "overdue", label: "Overdue" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
        </div>}>
          <div className="row wrap" style={{ padding: "0 18px 10px" }}>
            <label className="grow" style={{ minWidth: 200 }}><span className="sr">Search actions</span><input className="input" type="search" placeholder="Search actions" value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <select className="select" aria-label={`Filter by ${settings.unitLabel.toLowerCase()}`} value={filters.unit} onChange={(e) => setFilters({ unit: Number(e.target.value) })}>
              <option value={-1}>All {settings.unitPlural.toLowerCase()}</option>{data.units.map((u, i) => <option key={u.id} value={i}>{u.name}</option>)}
            </select>
          </div>
          {list.length ? (
            <div className="tablewrap" tabIndex={0}>
              <table className="t stack">
                <caption className="sr">Actions</caption>
                <thead><tr><th scope="col">ID</th><th scope="col">{settings.unitLabel}</th><th scope="col">Issue</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Due</th><th scope="col">Owner</th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className="clickable" onClick={() => setOpenId(a.id)}>
                      <td data-label="ID"><button type="button" className="linkbtn" style={{ textDecoration: "none", fontWeight: 800, color: "var(--ink)" }} onClick={(e) => { e.stopPropagation(); setOpenId(a.id); }}>{a.ref}</button></td>
                      <td data-label={settings.unitLabel}>{a.unitName}</td>
                      <td data-label="Issue" style={{ maxWidth: 280 }}>{a.title}{a.kind === "preventive" && <span className="sub"> · preventive</span>}</td>
                      <td data-label="Priority"><BandPill band={PRI_BAND[a.priority]}>{a.priority[0].toUpperCase() + a.priority.slice(1)}</BandPill></td>
                      <td data-label="Status"><StatusPill a={a} /></td>
                      <td data-label="Due" style={{ whiteSpace: "nowrap" }}>{a.status === "closed" ? "—" : fmtDate(a.dueDate)}</td>
                      <td data-label="Owner">{a.ownerName || a.ownerEmail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="check" title="Nothing here">{tab === "awaiting" ? "No closures are waiting for verification." : "No actions match."}</Empty>}
        </Card>
        <Card title="Open actions by branch" sub="Overdue first">
          {byUnitOpen.length ? <ul className="list">{byUnitOpen.map((u) => (
            <li key={u.name}><i className="swatch" data-band={u.overdue ? "escalate" : u.n > 1 ? "watch" : "worldClass"} aria-hidden="true" style={{ borderRadius: "50%" }} /><span className="grow"><strong>{u.name}</strong>{u.overdue > 0 && <span className="sub"> · {u.overdue} overdue</span>}</span><strong>{u.n}</strong></li>
          ))}</ul> : <p className="sub">No open actions.</p>}
        </Card>
      </div>
      {current && <ActionSheet a={current} onClose={() => setOpenId(null)} />}
      {raise && <RaiseAction onClose={() => setRaise(false)} />}
    </>
  );
}

const STEP_LABEL: Record<ActionStep, string> = { start: "Start work", submit: "Submit for verification", verify: "Verify and close", return: "Send back", reopen: "Reopen" };

function ActionSheet({ a, onClose }: { a: ActionView; onClose: () => void }) {
  const app = useApp();
  const { actor, refresh } = app;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [edit, setEdit] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const steps = allowedSteps(actor, a);
  const block = a.status === "awaiting_verification" ? verifyBlocker(actor, a) : null;
  useEffect(() => { setNote(""); setMsg(null); }, [a.id]);
  const step = async (s: ActionStep) => {
    setBusy(true); setMsg(null);
    try { await api(`/api/actions/${a.id}/step`, "POST", { step: s, note }); setNote(""); setMsg({ kind: "ok", text: `${a.ref}: ${STEP_LABEL[s].toLowerCase()} — done.` }); refresh(); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setMsg(null);
    try {
      for (const f of Array.from(files)) { const fd = new FormData(); fd.append("file", f); fd.append("entityType", "action"); fd.append("entityId", a.id); await api("/api/evidence", "POST", fd); }
      setMsg({ kind: "ok", text: "Evidence added." }); refresh();
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
    if (file.current) file.current.value = "";
  };
  const needsNote = steps.includes("submit") || steps.includes("return") || steps.includes("reopen");
  const canAddEvidence = a.status !== "closed" && (can.workActions(actor) || a.ownerEmail === actor.email);
  return (
    <>
      <Sheet title={<>{a.ref} <span className="sub" style={{ fontSize: 14 }}>· {a.kind === "preventive" ? "Preventive" : "Corrective"}</span></>} sub={`${a.unitName} · ${app.areaName(a.areaId)}`} onClose={onClose}
        footer={<>
          {can.planActions(actor) && a.status !== "closed" && <button className="btn" onClick={() => setEdit(true)}>Change plan</button>}
          {steps.map((s) => <button key={s} className={`btn ${s === "verify" || s === "submit" ? "primary" : ""}`} disabled={busy} onClick={() => step(s)}>{STEP_LABEL[s]}</button>)}
        </>}>
        <h3 className="h2" style={{ fontSize: 20, margin: "0 0 8px" }}>{a.title}</h3>
        <div className="row wrap"><StatusPill a={a} /><BandPill band={PRI_BAND[a.priority]}>{a.priority} priority</BandPill></div>
        <dl className="kv mt">
          <dt>Owner</dt><dd>{a.ownerName || a.ownerEmail}{a.ownerEmail && a.ownerName ? <span className="sub"> · {a.ownerEmail}</span> : ""}</dd>
          <dt>Due</dt><dd>{fmtDate(a.dueDate)}{a.overdue && <strong style={{ color: "var(--t-escalate)" }}> · overdue</strong>}</dd>
          <dt>Raised by</dt><dd>{a.raisedBy} · {fmtDate(a.createdAt)}</dd>
          {a.verifierEmail && <><dt>Verifier</dt><dd>{a.verifierEmail}</dd></>}
          {a.verifiedBy && <><dt>Verified by</dt><dd>{a.verifiedBy} · {fmtDate(a.verifiedAt)}</dd></>}
          {a.sourceType !== "manual" && <><dt>Source</dt><dd>{a.sourceType === "review_item" ? "A defect in a published review" : a.sourceType === "recurring" ? "A recurring issue" : "Previous version"}</dd></>}
        </dl>
        {a.details && <><div className="eyebrow mt2">Details</div><p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{a.details}</p></>}
        {a.rootCause && <><div className="eyebrow mt">Root cause</div><p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{a.rootCause}</p></>}
        {a.closureNote && <><div className="eyebrow mt">What was done</div><p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{a.closureNote}</p></>}
        <div className="eyebrow mt2">Evidence</div>
        {a.evidence.length ? <ul className="list">{a.evidence.map((e) => (
          <li key={e.id}><Icon name={e.contentType.startsWith("image/") ? "camera" : "file"} /><span className="grow"><a href={`/api/evidence/${e.id}?inline=1`} target="_blank" rel="noreferrer">{e.name}</a><br /><span className="sub">{Math.ceil(e.size / 1024)} KB · {e.uploadedBy} · {fmtDate(e.uploadedAt)}</span></span></li>
        ))}</ul> : <p className="sub" style={{ marginTop: 4 }}>No evidence yet.</p>}
        {canAddEvidence && (
          <label className="btn sm" style={{ marginTop: 6 }}>
            <Icon name="camera" />Add photo or file
            <input ref={file} type="file" multiple accept="image/*,application/pdf,.docx,.xlsx,.csv,.txt" capture="environment" className="sr" onChange={(e) => upload(e.target.files)} />
          </label>
        )}
        {needsNote && (
          <label className="field"><span>{steps.includes("submit") ? "What was done (for the verifier)" : "Note"}</span>
            <textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder={steps.includes("submit") ? "What was fixed, and the evidence attached" : "What still needs doing"} /></label>
        )}
        {block && a.status === "awaiting_verification" && actor.roles.some((r) => r === "admin" || r === "supervisor") && <Msg kind="info">{block}</Msg>}
        <Msg kind={msg?.kind}>{msg?.text}</Msg>
        <div className="eyebrow mt2">History</div>
        <ol className="timeline mt">
          {a.history.slice().reverse().map((h, i) => (
            <li key={i}><strong>{h.kind === "edited" ? "Plan changed" : h.status ? STATUS_LABEL[h.status as keyof typeof STATUS_LABEL] ?? h.status : h.kind}</strong> · {h.by}<br /><span className="sub">{fmtDateTime(h.at)}</span>{h.note && <div style={{ marginTop: 2 }}>{h.note}</div>}</li>
          ))}
        </ol>
        <p className="sub">Every change is also kept in the tamper-evident change history.</p>
      </Sheet>
      {edit && <RaiseAction edit={a} onClose={() => setEdit(false)} />}
    </>
  );
}
