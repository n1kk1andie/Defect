"use client";
// An inspection form, rendered from a template version: the phone capture, the
// read-only view a supervisor approves, and the builder's live preview all use
// it. Big tap targets, one card per question, the failing ones tinted, logic
// applied as you answer, guidance and the policy reference a tap away, and a
// repeating block per sampled item.
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { answerScore, describeShowIf, isVisible, type Answer, type Answers, type Question, type SampledItem, type Section, type TemplateDef } from "@/lib/templates/model";

export interface FormState { answers: Answers; items: SampledItem[] }

interface Props {
  def: TemplateDef;
  state: FormState;
  onChange?: (next: FormState) => void;
  readOnly?: boolean;
  /** Builder preview: compact, nothing uploads. */
  preview?: boolean;
  /** Upload a photo for a question; resolves to the stored id (or a local id while offline). */
  onPhoto?: (file: File) => Promise<string>;
  photoUrl?: (id: string) => string | null;
  highlight?: string | null;
}

export function InspectionForm({ def, state, onChange, readOnly, preview, onPhoto, photoUrl, highlight }: Props) {
  const set = (fn: (s: FormState) => FormState) => onChange?.(fn(state));
  const setAnswer = (scope: number | null, qid: string, a: Answer | undefined) => set((s) => {
    if (scope === null) { const answers = { ...s.answers }; if (a) answers[qid] = a; else delete answers[qid]; return { ...s, answers }; }
    const items = s.items.map((it, i) => { if (i !== scope) return it; const answers = { ...it.answers }; if (a) answers[qid] = a; else delete answers[qid]; return { ...it, answers }; });
    return { ...s, items };
  });
  const itemLabel = def.sampling?.itemLabel ?? "Item";
  return (
    <div className={`iform${preview ? " preview" : ""}`}>
      {def.sections.map((s, si) => s.perItem ? (
        <section key={s.id} className="isec" aria-labelledby={`sec-${s.id}`}>
          <div className="isec-h">
            <span className="isec-n" aria-hidden="true">{si + 1}</span>
            <div className="grow"><h2 id={`sec-${s.id}`}>{s.title}</h2><p className="sub">{s.description || `Repeat for each ${itemLabel.toLowerCase()} in the sample.`}</p></div>
            <span className="pill">{state.items.length} {itemLabel.toLowerCase()}{state.items.length === 1 ? "" : "s"}</span>
          </div>
          {state.items.map((it, ii) => (
            <ItemBlock key={ii} def={def} section={s} index={ii} item={it} itemLabel={itemLabel} readOnly={readOnly} preview={preview} onPhoto={onPhoto} photoUrl={photoUrl} highlight={highlight}
              onRef={(ref) => set((st) => ({ ...st, items: st.items.map((x, j) => (j === ii ? { ...x, ref } : x)) }))}
              onAnswer={(qid, a) => setAnswer(ii, qid, a)}
              onRemove={() => set((st) => ({ ...st, items: st.items.filter((_, j) => j !== ii) }))} />
          ))}
          {!readOnly && (
            <button type="button" className="btn iadd" onClick={() => set((st) => ({ ...st, items: [...st.items, { ref: "", answers: {} }] }))}>
              <Icon name="plus" />Add {itemLabel.toLowerCase()} {state.items.length + 1}
            </button>
          )}
          {readOnly && !state.items.length && <p className="sub">No {itemLabel.toLowerCase()}s recorded.</p>}
        </section>
      ) : (
        <section key={s.id} className="isec" aria-labelledby={`sec-${s.id}`}>
          <div className="isec-h">
            <span className="isec-n" aria-hidden="true">{si + 1}</span>
            <div className="grow"><h2 id={`sec-${s.id}`}>{s.title}</h2>{s.description && <p className="sub">{s.description}</p>}</div>
          </div>
          {s.questions.filter((q) => isVisible(q, s, state.answers)).map((q) => (
            <QuestionCard key={q.id} def={def} q={q} a={state.answers[q.id]} readOnly={readOnly} preview={preview} onPhoto={onPhoto} photoUrl={photoUrl} highlight={highlight === q.id}
              onAnswer={(a) => setAnswer(null, q.id, a)} />
          ))}
        </section>
      ))}
    </div>
  );
}

