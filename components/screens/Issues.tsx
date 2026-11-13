"use client";
// Reported issues: what anyone raised from a site's QR code or link, with no
// sign-in, for a supervisor to triage into an action, an inspection, or close
// with a reason. The second tab holds every site's link and QR poster.
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, fmtDate, fmtDateTime, Msg, PageHead, Seg, Sheet, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { CATEGORY_INFO, STATUS_INFO, type IssueView, type LinkView } from "@/lib/issueInfo";
import { KIND_LABEL, type ActionKind } from "@/lib/actionRules";
import { isSupervisor } from "@/lib/roles";

type Tab = "new" | "done" | "all" | "links";
const CAT_BAND = { hazard: "escalate", near_miss: "attention", observation: "watch", complaint: "watch", other: "healthy" } as const;
const ST_CLS: Record<string, string> = { new: "st-submitted", action: "st-in_progress", inspection: "st-in_progress", dismissed: "st-closed" };
const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export function Issues({ issues, links, templates, turnstile }: { issues: IssueView[]; links: LinkView[]; templates: { id: string; name: string }[]; turnstile: boolean }) {
  const app = useApp();
  const params = useSearchParams();
  const sup = isSupervisor(app.actor);
  const [tab, setTab] = useState<Tab>(params.get("tab") === "links" ? "links" : "new");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [unit, setUnit] = useState("all");
  const U = app.settings.unitLabel;
  const scoped = issues.filter((i) => unit === "all" || i.unitId === unit);
  const k = { new: scoped.filter((i) => i.status === "new").length, hazards: scoped.filter((i) => i.category === "hazard" && i.status === "new").length, done: scoped.filter((i) => i.status !== "new").length, week: scoped.filter((i) => Date.now() - Date.parse(i.createdAt) < 7 * 864e5).length };
  const list = scoped.filter((i) => tab === "all" || (tab === "new" ? i.status === "new" : i.status !== "new"));
  const current = issues.find((i) => i.id === openId) || null;
  return (
    <>
      <PageHead eyebrow="Issues" title="Anyone can report." accent="Supervisors act."
        lede={`Staff, contractors and visitors report an observation, hazard, near miss or complaint from a ${U.toLowerCase()}'s QR code or link, on a phone, without signing in. ${k.new} waiting for triage.`}
        right={sup ? <button className="btn" onClick={() => setTab("links")}><Icon name="qr" />QR codes and links</button> : undefined} />
      <div className="grid g4">
        <Stat icon="flag" value={k.new} label="Waiting for triage" band={k.new ? "watch" : "worldClass"} onClick={() => setTab("new")} />
        <Stat icon="alert" value={k.hazards} label="Hazards waiting" band={k.hazards ? "escalate" : "worldClass"} onClick={() => setTab("new")} />
        <Stat icon="check" value={k.done} label="Triaged" onClick={() => setTab("done")} />
        <Stat icon="clock" value={k.week} label="Reported this week" onClick={() => setTab("all")} />
      </div>
      <Card className="mt" flush title={tab === "links" ? "Report-an-issue links" : "Reported issues"} actions={<div className="row wrap">
        <Seg label="Show" value={tab} onChange={setTab} options={[{ value: "new", label: `New (${k.new})` }, { value: "done", label: "Triaged" }, { value: "all", label: "All" }, ...(sup ? [{ value: "links" as Tab, label: "QR codes" }] : [])]} />
      </div>}>
        {tab === "links" ? <Links links={links} turnstile={turnstile} /> : <>
          <div className="row wrap" style={{ padding: "0 18px 10px" }}>
            <select className="select" aria-label={`Filter by ${U.toLowerCase()}`} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="all">All {app.settings.unitPlural.toLowerCase()}</option>{app.program.units.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          {list.length ? (
            <ul className="list issue-list">{list.map((i) => (
              <li key={i.id} className="clickable" style={{ alignItems: "flex-start" }}>
                <span className="badge sm" aria-hidden="true" data-band={CAT_BAND[i.category]} style={{ background: "var(--bp)", color: "var(--bt)" }}><Icon name={i.category === "hazard" ? "alert" : "flag"} /></span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <button type="button" className="linkbtn" style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 700, textAlign: "left" }} onClick={() => setOpenId(i.id)}>{i.ref} · {CATEGORY_INFO[i.category].label}</button>
                  <span className="sub" style={{ display: "block", fontSize: 13 }}>{i.unitName}{i.location ? ` · ${i.location}` : ""} · {fmtDateTime(i.createdAt)}{i.photos.length ? ` · ${i.photos.length} photo` : ""}{i.source === "qr" ? " · from QR" : i.source === "api" ? " · from the API" : ""}</span>
                  <span style={{ display: "block", marginTop: 4 }}>{i.description.length > 180 ? i.description.slice(0, 180) + "…" : i.description}</span>
                </span>
                <span className={`status ${ST_CLS[i.status] ?? ""}`}>{STATUS_INFO[i.status] ?? i.status}</span>
              </li>
            ))}</ul>
          ) : <Empty icon="check" title={tab === "new" ? "Nothing waiting" : "Nothing here"}>{tab === "new" ? "New reports appear here as soon as someone sends one." : "No reports match."}</Empty>}
        </>}
      </Card>
      {current && <IssueSheet i={current} templates={templates} onClose={() => setOpenId(null)} />}
    </>
  );
}

