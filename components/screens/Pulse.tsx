"use client";
// Pulse: where quality stands, for the scope chosen. Branch Defects shows the
// defect rate, what was found, resolved and recurring, the monthly trend and
// every branch and process area; the scorecard view shows the Operational
// Standard score against its target, each measure, the heat-map and audit grades.
import Link from "next/link";
import { useMemo } from "react";
import { useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Legend, PageHead, Stat } from "@/components/ui";
import { BarTrend, Heatmap } from "@/components/charts";
import { FilterBar, ModeToggle, scopeText, YearSelect } from "@/components/screens/Filters";
import { bandInfo, auditGrade, gradeBand, AUDIT_GRADES, opStdRating, ratingBand } from "@/lib/bands";
import { byArea, byUnit, filterRows, monthShort, num, pct, record, scMean, scMonths, scRows, score, trend } from "@/lib/metrics";

export function Pulse() {
  const app = useApp();
  return app.filters.mode === "standard" && app.data.scorecard ? <StandardPulse /> : <DefectsPulse />;
}

function DefectsPulse() {
  const app = useApp();
  const { data, settings, filters, band, counts } = app;
  const f = { year: filters.year, unit: filters.unit, area: filters.area };
  const rec = useMemo(() => record(filterRows(data, f)), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = useMemo(() => trend(data, f), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = useMemo(() => byUnit(data, { ...f, unit: -1 }).sort((a, b) => (b.rec.defectRate ?? 0) - (a.rec.defectRate ?? 0)), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const areas = useMemo(() => byArea(data, { ...f, area: -1 }).sort((a, b) => (b.rec.defectRate ?? 0) - (a.rec.defectRate ?? 0)), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = band("defectRate", rec.defectRate);
  const item = settings.itemLabel.toLowerCase();
  const nothing = rec.instances === 0;

  return (
    <>
      <PageHead
        eyebrow={`Pulse · ${scopeText(app)}`}
        title={nothing ? "Know where quality stands." : filters.unit >= 0 ? `${data.units[filters.unit]?.name}, at a glance.` : `Quality across ${data.units.length} ${settings.unitPlural.toLowerCase()}.`}
        accent={nothing ? "Every day." : `${pct(rec.defectRate)} defect rate.`}
        lede={nothing ? "Once reviews are published, the defect rate, resolution and recurring defects show here." : `${num(rec.defects)} defects across ${num(rec.instances)} possible instances${b !== "none" ? ` — ${bandInfo(b).label.toLowerCase()}` : ""}. ${num(rec.unresolved)} still open.`}
        right={<YearSelect />}
      />
      <ModeToggle />
      <FilterBar />
      {nothing ? (
        <Card><Empty icon="pulse" title="Nothing published in this scope yet">Choose another year or {settings.unitLabel.toLowerCase()}, or key a review on the Review tab. Admins can import the previous version's data or a workbook under Settings → Data and uploads.</Empty></Card>
      ) : (
        <div className="stack">
          <section className="hero" aria-label="Defect rate">
            <div className="hero-scope">{scopeText(app)}</div>
            <div className="eyebrow">Defect rate</div>
            <div className="hero-big">{pct(rec.defectRate)}</div>
            <div className="hero-sub">{num(rec.defects)} defects across {num(rec.instances)} possible instances{b !== "none" && <> · <strong>{bandInfo(b).label}</strong></>}</div>
          </section>
          <div className="grid g4">
            <Stat icon="review" value={num(rec.reviewed)} label={`${settings.itemLabel}s reviewed`} />
            <Stat icon="alert" value={num(rec.defects)} label="Defects found" band="escalate" />
            <Stat icon="check" value={pct(rec.resolutionRate)} label="Defects resolved" band={band("resolutionRate", rec.resolutionRate)} />
            <Stat icon="repeat" value={pct(rec.recurringRate)} label="Recurring" band={band("recurringRate", rec.recurringRate)} />
          </div>
          <Card title="Defect rate trend" sub={`Each month in scope, coloured by band`} actions={<Legend family="defectRate" overrides={settings.bands} />}>
            <BarTrend
              data={months.map((m) => ({ label: monthShort(m.iso), value: m.rec.defectRate, band: band("defectRate", m.rec.defectRate), title: `${monthShort(m.iso)}: ${pct(m.rec.defectRate)} (${num(m.rec.defects)} of ${num(m.rec.instances)})` }))}
              format={(v) => `${(v * 100).toFixed(0)}%`}
              summary={`Defect rate by month, ${months.length} months. Latest ${months.length ? `${monthShort(months[months.length - 1].iso)}: ${pct(months[months.length - 1].rec.defectRate)}` : "none"}.`}
            />
          </Card>
          <div className="grid g-2-1">
            <Card title={`${settings.unitPlural} by defect rate`} sub="Worst first. Tap one to focus the dashboards on it.">
              <div className="grid g2" style={{ gap: 8 }}>
                {units.map((u) => (
                  <button key={u.index} type="button" className="minitile" style={{ cursor: "pointer", textAlign: "left" }} aria-pressed={filters.unit === u.index} onClick={() => app.setFilters({ unit: filters.unit === u.index ? -1 : u.index })}>
                    <span className="grow"><strong style={{ display: "block" }}>{u.name}</strong><span className="sub">{num(u.rec.defects)} of {num(u.rec.instances)}</span></span>
                    <BandPill band={band("defectRate", u.rec.defectRate)} label>{pct(u.rec.defectRate)}</BandPill>
                  </button>
                ))}
              </div>
            </Card>
            <Card title="By process area" sub="Defects ÷ possible instances">
              <ul className="list">
                {areas.map((a) => (
                  <li key={a.index}>
                    <span className="grow"><strong style={{ display: "block", fontSize: 14 }}>{a.name}</strong><span className="sub">{num(a.rec.defects)} / {num(a.rec.instances)} instances</span></span>
                    <BandPill band={band("defectRate", a.rec.defectRate)} label>{pct(a.rec.defectRate)}</BandPill>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
          <div className="grid g3">
            <Stat icon="actions" value={num(counts.openActions)} label="Open actions" href="/actions" />
            <Stat icon="clock" value={num(counts.overdue)} label="Overdue actions" band={counts.overdue ? "escalate" : "worldClass"} href="/actions" />
            <Stat icon="stamp" value={num(counts.awaitingApproval + counts.awaitingVerification)} label="Waiting for your sign-off" href={counts.awaitingApproval ? "/review" : "/actions"} />
          </div>
        </div>
      )}
    </>
  );
}

function StandardPulse() {
  const app = useApp();
  const { data, settings, filters, band } = app;
  const sc = data.scorecard!;
  const f = { year: filters.year, unit: filters.unit, area: -1 };
  const rows = scRows(sc, f);
  const overall = scMean(rows, 0);
  const months = scMonths(sc, filters.year);
  const r = opStdRating(overall);
  const unitsInCard = Array.from(new Set(sc.rows.map((x) => x[1] as number))).filter((u) => filters.unit < 0 || u === filters.unit);
  const heatRows = unitsInCard.map((ui) => ({
    name: data.units[ui]?.name || "—",
    cells: months.map((p) => { const v = scMean(scRows(sc, { ...f, unit: ui, period: p }), 0); return { band: band("opStandard", v), text: v == null ? "not tracked" : score(v) }; }),
    total: score(scMean(scRows(sc, { ...f, unit: ui }), 0)),
  })).sort((a, b) => Number(a.total) - Number(b.total));
  const lastP = months[months.length - 1];
  const grades = lastP == null ? [] : unitsInCard.map((ui) => {
    const idx = sc.rows.findIndex((x) => x[0] === lastP && x[1] === ui);
    return { name: data.units[ui]?.name || "—", grade: idx >= 0 ? auditGrade(sc.auditRaw[idx]) : null };
  });
  const gradeCounts = months.map((p) => {
    const c: Record<string, number> = {};
    sc.rows.forEach((x, i) => { if (x[0] === p && (filters.unit < 0 || x[1] === filters.unit)) { const g = auditGrade(sc.auditRaw[i]); if (g) c[g] = (c[g] || 0) + 1; } });
    return { p, c };
  });
  const gb = band("opStandard", overall);
  return (
    <>
      <PageHead eyebrow={`Pulse · ${sc.name} · ${scopeText(app)}`} title="Every process. Every measure." accent={overall == null ? "One view." : `${score(overall)} out of 100.`}
        lede={overall == null ? "No scorecard figures in this scope." : `The ${sc.name} score averages every tracked ${settings.unitLabel.toLowerCase()}-month in scope${gb !== "none" ? ` — ${bandInfo(gb).label.toLowerCase()}` : ""}. Target ${sc.target}.`} right={<YearSelect />} />
      <ModeToggle />
      <FilterBar areas={false} />
      {overall == null ? <Card><Empty icon="target" title="No scorecard figures here">Choose another year, or import the Operational Standards workbook under Settings → Data and uploads.</Empty></Card> : (
        <div className="stack">
          <div className="grid g-2-1">
            <section className="card" aria-label={`${sc.name} score`}>
              <div className="eyebrow">{sc.name} score</div>
              <div className="row" style={{ alignItems: "baseline", gap: 6, marginTop: 6 }}>
                <span className="stat-v" style={{ fontSize: 54 }}>{score(overall)}</span><span className="sub" style={{ fontSize: 16 }}>/100</span>
                <span className="grow" />
                {r != null && <BandPill band={ratingBand(r) ?? "none"} lg>Rating {r}</BandPill>}
              </div>
              <div className="gauge" role="img" aria-label={`${score(overall)} against a target of ${sc.target}`}>
                <i style={{ left: `${Math.min(100, Math.max(0, overall))}%` }} />
                <b style={{ left: `${sc.target}%` }}>Target {sc.target}</b>
              </div>
              <div className="row between sub" style={{ marginTop: 6 }}><span>Lower performance</span><span>Higher performance</span></div>
            </section>
            <div className="grid g2" style={{ gap: 10 }}>
              {sc.measures.slice(1, 5).map((m, i) => { const v = scMean(rows, i + 1); return <Stat key={m.key} value={score(v)} label={m.label} band={band("opStandard", v)} />; })}
            </div>
          </div>
          <div className="grid g4">
            {sc.measures.slice(5).map((m, i) => { const v = scMean(rows, i + 5); return <Stat key={m.key} value={score(v)} label={m.label} band={band("opStandard", v)} />; })}
          </div>
          <Card title={`${sc.name} score by ${settings.unitLabel.toLowerCase()}`} sub="Lowest first" actions={<Legend family="opStandard" overrides={settings.bands} />}>
            <Heatmap periods={months.map((p) => sc.periods[p])} rows={heatRows} caption={`${sc.name} score by ${settings.unitLabel.toLowerCase()} and month`} />
          </Card>
          <div className="grid g2">
            <Card title="Audit grades" sub={lastP != null ? `Latest audit, ${sc.periods[lastP].slice(0, 7)}` : undefined}>
              <ul className="list">
                {grades.map((g) => <li key={g.name}><span className="grow"><strong>{g.name}</strong></span>{g.grade ? <BandPill band={gradeBand(g.grade) ?? "none"}>{g.grade}</BandPill> : <span className="sub">Not graded</span>}</li>)}
              </ul>
            </Card>
            <Card title="Audit grades over time" sub="How many units earned each grade, month by month">
              <div className="legend" style={{ marginBottom: 8 }}>{AUDIT_GRADES.map((g) => <span key={g.grade} data-band={g.band}><i className="swatch" aria-hidden="true" />{g.grade}</span>)}</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 140 }} role="img" aria-label="Audit grade counts by month">
                {gradeCounts.map(({ p, c }) => {
                  const total = Object.values(c).reduce((s, x) => s + x, 0) || 1;
                  return (
                    <div key={p} title={`${sc.periods[p].slice(0, 7)}: ${Object.entries(c).map(([g, n]) => `${g} ${n}`).join(", ")}`} style={{ flex: 1, minWidth: 4, height: "100%", display: "flex", flexDirection: "column-reverse", borderRadius: 3, overflow: "hidden" }}>
                      {AUDIT_GRADES.map((g) => c[g.grade] ? <div key={g.grade} data-band={g.band} style={{ height: `${(c[g.grade] / total) * 100}%`, background: "var(--bc)" }} /> : null)}
                    </div>
                  );
                })}
              </div>
              <div className="row between sub" style={{ marginTop: 6 }}><span>{months.length ? sc.periods[months[0]].slice(0, 7) : ""}</span><span>{lastP != null ? sc.periods[lastP].slice(0, 7) : ""}</span></div>
            </Card>
          </div>
          <p className="sub">Audit grades keep their own scale (1–5 in 2024, letters from 2025) and borrow the band colours. <Link href="/report">See the report</Link> for PMAS to date.</p>
        </div>
      )}
    </>
  );
}
