"use client";
// Compare: roll every site up to its entity (hospital, agency, campus,
// subsidiary), region or named group, side by side, and benchmark each site
// against the median. Admins set up the entities; supervisors make groups.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, Msg, PageHead, Seg, Sheet } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BANDS } from "@/lib/bands";
import { can } from "@/lib/roles";
import type { Comparison, GroupFigures, SiteFigures, Structure } from "@/lib/structure";

const bandLabel = (b: string) => BANDS.find((x) => x.key === b)?.label ?? "No data";
const pct = (x: number | null) => (x == null ? "—" : `${x.toFixed(1)}%`);
type Level = Comparison["level"];

export function Compare({ comparison: c, structure }: { comparison: Comparison; structure: Structure }) {
  const app = useApp();
  const router = useRouter();
  const S = app.settings;
  const [edit, setEdit] = useState<null | { type: "entity" | "group"; id: string | null }>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  const levelName = (l: Level) => (l === "entity" ? S.entityLabel : l === "region" ? S.groupLabel : l === "group" ? "Group" : S.unitLabel);
  const go = (level: Level, days: number) => router.push(`/compare?level=${level}&days=${days}`);
  const best = [...c.sites].filter((s) => s.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore!);
  const levels: Level[] = ["entity", "region", "group", "site"];
  return (
    <>
      <PageHead eyebrow="Compare" title="Side by side," accent="fairly."
        lede={`Every ${S.unitLabel.toLowerCase()} rolled up to its ${S.entityLabel.toLowerCase()}, ${S.groupLabel.toLowerCase()} or group, with inspection scores, critical failures, risk, overdue actions and reported issues over the last ${c.days} days. ${c.median != null ? `The median ${S.unitLabel.toLowerCase()} scores ${pct(c.median)}.` : ""}`}
        right={<a className="btn" href={`/api/compare?level=${c.level}&days=${c.days}&format=xlsx`}><Icon name="download" />Excel</a>} />
      <div className="row wrap" style={{ gap: 10 }}>
        <Seg label="Roll up by" value={c.level} onChange={(l) => go(l, c.days)} options={levels.map((l) => ({ value: l, label: levelName(l) }))} />
        <Seg label="Period" value={String(c.days) as "30" | "90" | "180" | "365"} onChange={(d) => go(c.level, Number(d))} options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "180", label: "6 months" }, { value: "365", label: "12 months" }]} />
      </div>
      {c.level !== "site" && (
        <Card className="mt" flush title={`By ${levelName(c.level).toLowerCase()}`} sub="Highest average risk first. Scores are weighted by the number of inspections."
          actions={c.level === "entity" && can.manage(app.actor) ? <div className="row wrap"><button className="btn sm" onClick={() => setLabelOpen(true)}>Rename</button><button className="btn sm" onClick={() => setEdit({ type: "entity", id: null })}><Icon name="plus" />Add {S.entityLabel.toLowerCase()}</button></div> : c.level === "group" && can.buildTemplates(app.actor) ? <button className="btn sm" onClick={() => setEdit({ type: "group", id: null })}><Icon name="plus" />Add group</button> : undefined}>
          {c.groups.length ? <GroupTable groups={c.groups} label={levelName(c.level)} onEdit={c.level === "entity" && can.manage(app.actor) ? (id) => setEdit({ type: "entity", id }) : c.level === "group" && can.buildTemplates(app.actor) ? (id) => setEdit({ type: "group", id }) : undefined} />
            : <Empty icon="layers" title={c.level === "entity" ? `No ${S.entityLabel.toLowerCase()}s yet` : c.level === "group" ? "No groups yet" : `No ${S.groupLabel.toLowerCase()}s yet`}>
              {c.level === "entity" ? `In a group of organisations (a health system, a ministry and its agencies, a university system), add each ${S.entityLabel.toLowerCase()} and the ${S.unitPlural.toLowerCase()} in it.` : c.level === "group" ? `A group is any set of ${S.unitPlural.toLowerCase()} you want to compare, such as "Urban" or "Opened this year".` : `Give each ${S.unitLabel.toLowerCase()} a ${S.groupLabel.toLowerCase()} in Settings, Company set-up.`}
            </Empty>}
        </Card>
      )}
      <Card className="mt" flush title={`Benchmark: every ${S.unitLabel.toLowerCase()}`} sub={`Average inspection score against the median (${pct(c.median)}) and the best (${pct(c.best)}). Percentile 100 is the best ${S.unitLabel.toLowerCase()}.`}>
        {best.length || c.sites.length ? <SiteTable sites={[...best, ...c.sites.filter((s) => s.avgScore == null)]} structure={structure} median={c.median} /> : <Empty icon="layers" title="No figures yet" />}
      </Card>
      {edit && <EditSheet type={edit.type} id={edit.id} structure={structure} onClose={() => setEdit(null)} />}
      {labelOpen && <LabelSheet onClose={() => setLabelOpen(false)} />}
    </>
  );
}

