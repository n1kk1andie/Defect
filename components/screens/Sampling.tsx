"use client";
// Sampling: plans for file, chart, transaction and record reviews. Say how
// big the population is (or paste it), choose statistical or judgmental, and
// the sample size is worked out and the items chosen at random from a seed
// anyone can re-run. Review the selected items as an inspection; the result
// is projected to the population with an upper deviation limit.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Empty, Field, Msg, PageHead, Seg, Sheet, fmtDate, fmtDateTime } from "@/components/ui";
import { Icon } from "@/components/icons";
import { CONFIDENCES, evaluate as evalSample, parsePopulation, sampleSize, select, upperLimit, type PopItem } from "@/lib/sampling";
import { monthLabel } from "@/lib/metrics";
import type { PlanView } from "@/lib/samplingPlans";
import { can } from "@/lib/roles";

const pc = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d).replace(/\.0$/, "")}%`);
const randomSeed = () => `${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`;

export function Sampling({ plans, templates }: { plans: PlanView[]; templates: { id: string; name: string }[] }) {
  const app = useApp();
  const [creating, setCreating] = useState(false);
  const planner = can.buildTemplates(app.actor);
  const evaluated = plans.filter((p) => p.evaluation);
  return (
    <>
      <PageHead eyebrow="Sampling" title="Test a sample." accent="Know the population."
        lede={`For file, chart, transaction and record reviews: the sample size from the population, your confidence and the tolerable deviation rate; a random selection anyone can re-run from its seed; and the result projected to the whole population with an upper deviation limit.`}
        right={planner ? <button className="btn primary" onClick={() => setCreating(true)}><Icon name="plus" />New sampling plan</button> : undefined} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="stat-v">{plans.length}</div><div className="stat-l">Plans</div></div>
        <div className="stat"><div className="stat-v">{plans.filter((p) => !p.evaluation).length}</div><div className="stat-l">Awaiting results</div></div>
        <div className="stat"><div className="stat-v tone" data-band="strong">{evaluated.filter((p) => p.evaluation!.effective).length}</div><div className="stat-l">Controls effective</div></div>
        <div className="stat"><div className="stat-v tone" data-band={evaluated.some((p) => !p.evaluation!.effective) ? "escalate" : "none"}>{evaluated.filter((p) => !p.evaluation!.effective).length}</div><div className="stat-l">Not effective</div></div>
      </div>
      <Card flush>
        {plans.length ? (
          <div className="tablewrap" tabIndex={0} role="region" aria-label="Sampling plans">
            <table className="t stack">
              <thead><tr><th scope="col">Plan</th><th scope="col">{app.settings.unitLabel}</th><th scope="col" className="num">Sample</th><th scope="col">Method</th><th scope="col">Result</th></tr></thead>
              <tbody>{plans.map((p) => (
                <tr key={p.id}>
                  <td data-label="Plan"><Link href={`/sampling/${p.id}`} style={{ fontWeight: 700, color: "var(--ink)", textDecoration: "none" }}>{p.ref}</Link> <span>{p.name}</span><div className="sub" style={{ fontSize: 12 }}>{p.templateName ?? "No template"}{p.period ? ` · ${monthLabel(p.period)}` : ""}</div></td>
                  <td data-label={app.settings.unitLabel}>{p.unitName ?? "—"}</td>
                  <td data-label="Sample" className="num">{p.sampleSize} of {p.populationSize.toLocaleString("en-US")}</td>
                  <td data-label="Method">{p.method === "statistical" ? `${pc(p.confidence, 0)} · TDR ${pc(p.tdr)}${p.stratify ? " · stratified" : ""}` : "Judgmental"}</td>
                  <td data-label="Result">{p.evaluation ? <span className="pill" data-band={p.evaluation.effective ? "strong" : "escalate"}>{p.evaluation.effective ? "Effective" : "Not effective"} · {p.evaluation.deviations}/{p.evaluation.n}</span> : <span className="status st-submitted">{p.inspectionId ? `In review · ${p.inspectionRef}` : "Selected"}</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty icon="hash" title="No sampling plans yet">{planner ? "Start one for your next file or chart review." : "A supervisor plans samples."}</Empty>}
      </Card>
      {creating && <NewPlan templates={templates} onClose={() => setCreating(false)} />}
    </>
  );
}

function NewPlan({ templates, onClose }: { templates: { id: string; name: string }[]; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const units = app.program.units.filter((u) => u.active && (!app.actor.unitIds.length || app.actor.unitIds.includes(u.id)));
  const thisMonth = new Date().toISOString().slice(0, 7) + "-01";
  const [f, setF] = useState({ name: "", templateId: templates[0]?.id ?? "", unitId: units[0]?.id ?? "", period: thisMonth, method: "statistical" as "statistical" | "judgmental", confidence: 0.95, tdr: 0.05, edr: 0, popMode: "size" as "size" | "list", populationSize: "400", population: "", stratify: false, censusAbove: "", size: "25", seed: randomSeed() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items: PopItem[] = useMemo(() => (f.popMode === "list" ? parsePopulation(f.population) : []), [f.popMode, f.population]);
  const N = f.popMode === "list" ? items.length : Math.max(0, Math.floor(Number(f.populationSize) || 0));
  const strata = Array.from(new Set(items.map((i) => i.stratum).filter(Boolean)));
  const census = f.popMode === "list" && f.censusAbove !== "" ? items.filter((i) => (i.value ?? -Infinity) >= Number(f.censusAbove)).length : 0;
  const calc = useMemo(() => {
    if (f.method !== "statistical") return null;
    try { const s = sampleSize({ confidence: f.confidence, tdr: f.tdr, edr: f.edr, population: N - census || null }); return { ...s, n: s.n + census }; } catch (e) { return { error: (e as Error).message }; }
  }, [f.method, f.confidence, f.tdr, f.edr, N, census]);
  const table = useMemo(() => [0.03, 0.05, 0.1].map((t) => ({ t, n: [0.9, 0.95, 0.99].map((c) => { try { return sampleSize({ confidence: c, tdr: t, edr: Math.min(f.edr, t / 2), population: N || null }).n; } catch { return null; } }) })), [f.edr, N]);
  const size = f.method === "statistical" ? (calc && "n" in calc ? calc.n : 0) : Math.min(N, Math.round(Number(f.size) || 0));
  const name = f.name || `${app.unitName(f.unitId)} ${templates.find((t) => t.id === f.templateId)?.name ?? "review"}, ${monthLabel(f.period)}`;
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const j = await api<{ plan: PlanView }>("/api/sampling", "POST", { ...f, name, templateId: f.templateId || null, population: f.popMode === "list" ? f.population : "", populationSize: N, censusAbove: f.censusAbove === "" ? null : Number(f.censusAbove), size: Number(f.size) });
      router.push(`/sampling/${j.plan.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const months = Array.from({ length: 13 }, (_, i) => { const x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); return x.toISOString().slice(0, 7) + "-01"; });
  return (
    <Sheet title="New sampling plan" sub="The selection is made and recorded when you create the plan." onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !size || !N} onClick={submit}><Icon name="check" />Select {size || ""} item{size === 1 ? "" : "s"}</button></>}>
      <div className="grid g2" style={{ gap: 12 }}>
        <Field label="Review (sampled template)"><select className="select" style={{ width: "100%" }} value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}><option value="">None (record the result by hand)</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label={app.settings.unitLabel}><select className="select" style={{ width: "100%" }} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Month covered"><select className="select" style={{ width: "100%" }} value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></Field>
        <Field label="Name"><input className="input" value={f.name} placeholder={name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </div>
      <div className="field"><span>Population</span>
        <Seg label="Population" value={f.popMode} onChange={(v) => setF({ ...f, popMode: v })} options={[{ value: "size", label: "I know its size" }, { value: "list", label: "Paste the list" }]} />
      </div>
      {f.popMode === "size"
        ? <Field label={`How many ${app.settings.itemLabel.toLowerCase()}s in the period?`} hint="Items are numbered 1 to N; match the numbers to your own list."><input className="input" inputMode="numeric" value={f.populationSize} onChange={(e) => setF({ ...f, populationSize: e.target.value.replace(/\D/g, "") })} /></Field>
        : <Field label="One item per line: id, then optionally stratum and value" hint={`${items.length.toLocaleString("en-US")} items${strata.length ? ` in ${strata.length} strata` : ""}. A header row is skipped.`}><textarea className="textarea" rows={5} value={f.population} onChange={(e) => setF({ ...f, population: e.target.value })} placeholder={"ACC-100231, Personal, 2500\nACC-100232, Business, 48000\n…"} /></Field>}
      <div className="field"><span>Method</span>
        <Seg label="Method" value={f.method} onChange={(v) => setF({ ...f, method: v })} options={[{ value: "statistical", label: "Statistical" }, { value: "judgmental", label: "Judgmental (fixed)" }]} />
      </div>
      {f.method === "statistical" ? (
        <>
          <div className="grid g3" style={{ gap: 12 }}>
            <div className="field"><span>Confidence</span><div className="chips static" role="group" aria-label="Confidence">{CONFIDENCES.map((c) => <button key={c} type="button" className="chip" aria-pressed={f.confidence === c} onClick={() => setF({ ...f, confidence: c })}>{Math.round(c * 100)}%</button>)}</div></div>
            <Field label="Tolerable deviation rate (%)"><input className="input" inputMode="decimal" value={Math.round(f.tdr * 1000) / 10} onChange={(e) => setF({ ...f, tdr: Math.max(0.001, Math.min(0.5, (Number(e.target.value) || 0) / 100)) })} /></Field>
            <Field label="Expected deviation rate (%)"><input className="input" inputMode="decimal" value={Math.round(f.edr * 1000) / 10} onChange={(e) => setF({ ...f, edr: Math.max(0, Math.min(0.49, (Number(e.target.value) || 0) / 100)) })} /></Field>
          </div>
          <div className="msg info" role="status" style={{ marginTop: 12 }}>
            {calc && "n" in calc ? <><strong style={{ fontSize: 16 }}>Sample of {calc.n}</strong> from {N.toLocaleString("en-US")} ({calc.basis}). {calc.note}{census ? ` Includes all ${census} items at or above ${f.censusAbove}.` : ""}</> : calc && "error" in calc ? calc.error : "Enter the population."}
          </div>
          <div className="tablewrap mt" tabIndex={0} role="region" aria-label="Sample sizes for other choices">
            <table className="t"><caption className="sr">Sample sizes</caption><thead><tr><th scope="col">Tolerable</th><th scope="col" className="num">90%</th><th scope="col" className="num">95%</th><th scope="col" className="num">99%</th></tr></thead>
              <tbody>{table.map((r) => <tr key={r.t}><th scope="row">{pc(r.t, 0)}</th>{r.n.map((n, i) => <td key={i} className="num" style={{ fontWeight: Math.abs([0.9, 0.95, 0.99][i] - f.confidence) < 1e-9 && Math.abs(r.t - f.tdr) < 1e-9 ? 800 : 400 }}>{n ?? "—"}</td>)}</tr>)}</tbody></table>
          </div>
        </>
      ) : <Field label="How many to test"><input className="input" inputMode="numeric" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value.replace(/\D/g, "") })} /></Field>}
      {f.popMode === "list" && (
        <div className="grid g2 mt" style={{ gap: 12, alignItems: "end" }}>
          <label className="toggle"><input type="checkbox" checked={f.stratify} disabled={!strata.length} onChange={(e) => setF({ ...f, stratify: e.target.checked })} />Stratify by the second column{strata.length ? ` (${strata.length})` : ""}</label>
          <Field label="Test every item valued at or above (optional)"><input className="input" inputMode="decimal" value={f.censusAbove} onChange={(e) => setF({ ...f, censusAbove: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="e.g. 50000" /></Field>
        </div>
      )}
      <Field label="Seed" hint="The selection is a function of the population and this text. Keep it, and anyone can reproduce the same items."><div className="row"><input className="input" value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} /><button type="button" className="btn" onClick={() => setF({ ...f, seed: randomSeed() })}><Icon name="repeat" />New</button></div></Field>
      <Msg kind="err">{err}</Msg>
    </Sheet>
  );
}

