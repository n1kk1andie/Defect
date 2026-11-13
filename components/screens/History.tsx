"use client";
// History: each branch month by month, as a heat-map of the defect, resolution
// or recurring rate (or a scorecard measure), plus the branch × process-area
// view. Tap a cell for the counts behind it.
import { useMemo, useState } from "react";
import { useApp } from "@/components/app-context";
import { Card, Empty, Legend, PageHead, Seg, Sheet, Stat } from "@/components/ui";
import { Heatmap } from "@/components/charts";
import { FilterBar, ModeToggle, scopeText, YearSelect } from "@/components/screens/Filters";
import { areaGrid, filterRows, heatGrid, monthLabel, num, pct, record, scMean, scMonths, scRows, score, type MetricKey } from "@/lib/metrics";
import { Icon } from "@/components/icons";

const METRIC_LABEL: Record<MetricKey, string> = { defectRate: "Defect rate", resolutionRate: "Resolution rate", recurringRate: "Recurring rate" };

export function History() {
  const app = useApp();
  return (
    <>
      <PageHead eyebrow={`History · ${scopeText(app)}`} title="Finding the issue" accent="is only the beginning." lede="Every branch, month by month: where defects appeared, how fast they were fixed and what keeps coming back." right={<YearSelect />} />
      <ModeToggle />
      <FilterBar />
      {app.filters.mode === "standard" && app.data.scorecard ? <StandardHistory /> : <DefectHistory />}
    </>
  );
}

