"use client";
// Schedule: programmes of visits and the calendar they make. An inspector
// opens "My schedule" on a phone: what's overdue, what's due now, what's
// coming. Supervisors see every visit, the missed ones first, and plan the
// programmes: which checklist, which sites, how often (or risk-based), the
// window and who goes.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Empty, Field, Msg, PageHead, Seg, Sheet, fmtDate } from "@/components/ui";
import { Icon } from "@/components/icons";
import type { ProgrammeView, Visit } from "@/lib/schedule";
import { can } from "@/lib/roles";

const ST: Record<Visit["status"], { label: string; cls: string }> = {
  overdue: { label: "Overdue", cls: "st-overdue" }, due: { label: "Due now", cls: "st-submitted" }, in_progress: { label: "In progress", cls: "st-in_progress" }, upcoming: { label: "Upcoming", cls: "st-draft" }, done: { label: "Done", cls: "st-published" },
};
const EVERY = [{ v: 0, l: "Risk-based (by band)" }, { v: 7, l: "Weekly" }, { v: 14, l: "Every two weeks" }, { v: 30, l: "Monthly" }, { v: 60, l: "Every two months" }, { v: 91, l: "Quarterly" }, { v: 182, l: "Half-yearly" }, { v: 365, l: "Yearly" }];
const everyLabel = (d: number) => EVERY.find((e) => e.v === d)?.l ?? `Every ${d} days`;