function ItemBlock({ def, section, index, item, itemLabel, readOnly, preview, onPhoto, photoUrl, onRef, onAnswer, onRemove, highlight }: { def: TemplateDef; section: Section; index: number; item: SampledItem; itemLabel: string; readOnly?: boolean; preview?: boolean; onPhoto?: Props["onPhoto"]; photoUrl?: Props["photoUrl"]; onRef: (r: string) => void; onAnswer: (qid: string, a: Answer | undefined) => void; onRemove: () => void; highlight?: string | null }) {
  const fails = section.questions.filter((q) => isVisible(q, section, item.answers) && answerScore(q, item.answers[q.id]).outcome === "fail").length;
  const answered = section.questions.filter((q) => isVisible(q, section, item.answers) && answerScore(q, item.answers[q.id]).outcome !== "unanswered").length;
  const [open, setOpen] = useState(!readOnly || fails > 0);
  const rid = useId();
  return (
    <div className={`iitem${fails ? " failing" : ""}`}>
      <div className="iitem-h">
        <button type="button" className="iitem-t" aria-expanded={open} aria-controls={rid} onClick={() => setOpen((o) => !o)}>
          <Icon name="chevron" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
          <span className="grow"><strong>{itemLabel} {index + 1}</strong>{item.ref && <span className="sub"> · {item.ref}</span>}</span>
          {fails > 0 ? <span className="pill" data-band="escalate">{fails} failed</span> : answered > 0 ? <span className="pill" data-band="strong">{answered} answered</span> : null}
        </button>
        {!readOnly && <button type="button" className="iconbtn sm" onClick={onRemove} aria-label={`Remove ${itemLabel.toLowerCase()} ${index + 1}`}><Icon name="close" /></button>}
      </div>
      {open && (
        <div id={rid} className="iitem-b">
          {!section.questions.some((q) => q.type === "reference") && (
            <label className="field"><span>{itemLabel} reference</span><input className="input" value={item.ref} readOnly={readOnly} onChange={(e) => onRef(e.target.value)} placeholder="Account, chart, case or file number" /></label>
          )}
          {section.questions.filter((q) => isVisible(q, section, item.answers)).map((q) => (
            <QuestionCard key={q.id} def={def} q={q} a={item.answers[q.id]} readOnly={readOnly} preview={preview} onPhoto={onPhoto} photoUrl={photoUrl} highlight={highlight === q.id}
              onAnswer={(a) => { onAnswer(q.id, a); if (q.type === "reference" && typeof a?.v === "string") onRef(a.v); }} />
          ))}
        </div>
      )}
    </div>
  );
}

const YN = [{ v: "yes", label: "Yes" }, { v: "no", label: "No" }];
const PF = [{ v: "pass", label: "Pass" }, { v: "fail", label: "Fail" }];