export function PlanDetail({ plan: p, population }: { plan: PlanView; population: PopItem[] }) {
  const app = useApp();
  const router = useRouter();
  const [check, setCheck] = useState<null | boolean>(null);
  const [dev, setDev] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const planner = can.buildTemplates(app.actor);
  const [tab, setTab] = useState<"selection" | "method">("selection");
  useEffect(() => setCheck(null), [p.id]);
  const recheck = () => {
    const pop = population.length ? population : Array.from({ length: p.populationSize }, (_, i) => ({ id: `ITEM-${String(i + 1).padStart(String(p.populationSize).length, "0")}` }));
    const again = select(pop, p.sampleSize, p.seed, { stratify: p.stratify, censusAbove: p.censusAbove });
    setCheck(JSON.stringify(again.items.map((i) => i.id)) === JSON.stringify(p.selection.map((i) => i.id)));
  };
  const start = async () => { setBusy(true); setErr(null); try { const j = await api<{ inspectionId: string }>(`/api/sampling/${p.id}`, "POST", { action: "start" }); router.push(`/inspect/${j.inspectionId}`); } catch (e) { setErr((e as Error).message); setBusy(false); } };
  const evaluate = async () => { setBusy(true); setErr(null); try { await api(`/api/sampling/${p.id}`, "POST", { action: "evaluate", deviations: Number(dev) }); router.refresh(); } catch (e) { setErr((e as Error).message); } setBusy(false); };
  const ev = p.evaluation;
  const preview = dev !== "" && Number.isFinite(Number(dev)) ? evalSample(p.sampleSize, Math.min(p.sampleSize, Math.max(0, Number(dev))), p.confidence ?? 0.95, p.tdr ?? 0.05, p.populationSize) : null;
  void upperLimit;
  return (
    <div>
      <div className="row wrap" style={{ marginBottom: 10 }}><Link href="/sampling" className="btn sm ghost"><Icon name="back" />Sampling</Link></div>
      <PageHead eyebrow={`${p.ref} · ${p.method === "statistical" ? "statistical attribute sampling" : "judgmental sample"}`} title={p.name}
        lede={`${p.unitName ?? "No site"}${p.period ? ` · ${monthLabel(p.period)}` : ""} · ${p.sampleSize} of ${p.populationSize.toLocaleString("en-US")} ${app.settings.itemLabel.toLowerCase()}s · created ${fmtDate(p.createdAt)} by ${p.createdBy}`}
        right={<>
          <a className="btn" href={`/api/sampling/${p.id}/export?format=xlsx`}><Icon name="download" />Excel</a>
          <a className="btn" href={`/api/sampling/${p.id}/export`}><Icon name="download" />CSV</a>
          {p.inspectionId ? <Link className="btn primary" href={`/inspect/${p.inspectionId}`}><Icon name="clipboard" />{p.inspectionRef}{p.inspectionStatus ? ` · ${p.inspectionStatus}` : ""}</Link>
            : p.templateId && can.inspect(app.actor) ? <button className="btn primary" disabled={busy} onClick={start}><Icon name="play" />Review the selected items</button> : null}
        </>} />
      <Msg kind="err">{err}</Msg>
      <div className="grid g-2-1">
        <div style={{ minWidth: 0 }}>
          {ev ? (
            <section className={`hero${ev.effective ? " navy" : ""}`} aria-label="Result" style={{ marginBottom: 16 }}>
              <div className="eyebrow">Result · {ev.source === "inspection" ? `from ${p.inspectionRef ?? "the review"}` : "entered"} · {fmtDateTime(ev.at)}</div>
              <div className="hero-big" style={{ fontSize: 44 }}>{ev.effective ? "Effective" : "Not effective"}</div>
              <div className="hero-sub">{ev.deviations} deviation{ev.deviations === 1 ? "" : "s"} in {ev.n} ({pc(ev.rate)}) · upper limit {pc(ev.upper)} at {pc(ev.confidence, 0)} confidence vs tolerable {pc(ev.tdr)}{ev.projected != null ? ` · about ${ev.projected.toLocaleString("en-US")} in the population` : ""}</div>
            </section>
          ) : null}
          {ev && <Card><p style={{ margin: 0 }}>{ev.conclusion}</p></Card>}
          <div className="mt" style={{ margin: "16px 0 12px" }}><Seg label="View" value={tab} onChange={setTab} options={[{ value: "selection", label: `Selected items (${p.selection.length})` }, { value: "method", label: "Method and evidence" }]} /></div>
          {tab === "selection" ? (
            <Card flush>
              <div className="tablewrap" tabIndex={0} role="region" aria-label="Selected items" style={{ maxHeight: 520, overflowY: "auto" }}>
                <table className="t"><caption className="sr">Selected items</caption><thead><tr><th scope="col" className="num">#</th><th scope="col">Item</th>{(p.stratify || p.censusAbove != null) && <th scope="col">Stratum</th>}{p.selection.some((s) => s.value != null) && <th scope="col" className="num">Value</th>}</tr></thead>
                  <tbody>{p.selection.map((s, i) => <tr key={s.id}><td className="num">{i + 1}</td><td style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}>{s.id}</td>{(p.stratify || p.censusAbove != null) && <td>{s.stratum}</td>}{p.selection.some((x) => x.value != null) && <td className="num">{s.value?.toLocaleString("en-US") ?? ""}</td>}</tr>)}</tbody></table>
              </div>
            </Card>
          ) : (
            <Card>
              <p style={{ marginTop: 0 }}>{p.method_text}</p>
              <dl className="kv">
                <dt>Seed</dt><dd><code>{p.seed}</code></dd>
                <dt>Population</dt><dd>{p.populationSize.toLocaleString("en-US")} {p.listed ? "listed items" : `numbered ITEM-1 to ITEM-${p.populationSize}`}</dd>
                <dt>Population SHA-256</dt><dd style={{ wordBreak: "break-all", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12 }}>{p.populationHash}</dd>
                {p.method === "statistical" && <><dt>Inputs</dt><dd>{pc(p.confidence, 0)} confidence · tolerable {pc(p.tdr)} · expected {pc(p.edr)}</dd></>}
                <dt>Allocation</dt><dd>{p.allocation.map((a) => `${a.stratum}: ${a.sample} of ${a.population}`).join(" · ")}</dd>
              </dl>
              <div className="row wrap mt">
                <button className="btn" onClick={recheck}><Icon name="repeat" />Re-run the selection here</button>
                {check !== null && <span className="pill" data-band={check ? "strong" : "escalate"} role="status">{check ? "Same items: the selection checks out" : "Different items: the plan doesn't match"}</span>}
              </div>
            </Card>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <Card title="Allocation">
            <ul className="list">{p.allocation.map((a) => <li key={a.stratum}><span className="grow"><strong>{a.stratum}</strong><span className="sub" style={{ display: "block", fontSize: 12.5 }}>{a.census ? "every item tested" : `${pc(a.population ? a.sample / a.population : 0)} of the stratum`}</span></span><span className="num" style={{ fontWeight: 700 }}>{a.sample} / {a.population}</span></li>)}</ul>
          </Card>
          {!ev && planner && (
            <Card className="mt" title="Record the result" sub={p.inspectionId ? "Approving the review records it automatically. Or enter it here." : "How many selected items had a deviation?"}>
              <Field label={`Deviations found (0 to ${p.sampleSize})`}><input className="input" inputMode="numeric" value={dev} onChange={(e) => setDev(e.target.value.replace(/\D/g, ""))} /></Field>
              {preview && <p className="sub" role="status">{preview.effective ? "Effective" : "Not effective"}: upper limit {pc(preview.upper)} vs tolerable {pc(preview.tdr)}.</p>}
              <button className="btn primary mt" disabled={busy || dev === ""} onClick={evaluate}><Icon name="check" />Record</button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
