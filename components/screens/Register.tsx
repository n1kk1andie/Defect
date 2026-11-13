"use client";
// Register: the figures behind the dashboards, by branch or process area
// (sortable, with a total and exports), and the defects themselves from
// published reviews, which supervisors resolve, reopen or turn into actions.
import { useMemo, useState } from "react";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Msg, PageHead, Seg } from "@/components/ui";
import { FilterBar, ModeToggle, scopeText, YearSelect } from "@/components/screens/Filters";
import { RaiseAction } from "@/components/screens/RaiseAction";
import { byArea, byUnit, filterRows, monthLabel, num, pct, record, scMean, scRows, score, yearOf, type Rec } from "@/lib/metrics";
import { can } from "@/lib/roles";
import { Icon } from "@/components/icons";

export interface DefectRow { reviewId: string; ref: string; idx: number; unitId: string; areaId: string; period: string; reference: string; itemType: string; nature: string; defects: number; recurring: boolean; status: "open" | "resolved"; failed: string[] }

type SortKey = "name" | "reviewed" | "instances" | "defects" | "defectRate" | "resolved" | "resolutionRate" | "recurring" | "recurringRate";
const COLS: { k: SortKey; t: string; pct?: boolean }[] = [
  { k: "reviewed", t: "Reviewed" }, { k: "instances", t: "Instances" }, { k: "defects", t: "Defects" }, { k: "defectRate", t: "Defect rate", pct: true },
  { k: "resolved", t: "Resolved" }, { k: "resolutionRate", t: "Resolution", pct: true }, { k: "recurring", t: "Recurring" }, { k: "recurringRate", t: "Recurring rate", pct: true },
];

export function Register({ defects }: { defects: DefectRow[] }) {
  const app = useApp();
  const [view, setView] = useState<"summary" | "defects">("summary");
  return (
    <>
      <PageHead eyebrow={`Register · ${scopeText(app)}`} title="Every figure," accent="and where it came from." lede="The counts behind each rate, by branch or process area, and every defect found in published reviews." right={<YearSelect />} />
      <ModeToggle />
      <FilterBar />
      {app.filters.mode === "standard" && app.data.scorecard ? <StandardRegister /> : (
        <>
          <div style={{ maxWidth: 380, marginBottom: 14 }}><Seg label="Register view" value={view} onChange={setView} options={[{ value: "summary", label: "Summary" }, { value: "defects", label: `Defects (${defects.filter((d) => d.status === "open").length} open)` }]} /></div>
          {view === "summary" ? <Summary /> : <Defects rows={defects} />}
        </>
      )}
    </>
  );
}

