"use client";
// Report: the executive report. A board-ready view of the scope: what was
// found, fixed and repeated, the trend, where defects come from, each branch's
// resolution and risk, the audit grade, PMAS to date, and the actions that
// need leadership attention. Prints to PDF; the figures export to Excel.
import { useMemo } from "react";
import { useApp } from "@/components/app-context";
import { BandPill, Card, Empty, fmtDate, PageHead } from "@/components/ui";
import { HBars, LineTrend } from "@/components/charts";
import { YearSelect } from "@/components/screens/Filters";
import { StatusPill } from "@/components/screens/Actions";
import { auditGrade, gradeBand, AUDIT_POINTS, opStdRating, ratingBand } from "@/lib/bands";
import { byCategory, byUnit, filterRows, monthLabel, monthShort, num, pct, pmasToDate, record, scLastActive, score, topRecurring, trend, watchlist } from "@/lib/metrics";
import type { ActionView } from "@/lib/actionRules";
import { Icon } from "@/components/icons";

export function Report({ actions }: { actions: ActionView[] }) {
  const app = useApp();
  const { data, settings, filters, band, actor } = app;
  const f = { year: filters.year, unit: filters.unit, area: -1 };
  const rec = useMemo(() => record(filterRows(data, f)), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = useMemo(() => trend(data, f), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = useMemo(() => byUnit(data, { ...f, unit: -1 }), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = useMemo(() => byCategory(data, f), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const rec5 = useMemo(() => topRecurring(data, f), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const risk = useMemo(() => watchlist(data, { ...f, unit: -1 }, units.length), [data, filters, units.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const sc = data.scorecard;
  const scLast = sc ? scLastActive(sc) : -1;
  const latestGrades = sc && scLast >= 0 ? sc.rows.map((r, i) => (r[0] === scLast && (filters.unit < 0 || r[1] === filters.unit) ? auditGrade(sc.auditRaw[i]) : null)).filter((g): g is string => !!g) : [];
  const meanPoints = latestGrades.length ? latestGrades.reduce((s, g) => s + (AUDIT_POINTS[g] ?? 0), 0) / latestGrades.length : null;
  const grade = meanPoints == null ? null : auditGrade(meanPoints >= 90 ? 100 : meanPoints >= 70 ? 80 : meanPoints >= 50 ? 60 : meanPoints >= 30 ? 40 : meanPoints >= 10 ? 20 : 6);
  const execActions = actions.filter((a) => a.status !== "closed" && (a.priority === "high" || a.overdue) && (filters.unit < 0 || a.unitId === data.units[filters.unit]?.id)).slice(0, 8);
  const scope = `${filters.unit >= 0 ? data.units[filters.unit]?.name : `All ${settings.unitPlural.toLowerCase()}`} · ${filters.year === "all" ? "all years" : filters.year}`;
  const lastIso = months.length ? months[months.length - 1].iso : null;
  if (!rec.instances) return <><PageHead eyebrow="Executive report" title="From operational evidence" accent="to executive insight." right={<YearSelect />} /><Card><Empty icon="report" title="Nothing published in this scope" /></Card></>;
  return (
    <>
      <PageHead eyebrow={`Executive report · ${scope}`} title="From operational evidence" accent="to executive insight."
        lede={`${num(rec.defects)} defects were found across ${num(rec.instances)} reviewed instances, a defect rate of ${pct(rec.defectRate)}. ${pct(rec.resolutionRate)} of resolvable defects have been resolved and ${pct(rec.recurringRate)} are recurring.${risk[0] ? ` ${risk[0].name} needs the most attention.` : ""}`}
        right={<><YearSelect /><select className="select no-print" aria-label={settings.unitLabel} value={filters.unit} onChange={(e) => app.setFilters({ unit: Number(e.target.value) })}><option value={-1}>All {settings.unitPlural.toLowerCase()}</option>{data.units.map((u, i) => <option key={u.id} value={i}>{u.name}</option>)}</select>
          <button className="btn no-print" onClick={() => window.print()}><Icon name="print" />Print or save as PDF</button>
          <a className="btn no-print" href={`/api/export?what=register&format=xlsx&year=${filters.year}&unit=${filters.unit}`}><Icon name="download" />Excel</a></>} />
      <div className="stack">
        <div className="grid g4">
          <div className="stat"><div className="stat-v tone" data-band={band("resolutionRate", rec.resolutionRate)} style={{ fontSize: 32 }}>{pct(rec.resolutionRate)}</div><div className="stat-l">Defects resolved</div></div>
          <div className="stat"><div className="stat-v tone" data-band={band("defectRate", rec.defectRate)} style={{ fontSize: 32 }}>{pct(rec.defectRate)}</div><div className="stat-l">Defect rate</div></div>
          <div className="stat"><div className="stat-v tone" data-band={band("recurringRate", rec.recurringRate)} style={{ fontSize: 32 }}>{pct(rec.recurringRate)}</div><div className="stat-l">Recurring</div></div>
          <div className="stat"><div className="stat-row"><span className="badge" data-band={gradeBand(grade) ?? "none"} style={{ background: "var(--bp)", color: "var(--bt)", fontFamily: "Sora", fontWeight: 800, fontSize: 18 }}>{grade ?? "—"}</span><div><div className="stat-v" style={{ fontSize: 18 }}>Audit grade</div><div className="stat-l">{scLast >= 0 && sc ? `Last audit ${monthLabel(sc.periods[scLast])}` : "No audits recorded"}</div></div></div></div>
        </div>
        <div className="grid g-2-1">
          <Card title="Defect trend" sub="New defects and those resolved, by month">
            <LineTrend labels={months.map((m) => monthShort(m.iso))} series={[{ name: "New defects", colour: "#E4012B", values: months.map((m) => m.rec.defects) }, { name: "Resolved", colour: "#16A34A", values: months.map((m) => m.rec.resolved) }]} summary={`Defects found and resolved per month, ${months.length} months to ${lastIso ? monthLabel(lastIso) : ""}.`} />
          </Card>
          <Card title="Defects by category" sub={cats.length ? "Natures recorded on published reviews" : undefined}>
            {cats.length ? <HBars rows={cats.map((c, i) => ({ label: c.category, value: c.share, band: (["escalate", "attention", "watch", "healthy", "strong", "worldClass"] as const)[Math.min(5, i)] }))} format={(v) => pct(v, 0)} /> : <p className="sub">Categories come from item-level reviews.</p>}
          </Card>
        </div>
        <div className="grid g3">
          <Card title="Resolution rate by branch">
            <HBars rows={units.sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ label: u.name, value: u.rec.resolutionRate ?? 0, band: band("resolutionRate", u.rec.resolutionRate) }))} format={(v) => pct(v)} />
          </Card>
          <Card title="Top recurring issues">
            {rec5.length ? <table className="t"><thead><tr><th scope="col">Issue</th><th scope="col" className="num">Count</th></tr></thead><tbody>{rec5.map((r) => <tr key={r.nature}><td>{r.nature}<div className="sub">most at {r.topUnit}</div></td><td className="num"><strong>{num(r.recurring)}</strong></td></tr>)}</tbody></table> : <p className="sub">No recurring defects recorded at item level in this scope.</p>}
          </Card>
          <Card title="Branch risk" sub="From the watchlist score">
            <ul className="list">{risk.map((r) => { const lvl = r.risk >= 60 ? "High" : r.risk >= 35 ? "Medium" : "Low"; const b = lvl === "High" ? "escalate" : lvl === "Medium" ? "attention" : "worldClass"; return (
              <li key={r.index} data-band={b}><span style={{ width: 96, fontWeight: 600 }}>{r.name}</span><span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(4, Math.min(100, r.risk))}%` }} /></span><BandPill band={b}>{lvl}</BandPill></li>); })}</ul>
          </Card>
        </div>
        {sc && scLast >= 0 && (
          <Card title={`PMAS to date · ${monthLabel(sc.periods[scLast])}`} sub={`The running average of each ${settings.unitLabel.toLowerCase()}'s monthly ${sc.name} score: the year-to-date sum divided by 6 (to June) or 12 (after).`}>
            <div className="tablewrap"><table className="t stack">
              <thead><tr><th scope="col">{settings.unitLabel}</th><th scope="col" className="num">PMAS</th><th scope="col">Rating</th><th scope="col">Basis</th></tr></thead>
              <tbody>{Array.from(new Set(sc.rows.map((r) => r[1] as number))).filter((u) => filters.unit < 0 || u === filters.unit).map((u) => { const p = pmasToDate(sc, u, sc.periods[scLast]); const rt = opStdRating(p.value); return (
                <tr key={u}><td data-label={settings.unitLabel}><strong>{data.units[u]?.name}</strong></td><td data-label="PMAS" className="num">{score(p.value)}</td><td data-label="Rating">{rt != null ? <BandPill band={ratingBand(rt) ?? "none"}>Rating {rt}</BandPill> : "—"}</td><td data-label="Basis" className="sub">{p.basis} · {p.months} of {p.divisor} months</td></tr>); })}</tbody>
            </table></div>
          </Card>
        )}
        <Card flush title="Executive actions" sub="High priority or overdue, still open">
          {execActions.length ? <div className="tablewrap"><table className="t stack">
            <thead><tr><th scope="col">ID</th><th scope="col">{settings.unitLabel}</th><th scope="col">Issue</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Due</th></tr></thead>
            <tbody>{execActions.map((a) => <tr key={a.id}><td data-label="ID"><a href={`/actions?open=${a.id}`} style={{ fontWeight: 800, color: "var(--ink)" }}>{a.ref}</a></td><td data-label={settings.unitLabel}>{a.unitName}</td><td data-label="Issue">{a.title}</td><td data-label="Priority"><BandPill band={a.priority === "high" ? "escalate" : a.priority === "medium" ? "watch" : "healthy"}>{a.priority}</BandPill></td><td data-label="Status"><StatusPill a={a} /></td><td data-label="Due">{fmtDate(a.dueDate)}</td></tr>)}</tbody>
          </table></div> : <Empty icon="check" title="No high-priority or overdue actions" />}
        </Card>
        <p className="sub">Prepared for {actor.tenantName} by Pulsus Quality on {fmtDate(new Date().toISOString())}. Figures are from published reviews and imported history; colour bands follow Settings → Colour bands and targets.</p>
      </div>
    </>
  );
}
