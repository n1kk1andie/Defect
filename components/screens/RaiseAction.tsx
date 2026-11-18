"use client";
// Raise a corrective or preventive action (from a defect, a recurring issue or
// from scratch), or change an existing action's plan.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Field, Msg, Sheet } from "@/components/ui";
import { Icon } from "@/components/icons";
import { FISHBONE, KIND_HINT, KIND_LABEL, type ActionKind, type ActionView, type Rca } from "@/lib/actionRules";

export interface ActionPreset { unitId?: string; areaId?: string | null; title?: string; details?: string; rootCause?: string; priority?: string; kind?: string; sourceType?: string; sourceId?: string }

const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

export function RaiseAction({ onClose, preset = {}, edit }: { onClose: () => void; preset?: ActionPreset; edit?: ActionView }) {
  const { program, people, settings, actor, refresh } = useApp();
  const router = useRouter();
  const units = program.units.filter((u) => u.active && (!actor.unitIds.length || actor.unitIds.includes(u.id)));
  const [f, setF] = useState({
    kind: edit?.kind ?? preset.kind ?? "corrective",
    unitId: edit?.unitId ?? preset.unitId ?? units[0]?.id ?? "",
    areaId: edit?.areaId ?? preset.areaId ?? "",
    title: edit?.title ?? preset.title ?? "",
    details: edit?.details ?? preset.details ?? "",
    rootCause: edit?.rootCause ?? preset.rootCause ?? "",
    priority: edit?.priority ?? preset.priority ?? "medium",
    ownerEmail: edit?.ownerEmail ?? "",
    ownerName: edit && !edit.ownerEmail ? edit.ownerName : "",
    dueDate: edit?.dueDate ?? inDays(preset.priority === "high" ? 14 : 30),
    verifierEmail: edit?.verifierEmail ?? "",
    effectivenessDays: String(edit?.effectivenessDays ?? (preset.kind === "containment" ? 0 : 30)),
  });
  const [rca, setRca] = useState<Rca>(edit?.rca ?? { whys: [], fishbone: {} });
  const [showRca, setShowRca] = useState(!!edit?.rca);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const supervisors = people.filter((p) => (p.roles.includes("supervisor") || p.roles.includes("admin")) && p.email !== actor.email);
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const body = { ...f, areaId: f.areaId || null, effectivenessDays: Number(f.effectivenessDays), rca, ...(edit ? {} : { sourceType: preset.sourceType, sourceId: preset.sourceId }) };
      const j = edit ? await api<{ action: ActionView }>(`/api/actions/${edit.id}`, "PATCH", body) : await api<{ action: ActionView }>("/api/actions", "POST", body);
      refresh(); onClose();
      if (!edit) router.push(`/actions?open=${j.action.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Sheet title={edit ? `Change ${edit.ref}` : "Raise an action"} sub={edit ? "The change is recorded in the action's history." : "An owner, a due date, and a verifier who isn't you."} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : edit ? "Save changes" : "Raise action"}</button></>}>
      <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Kind" hint={KIND_HINT[f.kind as ActionKind]}><select className="select" style={{ width: "100%" }} value={f.kind} onChange={set("kind")}>{(["containment", "corrective", "preventive"] as ActionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        <Field label="Priority"><select className="select" style={{ width: "100%" }} value={f.priority} onChange={set("priority")}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
        <Field label={settings.unitLabel}><select className="select" style={{ width: "100%" }} value={f.unitId} onChange={set("unitId")} disabled={!!edit}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Process area"><select className="select" style={{ width: "100%" }} value={f.areaId ?? ""} onChange={set("areaId")}><option value="">Whole {settings.unitLabel.toLowerCase()}</option>{program.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
      </div>
      <Field label="Issue"><input className="input" value={f.title} onChange={set("title")} maxLength={160} /></Field>
      <Field label="Details"><textarea className="textarea" value={f.details} onChange={set("details")} /></Field>
      <Field label="Root cause" hint="Why it happened: what the action must change."><textarea className="textarea" style={{ minHeight: 70 }} value={f.rootCause} onChange={set("rootCause")} /></Field>
      {showRca ? <RcaEditor rca={rca} onChange={setRca} /> : <button type="button" className="btn sm" onClick={() => setShowRca(true)}><Icon name="list" />Analyse the root cause (5 whys, fishbone)</button>}
      <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
        <Field label="Owner"><select className="select" style={{ width: "100%" }} value={f.ownerEmail} onChange={set("ownerEmail")}><option value="">A team (type below)</option>{people.map((p) => <option key={p.email} value={p.email}>{p.name || p.email}</option>)}</select></Field>
        <Field label="Due date"><input className="input" type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
      </div>
      <Field label="Check it worked" hint="After closure, the failed questions are re-inspected; if they fail again the action reopens. A supervisor who didn't own or submit it can also record the check.">
        <select className="select" style={{ width: "100%" }} value={f.effectivenessDays} onChange={set("effectivenessDays")}>
          <option value="0">No effectiveness check</option>{[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days after closure</option>)}
        </select>
      </Field>
      {!f.ownerEmail && <Field label="Owning team"><input className="input" value={f.ownerName} onChange={set("ownerName")} placeholder="e.g. Branch operations" /></Field>}
      <Field label="Verifier (optional)" hint="Someone other than you, the owner or whoever submits it. Any other supervisor can verify if left blank.">
        <select className="select" style={{ width: "100%" }} value={f.verifierEmail} onChange={set("verifierEmail")}><option value="">Any other supervisor</option>{supervisors.filter((p) => p.email !== f.ownerEmail).map((p) => <option key={p.email} value={p.email}>{p.name || p.email}</option>)}</select>
      </Field>
      <Msg>{err}</Msg>
    </Sheet>
  );
}

/** Root cause analysis: up to five whys, and causes under each fishbone category. */
export function RcaEditor({ rca, onChange }: { rca: Rca; onChange: (r: Rca) => void }) {
  const whys = rca.whys.length ? rca.whys : [""];
  const setWhy = (i: number, v: string) => { const w = [...whys]; w[i] = v; onChange({ ...rca, whys: w }); };
  const setCat = (k: string, v: string) => onChange({ ...rca, fishbone: { ...rca.fishbone, [k]: v.split("\n").slice(0, 5) } });
  return (
    <fieldset className="rca">
      <legend>Root cause analysis</legend>
      <div className="eyebrow">5 whys</div>
      <p className="sub" style={{ margin: "2px 0 6px", fontSize: 13 }}>Ask why the problem happened, then why that happened, until you reach something the action can change. You may need fewer than five.</p>
      <ol className="whys">{whys.map((w, i) => (
        <li key={i}><label className="field" style={{ margin: 0 }}><span className="sr">Why {i + 1}</span><input className="input" value={w} maxLength={300} placeholder={i === 0 ? "Why did it happen?" : "And why was that?"} onChange={(e) => setWhy(i, e.target.value)} /></label></li>
      ))}</ol>
      {whys.length < 5 && whys[whys.length - 1] && <button type="button" className="btn sm" onClick={() => onChange({ ...rca, whys: [...whys, ""] })}><Icon name="plus" />Ask why again</button>}
      <div className="eyebrow mt">Fishbone</div>
      <p className="sub" style={{ margin: "2px 0 6px", fontSize: 13 }}>List contributing causes under each heading that applies, one per line.</p>
      <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
        {FISHBONE.map((c) => (
          <Field key={c.key} label={c.label} hint={c.hint}><textarea className="textarea" style={{ minHeight: 56 }} value={(rca.fishbone[c.key] ?? []).join("\n")} onChange={(e) => setCat(c.key, e.target.value)} /></Field>
        ))}
      </div>
    </fieldset>
  );
}
