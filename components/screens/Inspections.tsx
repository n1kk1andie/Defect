"use client";
// Inspections and field visits: start one on any published template, carry
// on with drafts (including those still only on this device), and approve
// other people's. Nothing reaches the dashboards until a supervisor who didn't
// carry it out approves it.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, Msg, PageHead, Seg, Sheet, fmtDate } from "@/components/ui";
import { Icon } from "@/components/icons";
import { readIndex } from "@/components/inspect/Capture";
import { INSPECTION_STATUS } from "@/components/inspect/View";
import { approveBlocker, can } from "@/lib/roles";
import { monthLabel } from "@/lib/metrics";
import type { InspectionView } from "@/lib/inspections";
import type { TemplateSummary } from "@/lib/templates/store";
import type { BandKey } from "@/lib/bands";

const scoreBand = (r: InspectionView): BandKey | "none" => (!r.score || r.score.pct === null ? "none" : r.score.result === "fail" ? (r.score.criticalFails ? "escalate" : "attention") : r.score.pct >= 95 ? "worldClass" : r.score.pct >= 90 ? "strong" : "healthy");

export function Inspections({ inspections, templates }: { inspections: InspectionView[]; templates: TemplateSummary[] }) {
  const app = useApp();
  const router = useRouter();
  const { actor, settings } = app;
  const supervisor = can.approveInspections(actor);
  const queue = inspections.filter((r) => r.status === "submitted" && !approveBlocker(actor, r, "inspection"));
  const mine = inspections.filter((r) => r.inspectorEmail === actor.email && r.status !== "approved");
  const approved = inspections.filter((r) => r.status === "approved");
  const [tab, setTab] = useState<"queue" | "mine" | "approved">(supervisor && queue.length ? "queue" : mine.length ? "mine" : "approved");
  const [starting, setStarting] = useState(false);
  const [onDevice, setOnDevice] = useState<ReturnType<typeof readIndex>>([]);
  useEffect(() => { setOnDevice(readIndex(actor.tenant, actor.email).filter((l) => !l.id || !inspections.some((r) => r.id === l.id && r.status !== "draft" && r.status !== "returned"))); }, [actor.tenant, actor.email, inspections]);
  const unsynced = onDevice.filter((l) => !l.id);
  const stats = useMemo(() => {
    const ap = approved.filter((r) => r.score?.pct != null);
    const avg = ap.length ? ap.reduce((t, r) => t + (r.score!.pct as number), 0) / ap.length : null;
    return { avg, fails: approved.filter((r) => r.score?.result === "fail").length, crit: approved.reduce((t, r) => t + (r.score?.criticalFails ?? 0), 0) };
  }, [approved]);
  const rows = tab === "queue" ? queue : tab === "mine" ? mine : approved.slice(0, 200);

  return (
    <>
      <PageHead eyebrow="Inspect" title="Go and see." accent="Prove it."
        lede={supervisor ? `${queue.length} inspection${queue.length === 1 ? "" : "s"} waiting for your approval. Inspections, field visits and file reviews on your published templates, with photos, signatures and a check-in.` : `Carry out an inspection or field visit on a phone, even without a signal: it's kept on this device and synced when you're back online.`}
        right={can.inspect(actor) ? <>
          <a className="btn" href="/api/export?what=inspections&format=xlsx"><Icon name="download" />Excel</a>
          {can.buildTemplates(actor) && <Link className="btn" href="/templates"><Icon name="layers" />Templates</Link>}
          <button className="btn primary" onClick={() => setStarting(true)} disabled={!templates.length}><Icon name="play" />Start an inspection</button>
        </> : undefined} />
      {!templates.length && <Msg kind="info">No published templates yet. {can.buildTemplates(actor) ? <Link href="/templates">Add one from the library</Link> : "A supervisor or admin publishes one under Templates."}</Msg>}
      {unsynced.length > 0 && (
        <Msg kind="info"><span className="row wrap"><Icon name="wifi" /><span className="grow">{unsynced.length} inspection{unsynced.length === 1 ? " is" : "s are"} saved only on this device so far. Open {unsynced.length === 1 ? "it" : "each"} with a connection to sync.</span>
          {unsynced.slice(0, 3).map((l) => <Link key={l.clientId} className="btn sm" href={`/inspect/new?template=${l.templateId}&unit=${l.unitId}&period=${l.period}&client=${l.clientId}`}>{l.templateName.slice(0, 28)} · {app.unitName(l.unitId)}</Link>)}</span></Msg>
      )}
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="stat-v">{approved.length}</div><div className="stat-l">Approved inspections</div></div>
        <div className="stat"><div className="stat-v tone" data-band={stats.avg === null ? "none" : stats.avg >= 90 ? "strong" : stats.avg >= 80 ? "watch" : "attention"}>{stats.avg === null ? "—" : `${stats.avg.toFixed(1)}%`}</div><div className="stat-l">Average score</div></div>
        <div className="stat"><div className="stat-v">{stats.fails}</div><div className="stat-l">Failed inspections</div></div>
        <div className="stat"><div className="stat-v tone" data-band={stats.crit ? "escalate" : "worldClass"}>{stats.crit}</div><div className="stat-l">Critical failures</div></div>
      </div>
      <div style={{ margin: "6px 0 14px" }}>
        <Seg label="Inspections" value={tab} onChange={setTab} options={[...(supervisor ? [{ value: "queue" as const, label: `To approve (${queue.length})` }] : []), { value: "mine" as const, label: `Mine (${mine.length})` }, { value: "approved" as const, label: `Approved (${approved.length})` }]} />
      </div>
      <Card flush>
        {rows.length ? (
          <div className="tablewrap" tabIndex={0} role="region" aria-label="Inspections">
            <table className="t stack">
              <caption className="sr">Inspections</caption>
              <thead><tr><th scope="col">Inspection</th><th scope="col">Template</th><th scope="col">{settings.unitLabel}</th><th scope="col">Month</th><th scope="col">Inspector</th><th scope="col" className="num">Score</th><th scope="col">Status</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => router.push(`/inspect/${r.id}`)}>
                  <td data-label="Inspection"><Link href={`/inspect/${r.id}`} style={{ fontWeight: 700, color: "var(--ink)", textDecoration: "none" }}>{r.ref}</Link><div className="sub" style={{ fontSize: 12 }}>{fmtDate(r.updatedAt)}</div></td>
                  <td data-label="Template">{r.templateName}<span className="sub"> · v{r.templateVersion}</span></td>
                  <td data-label={settings.unitLabel}>{r.unitName}</td>
                  <td data-label="Month">{monthLabel(r.period)}</td>
                  <td data-label="Inspector">{app.people.find((p) => p.email === r.inspectorEmail)?.name || r.inspectorEmail}</td>
                  <td data-label="Score" className="num">{r.score?.pct != null ? <BandPill band={scoreBand(r)}>{`${Math.round(r.score.pct)}%`}{r.score.criticalFails ? " · critical" : ""}</BandPill> : "—"}</td>
                  <td data-label="Status"><span className={`status st-${r.status === "approved" ? "published" : r.status}`}>{INSPECTION_STATUS[r.status]}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon="clipboard" title={tab === "queue" ? "Nothing waiting for approval." : tab === "mine" ? "No drafts in progress." : "Nothing approved yet."}>{tab === "mine" && can.inspect(actor) ? "Start an inspection on any published template." : undefined}</Empty>}
      </Card>
      {starting && <StartSheet templates={templates} onClose={() => setStarting(false)} />}
    </>
  );
}

