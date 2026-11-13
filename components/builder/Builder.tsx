"use client";
// The template builder. Sections and questions on the left, each question
// edited in place; a live phone preview on the right shows exactly what the
// inspector will see, logic included. Drag a question (desktop) or use the
// move buttons (phone and keyboard). The draft saves itself; publishing
// freezes it as the next locked version.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Field, Msg, Sheet, fmtDateTime } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { InspectionForm, type FormState } from "@/components/inspect/Form";
import { statusOf } from "@/components/screens/Templates";
import { QUESTION_TYPES, SECTORS, SECTOR_INFO, TYPE_INFO, newQuestion, newSection, uid, type Option, type QType, type Question, type Section, type TemplateDef } from "@/lib/templates/model";
import type { TemplateDetail } from "@/lib/templates/store";
import { can } from "@/lib/roles";

const TYPE_ICON: Record<QType, IconName> = { yesno: "toggle", passfail: "check", rating: "star", number: "hash", choice: "list", multi: "checks", text: "text", date: "calendar", photo: "camera", signature: "pen", reference: "file" };

type Pos = { s: number; q: number };

export function Builder({ template }: { template: TemplateDetail }) {
  const app = useApp();
  const router = useRouter();
  const editable = can.buildTemplates(app.actor) && template.status !== "archived";
  const [def, setDef] = useState<TemplateDef>(template.draft);
  const [meta, setMeta] = useState(template);
  const [sel, setSel] = useState<string | null>(null);
  const [save, setSave] = useState<"saved" | "saving" | "error" | "idle">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [drag, setDrag] = useState<Pos | null>(null);
  const [over, setOver] = useState<Pos | null>(null);
  const [form, setForm] = useState<FormState>({ answers: {}, items: def.sections.some((s) => s.perItem) ? [{ ref: "", answers: {} }] : [] });
  const first = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autosave the draft a moment after each change.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!editable) return;
    setSave("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const j = await api<{ template: TemplateDetail }>(`/api/templates/${template.id}`, "PUT", { draft: def }); setMeta(j.template); setSave("saved"); setErr(null); }
      catch (e) { setSave("error"); setErr((e as Error).message); }
    }, 900);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [def, editable, template.id]);
  useEffect(() => { if (def.sections.some((s) => s.perItem) && !form.items.length) setForm((f) => ({ ...f, items: [{ ref: "", answers: {} }] })); }, [def, form.items.length]);

  const upd = useCallback((fn: (d: TemplateDef) => TemplateDef) => setDef((d) => fn(structuredClone(d))), []);
  const updQ = (s: number, q: number, p: Partial<Question>) => upd((d) => { d.sections[s].questions[q] = { ...d.sections[s].questions[q], ...p }; return d; });
  const updS = (s: number, p: Partial<Section>) => upd((d) => { d.sections[s] = { ...d.sections[s], ...p }; return d; });
  const move = (from: Pos, to: Pos) => upd((d) => {
    const [q] = d.sections[from.s].questions.splice(from.q, 1);
    const target = d.sections[to.s].questions;
    let at = to.q; if (from.s === to.s && from.q < to.q) at--;
    target.splice(Math.max(0, Math.min(at, target.length)), 0, q);
    // A condition can only point at an earlier question in the same section.
    for (const sec of d.sections) sec.questions.forEach((x, i) => { if (x.showIf && !sec.questions.slice(0, i).some((y) => y.id === x.showIf!.q)) delete x.showIf; });
    if (!d.sections[from.s].questions.length) d.sections[from.s].questions.push(newQuestion("yesno", "New question"));
    return d;
  });
  const add = (s: number, type: QType) => { const q = newQuestion(type, ""); upd((d) => { d.sections[s].questions.push(q); return d; }); setSel(q.id); };
  const dup = (s: number, q: number) => upd((d) => { const c = structuredClone(d.sections[s].questions[q]); c.id = uid(); delete c.showIf; d.sections[s].questions.splice(q + 1, 0, c); return d; });
  const del = (s: number, q: number) => upd((d) => {
    const gone = d.sections[s].questions[q].id;
    d.sections[s].questions.splice(q, 1);
    for (const x of d.sections[s].questions) if (x.showIf?.q === gone) delete x.showIf;
    if (!d.sections[s].questions.length) d.sections[s].questions.push(newQuestion("yesno", "New question"));
    return d;
  });

  const totals = useMemo(() => ({ q: def.sections.reduce((t, s) => t + s.questions.length, 0), crit: def.sections.reduce((t, s) => t + s.questions.filter((x) => x.critical).length, 0), weight: def.sections.reduce((t, s) => t + s.questions.reduce((w, x) => w + x.weight, 0), 0) }), [def]);
  const st = statusOf(meta);
  const perItem = def.sections.some((s) => s.perItem);

  const act = async (path: string, body: unknown, after?: (t: TemplateDetail) => void) => {
    setErr(null);
    try { const j = await api<{ template: TemplateDetail }>(path, "POST", body); setMeta(j.template); after?.(j.template); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <div>
      <div className="btop">
        <Link href="/templates" className="btn sm ghost"><Icon name="back" />Templates</Link>
        <span className={`status ${st.cls}`}>{st.label}</span>
        {editable && <span className="saved" role="status" aria-live="polite">{save === "saving" ? "Saving…" : save === "saved" ? <><Icon name="check" width={14} height={14} />Draft saved</> : save === "error" ? "Not saved" : "Changes save automatically"}</span>}
        <span className="grow" />
        <button className="btn sm hide-wide" onClick={() => setShowPreview(true)}><Icon name="eye" />Preview</button>
        <a className="btn sm" href={`/api/templates/${template.id}/export?format=xlsx`}><Icon name="download" />Excel</a>
        <a className="btn sm" href={`/api/templates/${template.id}/export`}><Icon name="download" />JSON</a>
        {can.buildTemplates(app.actor) && <button className="btn sm" onClick={async () => { try { const j = await api<{ template: TemplateDetail }>("/api/templates", "POST", { from: "copy", copyOf: template.id }); router.push(`/templates/${j.template.id}`); } catch (e) { setErr((e as Error).message); } }}><Icon name="copy" />Duplicate</button>}
        {can.buildTemplates(app.actor) && meta.version > 0 && <button className="btn sm" onClick={() => act(`/api/templates/${template.id}/archive`, { archived: meta.status !== "archived" })}><Icon name="lock" />{meta.status === "archived" ? "Restore" : "Archive"}</button>}
        {editable && <button className="btn sm primary" disabled={save === "saving" || (meta.version > 0 && !meta.dirty)} onClick={() => setPublishing(true)}><Icon name="send" />Publish{meta.version ? ` v${meta.version + 1}` : ""}</button>}
      </div>
      <Msg kind="err">{err}</Msg>
      {!editable && <Msg kind="info">{meta.status === "archived" ? "This template is archived. Restore it to edit or use it." : "You can view this template. Supervisors and admins edit templates."}</Msg>}
      {meta.binding && <Msg kind="info">{meta.binding.kind === "defects" ? `This template feeds the ${app.settings.unitLabel} Defects register: each pass/fail check is a possible instance, and each failure a defect.` : "This template feeds the scorecard: each approved entry becomes the month's scorecard for the site."}</Msg>}

      <div className="builder mt">
        <nav className="outline" aria-label="Sections">
          <div className="eyebrow" style={{ padding: "0 10px 8px" }}>Sections</div>
          {def.sections.map((s, i) => <a key={s.id} href={`#bs-${s.id}`}><span className="n">{i + 1}</span><span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.title}</span><span className="sub" style={{ fontSize: 12 }}>{s.questions.length}</span></a>)}
          <div className="sub" style={{ padding: "12px 10px", fontSize: 12.5 }}>{totals.q} questions · {totals.crit} critical · total weight {totals.weight}</div>
        </nav>

        <div style={{ minWidth: 0 }}>
          <Card>
            <div className="grid g2" style={{ gap: 12 }}>
              <Field label="Template name"><input className="input" value={def.name} readOnly={!editable} onChange={(e) => upd((d) => ({ ...d, name: e.target.value }))} /></Field>
              <Field label="Category"><input className="input" value={def.category} readOnly={!editable} onChange={(e) => upd((d) => ({ ...d, category: e.target.value }))} placeholder="Inspection, File review, Safety…" /></Field>
            </div>
            <Field label="Description"><textarea className="textarea" style={{ minHeight: 64 }} value={def.description} readOnly={!editable} onChange={(e) => upd((d) => ({ ...d, description: e.target.value }))} placeholder="What this checks, and when to use it" /></Field>
            <div className="grid g4 mt" style={{ gap: 12 }}>
              <Field label="Sector"><select className="select" style={{ width: "100%" }} disabled={!editable} value={def.sector} onChange={(e) => upd((d) => ({ ...d, sector: e.target.value as TemplateDef["sector"] }))}>{SECTORS.map((s) => <option key={s} value={s}>{SECTOR_INFO[s].label}</option>)}</select></Field>
              <Field label="Pass mark (%)"><input className="input" inputMode="numeric" readOnly={!editable} value={def.scoring.passMark} onChange={(e) => upd((d) => ({ ...d, scoring: { ...d.scoring, passMark: Math.max(0, Math.min(100, Number(e.target.value.replace(/\D/g, "")) || 0)) } }))} /></Field>
              <Field label="A critical failure"><select className="select" style={{ width: "100%" }} disabled={!editable} value={def.scoring.critical} onChange={(e) => upd((d) => ({ ...d, scoring: { ...d.scoring, critical: e.target.value as "fail" | "zero" } }))}><option value="fail">Fails the inspection</option><option value="zero">Fails it and scores 0</option></select></Field>
              <Field label={perItem ? "Sampled item is a" : "Sampled item"}><input className="input" readOnly={!editable || !perItem} value={perItem ? def.sampling?.itemLabel ?? "Item" : "—"} onChange={(e) => upd((d) => ({ ...d, sampling: { itemLabel: e.target.value || "Item", min: d.sampling?.min ?? 1, max: d.sampling?.max ?? 200 } }))} /></Field>
            </div>
            <div className="row wrap mt" style={{ gap: 18 }}>
              <label className="toggle"><input type="checkbox" disabled={!editable} checked={def.checkin} onChange={(e) => upd((d) => ({ ...d, checkin: e.target.checked }))} />Check in at the site</label>
              <label className="toggle"><input type="checkbox" disabled={!editable} checked={def.signatures.inspector} onChange={(e) => upd((d) => ({ ...d, signatures: { ...d.signatures, inspector: e.target.checked } }))} />Inspector signs</label>
              <label className="toggle"><input type="checkbox" disabled={!editable} checked={def.signatures.site} onChange={(e) => upd((d) => ({ ...d, signatures: { ...d.signatures, site: e.target.checked } }))} />{app.settings.unitLabel} manager signs</label>
            </div>
          </Card>

          {def.sections.map((s, si) => (
            <section key={s.id} id={`bs-${s.id}`} className="bsec mt2" aria-label={`Section ${si + 1}: ${s.title}`}>
              <div className="bsec-h">
                <span className="isec-n" aria-hidden="true">{si + 1}</span>
                <input className="input grow" aria-label={`Section ${si + 1} title`} readOnly={!editable} value={s.title} onChange={(e) => updS(si, { title: e.target.value })} />
                {editable && <>
                  <button className="iconbtn sm" disabled={si === 0} onClick={() => upd((d) => { const [x] = d.sections.splice(si, 1); d.sections.splice(si - 1, 0, x); return d; })} aria-label={`Move section ${si + 1} up`}><Icon name="up" /></button>
                  <button className="iconbtn sm" disabled={si === def.sections.length - 1} onClick={() => upd((d) => { const [x] = d.sections.splice(si, 1); d.sections.splice(si + 1, 0, x); return d; })} aria-label={`Move section ${si + 1} down`}><Icon name="down" /></button>
                  <button className="iconbtn sm" disabled={def.sections.length === 1} onClick={() => { if (confirm(`Delete “${s.title}” and its ${s.questions.length} questions?`)) upd((d) => { d.sections.splice(si, 1); return d; }); }} aria-label={`Delete section ${si + 1}`}><Icon name="trash" /></button>
                </>}
              </div>
              <div className="row wrap" style={{ padding: "8px 16px", gap: 18, borderBottom: "1px solid var(--line)" }}>
                <label className="toggle"><input type="checkbox" disabled={!editable} checked={!!s.perItem} onChange={(e) => upd((d) => { d.sections[si].perItem = e.target.checked || undefined; if (e.target.checked && !d.sampling) d.sampling = { itemLabel: SECTOR_INFO[d.sector].item, min: 1, max: 200 }; return d; })} />Repeat for each sampled {(def.sampling?.itemLabel ?? "item").toLowerCase()} (file, chart, record)</label>
              </div>
              <div onDragOver={(e) => { if (drag) { e.preventDefault(); if (!s.questions.length) setOver({ s: si, q: 0 }); } }}>
                {s.questions.map((q, qi) => (
                  <QuestionRow key={q.id} def={def} s={si} qi={qi} q={q} section={s} editable={editable} open={sel === q.id}
                    dragging={drag?.s === si && drag.q === qi} over={over?.s === si && over.q === qi}
                    onSelect={() => setSel(sel === q.id ? null : q.id)}
                    onDragStart={() => setDrag({ s: si, q: qi })} onDragEnd={() => { setDrag(null); setOver(null); }}
                    onDragOver={() => setOver({ s: si, q: qi })} onDrop={() => { if (drag) move(drag, { s: si, q: qi }); setDrag(null); setOver(null); }}
                    onChange={(p) => updQ(si, qi, p)} onUp={() => qi > 0 ? move({ s: si, q: qi }, { s: si, q: qi - 1 }) : si > 0 && move({ s: si, q: qi }, { s: si - 1, q: def.sections[si - 1].questions.length })}
                    onDown={() => qi < s.questions.length - 1 ? move({ s: si, q: qi }, { s: si, q: qi + 2 }) : si < def.sections.length - 1 && move({ s: si, q: qi }, { s: si + 1, q: 0 })}
                    onDup={() => dup(si, qi)} onDel={() => del(si, qi)} first={si === 0 && qi === 0} last={si === def.sections.length - 1 && qi === s.questions.length - 1} />
                ))}
              </div>
              {editable && (
                <div className="addbar" role="group" aria-label={`Add a question to ${s.title}`}>
                  <span className="sub" style={{ alignSelf: "center", marginRight: 4 }}>Add</span>
                  {(["yesno", "passfail", "rating", "number", "choice", "multi", "text", "photo", "signature", "reference", "date"] as QType[]).map((t) => (
                    <button key={t} type="button" className="btn sm" onClick={() => add(si, t)}><Icon name={TYPE_ICON[t]} />{TYPE_INFO[t].label}</button>
                  ))}
                </div>
              )}
            </section>
          ))}
          {editable && <button className="btn iadd mt" onClick={() => upd((d) => { d.sections.push(newSection(`Section ${d.sections.length + 1}`)); return d; })}><Icon name="plus" />Add a section</button>}

          <Card className="mt2" title="Versions" sub="Each published version is locked. Inspections keep the version they were started on.">
            {meta.versions.length ? (
              <ul className="list">{meta.versions.map((v) => (
                <li key={v.version}><span className="rank" aria-hidden="true">{v.version}</span><span className="grow"><strong>Version {v.version}</strong><span className="sub"> · {fmtDateTime(v.publishedAt)} · {v.publishedBy}{v.note ? ` · ${v.note}` : ""}</span></span>
                  <a className="btn sm ghost" href={`/api/templates/${template.id}/export?version=${v.version}&format=xlsx`} aria-label={`Download version ${v.version} as Excel`}><Icon name="download" /></a></li>
              ))}</ul>
            ) : <p className="sub" style={{ margin: 0 }}>Not published yet. Publish to let inspectors use it.</p>}
          </Card>
        </div>

        <aside className={`previewpane${showPreview ? " show" : ""}`} aria-label="Live preview" onClick={(e) => { if (e.target === e.currentTarget) setShowPreview(false); }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="eyebrow" style={showPreview ? { color: "#fff" } : undefined}>Live preview · what the inspector sees</span>
            {showPreview && <button className="iconbtn" onClick={() => setShowPreview(false)} aria-label="Close the preview"><Icon name="close" /></button>}
          </div>
          <div className="phone"><div className="phone-in">
            <div style={{ marginBottom: 12 }}><div className="eyebrow">{def.category}</div><div className="h2" style={{ fontSize: 17, marginTop: 2 }}>{def.name || "Untitled"}</div></div>
            <InspectionForm def={def} state={form} onChange={setForm} preview highlight={sel} />
          </div></div>
          <button className="btn sm ghost mt" onClick={() => setForm({ answers: {}, items: perItem ? [{ ref: "", answers: {} }] : [] })} style={showPreview ? { color: "#fff" } : undefined}><Icon name="repeat" />Clear the preview answers</button>
        </aside>
      </div>

      {publishing && <PublishSheet t={meta} def={def} onClose={() => setPublishing(false)} onDone={(t) => { setMeta(t); setPublishing(false); router.refresh(); }} />}
    </div>
  );
}