function Links({ links, turnstile }: { links: LinkView[]; turnstile: boolean }) {
  const app = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const rotate = async (l: LinkView) => {
    if (!confirm(`Replace ${l.unitName}'s link? Posters with the old QR code will stop working.`)) return;
    setBusy(l.unitId); setMsg("");
    try { await api(`/api/issues/links/${l.unitId}`, "POST"); app.refresh(); setMsg(`${l.unitName} has a new link. Print its new poster.`); } catch (e) { setMsg((e as Error).message); }
    setBusy(null);
  };
  return (
    <div style={{ padding: "0 18px 18px" }}>
      <p className="sub" style={{ marginTop: 0 }}>Print each poster and put it where people work or visit. The link opens a short form on any phone, with no sign-in or app. {turnstile ? "Cloudflare Turnstile checks each report is from a person." : "A hidden trap field and a per-phone limit stop automated reports; add Turnstile keys to check every report is from a person."} Replace a link if a poster is misused: the old one stops working at once.</p>
      <Msg kind="ok">{msg}</Msg>
      <div className="qr-grid">{links.map((l) => (
        <div key={l.unitId} className="qr-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/issues/qr/${l.unitId}`} alt={`QR code for reporting an issue at ${l.unitName}`} width={132} height={132} loading="lazy" />
          <div className="grow" style={{ minWidth: 0 }}>
            <strong>{l.unitName}</strong>{l.region && <span className="sub"> · {l.region}</span>}
            <div className="sub" style={{ fontSize: 12.5, wordBreak: "break-all" }}>{origin}{l.path}</div>
            <div className="sub" style={{ fontSize: 12.5 }}>{l.reports} report{l.reports === 1 ? "" : "s"} so far</div>
            <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
              <a className="btn sm" href={`/api/issues/qr/${l.unitId}?format=png&download=1`}><Icon name="download" />Poster QR</a>
              <button type="button" className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(origin + l.path); setCopied(l.unitId); } catch { /* clipboard blocked */ } }}><Icon name="copy" />{copied === l.unitId ? "Copied" : "Copy link"}</button>
              <a className="btn sm ghost" href={l.path} target="_blank" rel="noreferrer">Open form</a>
              <button type="button" className="btn sm ghost" disabled={busy === l.unitId} onClick={() => rotate(l)}>Replace link</button>
            </div>
          </div>
        </div>
      ))}</div>
    </div>
  );
}