export function Schedule({ programmes, visits, templates, today }: { programmes: ProgrammeView[]; visits: Visit[]; templates: { id: string; name: string }[]; today: string }) {
  const app = useApp();
  const planner = can.buildTemplates(app.actor);
  const mineAll = visits.filter((v) => v.assignee === app.actor.email);
  const [tab, setTab] = useState<"mine" | "all" | "calendar" | "programmes">(mineAll.length || !planner ? "mine" : "all");
  const [editing, setEditing] = useState<ProgrammeView | "new" | null>(null);
  const scope = tab === "mine" ? mineAll : visits;
  const overdue = scope.filter((v) => v.status === "overdue"), due = scope.filter((v) => v.status === "due" || v.status === "in_progress");
  const soon = scope.filter((v) => v.status === "upcoming" && v.from <= addDays(today, 30)), done = scope.filter((v) => v.status === "done").slice(-12).reverse();
  return (
    <>
      <PageHead eyebrow="Schedule" title="Every visit," accent="on time."
        lede={programmes.length ? `${visits.filter((v) => v.status === "overdue").length} overdue and ${visits.filter((v) => v.status === "due").length} due now across ${programmes.filter((p) => p.active).length} programme${programmes.length === 1 ? "" : "s"}. A visit counts as done when an inspection of its checklist is started at the ${app.settings.unitLabel.toLowerCase()} within its window.` : "Plan who inspects which sites, with which checklist, how often. Risk-based programmes visit higher-risk sites more often."}
        right={planner ? <button className="btn primary" onClick={() => setEditing("new")}><Icon name="plus" />New programme</button> : undefined} />
      {overdue.length > 0 && <div className="msg err" role="alert" style={{ marginBottom: 14 }}><strong>{overdue.length} visit{overdue.length === 1 ? " is" : "s are"} overdue</strong> {tab === "mine" ? "on your schedule" : "across the programmes"}: {Array.from(new Set(overdue.map((v) => v.unit))).slice(0, 5).join(", ")}{overdue.length > 5 ? "…" : ""}.</div>}
      <div style={{ margin: "4px 0 14px" }}>
        <Seg label="Schedule" value={tab} onChange={setTab} options={[{ value: "mine", label: `My schedule (${mineAll.filter((v) => v.status !== "done").length})` }, { value: "all", label: "All visits" }, { value: "calendar", label: "Calendar" }, ...(planner ? [{ value: "programmes" as const, label: `Programmes (${programmes.length})` }] : [])]} />
      </div>
      {tab === "programmes" ? (
        programmes.length ? (
          <div className="tgrid">{programmes.map((p) => (
            <article key={p.id} className="tcard">
              <div className="row" style={{ alignItems: "flex-start" }}><span className="badge sm" aria-hidden="true"><Icon name="calendar" /></span><div className="grow"><h3>{p.name}</h3><div className="sub" style={{ fontSize: 12.5 }}>{p.template}</div></div>{!p.active && <span className="status st-draft">Paused</span>}</div>
              <div className="tmeta"><span>{everyLabel(p.everyDays)}</span><span>· {p.windowDays}-day window</span><span>· {p.sites} {p.sites === 1 ? app.settings.unitLabel.toLowerCase() : app.settings.unitPlural.toLowerCase()}</span></div>
              <p>{p.assignees.length ? `Visited by ${p.assignees.map((e) => app.people.find((x) => x.email === e)?.name || e).join(", ")}, taking ${app.settings.unitPlural.toLowerCase()} in turn.` : "Not assigned: anyone can carry it out."}</p>
              <div className="row wrap tfoot"><button className="btn sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}><Icon name="pen" />Edit</button></div>
            </article>
          ))}</div>
        ) : <Card><Empty icon="calendar" title="No programmes yet">Create one: a checklist, the sites, how often and who goes.</Empty></Card>
      ) : tab === "calendar" ? <Calendar visits={visits} today={today} /> : (
        scope.length ? (
          <div className="stack">
            {[["Overdue", overdue], ["Due now", due], ["Next 30 days", soon], ["Recently done", done]].map(([title, list]) => (list as Visit[]).length ? (
              <Card key={title as string} title={title as string} flush>
                <ul className="list" style={{ padding: "0 18px 6px" }}>{(list as Visit[]).slice(0, 40).map((v) => <VisitRow key={v.key} v={v} today={today} />)}</ul>
              </Card>
            ) : null)}
          </div>
        ) : <Card><Empty icon="calendar" title={tab === "mine" ? "Nothing on your schedule" : "No visits planned"}>{planner ? "Create a programme to plan visits." : "A supervisor plans the programmes."}</Empty></Card>
      )}
      {editing && <ProgrammeSheet p={editing === "new" ? null : editing} templates={templates} onClose={() => setEditing(null)} />}
    </>
  );
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

function VisitRow({ v, today }: { v: Visit; today: string }) {
  const app = useApp();
  const days = Math.round((Date.parse(v.by) - Date.parse(today)) / 864e5);
  const when = v.status === "overdue" ? `window ended ${fmtDate(v.by)} (${-days} day${-days === 1 ? "" : "s"} ago)` : v.status === "done" || v.status === "in_progress" ? `window ${fmtDate(v.from)} to ${fmtDate(v.by)}` : v.status === "due" ? `due by ${fmtDate(v.by)} (${days} day${days === 1 ? "" : "s"} left)` : `opens ${fmtDate(v.from)}`;
  return (
    <li style={{ flexWrap: "wrap" }}>
      <span className="badge sm" aria-hidden="true" style={v.status === "overdue" ? { background: "var(--p-escalate)", color: "var(--t-escalate)" } : undefined}><Icon name={v.status === "done" ? "check" : "pin"} /></span>
      <span className="grow" style={{ minWidth: 180 }}><strong>{v.unit}</strong> · {v.template}<span className="sub" style={{ display: "block", fontSize: 12.5 }}>{when} · {v.everyDays}-day cycle{v.assignee ? ` · ${app.people.find((p) => p.email === v.assignee)?.name || v.assignee}` : ""}</span></span>
      <span className={`status ${ST[v.status].cls}`}>{ST[v.status].label}</span>
      {v.inspectionId ? <Link className="btn sm" href={`/inspect/${v.inspectionId}`}>Open</Link>
        : (v.status === "due" || v.status === "overdue") && can.inspect(app.actor) ? <Link className="btn sm primary" href={`/inspect/new?template=${v.templateId}&unit=${v.unitId}&period=${today.slice(0, 7)}-01`}><Icon name="play" />Start</Link> : null}
    </li>
  );
}

function Calendar({ visits, today }: { visits: Visit[]; today: string }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState<string | null>(today);
  const days = useMemo(() => {
    const first = new Date(month + "-01T12:00:00Z");
    const lead = (first.getUTCDay() + 6) % 7;
    const n = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  }, [month]);
  const byDay = (d: string) => visits.filter((v) => v.by === d || (v.from === d && v.status !== "done"));
  const shift = (k: number) => { const d = new Date(month + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + k); setMonth(d.toISOString().slice(0, 7)); };
  const label = new Date(month + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const sel = day ? visits.filter((v) => v.from <= day && v.by >= day) : [];
  return (
    <div className="grid g-2-1">
      <Card title={label} actions={<div className="row"><button className="iconbtn sm" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="back" /></button><button className="iconbtn sm" onClick={() => shift(1)} aria-label="Next month"><Icon name="chevron" /></button></div>}>
        <div className="cal">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="cal-h" aria-hidden="true">{d}</div>)}
          {days.map((d, i) => {
            if (!d) return <div key={`x${i}`} className="cal-d empty" aria-hidden="true" />;
            const vs = byDay(d);
            const worst = vs.some((v) => v.status === "overdue") ? "escalate" : vs.some((v) => v.status === "due") ? "watch" : vs.some((v) => v.status === "done") ? "strong" : vs.length ? "none" : "";
            return (
              <button key={d} type="button" className={`cal-d${d === today ? " today" : ""}`} aria-pressed={day === d} onClick={() => setDay(d)}>
                <span className="n">{Number(d.slice(8))}</span>
                <span className="sr-only">{` ${label.split(" ")[0]}: `}</span>
                {vs.length > 0 && <span className="pill sm" data-band={worst || "none"}>{vs.length}</span>}
                <span className="sr-only">{vs.length === 0 ? "no visits" : vs.length === 1 ? " visit" : " visits"}</span>
              </button>
            );
          })}
        </div>
        <p className="sub" style={{ fontSize: 12.5, marginBottom: 0 }}>Each day shows visits whose window opens or ends then: red overdue, amber due, green done.</p>
      </Card>
      <Card title={day ? `Open on ${fmtDate(day)}` : "Choose a day"} flush>
        {sel.length ? <ul className="list" style={{ padding: "0 18px 6px" }}>{sel.map((v) => <VisitRow key={v.key} v={v} today={today} />)}</ul> : <Empty icon="calendar" title="No visit windows open that day" />}
      </Card>
    </div>
  );
}

