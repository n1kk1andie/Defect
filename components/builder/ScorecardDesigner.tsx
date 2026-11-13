"use client";
// The scorecard designer. Each measure is entered monthly, computed from other
// measures (a weighted average, optionally rounded), or taken from approved
// inspections of a checklist. Choose the headline, the target and the columns
// the dashboards show, and check it all against sample data before publishing
// a locked version.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Field, Msg, fmtDateTime } from "@/components/ui";
import { Icon } from "@/components/icons";
import { evaluate, validateDefinition, type Measure, type ScorecardDef } from "@/lib/scorecard";
import type { ScorecardView } from "@/lib/scorecards/store";
import { can } from "@/lib/roles";

const KIND_LABEL: Record<Measure["kind"], string> = { input: "Entered monthly", computed: "Computed from other measures", inspection: "From a checklist's inspections" };
const keyOf = (label: string, taken: Set<string>) => {
  let k = label.replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("").slice(0, 30) || "measure";
  if (!/^[a-zA-Z]/.test(k)) k = "m" + k;
  let out = k, n = 2; while (taken.has(out)) out = `${k}${n++}`;
  return out;
};
function rng(seed: number) { let a = seed >>> 0; return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function ScorecardDesigner({ scorecard, templates }: { scorecard: ScorecardView; templates: { id: string; name: string }[] }) {
  const app = useApp();
  const router = useRouter();
  const editable = can.manage(app.actor);
  const [def, setDef] = useState<ScorecardDef>(scorecard.draft);
  const [meta, setMeta] = useState(scorecard);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [seed, setSeed] = useState(7);
  const [open, setOpen] = useState<string | null>(null);
  const first = useRef(true);
  const valid = useMemo(() => validateDefinition(def), [def]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!editable) return;
    if (!valid.ok) { setSave("error"); setErr(valid.error); return; }
    setErr(null); setSave("saving");
    const t = setTimeout(async () => {
      try { const j = await api<{ scorecard: ScorecardView }>(`/api/scorecards/${scorecard.id}`, "PUT", { draft: def }); setMeta(j.scorecard); setSave("saved"); }
      catch (e) { setSave("error"); setErr((e as Error).message); }
    }, 800);
    return () => clearTimeout(t);
  }, [def, editable, scorecard.id, valid]);

  const upd = (fn: (d: ScorecardDef) => ScorecardDef) => setDef((d) => fn(structuredClone(d)));
  const updM = (i: number, p: Partial<Measure>) => upd((d) => { d.measures[i] = { ...d.measures[i], ...p }; return d; });
  const keys = new Set(def.measures.map((m) => m.key));
  const label = (k: string) => (k === "@audit" ? "Audit grade points" : def.measures.find((m) => m.key === k)?.label ?? k);
  const addMeasure = (kind: Measure["kind"]) => upd((d) => {
    const k = keyOf(kind === "computed" ? "Subtotal" : "New measure", keys);
    const m: Measure = kind === "computed" ? { key: k, label: "Subtotal", kind, of: d.measures.filter((x) => x.kind !== "computed").slice(0, 2).map((x) => x.key) } : kind === "inspection" ? { key: k, label: templates[0]?.name ?? "Checklist score", kind, source: { templateId: templates[0]?.id ?? "", metric: "score" } } : { key: k, label: "New measure", kind, group: "Measures" };
    if (kind === "computed" && !m.of!.length) m.of = [d.measures[0]?.key].filter(Boolean) as string[];
    // Insert before the headline so the headline can still use it.
    const at = d.measures.findIndex((x) => x.key === d.overall);
    d.measures.splice(at >= 0 ? at : d.measures.length, 0, m);
    setOpen(k);
    return d;
  });
  const del = (i: number) => upd((d) => {
    const k = d.measures[i].key;
    if (k === d.overall) return d;
    d.measures.splice(i, 1);
    for (const m of d.measures) if (m.of) { const idx = m.of.indexOf(k); if (idx >= 0) { m.of.splice(idx, 1); m.weights?.splice(idx, 1); } }
    d.columns = d.columns.filter((c) => c.key !== k);
    return d;
  });
  const moveM = (i: number, dir: -1 | 1) => upd((d) => { const [m] = d.measures.splice(i, 1); d.measures.splice(i + dir, 0, m); return d; });

  // Preview: four sample sites with entered values drawn around the target.
  const sample = useMemo(() => {
    const r = rng(seed);
    return ["Site A", "Site B", "Site C", "Site D"].map((name, si) => {
      const inputs: Record<string, number> = {};
      for (const m of def.measures) if (m.kind !== "computed") inputs[m.key] = Math.round(Math.max(40, Math.min(100, def.target + 8 - si * 4 + (r() - 0.5) * 14)) * 10) / 10;
      const grade = def.audit ? [100, 80, 60, 40][Math.min(3, Math.floor(r() * 4))] : null;
      return { name, vals: valid.ok ? evaluate(def, inputs, grade) : {}, grade };
    });
  }, [def, seed, valid]);
  const tone = (v: number | null | undefined) => (v == null ? "none" : v >= def.target + 5 ? "worldClass" : v >= def.target ? "strong" : v >= def.target - 5 ? "watch" : v >= def.target - 10 ? "attention" : "escalate");

  const publish = async (activate: boolean) => {
    setErr(null);
    try { await api(`/api/scorecards/${scorecard.id}`, "PUT", { draft: def }); const j = await api<{ scorecard: ScorecardView }>(`/api/scorecards/${scorecard.id}`, "POST", { action: "publish", activate }); setMeta(j.scorecard); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
  };
  const activate = async () => { try { const j = await api<{ scorecard: ScorecardView }>(`/api/scorecards/${scorecard.id}`, "POST", { action: "activate" }); setMeta(j.scorecard); router.refresh(); } catch (e) { setErr((e as Error).message); } };

  return (
    <div>
      <div className="btop">
        <Link href="/scorecards" className="btn sm ghost"><Icon name="back" />Scorecards</Link>
        <span className={`status ${!meta.version ? "st-draft" : meta.dirty ? "st-submitted" : "st-published"}`}>{!meta.version ? "Draft" : meta.dirty ? `v${meta.version} · changes not published` : `Published · v${meta.version}`}</span>
        {meta.active && <span className="pill sm" data-band="strong">On the dashboards</span>}
        {editable && <span className="saved" role="status" aria-live="polite">{save === "saving" ? "Saving…" : save === "saved" ? "Draft saved" : save === "error" ? "Not saved" : "Changes save automatically"}</span>}
        <span className="grow" />
        {editable && meta.version > 0 && !meta.active && !meta.dirty && <button className="btn sm" onClick={activate}><Icon name="pulse" />Show on the dashboards</button>}
        {editable && <button className="btn sm" disabled={!valid.ok || (meta.version > 0 && !meta.dirty)} onClick={() => publish(false)}>Publish v{meta.version + 1}</button>}
        {editable && <button className="btn sm primary" disabled={!valid.ok || (meta.version > 0 && !meta.dirty && meta.active)} onClick={() => publish(true)}><Icon name="send" />Publish and show</button>}
      </div>
      <Msg kind="err">{err}</Msg>
      <div className="grid g-2-1 mt">
        <div style={{ minWidth: 0 }}>
          <Card>
            <div className="grid g3" style={{ gap: 12 }}>
              <Field label="Scorecard name"><input className="input" readOnly={!editable} value={def.name} onChange={(e) => upd((d) => ({ ...d, name: e.target.value }))} /></Field>
              <Field label="Target (0–100)"><input className="input" inputMode="numeric" readOnly={!editable} value={def.target} onChange={(e) => upd((d) => ({ ...d, target: Math.max(1, Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0)) }))} /></Field>
              <Field label="Headline measure"><select className="select" style={{ width: "100%" }} disabled={!editable} value={def.overall} onChange={(e) => upd((d) => ({ ...d, overall: e.target.value, columns: [{ key: e.target.value, label: label(e.target.value) }, ...d.columns.filter((c) => c.key !== e.target.value)] }))}>{def.measures.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></Field>
            </div>
            <label className="toggle mt"><input type="checkbox" disabled={!editable} checked={def.audit} onChange={(e) => upd((d) => ({ ...d, audit: e.target.checked }))} />Record an audit grade each month (A 100 · B+ 80 · B 60 · C 40 · D 20), usable in computed measures</label>
          </Card>

          <section className="bsec mt2" aria-label="Measures">
            <div className="bsec-h"><h2 className="grow" style={{ fontSize: 16 }}>Measures</h2><span className="sub">{def.measures.length} · computed ones come after what they use</span></div>
            {def.measures.map((m, i) => {
              const isOpen = open === m.key;
              const earlier = def.measures.slice(0, i);
              return (
                <div key={m.key}>
                  <div className={`bq${isOpen ? " sel" : ""}`}>
                    <span className="grip" aria-hidden="true"><Icon name={m.kind === "computed" ? "sliders" : m.kind === "inspection" ? "clipboard" : "hash"} /></span>
                    <button type="button" className="bq-main" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.key)}>
                      <div className="bq-l">{m.label}{m.key === def.overall && <span className="pill sm" data-band="strong" style={{ marginLeft: 8 }}>Headline</span>}</div>
                      <div className="bq-tags">
                        <span className="tag">{KIND_LABEL[m.kind]}</span>
                        {m.kind === "computed" && <span className="tag logic">average of {(m.of || []).map((k, j) => `${label(k)}${m.weights ? ` ×${m.weights[j]}` : ""}`).join(", ")}</span>}
                        {m.kind === "inspection" && <span className="tag logic">{templates.find((t) => t.id === m.source?.templateId)?.name ?? "choose a checklist"} · {m.source?.metric === "passRate" ? "pass rate" : m.source?.metric === "compliance" ? "compliance" : "average score"}</span>}
                        {m.round && <span className="tag">rounded</span>}
                        {def.columns.some((c) => c.key === m.key) && <span className="tag">dashboard column</span>}
                      </div>
                    </button>
                    {editable && <div className="bq-tools">
                      <button className="iconbtn sm" disabled={i === 0} onClick={() => moveM(i, -1)} aria-label={`Move ${m.label} up`}><Icon name="up" /></button>
                      <button className="iconbtn sm" disabled={i === def.measures.length - 1} onClick={() => moveM(i, 1)} aria-label={`Move ${m.label} down`}><Icon name="down" /></button>
                      <button className="iconbtn sm" disabled={m.key === def.overall} onClick={() => del(i)} aria-label={`Delete ${m.label}`}><Icon name="trash" /></button>
                    </div>}
                  </div>
                  {isOpen && (
                    <fieldset className="bq-edit" disabled={!editable} style={{ border: 0, margin: 0, minWidth: 0 }}>
                      <legend className="sr">Edit {m.label}</legend>
                      <Field label="Name"><input className="input" value={m.label} onChange={(e) => { updM(i, { label: e.target.value }); upd((d) => { d.columns = d.columns.map((c) => (c.key === m.key ? { ...c, label: e.target.value } : c)); return d; }); }} /></Field>
                      <Field label="Kind"><select className="select" style={{ width: "100%" }} value={m.kind} onChange={(e) => { const k = e.target.value as Measure["kind"]; updM(i, k === "computed" ? { kind: k, of: earlier.slice(0, 2).map((x) => x.key), source: undefined } : k === "inspection" ? { kind: k, source: { templateId: templates[0]?.id ?? "", metric: "score" }, of: undefined, weights: undefined } : { kind: k, of: undefined, weights: undefined, source: undefined }); }}>
                        <option value="input">{KIND_LABEL.input}</option><option value="computed">{KIND_LABEL.computed}</option><option value="inspection">{KIND_LABEL.inspection}</option></select></Field>
                      {m.kind !== "computed" && <Field label="Group (on the entry form)"><input className="input" value={m.group ?? ""} onChange={(e) => updM(i, { group: e.target.value || undefined })} /></Field>}
                      {m.kind === "inspection" && <>
                        <Field label="Checklist"><select className="select" style={{ width: "100%" }} value={m.source?.templateId ?? ""} onChange={(e) => updM(i, { source: { templateId: e.target.value, metric: m.source?.metric ?? "score" } })}><option value="">Choose…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
                        <Field label="Result to use"><select className="select" style={{ width: "100%" }} value={m.source?.metric ?? "score"} onChange={(e) => updM(i, { source: { templateId: m.source?.templateId ?? "", metric: e.target.value as "score" } })}><option value="score">Average inspection score</option><option value="passRate">% of inspections passed</option><option value="compliance">Compliance (100 − deviation rate)</option></select></Field>
                      </>}
                      {m.kind === "computed" && (
                        <div className="field full"><span>Average of (with weights)</span>
                          {[...earlier.map((x) => x.key), ...(def.audit ? ["@audit"] : [])].map((k) => {
                            const at = (m.of || []).indexOf(k);
                            const on = at >= 0;
                            return (
                              <div key={k} className="row" style={{ gap: 10, minHeight: 40 }}>
                                <label className="toggle grow"><input type="checkbox" checked={on} onChange={(e) => {
                                  const of = [...(m.of || [])], w = m.weights ? [...m.weights] : undefined;
                                  if (e.target.checked) { of.push(k); w?.push(1); } else { of.splice(at, 1); w?.splice(at, 1); }
                                  updM(i, { of, weights: w });
                                }} />{label(k)}</label>
                                {on && <label className="row" style={{ gap: 6 }}><span className="sub">weight</span><input className="input" style={{ width: 70, minHeight: 36 }} inputMode="decimal" value={m.weights?.[at] ?? 1} onChange={(e) => { const w = m.weights ? [...m.weights] : (m.of || []).map(() => 1); w[at] = Math.max(0, Number(e.target.value) || 0); updM(i, { weights: w }); }} aria-label={`Weight of ${label(k)}`} /></label>}
                              </div>
                            );
                          })}
                          {!earlier.length && <small className="sub">Move this measure below the ones it averages.</small>}
                          <label className="toggle mt"><input type="checkbox" checked={!!m.round} onChange={(e) => updM(i, { round: e.target.checked || undefined })} />Round to a whole number before it feeds anything else</label>
                        </div>
                      )}
                      <label className="toggle full"><input type="checkbox" checked={def.columns.some((c) => c.key === m.key)} disabled={m.key === def.overall} onChange={(e) => upd((d) => { d.columns = e.target.checked ? [...d.columns, { key: m.key, label: m.label }] : d.columns.filter((c) => c.key !== m.key); return d; })} />Show as a column on the dashboards</label>
                    </fieldset>
                  )}
                </div>
              );
            })}
            {editable && <div className="addbar"><span className="sub" style={{ alignSelf: "center" }}>Add</span>
              <button className="btn sm" onClick={() => addMeasure("input")}><Icon name="hash" />Entered measure</button>
              <button className="btn sm" onClick={() => addMeasure("inspection")} disabled={!templates.length}><Icon name="clipboard" />From a checklist</button>
              <button className="btn sm" onClick={() => addMeasure("computed")}><Icon name="sliders" />Computed measure</button>
            </div>}
          </section>
        </div>

        <div style={{ minWidth: 0 }}>
          <Card title="Preview with sample data" sub={`Four made-up sites, entered values around the target of ${def.target}`} actions={<button className="btn sm" onClick={() => setSeed((x) => x + 1)}><Icon name="repeat" />New sample</button>}>
            {valid.ok ? (
              <div className="tablewrap" tabIndex={0} role="region" aria-label="Sample scorecard">
                <table className="t">
                  <thead><tr><th scope="col">Site</th>{def.columns.map((c) => <th key={c.key} scope="col" className="num">{c.label}</th>)}</tr></thead>
                  <tbody>{sample.map((r) => <tr key={r.name}><th scope="row" style={{ fontWeight: 600 }}>{r.name}</th>{def.columns.map((c) => { const v = r.vals[c.key]; return <td key={c.key} className="num"><span className="pill" data-band={tone(v)}>{v == null ? "—" : v.toFixed(1)}</span></td>; })}</tr>)}</tbody>
                </table>
              </div>
            ) : <Msg kind="err">{valid.error}</Msg>}
            <p className="sub" style={{ fontSize: 12.5, marginBottom: 0 }}>Colours: at or above the target is Strong; five or more above is World class; below the target, Watch, Attention, then Escalate.</p>
          </Card>
          <Card className="mt" title="Versions" sub="Monthly entries keep the values they were scored with.">
            {meta.versions.length ? <ul className="list">{meta.versions.map((v) => <li key={v.version}><span className="rank" aria-hidden="true">{v.version}</span><span className="grow">Version {v.version}<span className="sub"> · {fmtDateTime(v.publishedAt)} · {v.publishedBy}</span></span></li>)}</ul> : <p className="sub" style={{ margin: 0 }}>Not published yet.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
