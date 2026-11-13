"use client";
// Saved reports: pick the sections, the scope (everything, one entity, region
// or group) and the period; PDF, Excel or both; on demand or weekly/monthly to
// a list of people. Email goes through Resend when the deployment has it;
// otherwise every run is kept here to download, and the page says so.
import { useState } from "react";
import { api, useApp } from "@/components/app-context";
import { Card, Field, fmtDateTime, Msg, Seg, Sheet } from "@/components/ui";
import { Icon } from "@/components/icons";
import { can } from "@/lib/roles";
import type { SavedReportView, Schedule } from "@/lib/reportBuilder";
import type { Structure } from "@/lib/structure";

export interface SavedReportsData { reports: SavedReportView[]; email: boolean; structure: Structure }

const SECTIONS: { key: string; label: string }[] = [
  { key: "kpis", label: "Headline figures" }, { key: "league", label: "Risk league table" }, { key: "watchlist", label: "Watchlist with reasons" },
  { key: "comparison", label: "Comparison by entity, region or group" }, { key: "missed", label: "Missed visits" }, { key: "sampling", label: "Sampling conclusions" },
  { key: "failed", label: "Most-failed questions" }, { key: "actions", label: "Corrective actions and effectiveness" }, { key: "issues", label: "Reported issues" },
];
const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const ST: Record<string, string> = { emailed: "st-closed", stored: "st-draft", failed: "st-overdue" };
export const scheduleText = (s: Schedule) => (s.every === "none" ? "On demand" : s.every === "weekly" ? `Every ${DAYS[s.day]} at ${String(s.hour).padStart(2, "0")}:00 UTC` : `Monthly on day ${s.day} at ${String(s.hour).padStart(2, "0")}:00 UTC`);