function QuestionRow({ def, s, qi, q, section, editable, open, dragging, over, onSelect, onDragStart, onDragEnd, onDragOver, onDrop, onChange, onUp, onDown, onDup, onDel, first, last }: {
  def: TemplateDef; s: number; qi: number; q: Question; section: Section; editable: boolean; open: boolean; dragging: boolean; over: boolean;
  onSelect: () => void; onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDrop: () => void; onChange: (p: Partial<Question>) => void;
  onUp: () => void; onDown: () => void; onDup: () => void; onDel: () => void; first: boolean; last: boolean;
}) {
  const scorable = TYPE_INFO[q.type].scorable;
  const earlier = section.questions.slice(0, qi).filter((x) => TYPE_INFO[x.type].scorable || x.type === "text" || x.type === "reference");
  const target = q.showIf ? section.questions.find((x) => x.id === q.showIf!.q) : null;
  const setType = (t: QType) => { const fresh = newQuestion(t, q.label); onChange({ type: t, options: fresh.options, scale: fresh.scale, range: fresh.range, weight: TYPE_INFO[t].scorable ? (q.weight || 1) : 0, critical: TYPE_INFO[t].scorable && q.critical, allowNA: fresh.allowNA, required: fresh.required }); };
  const opts = q.options || [];
  const setOpt = (i: number, p: Partial<Option>) => onChange({ options: opts.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  return (
    <>
      <div className={`bq${dragging ? " drag" : ""}${over ? " over" : ""}${open ? " sel" : ""}`}
        onDragOver={(e) => { e.preventDefault(); onDragOver(); }} onDrop={(e) => { e.preventDefault(); onDrop(); }}>
        {editable ? <span className="grip" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", q.id); onDragStart(); }} onDragEnd={onDragEnd} title="Drag to reorder" aria-hidden="true"><Icon name="grip" /></span> : <span className="grip" aria-hidden="true" />}
        <button type="button" className="bq-main" aria-expanded={open} onClick={onSelect}>
          <div className={`bq-l${q.label ? "" : " empty"}`}>{q.label || "Write the question"}</div>
          <div className="bq-tags">
            <span className="tag"><Icon name={TYPE_ICON[q.type]} width={12} height={12} />{TYPE_INFO[q.type].label}</span>
            {scorable && <span className="tag">weight {q.weight}</span>}
            {q.critical && <span className="tag crit">Critical</span>}
            {q.showIf && <span className="tag logic">Logic</span>}
            {q.photoOnFail && <span className="tag">Photo if failed</span>}
            {q.action?.auto && <span className="tag">Action if failed</span>}
            {q.reference && <span className="tag">{q.reference}</span>}
          </div>
        </button>
        {editable && (
          <div className="bq-tools">
            <button className="iconbtn sm" disabled={first} onClick={onUp} aria-label={`Move “${q.label || "question"}” up`}><Icon name="up" /></button>
            <button className="iconbtn sm" disabled={last} onClick={onDown} aria-label={`Move “${q.label || "question"}” down`}><Icon name="down" /></button>
            <button className="iconbtn sm hide-sm" onClick={onDup} aria-label={`Duplicate “${q.label || "question"}”`}><Icon name="copy" /></button>
            <button className="iconbtn sm" onClick={onDel} aria-label={`Delete “${q.label || "question"}”`}><Icon name="trash" /></button>
          </div>
        )}
      </div>
      {open && (
        <fieldset className="bq-edit" disabled={!editable} style={{ border: 0, margin: 0, minWidth: 0 }}>
          <legend className="sr">Edit question {qi + 1}</legend>
          <Field label="Question" className="full"><textarea className="textarea" style={{ minHeight: 60 }} autoFocus value={q.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="e.g. Fire exits unobstructed and signed" /></Field>
          <div className="field full"><span>Response type</span>
            <div className="typegrid" role="group" aria-label="Response type">
              {QUESTION_TYPES.map((t) => <button key={t} type="button" className="typebtn" aria-pressed={q.type === t} onClick={() => setType(t)}><Icon name={TYPE_ICON[t]} />{TYPE_INFO[t].label}</button>)}
            </div>
            <small className="sub" style={{ display: "block", marginTop: 4 }}>{TYPE_INFO[q.type].hint}</small>
          </div>
          {(q.type === "choice" || q.type === "multi") && (
            <div className="field full"><span>Options (score 0–1; tick “fails” for a failing answer)</span>
              {opts.map((o, i) => (
                <div key={o.id} className="optrow">
                  <input className="input" aria-label={`Option ${i + 1}`} value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} />
                  <input className="input" aria-label={`Option ${i + 1} score`} inputMode="decimal" value={o.score} onChange={(e) => setOpt(i, { score: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
                  <label className="toggle" style={{ fontSize: 13 }}><input type="checkbox" checked={!!o.fail} onChange={(e) => setOpt(i, { fail: e.target.checked || undefined })} />fails</label>
                  <button type="button" className="iconbtn sm" disabled={opts.length <= 2} onClick={() => onChange({ options: opts.filter((_, j) => j !== i) })} aria-label={`Remove option ${i + 1}`}><Icon name="close" /></button>
                </div>
              ))}
              <button type="button" className="btn sm" onClick={() => onChange({ options: [...opts, { id: uid("o"), label: `Option ${opts.length + 1}`, score: 1 }] })}><Icon name="plus" />Add option</button>
            </div>
          )}
          {q.type === "rating" && q.scale && (
            <div className="grid g3 full" style={{ gap: 10 }}>
              <Field label="Lowest"><input className="input" inputMode="numeric" value={q.scale.min} onChange={(e) => onChange({ scale: { ...q.scale!, min: Number(e.target.value) || 0 } })} /></Field>
              <Field label="Highest"><input className="input" inputMode="numeric" value={q.scale.max} onChange={(e) => onChange({ scale: { ...q.scale!, max: Number(e.target.value) || 5 } })} /></Field>
              <Field label="Passes from"><input className="input" inputMode="numeric" value={q.scale.passAt} onChange={(e) => onChange({ scale: { ...q.scale!, passAt: Number(e.target.value) || 1 } })} /></Field>
            </div>
          )}
          {q.type === "number" && (
            <div className="grid g3 full" style={{ gap: 10 }}>
              <Field label="Expected from"><input className="input" inputMode="decimal" value={q.range?.min ?? ""} onChange={(e) => onChange({ range: { ...q.range, min: e.target.value === "" ? undefined : Number(e.target.value) } })} placeholder="No minimum" /></Field>
              <Field label="Expected to"><input className="input" inputMode="decimal" value={q.range?.max ?? ""} onChange={(e) => onChange({ range: { ...q.range, max: e.target.value === "" ? undefined : Number(e.target.value) } })} placeholder="No maximum" /></Field>
              <Field label="Unit"><input className="input" value={q.range?.unit ?? ""} onChange={(e) => onChange({ range: { ...q.range, unit: e.target.value || undefined } })} placeholder="°C, minutes, £…" /></Field>
            </div>
          )}
          {scorable && (
            <>
              <Field label={`Weight: ${q.weight}`} hint="0 records the answer without scoring it."><input className="range" type="range" min={0} max={10} step={1} value={q.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })} /></Field>
              <Field label="Severity"><select className="select" style={{ width: "100%" }} value={q.severity} onChange={(e) => onChange({ severity: e.target.value as Question["severity"] })}><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option></select></Field>
              <div className="full row wrap" style={{ gap: 18 }}>
                <label className="toggle"><input type="checkbox" checked={q.critical} onChange={(e) => onChange({ critical: e.target.checked, ...(e.target.checked ? { severity: "critical" as const, action: { auto: true, priority: "high" as const, dueDays: q.action?.dueDays ?? 7 } } : {}) })} />Critical: failing it fails the inspection</label>
                <label className="toggle"><input type="checkbox" checked={q.allowNA} onChange={(e) => onChange({ allowNA: e.target.checked })} />Allow N/A</label>
                <label className="toggle"><input type="checkbox" checked={q.required} onChange={(e) => onChange({ required: e.target.checked })} />Required</label>
                <label className="toggle"><input type="checkbox" checked={!!q.photoOnFail} onChange={(e) => onChange({ photoOnFail: e.target.checked || undefined })} />Photo if it fails</label>
                <label className="toggle"><input type="checkbox" checked={!!q.noteOnFail} onChange={(e) => onChange({ noteOnFail: e.target.checked || undefined })} />Note if it fails</label>
              </div>
              <div className="full row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
                <label className="toggle"><input type="checkbox" checked={!!q.action?.auto || q.critical} disabled={q.critical} onChange={(e) => onChange({ action: e.target.checked ? { auto: true, priority: q.action?.priority ?? "medium", dueDays: q.action?.dueDays ?? 30 } : undefined })} />Raise a corrective action if it fails</label>
                {(q.action?.auto || q.critical) && <>
                  <label className="row" style={{ gap: 6 }}><span className="sub">Priority</span><select className="select" value={q.action?.priority ?? "high"} onChange={(e) => onChange({ action: { auto: true, dueDays: q.action?.dueDays ?? 30, priority: e.target.value as "high" } })}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
                  <label className="row" style={{ gap: 6 }}><span className="sub">Due in</span><input className="input" style={{ width: 80 }} inputMode="numeric" value={q.action?.dueDays ?? 30} onChange={(e) => onChange({ action: { auto: true, priority: q.action?.priority ?? "high", dueDays: Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1) } })} /><span className="sub">days</span></label>
                </>}
              </div>
            </>
          )}
          <Field label="Guidance for the inspector" className="full"><textarea className="textarea" style={{ minHeight: 60 }} value={q.guidance ?? ""} onChange={(e) => onChange({ guidance: e.target.value || undefined })} placeholder="How to check it, what good looks like" /></Field>
          <Field label="Policy or procedure reference"><input className="input" value={q.reference ?? ""} onChange={(e) => onChange({ reference: e.target.value || undefined })} placeholder="e.g. Cash Handling Procedure §4.2" /></Field>
          <div className="field full"><span>Logic: only show this question when…</span>
            <div className="row wrap" style={{ gap: 8 }}>
              <select className="select" aria-label="Depends on" value={q.showIf?.q ?? ""} onChange={(e) => onChange({ showIf: e.target.value ? { q: e.target.value, is: "fail" } : undefined })}>
                <option value="">Always show it</option>
                {earlier.map((x) => <option key={x.id} value={x.id}>{x.label.slice(0, 60) || "(untitled)"}</option>)}
              </select>
              {target && (
                <select className="select" aria-label="Condition" value={q.showIf!.is} onChange={(e) => onChange({ showIf: { q: target.id, is: e.target.value } })}>
                  {TYPE_INFO[target.type].scorable && <option value="fail">{target.type === "yesno" ? "is No" : "fails"}</option>}
                  {TYPE_INFO[target.type].scorable && <option value="pass">{target.type === "yesno" ? "is Yes" : "passes"}</option>}
                  {target.allowNA && <option value="na">is N/A</option>}
                  <option value="answered">is answered</option>
                  {target.options?.map((o) => <option key={o.id} value={o.id}>is “{o.label}”</option>)}
                </select>
              )}
            </div>
            {!earlier.length && <small className="sub">Add a question before this one in the section to branch on it.</small>}
          </div>
          <div className="full row" style={{ justifyContent: "flex-end" }}><span className="sub" style={{ fontSize: 12 }}>{def.sections[s].perItem ? "Asked for every sampled item." : ""}</span></div>
        </fieldset>
      )}
    </>
  );
}

function PublishSheet({ t, def, onClose, onDone }: { t: TemplateDetail; def: TemplateDef; onClose: () => void; onDone: (t: TemplateDetail) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next = t.version + 1;
  const go = async () => {
    setBusy(true); setErr(null);
    try { await api(`/api/templates/${t.id}`, "PUT", { draft: def }); const j = await api<{ template: TemplateDetail }>(`/api/templates/${t.id}/publish`, "POST", { note }); onDone(j.template); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Sheet title={`Publish version ${next}`} sub={def.name} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={go}><Icon name="send" />Publish version {next}</button></>}>
      <ul className="list">
        <li><Icon name="lock" /><span>Version {next} is locked once published. To change it later, edit the draft and publish again.</span></li>
        <li><Icon name="clipboard" /><span>New inspections use version {next}. {t.version ? `Inspections already started keep version ${t.version}.` : "Inspectors can start straight away."}</span></li>
        <li><Icon name="scroll" /><span>The change history records who published it, and when.</span></li>
      </ul>
      <Field label="What changed (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added the call-back question" /></Field>
      <Msg kind="err">{err}</Msg>
    </Sheet>
  );
}
