"use client";
// Charts, drawn in SVG and HTML so they follow the theme and stay legible:
// every chart has a text summary for screen readers, and values on hover/focus.
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

/** The rendered width of a box, so charts draw at real size (text stays legible). */
function useWidth(min = 280): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(min, Math.floor(el.clientWidth))));
    ro.observe(el); setW(Math.max(min, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, [min]);
  return [ref, w];
}
import type { BandKey } from "@/lib/bands";
import { MON3 } from "@/lib/metrics";

export interface BarDatum { label: string; value: number | null; band: BandKey | "none"; title: string }

/** Monthly bars coloured by band, with a light grid. */
export function BarTrend({ data, max, format, summary, height = 170 }: { data: BarDatum[]; max?: number; format: (v: number) => string; summary: string; height?: number }) {
  const [box, W] = useWidth();
  const H = height, PAD_L = 40, PAD_B = 26, PAD_T = 8;
  const every = Math.max(1, Math.ceil((data.length * 52) / Math.max(1, W - PAD_L)));
  const top = max ?? Math.max(0.0001, ...data.map((d) => d.value || 0)) * 1.15;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * top);
  const bw = (W - PAD_L) / Math.max(1, data.length);
  const y = (v: number) => PAD_T + (H - PAD_B - PAD_T) * (1 - v / top);
  return (
    <figure style={{ margin: 0 }} ref={box}>
      <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <g className="grid">{ticks.map((t, i) => <line key={i} x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} />)}</g>
        {ticks.map((t, i) => <text key={i} x={PAD_L - 6} y={y(t) + 4} textAnchor="end">{format(t)}</text>)}
        {data.map((d, i) => {
          const h = d.value == null ? 0 : Math.max(2, H - PAD_B - y(d.value));
          return (
            <g key={i} data-band={d.band}>
              <rect className="bar-rect" x={PAD_L + i * bw + bw * 0.18} y={H - PAD_B - h} width={bw * 0.64} height={h} rx={3}><title>{d.title}</title></rect>
              {i % every === 0 && <text x={PAD_L + i * bw + bw / 2} y={H - 8} textAnchor="middle">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Two lines (e.g. new defects and resolved) over months. */
export function LineTrend({ labels, series, summary, height = 200 }: { labels: string[]; series: { name: string; colour: string; values: number[] }[]; summary: string; height?: number }) {
  const [box, W] = useWidth();
  const H = height, PAD_L = 44, PAD_B = 26, PAD_T = 10;
  const every = Math.max(1, Math.ceil((labels.length * 52) / Math.max(1, W - PAD_L)));
  const top = Math.max(1, ...series.flatMap((s) => s.values)) * 1.1;
  const x = (i: number) => PAD_L + (labels.length <= 1 ? 0 : (i * (W - PAD_L - 10)) / (labels.length - 1));
  const y = (v: number) => PAD_T + (H - PAD_B - PAD_T) * (1 - v / top);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * top));
  return (
    <figure style={{ margin: 0 }} ref={box}>
      <div className="legend" style={{ marginBottom: 6 }}>
        {series.map((s) => <span key={s.name}><i className="swatch" style={{ background: s.colour, borderRadius: "50%" }} aria-hidden="true" />{s.name}</span>)}
      </div>
      <svg className="chart" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        <g className="grid">{ticks.map((t, i) => <line key={i} x1={PAD_L} x2={W} y1={y(t)} y2={y(t)} />)}</g>
        {ticks.map((t, i) => <text key={i} x={PAD_L - 6} y={y(t) + 4} textAnchor="end">{t.toLocaleString("en-US")}</text>)}
        {series.map((s) => (
          <g key={s.name}>
            <polyline fill="none" stroke={s.colour} strokeWidth={2.4} strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3.2} fill={s.colour}><title>{`${labels[i]}: ${v.toLocaleString("en-US")} ${s.name.toLowerCase()}`}</title></circle>)}
          </g>
        ))}
        {labels.map((l, i) => i % every === 0 && <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{l}</text>)}
      </svg>
    </figure>
  );
}

export interface HeatRow { name: string; cells: { band: BandKey | "none"; text: string }[]; total?: string }

/** A unit × month heat-map, years grouped above the months. Cells are buttons when onPick is given. */
export function Heatmap({ periods, rows, caption, onPick }: { periods: string[]; rows: HeatRow[]; caption: string; onPick?: (row: number, col: number) => void }) {
  const groups = useMemo(() => {
    const g: { year: string; span: number }[] = [];
    for (const p of periods) { const y = p.slice(0, 4); const last = g[g.length - 1]; if (last && last.year === y) last.span++; else g.push({ year: y, span: 1 }); }
    return g;
  }, [periods]);
  return (
    <div className="tablewrap" tabIndex={0}>
      <table className="heat">
        <caption className="sr">{caption}</caption>
        <thead>
          <tr className="yr"><th scope="col"><span className="sr">Branch</span></th>{groups.map((g) => <th key={g.year} colSpan={g.span} scope="colgroup">{g.year}</th>)}{rows[0]?.total !== undefined && <th />}</tr>
          <tr><th />{periods.map((p) => <th key={p} scope="col"><span aria-hidden="true">{MON3[Number(p.slice(5, 7)) - 1][0]}</span><span className="sr">{MON3[Number(p.slice(5, 7)) - 1]} {p.slice(0, 4)}</span></th>)}{rows[0]?.total !== undefined && <th scope="col">All</th>}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              {r.cells.map((c, ci) => (
                <td key={ci} data-band={c.band} className={ci > 0 && periods[ci].slice(5, 7) === "01" ? "ystart" : undefined} title={`${r.name} · ${MON3[Number(periods[ci].slice(5, 7)) - 1]} ${periods[ci].slice(0, 4)}: ${c.text}`}>
                  {onPick ? (
                    <button type="button" aria-label={`${r.name}, ${MON3[Number(periods[ci].slice(5, 7)) - 1]} ${periods[ci].slice(0, 4)}: ${c.text}`} onClick={() => onPick(ri, ci)} />
                  ) : <span className="sr">{c.text}</span>}
                </td>
              ))}
              {r.total !== undefined && <td className="tot">{r.total}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A labelled horizontal bar per row (resolution by branch, defects by category…). */
export function HBars({ rows, format }: { rows: { label: string; value: number; band: BandKey | "none"; note?: string }[]; format: (v: number) => string }) {
  return (
    <ul className="list">
      {rows.map((r) => (
        <Fragment key={r.label}>
          <li data-band={r.band}>
            <span style={{ width: 120, flex: "none", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
            <span className="bar" aria-hidden="true"><i style={{ width: `${Math.max(2, Math.min(100, r.value * 100))}%` }} /></span>
            <span className="tone" style={{ width: 64, textAlign: "right", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{format(r.value)}</span>
          </li>
        </Fragment>
      ))}
    </ul>
  );
}