export function SavedReports({ data }: { data: SavedReportsData }) {
  const app = useApp();
  const [edit, setEdit] = useState<SavedReportView | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const builder = can.buildTemplates(app.actor);
  const scopeText = (sc: string) => {
    if (sc === "all") return `All ${app.settings.unitPlural.toLowerCase()}`;
    if (sc.startsWith("entity:")) return data.structure.entities.find((e) => e.id === sc.slice(7))?.name ?? "Removed entity";
    if (sc.startsWith("group:")) return data.structure.groups.find((g) => g.id === sc.slice(6))?.name ?? "Removed group";
    return sc.slice(7);
  };
  const run = async (r: SavedReportView, send: boolean) => {
    setBusy(r.id); setMsg(null);
    try {
      const j = await api<{ runId: string; status: string; note: string }>(`/api/reports/${r.id}`, "POST", { send });
      setMsg({ kind: j.status === "failed" ? "err" : j.status === "emailed" ? "ok" : "info", text: `${r.name}: ${j.note || "done"}` });
      if (!send && r.format !== "xlsx") window.open(`/api/reports/runs/${j.runId}?kind=pdf`, "_blank", "noopener");
      if (!send && r.format === "xlsx") window.location.href = `/api/reports/runs/${j.runId}?kind=xlsx`;
      app.refresh();
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(null);
  };
  return (
    <Card className="no-print" title="Saved reports" sub={data.email ? "Run any report now, or let it go out on its schedule by email." : "Run any report now. Scheduled runs are kept here to download: email isn't set up on this deployment."}
      actions={builder ? <button className="btn sm" onClick={() => setEdit("new")}><Icon name="plus" />New report</button> : undefined}>
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
      {data.reports.length ? <ul className="list">{data.reports.map((r) => (
        <li key={r.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span className="badge sm" aria-hidden="true"><Icon name={r.schedule.every === "none" ? "report" : "mail"} /></span>
          <span className="grow" style={{ minWidth: 220 }}>
            <strong>{r.name}</strong>
            <span className="sub" style={{ display: "block", fontSize: 13 }}>{scopeText(r.filters.scope)} · last {r.filters.days} days · {r.format === "both" ? "PDF and Excel" : r.format.toUpperCase()} · {r.sections.length} section{r.sections.length === 1 ? "" : "s"}</span>
            <span className="sub" style={{ display: "block", fontSize: 13 }}>{scheduleText(r.schedule)}{r.recipients.length ? ` · to ${r.recipients.length} ${r.recipients.length === 1 ? "person" : "people"}` : ""}{r.nextRunAt ? ` · next ${fmtDateTime(r.nextRunAt)}` : ""}</span>
            {r.runs.length > 0 && <span className="row wrap" style={{ gap: 6, marginTop: 6 }}>{r.runs.slice(0, 3).map((x) => (
              <span key={x.id} className="run-chip"><span className={`status ${ST[x.status] ?? ""}`}>{x.status === "stored" ? "Kept here" : x.status === "emailed" ? "Emailed" : "Failed"}</span> {fmtDateTime(x.at)}{x.pdf && <a href={`/api/reports/runs/${x.id}?kind=pdf`} target="_blank" rel="noreferrer" aria-label={`PDF of ${r.name}, ${fmtDateTime(x.at)}`}>PDF</a>}{x.xlsx && <a href={`/api/reports/runs/${x.id}?kind=xlsx`} aria-label={`Excel of ${r.name}, ${fmtDateTime(x.at)}`}>Excel</a>}</span>
            ))}</span>}
          </span>
          <span className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm primary" disabled={busy === r.id} onClick={() => run(r, false)}><Icon name="play" />Run now</button>
            {r.recipients.length > 0 && builder && <button className="btn sm" disabled={busy === r.id} onClick={() => run(r, true)}><Icon name="send" />Send now</button>}
            {builder && <button className="btn sm ghost" onClick={() => setEdit(r)}>Edit</button>}
          </span>
        </li>
      ))}</ul> : <p className="sub" style={{ margin: 0 }}>No saved reports yet.{builder ? " Build one from the sections of the committee report, for one entity, region or group if you like." : ""}</p>}
      {edit && <ReportSheet r={edit === "new" ? null : edit} data={data} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function ReportSheet({ r, data, onClose }: { r: SavedReportView | null; data: SavedReportsData; onClose: () => void }) {
  const app = useApp();
  const S = app.settings;
  const [f, setF] = useState({
    name: r?.name ?? "Monthly quality pack", sections: r?.sections ?? ["kpis", "league", "watchlist", "actions"], scope: r?.filters.scope ?? "all", days: String(r?.filters.days ?? 90), level: r?.filters.level ?? "region",
    format: r?.format ?? "pdf", every: r?.schedule.every ?? "none", day: String(r?.schedule.day ?? 1), hour: String(r?.schedule.hour ?? 7), recipients: (r?.recipients ?? []).join(", "),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const regions = Array.from(new Set(app.program.units.map((u) => u.region).filter(Boolean))) as string[];
  const save = async (remove = false) => {
    setBusy(true); setErr("");
    const body = { name: f.name, sections: f.sections, filters: { scope: f.scope, days: Number(f.days), level: f.level }, format: f.format, schedule: { every: f.every, day: Number(f.day), hour: Number(f.hour) }, recipients: f.recipients, remove };
    try { if (r) await api(`/api/reports/${r.id}`, remove ? "DELETE" : "PUT", remove ? undefined : body); else await api("/api/reports", "POST", body); app.refresh(); onClose(); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Sheet title={r ? `Change ${r.name}` : "New saved report"} sub="The same figures as the screens, for the people and places you choose." onClose={onClose}
      footer={<>{r && <button className="btn ghost" disabled={busy} onClick={() => confirm(`Delete ${r.name} and its kept runs?`) && save(true)}>Delete</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save report"}</button></>}>
      <Field label="Name"><input className="input" value={f.name} maxLength={100} onChange={set("name")} /></Field>
      <div className="field"><span>Sections</span>
        <div className="chips static" role="group" aria-label="Sections">{SECTIONS.map((s) => (
          <button key={s.key} type="button" className="chip" aria-pressed={f.sections.includes(s.key as never)} onClick={() => setF((x) => ({ ...x, sections: (x.sections.includes(s.key as never) ? x.sections.filter((k) => k !== s.key) : [...x.sections, s.key]) as typeof x.sections }))}>{s.label}</button>
        ))}</div>
      </div>
      <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Covers"><select className="select" style={{ width: "100%" }} value={f.scope} onChange={set("scope")}>
          <option value="all">All {S.unitPlural.toLowerCase()}</option>
          {data.structure.entities.length > 0 && <optgroup label={`${S.entityLabel}s`}>{data.structure.entities.map((e) => <option key={e.id} value={`entity:${e.id}`}>{e.name}</option>)}</optgroup>}
          {regions.length > 0 && <optgroup label={`${S.groupLabel}s`}>{regions.map((g) => <option key={g} value={`region:${g}`}>{g}</option>)}</optgroup>}
          {data.structure.groups.length > 0 && <optgroup label="Groups">{data.structure.groups.map((g) => <option key={g.id} value={`group:${g.id}`}>{g.name}</option>)}</optgroup>}
        </select></Field>
        <Field label="Period"><select className="select" style={{ width: "100%" }} value={f.days} onChange={set("days")}><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="180">Last 6 months</option><option value="365">Last 12 months</option></select></Field>
        {f.sections.includes("comparison" as never) && <Field label="Compare by"><select className="select" style={{ width: "100%" }} value={f.level} onChange={set("level")}><option value="entity">{S.entityLabel}</option><option value="region">{S.groupLabel}</option><option value="group">Group</option></select></Field>}
        <Field label="Format"><select className="select" style={{ width: "100%" }} value={f.format} onChange={set("format")}><option value="pdf">PDF</option><option value="xlsx">Excel</option><option value="both">PDF and Excel</option></select></Field>
      </div>
      <div className="field"><span>Schedule</span><Seg label="Schedule" value={f.every as "none" | "weekly" | "monthly"} onChange={(v) => setF((x) => ({ ...x, every: v, day: "1" }))} options={[{ value: "none", label: "On demand" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }]} /></div>
      {f.every !== "none" && <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
        <Field label={f.every === "weekly" ? "Day" : "Day of the month"}><select className="select" style={{ width: "100%" }} value={f.day} onChange={set("day")}>{f.every === "weekly" ? DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>) : Array.from({ length: 28 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></Field>
        <Field label="Time (UTC)"><select className="select" style={{ width: "100%" }} value={f.hour} onChange={set("hour")}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, "0")}:00</option>)}</select></Field>
      </div>}
      <Field label="Send to" hint={data.email ? "Email addresses, separated by commas." : "Email addresses, separated by commas. Email isn't set up on this deployment yet, so runs are kept here to download until it is."}><textarea className="textarea" style={{ minHeight: 56 }} value={f.recipients} onChange={set("recipients")} placeholder="committee@example.org" /></Field>
      <Msg>{err}</Msg>
    </Sheet>
  );
}