function StartSheet({ templates, onClose }: { templates: TemplateSummary[]; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const units = app.program.units.filter((u) => u.active && (!app.actor.unitIds.length || app.actor.unitIds.includes(u.id)));
  const [t, setT] = useState(templates[0]?.id || "");
  const [unit, setUnit] = useState(units[0]?.id || "");
  const thisMonth = new Date().toISOString().slice(0, 7) + "-01";
  const [period, setPeriod] = useState(thisMonth);
  const months = Array.from({ length: 13 }, (_, i) => { const x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); return x.toISOString().slice(0, 7) + "-01"; });
  const groups = Array.from(new Set(templates.map((x) => x.category)));
  return (
    <Sheet title="Start an inspection" sub="It's kept on this device as you go, and synced when there's a connection." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!t || !unit} onClick={() => router.push(`/inspect/new?template=${t}&unit=${unit}&period=${period}`)}><Icon name="play" />Start</button></>}>
      <div className="field" style={{ marginTop: 0 }}><span>Template</span>
        <div className="ilist" role="radiogroup" aria-label="Template">
          {groups.map((g) => (
            <div key={g}>
              <div className="eyebrow" style={{ margin: "10px 0 6px" }}>{g}</div>
              {templates.filter((x) => x.category === g).map((x) => (
                <button key={x.id} type="button" role="radio" aria-checked={t === x.id} className={`ilistopt${t === x.id ? " on" : ""}`} style={{ width: "100%", marginBottom: 6 }} onClick={() => setT(x.id)}>
                  <span className="tick" aria-hidden="true">{t === x.id && <Icon name="check" />}</span>
                  <span className="grow"><strong>{x.name}</strong><span className="sub" style={{ display: "block", fontSize: 12.5 }}>{x.questions} questions{x.sampled ? " · sampled" : ""} · v{x.version}</span></span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="grid g2" style={{ gap: 12 }}>
        <Field label={app.settings.unitLabel}><select className="select" style={{ width: "100%" }} value={unit} onChange={(e) => setUnit(e.target.value)}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Month covered"><select className="select" style={{ width: "100%" }} value={period} onChange={(e) => setPeriod(e.target.value)}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></Field>
      </div>
    </Sheet>
  );
}