function Summary() {
  const { data, settings, filters, band } = useApp();
  const [group, setGroup] = useState<"unit" | "area">("unit");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "defectRate", dir: -1 });
  const f = { year: filters.year, unit: filters.unit, area: filters.area };
  const list = useMemo(() => (group === "area" ? byArea(data, f) : byUnit(data, f)), [data, filters, group]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = useMemo(() => record(filterRows(data, f)), [data, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = list.slice().sort((a, b) => {
    const av = sort.k === "name" ? a.name : (a.rec[sort.k as keyof Rec] as number | null) ?? -1;
    const bv = sort.k === "name" ? b.name : (b.rec[sort.k as keyof Rec] as number | null) ?? -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
  });
  const q = `year=${filters.year}&unit=${filters.unit}&area=${filters.area}&group=${group}`;
  const head = (k: SortKey, t: string, numeric = true) => (
    <th scope="col" className={numeric ? "num" : undefined} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : -1 }))}>{t}{sort.k === k ? (sort.dir === 1 ? " ▴" : " ▾") : ""}</button>
    </th>
  );
  const row = (name: string, r: Rec, cls?: string) => (
    <tr key={name} className={cls}>
      <th scope="row" style={{ textAlign: "left", fontWeight: cls ? 800 : 600, padding: "11px 12px", borderBottom: "1px solid var(--line)" }} data-label={group === "area" ? "Process area" : settings.unitLabel}>{name}</th>
      {COLS.map((c) => (
        <td key={c.k} className="num" data-label={c.t}>
          {c.k === "defectRate" ? <BandPill band={band("defectRate", r.defectRate)} label>{pct(r.defectRate)}</BandPill>
            : c.k === "resolutionRate" ? <span className="tone" data-band={band("resolutionRate", r.resolutionRate)} style={{ fontWeight: 700 }}>{pct(r.resolutionRate)}</span>
            : c.k === "recurringRate" ? <span className="tone" data-band={band("recurringRate", r.recurringRate)} style={{ fontWeight: 700 }}>{pct(r.recurringRate)}</span>
            : num(r[c.k as keyof Rec] as number)}
        </td>
      ))}
    </tr>
  );
  return (
    <Card flush title={group === "area" ? "By process area" : `By ${settings.unitLabel.toLowerCase()}`} sub={`${list.length} with reviews in scope`}
      actions={<div className="row wrap" style={{ padding: "0 0 0 0" }}>
        <Seg label="Group by" value={group} onChange={setGroup} options={[{ value: "unit", label: settings.unitLabel }, { value: "area", label: "Process area" }]} />
        <a className="btn sm" href={`/api/export?what=register&format=csv&${q}`}><Icon name="download" />CSV</a>
        <a className="btn sm" href={`/api/export?what=register&format=xlsx&${q}`}><Icon name="download" />Excel</a>
      </div>}>
      {list.length ? (
        <div className="tablewrap" tabIndex={0} style={{ marginTop: 8 }}>
          <table className="t stack">
            <caption className="sr">Register by {group === "area" ? "process area" : settings.unitLabel.toLowerCase()}</caption>
            <thead><tr>{head("name", group === "area" ? "Process area" : settings.unitLabel, false)}{COLS.map((c) => <Fragmented key={c.k}>{head(c.k, c.t)}</Fragmented>)}</tr></thead>
            <tbody>{sorted.map((x) => row(x.name, x.rec))}{row("Total", total, "total")}</tbody>
          </table>
        </div>
      ) : <Empty title="Nothing reviewed in this scope" />}
    </Card>
  );
}
const Fragmented = ({ children }: { children: React.ReactNode }) => <>{children}</>;