function GroupTable({ groups, label, onEdit }: { groups: GroupFigures[]; label: string; onEdit?: (id: string) => void }) {
  const app = useApp();
  return (
    <div className="tablewrap" tabIndex={0} role="region" aria-label={`Comparison by ${label}`}>
      <table className="t stack">
        <caption className="sr">Comparison by {label}</caption>
        <thead><tr><th scope="col">{label}</th><th scope="col" className="num">{app.settings.unitPlural}</th><th scope="col" className="num">Inspections</th><th scope="col" className="num">Avg score</th><th scope="col" className="num">Pass rate</th><th scope="col" className="num">Critical</th><th scope="col" className="num">Avg risk</th><th scope="col">Worst</th><th scope="col" className="num">Overdue actions</th><th scope="col" className="num">Open reports</th></tr></thead>
        <tbody>{groups.map((g) => (
          <tr key={g.key}>
            <td data-label={label}>{onEdit && g.key !== "_none" ? <button type="button" className="linkbtn" style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 700 }} onClick={() => onEdit(g.key)}>{g.name}</button> : <strong>{g.name}</strong>}</td>
            <td data-label={app.settings.unitPlural} className="num">{g.sites}</td>
            <td data-label="Inspections" className="num">{g.inspections}</td>
            <td data-label="Avg score" className="num"><strong>{pct(g.avgScore)}</strong></td>
            <td data-label="Pass rate" className="num">{g.passRate == null ? "—" : `${Math.round(g.passRate * 100)}%`}</td>
            <td data-label="Critical" className="num">{g.criticalFails}</td>
            <td data-label="Avg risk" className="num">{g.avgRisk ?? "—"}</td>
            <td data-label="Worst">{g.worstBand !== "none" ? <BandPill band={g.worstBand}>{g.worstSite} · {bandLabel(g.worstBand)}</BandPill> : "—"}</td>
            <td data-label="Overdue actions" className="num">{g.overdueActions}</td>
            <td data-label="Open reports" className="num">{g.openIssues}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SiteTable({ sites, structure, median }: { sites: SiteFigures[]; structure: Structure; median: number | null }) {
  const app = useApp();
  const ent = new Map(structure.entities.map((e) => [e.id, e.name]));
  const U = app.settings.unitLabel;
  return (
    <div className="tablewrap" tabIndex={0} role="region" aria-label={`Benchmark by ${U.toLowerCase()}`}>
      <table className="t stack">
        <caption className="sr">Benchmark by {U.toLowerCase()}</caption>
        <thead><tr><th scope="col">{U}</th><th scope="col">{structure.entities.length ? app.settings.entityLabel : app.settings.groupLabel}</th><th scope="col" className="num">Avg score</th><th scope="col">Against the median</th><th scope="col" className="num">Percentile</th><th scope="col" className="num">Critical</th><th scope="col">Risk</th><th scope="col" className="num">Overdue</th></tr></thead>
        <tbody>{sites.map((s) => (
          <tr key={s.unitId}>
            <td data-label={U}><strong>{s.name}</strong><div className="sub" style={{ fontSize: 12 }}>{s.inspections} inspection{s.inspections === 1 ? "" : "s"}</div></td>
            <td data-label={structure.entities.length ? app.settings.entityLabel : app.settings.groupLabel}>{(structure.entities.length ? (s.entityId ? ent.get(s.entityId) : null) : s.region) ?? "—"}</td>
            <td data-label="Avg score" className="num"><strong>{pct(s.avgScore)}</strong></td>
            <td data-label="Against the median">{s.vsMedian == null || median == null ? "—" : <span className="bench" data-band={s.vsMedian >= 2 ? "strong" : s.vsMedian <= -2 ? "escalate" : "watch"}><span className="bench-bar" aria-hidden="true"><i style={{ [s.vsMedian >= 0 ? "left" : "right"]: "50%", width: `${Math.min(50, Math.abs(s.vsMedian) * 2.5)}%` }} /></span>{s.vsMedian > 0 ? "+" : ""}{s.vsMedian.toFixed(1)} pts</span>}</td>
            <td data-label="Percentile" className="num">{s.scorePercentile ?? "—"}</td>
            <td data-label="Critical" className="num">{s.criticalFails}</td>
            <td data-label="Risk">{s.band !== "none" ? <BandPill band={s.band}>{s.risk} · {bandLabel(s.band)}</BandPill> : "—"}</td>
            <td data-label="Overdue" className="num">{s.overdueActions}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function EditSheet({ type, id, structure, onClose }: { type: "entity" | "group"; id: string | null; structure: Structure; onClose: () => void }) {
  const app = useApp();
  const S = app.settings;
  const ex = type === "entity" ? structure.entities.find((e) => e.id === id) : structure.groups.find((g) => g.id === id);
  const [name, setName] = useState(ex?.name ?? "");
  const [code, setCode] = useState(type === "entity" ? (ex as Structure["entities"][number] | undefined)?.code ?? "" : "");
  const [pick, setPick] = useState<string[]>(ex?.unitIds ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const units = app.program.units.filter((u) => u.active);
  const elsewhere = (uid: string) => type === "entity" ? structure.entities.find((e) => e.id !== id && e.unitIds.includes(uid))?.name : undefined;
  const save = async (remove = false) => {
    setBusy(true); setErr("");
    try { await api("/api/structure", "POST", { type, id, name, code, unitIds: pick, remove }); app.refresh(); onClose(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const noun = type === "entity" ? S.entityLabel.toLowerCase() : "group";
  return (
    <Sheet title={ex ? `Change ${ex.name}` : `Add a ${noun}`} sub={type === "entity" ? `Each ${S.unitLabel.toLowerCase()} belongs to one ${noun} at most.` : `A ${S.unitLabel.toLowerCase()} can be in any number of groups.`} onClose={onClose}
      footer={<>{ex && <button className="btn ghost" disabled={busy} onClick={() => confirm(`Remove ${ex.name}? Its ${S.unitPlural.toLowerCase()} stay.`) && save(true)}>Remove</button>}<button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</button></>}>
      <Field label="Name"><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
      {type === "entity" && <Field label="Code (optional)"><input className="input" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} /></Field>}
      <div className="field"><span>{S.unitPlural}</span>
        <div className="chips static" role="group" aria-label={S.unitPlural}>{units.map((u) => (
          <button key={u.id} type="button" className="chip" aria-pressed={pick.includes(u.id)} onClick={() => setPick((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : [...p, u.id]))}>{u.name}{elsewhere(u.id) ? ` (now ${elsewhere(u.id)})` : ""}</button>
        ))}</div>
      </div>
      <Msg>{err}</Msg>
    </Sheet>
  );
}

function LabelSheet({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [v, setV] = useState(app.settings.entityLabel);
  const [err, setErr] = useState("");
  return (
    <Sheet title="What do you call an entity?" sub="For example Hospital, Agency, Campus, Subsidiary or Business unit." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => { try { await api("/api/structure", "POST", { type: "label", entityLabel: v }); app.refresh(); onClose(); } catch (e) { setErr((e as Error).message); } }}>Save</button></>}>
      <Field label="Name"><input className="input" value={v} maxLength={30} onChange={(e) => setV(e.target.value)} /></Field>
      <Msg>{err}</Msg>
    </Sheet>
  );
}
