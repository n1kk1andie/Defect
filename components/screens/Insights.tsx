"use client";
// Insights: interpretation, not a data dump. Where to focus (the watchlist),
// what was found but not fixed (the resolution gap), what keeps coming back
// (recurring issues detected month on month, and systemic recurring by process
// area), and whether the scorecard and the defects tell the same story.
import { useMemo, useState } from "react";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Msg, PageHead, Sheet } from "@/components/ui";
import { YearSelect } from "@/components/screens/Filters";
import { RaiseAction } from "@/components/screens/RaiseAction";
import { byUnit, monthLabel, num, pct, pearson, recurringIssues, resolutionGap, scMean, scRows, score, systemicRecurring, watchlist, type RecurringIssue } from "@/lib/metrics";
import { can } from "@/lib/roles";
import { Icon } from "@/components/icons";

export function Insights() {
  const app = useApp();
  const { data, settings, filters, band, actor } = app;
  const f = { year: filters.year, unit: -1, area: -1 };
  const watch = useMemo(() => watchlist(data, f), [data, filters.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const gap = useMemo(() => resolutionGap(data, f), [data, filters.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const systemic = useMemo(() => systemicRecurring(data, f), [data, filters.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const issues = useMemo(() => recurringIssues(data, settings.recurringMonths), [data, settings.recurringMonths]);
  const [prevent, setPrevent] = useState<RecurringIssue | null>(null);
  const [risk, setRisk] = useState<RecurringIssue | null>(null);
  const corr = useMemo(() => {
    const sc = data.scorecard;
    if (!sc) return null;
    const pairs = byUnit(data, f).map((u) => ({ name: u.name, dr: u.rec.defectRate, op: scMean(scRows(sc, { ...f, unit: u.index }), 0) })).filter((x): x is { name: string; dr: number; op: number } => x.dr != null && x.op != null);
    return { r: pearson(pairs.map((p) => [p.op, p.dr])), pairs };
  }, [data, filters.year]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = watch[0];
  return (
    <>
      <PageHead eyebrow={`Insights · ${filters.year === "all" ? "all years" : filters.year}`} title="What you don't see" accent="becomes your risk." lede={top ? `${top.name} leads the watchlist: ${top.why.join(", ")}. ${issues.length} recurring issue${issues.length === 1 ? "" : "s"} detected.` : "Insights appear once reviews are published."} right={<YearSelect />} />
      {!watch.length ? <Card><Empty icon="insights" title="Nothing to interpret yet" /></Card> : (
        <div className="stack">
          <div className="grid g-2-1">
            <Card title={`${settings.unitLabel} watchlist: where to focus`} sub="Ranked by combined defect rate (60%), unresolved share (25%) and recurring (15%), each against the worst branch.">
              <ol className="list" aria-label="Watchlist">
                {watch.map((w, i) => (
                  <li key={w.index}>
                    <span className={`rank ${i === 0 ? "first" : ""}`} aria-hidden="true">{i + 1}</span>
                    <span className="grow"><strong style={{ display: "block" }}>{w.name}</strong><span className="sub">{w.why.join(" · ")}</span></span>
                    <BandPill band={band("defectRate", w.rec.defectRate)} label>{pct(w.rec.defectRate)}</BandPill>
                  </li>
                ))}
              </ol>
            </Card>
            <Card title="Resolution gap: found vs fixed" sub={`${settings.unitPlural} with 10 or more defects, lowest resolution first`}>
              {gap.length && (gap[0].rec.resolutionRate ?? 1) < 0.95 ? (
                <div className="tablewrap"><table className="t">
                  <thead><tr><th scope="col">{settings.unitLabel}</th><th scope="col" className="num">Defects</th><th scope="col" className="num">Open</th><th scope="col" className="num">Resolved</th></tr></thead>
                  <tbody>{gap.map((g, i) => (
                    <tr key={g.index} className={i === 0 && (g.rec.resolutionRate ?? 1) < 0.7 ? "hl" : undefined}><td><strong>{g.name}</strong></td><td className="num">{num(g.rec.defects)}</td><td className="num">{num(g.rec.unresolved)}</td><td className="num"><span className="tone" data-band={band("resolutionRate", g.rec.resolutionRate)} style={{ fontWeight: 800 }}>{pct(g.rec.resolutionRate)}</span></td></tr>
                  ))}</tbody>
                </table></div>
              ) : <p className="sub">Resolution is healthy across {settings.unitPlural.toLowerCase()} in this scope.</p>}
            </Card>
          </div>
          <Card title="Recurring issues detected" sub={`The same defect at the same ${settings.unitLabel.toLowerCase()} for ${settings.recurringMonths} or more months running, from published reviews. Each is a candidate for a preventive action, or for Pulsus Risk.`}>
            {issues.length ? (
              <ul className="list">
                {issues.slice(0, 8).map((x) => (
                  <li key={`${x.unit}|${x.area}|${x.nature}`} style={{ flexWrap: "wrap" }}>
                    <span className="badge sm" aria-hidden="true"><Icon name="repeat" /></span>
                    <span className="grow" style={{ minWidth: 220 }}><strong style={{ display: "block" }}>{x.nature}</strong><span className="sub">{x.unitName} · {x.areaName} · {x.streak} months running to {monthLabel(x.lastPeriod)} · {num(x.defects)} defects</span></span>
                    <BandPill band={x.streak >= settings.recurringMonths + 2 ? "escalate" : "attention"}>{x.category}</BandPill>
                    {can.raiseActions(actor) && <button className="btn sm" onClick={() => setPrevent(x)}>Preventive action</button>}
                    {can.sendToRisk(actor) && <button className="btn sm ghost" onClick={() => setRisk(x)}><Icon name="send" />Send to Risk</button>}
                  </li>
                ))}
              </ul>
            ) : <p className="sub">No defect has recurred at the same {settings.unitLabel.toLowerCase()} for {settings.recurringMonths} months running. Item-level reviews feed this; imported history counts recurring defects only in total.</p>}
          </Card>
          <div className="grid g2">
            <Card title="Systemic recurring: repeat defects" sub="Process areas with 20 or more defects, most recurring first">
              {systemic.length ? <ul className="list">{systemic.map((s) => (
                <li key={s.index}><span className="grow"><strong style={{ display: "block" }}>{s.name}</strong><span className="sub">{num(s.rec.defects)} defects · most at {s.topUnit}</span></span><BandPill band={band("recurringRate", s.rec.recurringRate)} label>{pct(s.rec.recurringRate)} recur</BandPill></li>
              ))}</ul> : <p className="sub">Not enough defects in this scope.</p>}
            </Card>
            {corr && (
              <Card title={`${data.scorecard!.name} vs defects`} sub="Does one predict the other?">
                {corr.r == null ? <p className="sub">Not enough overlapping data to compare in this scope.</p> : (
                  <>
                    <p style={{ marginTop: 0 }}>{Math.abs(corr.r) < 0.3 ? <>There&apos;s <strong>little to no</strong> relationship between {data.scorecard!.name} scores and defect rates (r = {corr.r.toFixed(2)}): they move largely independently.</> : <>There&apos;s <strong>{Math.abs(corr.r) < 0.6 ? "a moderate" : "a strong"}</strong> relationship (r = {corr.r.toFixed(2)}): {corr.r < 0 ? "lower scores tend to come with higher defect rates" : "higher scores oddly come with higher defect rates, worth a look"}.</>}</p>
                    <div className="grid g2" style={{ gap: 8 }}>
                      {(() => { const lo = corr.pairs.slice().sort((a, b) => a.op - b.op)[0], hi = corr.pairs.slice().sort((a, b) => b.dr - a.dr)[0]; return (<>
                        <div className="minitile" style={{ display: "block" }}><div className="eyebrow">Lowest score</div><strong>{lo.name}</strong><div className="sub">{score(lo.op)} · {pct(lo.dr)} defects</div></div>
                        <div className="minitile" style={{ display: "block" }}><div className="eyebrow">Highest defect rate</div><strong>{hi.name}</strong><div className="sub">{pct(hi.dr)} · score {score(hi.op)}</div></div>
                      </>); })()}
                    </div>
                  </>
                )}
              </Card>
            )}
          </div>
        </div>
      )}
      {prevent && <RaiseAction onClose={() => setPrevent(null)} preset={{ kind: "preventive", unitId: data.units[prevent.unit]?.id, areaId: data.areas[prevent.area]?.id, title: `Stop “${prevent.nature}” recurring`, rootCause: `Recurring: ${prevent.nature} at ${prevent.unitName} (${prevent.areaName}) for ${prevent.streak} months running, ${prevent.defects} defects.`, priority: "high", sourceType: "recurring", sourceId: `${data.units[prevent.unit]?.id}|${data.areas[prevent.area]?.id}|${prevent.nature}` }} />}
      {risk && <SendToRisk issue={risk} onClose={() => setRisk(null)} />}
    </>
  );
}

function SendToRisk({ issue, onClose }: { issue: RecurringIssue; onClose: () => void }) {
  const { data, refresh } = useApp();
  const [severity, setSeverity] = useState(issue.streak >= 5 ? "high" : "medium");
  const [note, setNote] = useState(`${issue.nature} has recurred at ${issue.unitName} (${issue.areaName}) for ${issue.streak} consecutive months, ${issue.defects} defects in published reviews.`);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const send = async () => {
    setBusy(true); setRes(null);
    try {
      const j = await api<{ status: string }>("/api/risk", "POST", {
        recordType: "recurring_issue", recordRef: `${data.units[issue.unit]?.id}|${data.areas[issue.area]?.id}|${issue.nature}`, title: `Recurring: ${issue.nature} at ${issue.unitName}`, description: note, severity,
        unitName: issue.unitName, area: issue.areaName, detectedAt: issue.lastPeriod + "T00:00:00Z", recurrence: { months: issue.streak, first_period: issue.months[issue.months.length - issue.streak]?.slice(0, 7), last_period: issue.lastPeriod.slice(0, 7), defects: issue.defects }, path: "/insights",
      });
      setRes({ kind: "ok", text: j.status === "sent" ? "Sent to Pulsus Risk's review queue. A Risk Officer accepts or rejects it there." : "Recorded for Pulsus Risk. Its intake isn't connected yet, so the proposal waits in Settings → Integrations." });
      refresh();
    } catch (e) { setRes({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <Sheet title="Send to Pulsus Risk" sub="As a proposed issue: nothing enters Risk until a Risk Officer accepts it." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button>{res?.kind !== "ok" && <button className="btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Propose to Risk"}</button>}</>}>
      <label className="field"><span>Severity</span><select className="select" value={severity} onChange={(e) => setSeverity(e.target.value)}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
      <label className="field"><span>Description</span><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <Msg kind={res?.kind}>{res?.text}</Msg>
    </Sheet>
  );
}