function IssueSheet({ i, templates, onClose }: { i: IssueView; templates: { id: string; name: string }[]; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const sup = isSupervisor(app.actor);
  const [to, setTo] = useState<"action" | "inspection" | "dismiss">(i.category === "hazard" ? "action" : "action");
  const [f, setF] = useState({ title: i.description.slice(0, 120), kind: (i.category === "hazard" ? "containment" : "corrective") as ActionKind, priority: i.category === "hazard" ? "high" : "medium", dueDate: inDays(i.category === "hazard" ? 2 : 14), ownerEmail: "", ownerName: `${i.unitName} ${app.settings.unitLabel.toLowerCase()} manager`, templateId: templates[0]?.id ?? "", assignee: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inspectors = useMemo(() => app.people.filter((p) => p.roles.some((r) => r === "inspector" || r === "supervisor" || r === "admin")), [app.people]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => {
    setBusy(true); setErr("");
    try {
      const r = await api<{ issue: IssueView }>(`/api/issues/${i.id}`, "POST", { to, ...f });
      app.refresh(); onClose();
      if (to === "action" && r.issue.actionId) router.push(`/actions?open=${r.issue.actionId}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Sheet title={<>{i.ref} <span className="sub" style={{ fontSize: 14 }}>· {CATEGORY_INFO[i.category].label}</span></>} sub={`${i.unitName} · reported ${fmtDateTime(i.createdAt)}`} onClose={onClose}
      footer={i.status === "new" && sup ? <><button className="btn" onClick={onClose}>Later</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? "Saving…" : to === "action" ? "Raise the action" : to === "inspection" ? "Schedule the inspection" : "Close with no action"}</button></> : undefined}>
      <div className="row wrap"><BandPill band={CAT_BAND[i.category]}>{CATEGORY_INFO[i.category].label}</BandPill><span className={`status ${ST_CLS[i.status] ?? ""}`}>{STATUS_INFO[i.status]}</span></div>
      <p style={{ whiteSpace: "pre-wrap" }}>{i.description}</p>
      <dl className="kv">
        {i.location && <><dt>Where</dt><dd>{i.location}</dd></>}
        <dt>Reported by</dt><dd>{i.reporterName || "Not given"}{i.reporterContact ? ` · ${i.reporterContact}` : ""}</dd>
        <dt>How</dt><dd>{i.source === "qr" ? "Scanned the QR code" : i.source === "api" ? "Another system, through the API" : "The site's link"}</dd>
        {i.status !== "new" && <><dt>Triaged</dt><dd>{i.triagedBy} · {fmtDate(i.triagedAt)}{i.triageNote ? ` · ${i.triageNote}` : ""}</dd></>}
        {i.actionId && <><dt>Action</dt><dd><a href={`/actions?open=${i.actionId}`}>Open the action</a></dd></>}
        {i.inspectionId && <><dt>Inspection</dt><dd><a href={`/inspect/${i.inspectionId}`}>Open the inspection</a></dd></>}
      </dl>
      {i.photos.length > 0 && <div className="row wrap mt">{i.photos.map((p) => (
        <a key={p.id} href={`/api/evidence/${p.id}?inline=1`} target="_blank" rel="noreferrer" className="photo-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/evidence/${p.id}?inline=1`} alt={`Photo with ${i.ref}`} width={120} height={120} />
        </a>
      ))}</div>}
      {i.status === "new" && sup && <>
        <div className="eyebrow mt2">Triage</div>
        <Seg label="What to do" value={to} onChange={setTo} options={[{ value: "action", label: "Raise an action" }, { value: "inspection", label: "Inspect" }, { value: "dismiss", label: "No action" }]} />
        {to === "action" && <>
          <Field label="Issue"><input className="input" value={f.title} maxLength={160} onChange={set("title")} /></Field>
          <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
            <Field label="Kind"><select className="select" style={{ width: "100%" }} value={f.kind} onChange={set("kind")}>{(["containment", "corrective", "preventive"] as ActionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
            <Field label="Priority"><select className="select" style={{ width: "100%" }} value={f.priority} onChange={set("priority")}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
            <Field label="Owner"><select className="select" style={{ width: "100%" }} value={f.ownerEmail} onChange={set("ownerEmail")}><option value="">A team (type below)</option>{app.people.map((p) => <option key={p.email} value={p.email}>{p.name || p.email}</option>)}</select></Field>
            <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
          </div>
          {!f.ownerEmail && <Field label="Owning team"><input className="input" value={f.ownerName} onChange={set("ownerName")} /></Field>}
        </>}
        {to === "inspection" && <>
          <Field label="Checklist"><select className="select" style={{ width: "100%" }} value={f.templateId} onChange={set("templateId")}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Who inspects" hint="A draft inspection appears on their list."><select className="select" style={{ width: "100%" }} value={f.assignee} onChange={set("assignee")}><option value="">Me</option>{inspectors.filter((p) => p.email !== app.actor.email).map((p) => <option key={p.email} value={p.email}>{p.name || p.email}</option>)}</select></Field>
        </>}
        <Field label={to === "dismiss" ? "Why no action is needed" : "Triage note (optional)"}><textarea className="textarea" style={{ minHeight: 60 }} value={f.note} onChange={set("note")} /></Field>
        <Msg>{err}</Msg>
      </>}
    </Sheet>
  );
}
