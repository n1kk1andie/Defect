"use client";
// Risk: every site's quality risk score, worst first, with the reasons
// behind it ("why this ward is Escalate"), the watchlist, and how often the
// band says the site should be visited. Admins tune the model: driver
// weights, their own factors (entered per site), band cut-offs and the visit
// frequency per band. It works in the organisation's own words.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, Msg, PageHead, Sheet } from "@/components/ui";
import { Icon } from "@/components/icons";
import { BANDS, type BandKey } from "@/lib/bands";
import { DRIVER_INFO, DRIVER_KEYS, why, type RiskConfig } from "@/lib/risk";
import type { RiskBoard } from "@/lib/riskScore";
import { can } from "@/lib/roles";
import { RiskFeed } from "@/components/screens/RiskFeed";
import type { OutboxRow } from "@/lib/riskLink";

type Site = RiskBoard["sites"][number];
const bandLabel = (b: string) => BANDS.find((x) => x.key === b)?.label ?? "No data";

export function Risk({ board, proposals = [], connected = false }: { board: RiskBoard; proposals?: OutboxRow[]; connected?: boolean }) {
  const app = useApp();
  const [open, setOpen] = useState<Site | null>(null);
  const [model, setModel] = useState(false);
  const [group, setGroup] = useState("all");
  const admin = can.manage(app.actor);
  const groups = Array.from(new Set(board.sites.map((s) => s.group).filter(Boolean))) as string[];
  const sites = board.sites.filter((s) => group === "all" || s.group === group);
  const watch = sites.filter((s) => s.band === "attention" || s.band === "escalate" || (s.delta ?? 0) >= 5);
  const counts = BANDS.map((b) => ({ ...b, n: sites.filter((s) => s.band === b.key).length }));
  const U = app.settings.unitLabel, Us = app.settings.unitPlural;
  return (
    <>
      <PageHead eyebrow="Risk" title={`Every ${U.toLowerCase()},`} accent="ranked by risk."
        lede={`A quality risk score from 0 (low) to 100 for each ${U.toLowerCase()}: inspection scores, critical failures, deviation rates from sampling, overdue actions, repeat findings, time since the last visit${board.config.factors.length ? ` and ${board.config.factors.map((f) => f.label.toLowerCase()).join(", ")}` : ""}. Recent results weigh more. The band sets how often to visit.`}
        right={<>
          {groups.length > 1 && <select className="select" aria-label={app.settings.groupLabel} value={group} onChange={(e) => setGroup(e.target.value)}><option value="all">All {app.settings.groupLabel.toLowerCase()}s</option>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select>}
          <a className="btn" href="/api/committee"><Icon name="report" />Committee PDF</a>
          {admin && <button className="btn" onClick={() => setModel(true)}><Icon name="sliders" />Risk model</button>}
        </>} />
      <div className="bandbar" role="list" aria-label={`${Us} by band`}>
        {counts.map((c) => <div key={c.key} role="listitem" data-band={c.key} className="bandbar-i" style={{ flex: Math.max(c.n, 0.9) }}><span className="n">{c.n}</span><span className="l">{c.label}</span></div>)}
      </div>
      <div className="grid g-2-1 mt2">
        <Card title="League table" sub={`Highest risk first · change over the last 30 days`} flush>
          {sites.length ? (
            <div className="tablewrap" tabIndex={0} role="region" aria-label="Risk league table">
              <table className="t stack">
                <caption className="sr">Risk league table</caption>
                <thead><tr><th scope="col" className="num">#</th><th scope="col">{U}</th><th scope="col" className="num">Score</th><th scope="col">Band</th><th scope="col" className="num">30 days</th><th scope="col">Biggest driver</th><th scope="col" className="num">Visit every</th></tr></thead>
                <tbody>{sites.map((s, i) => (
                  <tr key={s.unitId} className="clickable" onClick={() => setOpen(s)}>
                    <td data-label="#" className="num">{i + 1}</td>
                    <td data-label={U}><button type="button" className="linkbtn" style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 700 }} onClick={(e) => { e.stopPropagation(); setOpen(s); }}>{s.name}</button>{s.group && <div className="sub" style={{ fontSize: 12 }}>{s.group}</div>}</td>
                    <td data-label="Score" className="num"><strong>{s.score ?? "—"}</strong></td>
                    <td data-label="Band"><BandPill band={s.band}>{bandLabel(s.band)}</BandPill></td>
                    <td data-label="30 days" className="num">{s.delta == null ? "—" : <span className={s.delta > 0 ? "tone" : ""} data-band={s.delta >= 5 ? "escalate" : s.delta <= -5 ? "strong" : undefined}>{s.delta > 0 ? "▲" : s.delta < 0 ? "▼" : ""} {Math.abs(s.delta).toFixed(1)}</span>}</td>
                    <td data-label="Biggest driver">{s.top ? <><strong style={{ fontWeight: 600 }}>{s.top.label}</strong> <span className="sub">+{s.top.contribution}</span></> : "—"}</td>
                    <td data-label="Visit every" className="num">{s.frequencyDays ? `${s.frequencyDays} days` : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <Empty icon="alert" title={`No ${Us.toLowerCase()} yet`} />}
        </Card>
        <Card title="Watchlist" sub="Attention or Escalate, or rising by 5 or more">
          {watch.length ? (
            <ul className="list">{watch.map((s) => (
              <li key={s.unitId} style={{ alignItems: "flex-start" }}>
                <span className="badge sm" aria-hidden="true" data-band={s.band} style={{ background: "var(--bp)", color: "var(--bt)" }}><Icon name="alert" /></span>
                <span className="grow"><button type="button" className="linkbtn" style={{ color: "var(--ink)", textDecoration: "none", fontWeight: 700 }} onClick={() => setOpen(s)}>{s.name}</button> <BandPill band={s.band}>{s.score}</BandPill><span className="sub" style={{ display: "block", fontSize: 13, marginTop: 4 }}>{why(s, U)}</span></span>
              </li>
            ))}</ul>
          ) : <Empty icon="check" title="Nothing on the watchlist" />}
        </Card>
      </div>
      <Card className="mt2" title="Sent to Pulsus Risk" sub={`${connected ? "Proposed to Risk's review queue" : "Stored here until Risk's intake is connected"}: a ${U.toLowerCase()} entering Attention or Escalate, a critical failure, a sampled control not effective. Each is proposed once; a Risk Officer accepts or rejects it.`}>
        <RiskFeed rows={proposals.filter((p) => p.rule)} empty="Nothing has needed proposing yet." />
      </Card>
      {open && <SiteSheet s={open} cfg={board.config} onClose={() => setOpen(null)} />}
      {model && <ModelSheet board={board} onClose={() => setModel(false)} />}
    </>
  );
}

function SiteSheet({ s, cfg, onClose }: { s: Site; cfg: RiskConfig; onClose: () => void }) {
  const app = useApp();
  const max = Math.max(1, ...s.drivers.map((d) => d.contribution));
  return (
    <Sheet title={`${s.name}: ${bandLabel(s.band)} (${s.score ?? "—"})`} sub={`${s.group ? `${s.group} · ` : ""}visit every ${s.frequencyDays ?? "—"} days · ${s.observed} inspections and samples in the last 12 months`} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{why(s, app.settings.unitLabel)}</p>
      <div className="eyebrow mt">What makes up the score</div>
      <ul className="list">{s.drivers.map((d) => (
        <li key={d.key} style={{ alignItems: "flex-start" }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <strong>{d.label}</strong> <span className="sub">weight {d.weight}</span>
            <span className="sub" style={{ display: "block", fontSize: 13 }}>{d.detail}{d.risk !== null ? ` · risk ${Math.round(d.risk)} of 100` : " · not counted"}</span>
            <span className="bar" style={{ display: "block", marginTop: 6 }} aria-hidden="true"><i style={{ width: `${(d.contribution / max) * 100}%`, background: d.contribution > 10 ? "var(--b-escalate)" : d.contribution > 4 ? "var(--b-attention)" : "var(--b-strong)" }} /></span>
          </span>
          <span className="num" style={{ fontWeight: 800, minWidth: 48, textAlign: "right" }}>+{d.contribution}</span>
        </li>
      ))}</ul>
      <p className="sub" style={{ fontSize: 12.5 }}>The score is the weighted average of each driver's risk (0–100); a driver with no data isn't counted. Scales: {DRIVER_KEYS.map((k) => `${DRIVER_INFO[k].label.toLowerCase()}: ${DRIVER_INFO[k].scale.toLowerCase()}`).join("; ")}. Recent results weigh more (half-life {cfg.halfLifeMonths} months).</p>
    </Sheet>
  );
}

function ModelSheet({ board, onClose }: { board: RiskBoard; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const [m, setM] = useState<RiskConfig>(structuredClone(board.config));
  const [vals, setVals] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(board.sites.map((s) => [s.unitId, Object.fromEntries(Object.entries(s.factors).map(([k, v]) => [k, v == null ? "" : String(v)]))])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const cut = useMemo(() => [m.cutoffs.worldClass, m.cutoffs.strong, m.cutoffs.healthy, m.cutoffs.watch, m.cutoffs.attention], [m]);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api("/api/risk-model", "PUT", { model: m });
      await api("/api/risk-model", "PUT", { factors: Object.entries(vals).map(([unitId, data]) => ({ unitId, data })) });
      setMsg({ kind: "ok", text: "Saved. Scores are recalculated." }); router.refresh();
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <Sheet title="Risk model" sub="Recorded in the change history. Applies to every score at once." onClose={onClose} footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn primary" disabled={busy} onClick={save}><Icon name="check" />Save</button></>}>
      <div className="eyebrow">Driver weights</div>
      {DRIVER_KEYS.map((k) => <Field key={k} label={`${DRIVER_INFO[k].label}: ${m.weights[k]}`} hint={DRIVER_INFO[k].scale}><input className="range" type="range" min={0} max={10} step={0.5} value={m.weights[k]} onChange={(e) => setM({ ...m, weights: { ...m.weights, [k]: Number(e.target.value) } })} /></Field>)}
      <div className="eyebrow mt2">Your own factors (entered per {app.settings.unitLabel.toLowerCase()}, 0 to 100)</div>
      {m.factors.map((f, i) => (
        <div key={i} className="row wrap" style={{ gap: 8, marginTop: 8 }}>
          <input className="input grow" aria-label={`Factor ${i + 1} name`} value={f.label} onChange={(e) => setM({ ...m, factors: m.factors.map((x, j) => (j === i ? { ...x, label: e.target.value, key: x.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) } : x)) })} />
          <label className="row" style={{ gap: 6 }}><span className="sub">weight</span><input className="input" style={{ width: 72 }} inputMode="decimal" aria-label={`Factor ${i + 1} weight`} value={f.weight} onChange={(e) => setM({ ...m, factors: m.factors.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 0 } : x)) })} /></label>
          <button type="button" className="iconbtn sm" onClick={() => setM({ ...m, factors: m.factors.filter((_, j) => j !== i) })} aria-label={`Remove ${f.label}`}><Icon name="trash" /></button>
        </div>
      ))}
      {m.factors.length < 8 && <button type="button" className="btn sm mt" onClick={() => setM({ ...m, factors: [...m.factors, { key: `factor${m.factors.length + 1}`, label: "New factor", weight: 1 }] })}><Icon name="plus" />Add a factor</button>}
      {m.factors.length > 0 && (
        <div className="tablewrap mt" tabIndex={0} role="region" aria-label="Factor values">
          <table className="t"><caption className="sr">Factor values</caption><thead><tr><th scope="col">{app.settings.unitLabel}</th>{m.factors.map((f) => <th key={f.key} scope="col">{f.label}</th>)}</tr></thead>
            <tbody>{board.sites.map((s) => <tr key={s.unitId}><th scope="row">{s.name}</th>{m.factors.map((f) => <td key={f.key}><input className="input" style={{ width: 76, minHeight: 36 }} inputMode="numeric" aria-label={`${f.label} for ${s.name}`} value={vals[s.unitId]?.[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [s.unitId]: { ...vals[s.unitId], [f.key]: e.target.value.replace(/\D/g, "").slice(0, 3) } })} /></td>)}</tr>)}</tbody></table>
        </div>
      )}
      <div className="eyebrow mt2">Bands (score below each cut-off earns the band; lower is better)</div>
      <div className="grid g3" style={{ gap: 8 }}>
        {(["worldClass", "strong", "healthy", "watch", "attention"] as const).map((k) => <Field key={k} label={`${bandLabel(k)} below`}><input className="input" inputMode="numeric" value={m.cutoffs[k]} onChange={(e) => setM({ ...m, cutoffs: { ...m.cutoffs, [k]: Number(e.target.value.replace(/\D/g, "")) || 0 } })} /></Field>)}
      </div>
      {cut.some((v, i) => i && v <= cut[i - 1]) && <Msg kind="err">Each cut-off must be above the one before it.</Msg>}
      <div className="eyebrow mt2">Visit frequency by band (risk-based programmes)</div>
      <div className="grid g3" style={{ gap: 8 }}>
        {BANDS.map((b) => <Field key={b.key} label={`${b.label}: every (days)`}><input className="input" inputMode="numeric" value={m.frequency[b.key as BandKey]} onChange={(e) => setM({ ...m, frequency: { ...m.frequency, [b.key]: Number(e.target.value.replace(/\D/g, "")) || 7 } })} /></Field>)}
      </div>
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
    </Sheet>
  );
}