export function QuestionCard({ def, q, a, readOnly, preview, onPhoto, photoUrl, onAnswer, highlight }: { def: TemplateDef; q: Question; a?: Answer; readOnly?: boolean; preview?: boolean; onPhoto?: Props["onPhoto"]; photoUrl?: Props["photoUrl"]; onAnswer: (a: Answer | undefined) => void; highlight?: boolean }) {
  const { outcome } = answerScore(q, a);
  const [guide, setGuide] = useState(false);
  const [noteOpen, setNoteOpen] = useState(!!a?.note);
  const [busy, setBusy] = useState(false);
  const lid = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight]);
  const put = (p: Partial<Answer>) => { const n: Answer = { ...(a || {}), ...p }; if (p.v !== undefined) delete n.na; onAnswer(n); };
  const failNeeds = outcome === "fail" && ((q.photoOnFail && !a?.photos?.length) || (q.noteOnFail && !a?.note));
  const showIf = describeShowIf(def, q);
  const photos = a?.photos || [];
  const addPhoto = async (files: FileList | null) => {
    if (!files?.length || !onPhoto) return;
    setBusy(true);
    try { const added: string[] = []; for (const f of Array.from(files).slice(0, 6)) added.push(await onPhoto(f)); onAnswer({ ...(a || {}), photos: [...photos, ...added].slice(0, 12) }); }
    finally { setBusy(false); }
  };
  const choice = (opts: { v: string; label: string }[]) => (
    <div className="iopts" role="radiogroup" aria-labelledby={lid}>
      {opts.map((o) => {
        const on = a?.v === o.v;
        const tone = on ? (o.v === "no" || o.v === "fail" ? "bad" : "good") : "";
        return <button key={o.v} type="button" role="radio" aria-checked={on} disabled={readOnly} className={`iopt ${tone}`} onClick={() => put({ v: on ? undefined : o.v })}>{o.label}</button>;
      })}
      {q.allowNA && <button type="button" role="radio" aria-checked={!!a?.na} disabled={readOnly} className="iopt na" onClick={() => onAnswer(a?.na ? undefined : { na: true, ...(a?.note ? { note: a.note } : {}) })}>N/A</button>}
    </div>
  );
  return (
    <div ref={ref} className={`icard ${outcome === "fail" ? "fail" : outcome === "pass" ? "pass" : ""}${highlight ? " hl" : ""}`}>
      <div className="icard-h">
        <div className="grow">
          <div className="iq" id={lid}>{q.label}{q.required && !readOnly && outcome === "unanswered" && <span className="req" aria-label="required"> *</span>}</div>
          <div className="imeta">
            {q.critical && <span className="pill sm" data-band="escalate">Critical</span>}
            {q.reference && <span className="pill sm"><Icon name="scroll" width={13} height={13} />{q.reference}</span>}
            {showIf && preview && <span className="pill sm info">{showIf}</span>}
            {q.guidance && <button type="button" className="linkbtn sm" aria-expanded={guide} onClick={() => setGuide((g) => !g)}>{guide ? "Hide guidance" : "Guidance"}</button>}
          </div>
        </div>
        {outcome === "fail" && <span className="ibadge bad" role="img" aria-label="Failed"><Icon name="close" /></span>}
        {outcome === "pass" && <span className="ibadge good" role="img" aria-label="Passed"><Icon name="check" /></span>}
      </div>
      {guide && q.guidance && <p className="iguide">{q.guidance}</p>}
      {q.type === "yesno" && choice(YN)}
      {q.type === "passfail" && choice(PF)}
      {q.type === "rating" && q.scale && (
        <div>
          <div className="iopts scale" role="radiogroup" aria-labelledby={lid}>
            {Array.from({ length: q.scale.max - q.scale.min + 1 }, (_, i) => q.scale!.min + i).map((n) => {
              const on = a?.v === n;
              return <button key={n} type="button" role="radio" aria-checked={on} disabled={readOnly} className={`iopt ${on ? (n < q.scale!.passAt ? "bad" : "good") : ""}`} onClick={() => put({ v: on ? undefined : n })}>{n}</button>;
            })}
            {q.allowNA && <button type="button" role="radio" aria-checked={!!a?.na} disabled={readOnly} className="iopt na" onClick={() => onAnswer(a?.na ? undefined : { na: true })}>N/A</button>}
          </div>
          {q.scale.labels && <div className="row between sub" style={{ fontSize: 12, marginTop: 4 }}><span>{q.scale.labels[0]}</span><span>{q.scale.labels[1]}</span></div>}
        </div>
      )}
      {q.type === "number" && (
        <div className="row wrap" style={{ gap: 8 }}>
          <input className="input" style={{ maxWidth: 180 }} inputMode="decimal" aria-labelledby={lid} readOnly={readOnly} value={a?.v === undefined || a?.v === null ? "" : String(a.v)}
            onChange={(e) => { const t = e.target.value.replace(/[^0-9.\-]/g, ""); onAnswer(t === "" ? (a?.note || a?.photos ? { note: a?.note, photos: a?.photos } : undefined) : { ...(a || {}), v: t }); }} />
          {q.range?.unit && <span className="sub">{q.range.unit}</span>}
          <span className="sub">{q.range?.min !== undefined && q.range?.max !== undefined ? `Expected ${q.range.min} to ${q.range.max}` : q.range?.min !== undefined ? `At least ${q.range.min}` : q.range?.max !== undefined ? `At most ${q.range.max}` : ""}</span>
          {q.allowNA && <button type="button" className={`iopt na sm`} aria-pressed={!!a?.na} disabled={readOnly} onClick={() => onAnswer(a?.na ? undefined : { na: true })}>N/A</button>}
        </div>
      )}
      {(q.type === "choice" || q.type === "multi") && (
        <div className="ilist" role={q.type === "choice" ? "radiogroup" : "group"} aria-labelledby={lid}>
          {q.options?.map((o) => {
            const on = q.type === "multi" ? Array.isArray(a?.v) && a!.v.includes(o.id) : a?.v === o.id;
            const toggle = () => {
              if (q.type === "choice") return put({ v: on ? undefined : o.id });
              const cur = Array.isArray(a?.v) ? a!.v : [];
              const next = on ? cur.filter((x) => x !== o.id) : [...cur, o.id];
              onAnswer(next.length ? { ...(a || {}), v: next } : undefined);
            };
            return (
              <button key={o.id} type="button" role={q.type === "choice" ? "radio" : "checkbox"} aria-checked={on} disabled={readOnly} className={`ilistopt${on ? (o.fail ? " bad" : " on") : ""}`} onClick={toggle}>
                <span className={`tick ${q.type === "multi" ? "box" : ""}`} aria-hidden="true">{on && <Icon name="check" />}</span>{o.label}
              </button>
            );
          })}
          {q.allowNA && <button type="button" role={q.type === "choice" ? "radio" : "checkbox"} aria-checked={!!a?.na} disabled={readOnly} className={`ilistopt${a?.na ? " on" : ""}`} onClick={() => onAnswer(a?.na ? undefined : { na: true })}><span className="tick" aria-hidden="true">{a?.na && <Icon name="check" />}</span>Not applicable</button>}
        </div>
      )}
      {q.type === "text" && <textarea className="textarea" aria-labelledby={lid} readOnly={readOnly} value={String(a?.v ?? "")} onChange={(e) => onAnswer(e.target.value ? { ...(a || {}), v: e.target.value } : undefined)} />}
      {q.type === "reference" && <input className="input" aria-labelledby={lid} readOnly={readOnly} value={String(a?.v ?? "")} onChange={(e) => onAnswer(e.target.value ? { ...(a || {}), v: e.target.value } : undefined)} placeholder="Reference" />}
      {q.type === "date" && <input className="input" style={{ maxWidth: 220 }} type="date" aria-labelledby={lid} readOnly={readOnly} value={String(a?.v ?? "")} onChange={(e) => onAnswer(e.target.value ? { ...(a || {}), v: e.target.value } : undefined)} />}
      {q.type === "signature" && <SignaturePad label={q.label} value={typeof a?.v === "string" ? a.v : ""} readOnly={readOnly} onChange={(v) => onAnswer(v ? { v } : undefined)} />}
      {(q.type === "photo" || photos.length > 0 || (outcome === "fail" && q.photoOnFail)) && (
        <div className="iphotos">
          {photos.map((p) => { const url = photoUrl?.(p); return url ? <a key={p} href={url} target="_blank" rel="noreferrer" className="ithumb"><img src={url} alt="Evidence photo" /></a> : <span key={p} className="ithumb pending" title="Waiting to upload"><Icon name="clock" /></span>; })}
          {!readOnly && (
            <label className={`btn sm${q.type === "photo" && !photos.length ? " primary" : ""}`} aria-disabled={busy || preview}>
              <Icon name="camera" />{busy ? "Adding…" : photos.length ? "Add another" : q.type === "photo" ? "Take a photo" : "Add a photo"}
              <input type="file" accept="image/*" capture="environment" multiple className="sr" disabled={busy || preview} onChange={(e) => { void addPhoto(e.target.files); e.target.value = ""; }} />
            </label>
          )}
        </div>
      )}
      {failNeeds && !readOnly && <p className="ineed"><Icon name="alert" width={15} height={15} />{q.photoOnFail && !a?.photos?.length ? "A photo is required when this fails." : "A note is required when this fails."}</p>}
      {(noteOpen || a?.note || (outcome === "fail" && q.noteOnFail)) ? (
        readOnly ? (a?.note ? <p className="inote"><Icon name="info" width={15} height={15} />{a.note}</p> : null) : (
          <label className="field" style={{ marginTop: 8 }}><span>Note</span><textarea className="textarea" style={{ minHeight: 64 }} value={a?.note ?? ""} onChange={(e) => onAnswer({ ...(a || {}), note: e.target.value || undefined })} placeholder="What did you find?" /></label>
        )
      ) : !readOnly && q.type !== "text" && q.type !== "signature" ? (
        <button type="button" className="linkbtn sm" style={{ marginTop: 8 }} onClick={() => setNoteOpen(true)}>Add a note</button>
      ) : null}
    </div>
  );
}

/** Draw a signature with a finger, stylus or mouse; stored as a small PNG. */
export function SignaturePad({ label, value, readOnly, onChange }: { label: string; value: string; readOnly?: boolean; onChange: (dataUrl: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = value; }
  }, [value]);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * e.currentTarget.width, ((e.clientY - r.top) / r.height) * e.currentTarget.height]; };
  if (readOnly) return value ? <img className="isig" src={value} alt={`${label}: signed`} /> : <p className="sub">Not signed.</p>;
  return (
    <div>
      <canvas ref={ref} className="isig" width={600} height={180} role="img" aria-label={`${label}: sign here with a finger, stylus or mouse`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drawing.current = true; const ctx = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1c1416"; }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = e.currentTarget.getContext("2d")!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true; }}
        onPointerUp={(e) => { drawing.current = false; if (dirty.current) { dirty.current = false; onChange(e.currentTarget.toDataURL("image/png")); } }} />
      <div className="row" style={{ marginTop: 6 }}>
        <span className="sub grow">Sign in the box.</span>
        {value && <button type="button" className="btn sm ghost" onClick={() => onChange("")}>Clear</button>}
      </div>
    </div>
  );
}