function DefectHistory() {
  const { data, settings, filters, band } = useApp();
  const [metric, setMetric] = useState<MetricKey>("defectRate");
  const [cell, setCell] = useState<{ unit: number; period: number } | null>(null);
  const f = { year: filters.year, unit: filters.unit, area: filters.area };
  const grid = useMemo(() => heatGrid(data, f, metric), [data, filters, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = filters.unit >= 0 ? grid.units.filter((u) => u.index === filters.unit) : grid.units;
  const rec = useMemo(() => record(filterRows(data, f)), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const areas = useMemo(() => areaGrid(data, { ...f, area: -1 }, metric), [data, filters, metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const detail = cell ? record(filterRows(data, { ...f, unit: cell.unit, period: cell.period })) : null;
  const q = `year=${filters.year}&unit=${filters.unit}&area=${filters.area}&metric=${metric}`;
  return (
    <div className="stack">
      <div style={{ maxWidth: 560 }}><Seg label="Measure" value={metric} onChange={setMetric} options={[{ value: "defectRate", label: "Defect rate" }, { value: "resolutionRate", label: "Resolution rate" }, { value: "recurringRate", label: "Recurring rate" }]} /></div>
      <Card title={`${METRIC_LABEL[metric]} history by ${settings.unitLabel.toLowerCase()}`} sub="Tap a month for the counts behind it"
        actions={<div className="row wrap"><a className="btn sm" href={`/api/export?what=history&format=xlsx&${q}`}><Icon name="download" />Excel</a><a className="btn sm" href={`/api/export?what=history&format=csv&${q}`}><Icon name="download" />CSV</a></div>}>
        {shown.length ? (
          <>
            <Heatmap periods={grid.months.map((p) => data.periods[p])} caption={`${METRIC_LABEL[metric]} by ${settings.unitLabel.toLowerCase()} and month`}
              rows={shown.map((u) => ({ name: u.name, cells: u.cells.map((v) => ({ band: band(metric, v), text: v == null ? "not reviewed" : pct(v) })), total: pct(u.total) }))}
              onPick={(ri, ci) => setCell({ unit: shown[ri].index, period: grid.months[ci] })} />
            <div className="mt"><Legend family={metric} overrides={settings.bands} /></div>
          </>
        ) : <Empty title="Nothing reviewed in this scope" />}
      </Card>
      <div className="grid g3">
        <Stat icon="check" value={pct(rec.resolutionRate)} label="Defects resolved" band={band("resolutionRate", rec.resolutionRate)} />
        <Stat icon="pulse" value={pct(rec.defectRate)} label="Defect rate" band={band("defectRate", rec.defectRate)} />
        <Stat icon="repeat" value={pct(rec.recurringRate)} label="Recurring" band={band("recurringRate", rec.recurringRate)} />
      </div>
      {data.areas.length > 1 && (
        <Card title={`${METRIC_LABEL[metric]} by ${settings.unitLabel.toLowerCase()} and process area`} sub={filters.year === "all" ? "All years" : filters.year}>
          <div className="tablewrap">
            <table className="heat wide">
              <caption className="sr">{METRIC_LABEL[metric]} by {settings.unitLabel.toLowerCase()} and process area</caption>
              <thead><tr><th />{data.areas.map((a) => <th key={a.id} scope="col" style={{ whiteSpace: "normal", maxWidth: 120, fontSize: 11.5 }}>{a.name}</th>)}</tr></thead>
              <tbody>
                {areas.units.filter((u) => filters.unit < 0 || u.index === filters.unit).map((u) => (
                  <tr key={u.index}><th scope="row">{u.name}</th>
                    {u.cells.map((c, i) => <td key={i} data-band={band(metric, c.rate)} title={`${num(c.rec.defects)} defects / ${num(c.rec.instances)} instances, ${num(c.rec.recurring)} recurring`}>{pct(c.rate)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {cell && detail && (
        <Sheet title={`${data.units[cell.unit]?.name} · ${monthLabel(data.periods[cell.period])}`} sub={filters.area >= 0 ? data.areas[filters.area]?.name : "All process areas"} onClose={() => setCell(null)}>
          <div className="grid g2">
            <Stat value={pct(detail.defectRate)} label="Defect rate" band={band("defectRate", detail.defectRate)} />
            <Stat value={pct(detail.resolutionRate)} label="Resolution rate" band={band("resolutionRate", detail.resolutionRate)} />
            <Stat value={pct(detail.recurringRate)} label="Recurring rate" band={band("recurringRate", detail.recurringRate)} />
            <Stat value={num(detail.reviewed)} label={`${settings.itemLabel}s reviewed`} />
          </div>
          <dl className="kv mt2">
            <dt>Possible instances</dt><dd>{num(detail.instances)}</dd>
            <dt>Defects</dt><dd>{num(detail.defects)}</dd>
            <dt>Resolved</dt><dd>{num(detail.resolved)} of {num(detail.resolvable)}</dd>
            <dt>Recurring</dt><dd>{num(detail.recurring)}</dd>
          </dl>
        </Sheet>
      )}
    </div>
  );
}

function StandardHistory() {
  const { data, settings, filters, band } = useApp();
  const sc = data.scorecard!;
  const [measure, setMeasure] = useState(0);
  const months = scMonths(sc, filters.year);
  const f = { year: filters.year, unit: -1, area: -1 };
  const units = Array.from(new Set(sc.rows.map((r) => r[1] as number))).filter((u) => filters.unit < 0 || u === filters.unit);
  return (
    <Card title={`${sc.measures[measure]?.label} history`} sub={`By ${settings.unitLabel.toLowerCase()}, lowest first`}
      actions={<label className="row"><span className="sub">Measure</span><select className="select" value={measure} onChange={(e) => setMeasure(Number(e.target.value))}>{sc.measures.map((m, i) => <option key={m.key} value={i}>{m.label}</option>)}</select></label>}>
      <Heatmap periods={months.map((p) => sc.periods[p])} caption={`${sc.measures[measure]?.label} by month`}
        rows={units.map((u) => ({ name: data.units[u]?.name || "—", cells: months.map((p) => { const v = scMean(scRows(sc, { ...f, unit: u, period: p }), measure); return { band: band("opStandard", v), text: v == null ? "not tracked" : score(v) }; }), total: score(scMean(scRows(sc, { ...f, unit: u }), measure)) })).sort((a, b) => Number(a.total) - Number(b.total))} />
      <div className="mt"><Legend family="opStandard" overrides={settings.bands} /></div>
    </Card>
  );
}