function StandardRegister() {
  const { data, settings, filters, band } = useApp();
  const sc = data.scorecard!;
  const units = Array.from(new Set(sc.rows.map((r) => r[1] as number))).filter((u) => filters.unit < 0 || u === filters.unit);
  const f = { year: filters.year, unit: filters.unit, area: -1 };
  return (
    <Card flush title={`${sc.name} by ${settings.unitLabel.toLowerCase()}`} sub="Average of each tracked month in scope">
      <div className="tablewrap" tabIndex={0} style={{ marginTop: 8 }}>
        <table className="t stack">
          <thead><tr><th scope="col">{settings.unitLabel}</th>{sc.measures.map((m) => <th key={m.key} scope="col" className="num">{m.label}</th>)}</tr></thead>
          <tbody>
            {units.map((u) => { const rows = scRows(sc, { ...f, unit: u }); return (
              <tr key={u}><th scope="row" style={{ textAlign: "left", padding: "11px 12px", borderBottom: "1px solid var(--line)" }}>{data.units[u]?.name}</th>
                {sc.measures.map((m, i) => { const v = scMean(rows, i); return <td key={m.key} className="num" data-label={m.label}>{i === 0 ? <BandPill band={band("opStandard", v)} label>{score(v)}</BandPill> : <span className="tone" data-band={band("opStandard", v)} style={{ fontWeight: 600 }}>{score(v)}</span>}</td>; })}
              </tr>); })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Defects({ rows }: { rows: DefectRow[] }) {
  const app = useApp();
  const { data, filters, actor, program, refresh } = app;
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [raise, setRaise] = useState<DefectRow | null>(null);
  const unitId = filters.unit >= 0 ? data.units[filters.unit]?.id : null;
  const areaId = filters.area >= 0 ? data.areas[filters.area]?.id : null;
  const list = rows.filter((r) => (status === "all" || r.status === status) && (!unitId || r.unitId === unitId) && (!areaId || r.areaId === areaId) && (filters.year === "all" || yearOf(r.period) === filters.year));
  const key = (r: DefectRow) => `${r.reviewId}:${r.idx}`;
  const canResolve = can.resolveDefects(actor);
  const act = async (resolved: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const items = list.filter((r) => picked.has(key(r))).map((r) => ({ reviewId: r.reviewId, idx: r.idx }));
      const j = await api<{ changed: number }>("/api/reviews/resolve", "POST", { items, resolved });
      setMsg({ kind: "ok", text: `${j.changed} defect${j.changed === 1 ? "" : "s"} ${resolved ? "marked resolved" : "reopened"}. The resolution rate has been updated.` });
      setPicked(new Set()); refresh();
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  const shown = list.slice(0, 300);
  return (
    <Card flush title="Defects from published reviews" sub={`${list.length} in scope${list.length > 300 ? ", showing the latest 300" : ""}`}
      actions={<div className="row wrap"><Seg label="Status" value={status} onChange={(s) => { setStatus(s); setPicked(new Set()); }} options={[{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]} /></div>}>
      {canResolve && picked.size > 0 && (
        <div className="row wrap" style={{ padding: "8px 18px", background: "var(--card-2)", borderTop: "1px solid var(--line)" }} role="region" aria-label="Selected defects">
          <strong>{picked.size} selected</strong>
          <button className="btn sm primary" disabled={busy} onClick={() => act(true)}><Icon name="check" />Mark resolved</button>
          <button className="btn sm" disabled={busy} onClick={() => act(false)}>Reopen</button>
        </div>
      )}
      <div style={{ padding: "0 18px" }}><Msg kind={msg?.kind}>{msg?.text}</Msg></div>
      {shown.length ? (
        <div className="tablewrap" tabIndex={0} style={{ marginTop: 8 }}>
          <table className="t stack">
            <caption className="sr">Defects</caption>
            <thead><tr>{canResolve && <th scope="col"><span className="sr">Select</span></th>}<th scope="col">Review</th><th scope="col">{app.settings.unitLabel}</th><th scope="col">Process area</th><th scope="col">Month</th><th scope="col">Nature</th><th scope="col">Failed checks</th><th scope="col">Status</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={key(r)}>
                  {canResolve && <td data-label="Select"><input type="checkbox" aria-label={`Select ${r.ref} item ${r.idx + 1}`} checked={picked.has(key(r))} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(key(r)); else n.delete(key(r)); return n; })} /></td>}
                  <td data-label="Review"><strong>{r.ref}</strong> <span className="sub">#{r.idx + 1}{r.reference ? ` · ${r.reference}` : ""}</span></td>
                  <td data-label={app.settings.unitLabel}>{app.unitName(r.unitId)}</td>
                  <td data-label="Process area">{app.areaName(r.areaId)}</td>
                  <td data-label="Month">{monthLabel(r.period)}</td>
                  <td data-label="Nature">{r.nature || "—"}{r.recurring && <> <span className="pill" data-band="attention">Recurring</span></>}</td>
                  <td data-label="Failed checks" style={{ maxWidth: 260 }}>{r.failed.length ? r.failed.join(", ") : `${r.defects} defect${r.defects === 1 ? "" : "s"}`}</td>
                  <td data-label="Status"><span className={`status ${r.status === "resolved" ? "st-closed" : "st-open"}`}>{r.status === "resolved" ? "Resolved" : "Open"}</span></td>
                  <td data-label="">{can.raiseActions(actor) && r.status === "open" && <button className="btn sm ghost" onClick={() => setRaise(r)}>Raise action</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty icon="check" title={status === "open" ? "No open defects here" : "Nothing to show"}>Defects appear once a supervisor publishes a review.</Empty>}
      {raise && <RaiseAction onClose={() => setRaise(null)} preset={{ unitId: raise.unitId, areaId: raise.areaId, title: raise.nature || "Defect found in review", details: `From ${raise.ref}, item ${raise.idx + 1}${raise.reference ? ` (${raise.reference})` : ""}: ${raise.failed.join(", ") || raise.nature}.`, sourceType: "review_item", sourceId: `${raise.reviewId}:${raise.idx}`, priority: raise.recurring ? "high" : "medium" }} />}
      {program.areas.length === 0 && null}
    </Card>
  );
}