function ProgrammeSheet({ p, templates, onClose }: { p: ProgrammeView | null; templates: { id: string; name: string }[]; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const units = app.program.units.filter((u) => u.active);
  const inspectors = app.people.filter((x) => x.roles.some((r) => r === "inspector" || r === "supervisor" || r === "admin"));
  const [f, setF] = useState({ name: p?.name ?? "", templateId: p?.templateId ?? templates[0]?.id ?? "", unitIds: p?.unitIds ?? [], everyDays: p?.everyDays ?? 30, windowDays: p?.windowDays ?? 14, assignees: p?.assignees ?? [], startDate: p?.startDate ?? new Date().toISOString().slice(0, 10), active: p?.active ?? true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    try { await api(p ? `/api/programmes/${p.id}` : "/api/programmes", p ? "PUT" : "POST", { ...f, name: f.name || templates.find((t) => t.id === f.templateId)?.name }); router.refresh(); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Sheet title={p ? "Edit programme" : "New programme"} sub="Visits are worked out from the programme; nothing else to keep in step." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !f.templateId} onClick={save}><Icon name="check" />Save</button></>}>
      <Field label="Checklist"><select className="select" style={{ width: "100%" }} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <Field label="Name"><input className="input" value={f.name} placeholder={templates.find((t) => t.id === f.templateId)?.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <div className="grid g3" style={{ gap: 12 }}>
        <Field label="How often"><select className="select" style={{ width: "100%" }} value={f.everyDays} onChange={(e) => setF({ ...f, everyDays: Number(e.target.value) })}>{EVERY.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}</select></Field>
        <Field label="Window (days)"><input className="input" inputMode="numeric" value={f.windowDays} onChange={(e) => setF({ ...f, windowDays: Number(e.target.value.replace(/\D/g, "")) || 1 })} /></Field>
        <Field label="Starting"><input className="input" type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
      </div>
      {f.everyDays === 0 && <Msg kind="info">Risk-based: each {app.settings.unitLabel.toLowerCase()} is visited as often as its risk band says (Risk → Risk model): {Object.entries(app.settings.risk.frequency).map(([b, d]) => `${b === "worldClass" ? "World class" : b.charAt(0).toUpperCase() + b.slice(1)} every ${d} days`).join(" · ")}.</Msg>}
      <div className="field"><span>{app.settings.unitPlural} (none ticked = all)</span>
        <div className="chips static" role="group" aria-label={app.settings.unitPlural}>{units.map((u) => <button key={u.id} type="button" className="chip" aria-pressed={f.unitIds.includes(u.id)} onClick={() => setF({ ...f, unitIds: toggle(f.unitIds, u.id) })}>{u.name}</button>)}</div>
      </div>
      <div className="field"><span>Who goes ({app.settings.unitPlural.toLowerCase()} are shared out in turn)</span>
        <div className="chips static" role="group" aria-label="Inspectors">{inspectors.map((x) => <button key={x.email} type="button" className="chip" aria-pressed={f.assignees.includes(x.email)} onClick={() => setF({ ...f, assignees: toggle(f.assignees, x.email) })}>{x.name || x.email}</button>)}</div>
      </div>
      <label className="toggle mt"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
      <Msg kind="err">{err}</Msg>
    </Sheet>
  );
}
