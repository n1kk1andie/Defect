"use client";
// Carrying out an inspection, phone first. Everything is kept on the device as
// it is typed (localStorage; photos wait in IndexedDB), and synced to the
// server when there is a connection, under a client id so a retry never makes
// a second inspection. Check in at the site, answer, photograph, sign, submit.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Msg } from "@/components/ui";
import { Icon } from "@/components/icons";
import { InspectionForm, SignaturePad, type FormState } from "@/components/inspect/Form";
import { monthLabel } from "@/lib/metrics";
import { scoreInspection, type Answers, type SampledItem, type TemplateDef } from "@/lib/templates/model";
import type { Checkin, InspectionView, Signature } from "@/lib/inspections";

interface Local {
  clientId: string; id?: string; templateId: string; version: number; templateName: string; unitId: string; period: string;
  answers: Answers; items: SampledItem[]; signatures: { inspector?: Signature; site?: Signature }; checkin: Checkin | null;
  savedAt: string; synced: boolean;
}

// ── on-device storage ────────────────────────────────────────────────────────
const lsKey = (tenant: string, cid: string) => `pq-insp:${tenant}:${cid}`;
const idxKey = (tenant: string, email: string) => `pq-insp-index:${tenant}:${email}`;
export function readIndex(tenant: string, email: string): Local[] {
  try {
    const ids: string[] = JSON.parse(localStorage.getItem(idxKey(tenant, email)) || "[]");
    return ids.map((c) => { try { return JSON.parse(localStorage.getItem(lsKey(tenant, c)) || "null"); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function writeLocal(tenant: string, email: string, l: Local) {
  try {
    localStorage.setItem(lsKey(tenant, l.clientId), JSON.stringify(l));
    const ids: string[] = JSON.parse(localStorage.getItem(idxKey(tenant, email)) || "[]");
    if (!ids.includes(l.clientId)) localStorage.setItem(idxKey(tenant, email), JSON.stringify([...ids, l.clientId].slice(-30)));
  } catch { /* storage full or blocked: the server copy still holds */ }
}
export function dropLocal(tenant: string, email: string, cid: string) {
  try {
    localStorage.removeItem(lsKey(tenant, cid));
    const ids: string[] = JSON.parse(localStorage.getItem(idxKey(tenant, email)) || "[]");
    localStorage.setItem(idxKey(tenant, email), JSON.stringify(ids.filter((x) => x !== cid)));
  } catch { /* */ }
}
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => { const r = indexedDB.open("pulsus-quality", 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbPut(key: string, v: Blob) { const db = await idb(); await new Promise<void>((res, rej) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").put(v, key); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
async function idbGet(key: string): Promise<Blob | null> { const db = await idb(); return new Promise((res) => { const t = db.transaction("photos").objectStore("photos").get(key); t.onsuccess = () => res((t.result as Blob) ?? null); t.onerror = () => res(null); }); }
async function idbDel(key: string) { const db = await idb(); await new Promise<void>((res) => { const t = db.transaction("photos", "readwrite"); t.objectStore("photos").delete(key); t.oncomplete = () => res(); t.onerror = () => res(); }); }

const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()); return d.toISOString().slice(0, 7) + "-01"; };
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);

function replaceIds(answers: Answers, map: Map<string, string>): Answers {
  const out: Answers = {};
  for (const [k, a] of Object.entries(answers)) out[k] = a.photos ? { ...a, photos: a.photos.map((p) => map.get(p) ?? p) } : a;
  return out;
}

export function Capture({ def, templateId, version, inspection, start }: { def: TemplateDef; templateId: string; version: number; inspection?: InspectionView; start?: { unitId: string; period: string; clientId: string } }) {
  const app = useApp();
  const router = useRouter();
  const { actor, settings } = app;
  const units = app.program.units.filter((u) => u.active && (!actor.unitIds.length || actor.unitIds.includes(u.id)));
  const [s, setS] = useState<Local>(() => ({
    clientId: inspection?.clientId || start?.clientId || newId(), id: inspection?.id, templateId, version, templateName: def.name,
    unitId: inspection?.unitId || start?.unitId || units[0]?.id || "", period: inspection?.period || start?.period || lastMonth(),
    answers: inspection?.answers || {}, items: inspection?.items?.length ? inspection.items : def.sections.some((x) => x.perItem) ? [{ ref: "", answers: {} }] : [],
    signatures: inspection?.signatures || {}, checkin: inspection?.checkin || null, savedAt: new Date().toISOString(), synced: !!inspection,
  }));
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<"idle" | "saving" | "saved" | "offline" | "error">(inspection ? "saved" : "idle");
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(inspection?.status === "returned" && inspection.note ? { kind: "info", text: `Returned by ${inspection.supervisorEmail}: ${inspection.note}` } : null);
  const [hl, setHl] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const local = useRef(new Map<string, string>()); // local photo id → object URL
  const loaded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(s);
  latest.current = s;

  // Resume a copy kept on this device (it may be newer than the server's).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(lsKey(actor.tenant, s.clientId)) || "null") as Local | null;
      if (saved && saved.templateId === templateId && saved.version === version && (!inspection || Date.parse(saved.savedAt) > Date.parse(inspection.updatedAt))) setS((x) => ({ ...x, ...saved, id: x.id || saved.id }));
    } catch { /* */ }
    loaded.current = true;
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); void push(); }, off = () => { setOnline(false); setSync("offline"); };
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Upload photos taken offline, then save the draft. */
  const push = useCallback(async (submit = false): Promise<InspectionView | null> => {
    const cur = latest.current;
    if (typeof navigator !== "undefined" && !navigator.onLine) { setSync("offline"); return null; }
    setSync("saving");
    try {
      let id = cur.id;
      const body = (x: Local, sub: boolean) => ({ id: x.id, clientId: x.clientId, templateId: x.templateId, unitId: x.unitId, period: x.period, answers: x.answers, items: x.items, signatures: x.signatures, checkin: x.checkin, submit: sub });
      if (!id) { const j = await api<{ inspection: InspectionView }>("/api/inspections", "POST", body(cur, false)); id = j.inspection.id; setS((x) => ({ ...x, id })); window.history.replaceState(null, "", `/inspect/${id}`); }
      // Photos waiting on the device.
      const pending = new Set<string>();
      const scan = (a: Answers) => { for (const v of Object.values(a)) for (const p of v.photos || []) if (p.startsWith("local-")) pending.add(p); };
      scan(cur.answers); cur.items.forEach((it) => scan(it.answers));
      if (pending.size) {
        const map = new Map<string, string>();
        for (const p of pending) {
          const blob = await idbGet(p);
          if (!blob) continue;
          const fd = new FormData(); fd.append("file", new File([blob], `${p}.jpg`, { type: blob.type || "image/jpeg" })); fd.append("entityType", "inspection"); fd.append("entityId", id!);
          const j = await api<{ file: { id: string } }>("/api/evidence", "POST", fd);
          map.set(p, j.file.id); await idbDel(p);
          const url = local.current.get(p); if (url) local.current.set(j.file.id, url);
        }
        setS((x) => ({ ...x, answers: replaceIds(x.answers, map), items: x.items.map((it) => ({ ...it, answers: replaceIds(it.answers, map) })) }));
        latest.current = { ...latest.current, answers: replaceIds(latest.current.answers, map), items: latest.current.items.map((it) => ({ ...it, answers: replaceIds(it.answers, map) })) };
      }
      const j = await api<{ inspection: InspectionView }>("/api/inspections", "POST", body({ ...latest.current, id }, submit));
      setS((x) => ({ ...x, synced: true }));
      setSync("saved");
      return j.inspection;
    } catch (e) {
      setSync("error");
      if (submit) throw e;
      setMsg({ kind: "err", text: (e as Error).message });
      return null;
    }
  }, []);

  // Keep on the device on every change; sync a moment later.
  useEffect(() => {
    if (!loaded.current) return;
    writeLocal(actor.tenant, actor.email, { ...s, savedAt: new Date().toISOString() });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void push(); }, 2000);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [s.answers, s.items, s.signatures, s.checkin, s.unitId, s.period]); // eslint-disable-line react-hooks/exhaustive-deps

  const score = useMemo(() => scoreInspection(def, s.answers, s.items), [def, s.answers, s.items]);
  const progress = score.questions ? Math.round((score.answered / score.questions) * 100) : 0;
  const form: FormState = { answers: s.answers, items: s.items };

  const onPhoto = async (file: File): Promise<string> => {
    const lid = `local-${newId()}`;
    local.current.set(lid, URL.createObjectURL(file));
    try { await idbPut(lid, file); } catch { /* private mode: it uploads now or not at all */ }
    if (s.id && navigator.onLine) {
      try {
        const fd = new FormData(); fd.append("file", file); fd.append("entityType", "inspection"); fd.append("entityId", s.id);
        const j = await api<{ file: { id: string } }>("/api/evidence", "POST", fd);
        await idbDel(lid).catch(() => {});
        local.current.set(j.file.id, local.current.get(lid)!);
        return j.file.id;
      } catch (e) { setMsg({ kind: "info", text: `${(e as Error).message} The photo is kept on this device and will upload later.` }); }
    }
    return lid;
  };
  const photoUrl = (id: string) => local.current.get(id) ?? (id.startsWith("local-") ? null : `/api/evidence/${id}?inline=1`);

  const checkIn = () => {
    const at = new Date().toISOString();
    if (!("geolocation" in navigator)) { setS((x) => ({ ...x, checkin: { at } })); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setS((x) => ({ ...x, checkin: { at, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } })); setLocating(false); },
      () => { setS((x) => ({ ...x, checkin: { at } })); setLocating(false); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  };

  const submit = async () => {
    setMsg(null);
    if (score.missing.length) {
      const m = score.missing[0];
      setHl(m.questionId);
      setMsg({ kind: "err", text: `${score.missing.length} to finish: “${m.label.slice(0, 70)}”${m.item !== null ? ` (${(def.sampling?.itemLabel ?? "item").toLowerCase()} ${m.item + 1})` : ""} ${m.why === "photo" ? "needs a photo" : m.why === "note" ? "needs a note" : "needs an answer"}.` });
      return;
    }
    if (def.signatures.inspector && !s.signatures.inspector) { setMsg({ kind: "err", text: "Sign the inspection at the end before you submit it." }); document.getElementById("signatures")?.scrollIntoView({ behavior: "smooth" }); return; }
    if (def.signatures.site && !s.signatures.site) { setMsg({ kind: "err", text: `Ask the ${settings.unitLabel.toLowerCase()} manager to sign before you submit.` }); document.getElementById("signatures")?.scrollIntoView({ behavior: "smooth" }); return; }
    if (!navigator.onLine) { setMsg({ kind: "info", text: "You're offline. Everything is saved on this device; submit when you're back online." }); return; }
    setSubmitting(true);
    try {
      const r = await push(true);
      if (r) { dropLocal(actor.tenant, actor.email, s.clientId); router.push(`/inspect/${r.id}?submitted=1`); router.refresh(); }
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); setSubmitting(false); }
  };

  const discard = async () => {
    if (!confirm("Delete this draft inspection? This can't be undone.")) return;
    if (s.id) { try { await api(`/api/inspections/${s.id}`, "DELETE"); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); return; } }
    dropLocal(actor.tenant, actor.email, s.clientId);
    router.push("/inspect"); router.refresh();
  };

  const months = Array.from({ length: 13 }, (_, i) => { const x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); return x.toISOString().slice(0, 7) + "-01"; });
  const band = score.pct === null ? "none" : score.result === "fail" ? "escalate" : score.pct >= 95 ? "worldClass" : score.pct >= def.scoring.passMark ? "strong" : "attention";
  const syncLabel = !online || sync === "offline" ? "Offline · saved on this device" : sync === "saving" ? "Saving…" : sync === "error" ? "Not synced · saved on this device" : sync === "saved" ? "Saved" : "Saved on this device";

  return (
    <div className="capture">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <Link href="/inspect" className="btn sm ghost"><Icon name="back" />Inspections</Link>
        <span className="grow" />
        <span className={`sync${!online || sync === "offline" ? " off" : sync === "error" ? " err" : ""}`} role="status" aria-live="polite"><i aria-hidden="true" />{syncLabel}</span>
      </div>
      <div className="capbar">
        <div className="row" style={{ alignItems: "center" }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="eyebrow">{inspection?.ref ? `${inspection.ref} · ` : ""}{def.category} · version {version}</div>
            <h1 style={{ fontSize: 18, margin: "2px 0 0", fontFamily: "Sora, sans-serif", lineHeight: 1.25 }}>{def.name}</h1>
          </div>
          <div className="scorering" role="img" data-band={band} style={{ ["--v" as string]: score.pct ?? 0 }} aria-label={score.pct === null ? "No score yet" : `Score ${score.pct}%`}><span>{score.pct === null ? "—" : `${Math.round(score.pct)}%`}</span></div>
        </div>
        <div className="progress" role="progressbar" aria-label="Answered" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}><i style={{ width: `${progress}%` }} /></div>
        <div className="row between sub" style={{ fontSize: 12.5, marginTop: 6 }}>
          <span>{score.answered} of {score.questions} answered{score.items ? ` · ${score.items} ${(def.sampling?.itemLabel ?? "item").toLowerCase()}s` : ""}</span>
          <span>{score.findings.length ? `${score.findings.length} failed${score.criticalFails ? ` · ${score.criticalFails} critical` : ""}` : "No failures"}</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="grid g2" style={{ gap: 12 }}>
          <label className="field" style={{ marginTop: 0 }}><span>{settings.unitLabel}</span><select className="select" style={{ width: "100%" }} value={s.unitId} onChange={(e) => setS({ ...s, unitId: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field" style={{ marginTop: 0 }}><span>Month covered</span><select className="select" style={{ width: "100%" }} value={s.period} onChange={(e) => setS({ ...s, period: e.target.value })}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        </div>
        {def.checkin && (
          <div className="row wrap mt" style={{ gap: 10 }}>
            {s.checkin ? (
              <span className="row" style={{ gap: 8 }}><span className="badge sm navy" aria-hidden="true"><Icon name="pin" /></span><span><strong>Checked in</strong> at {new Date(s.checkin.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}<span className="sub">{s.checkin.lat !== undefined ? ` · ${s.checkin.lat.toFixed(4)}, ${s.checkin.lng!.toFixed(4)}${s.checkin.accuracy ? ` (±${Math.round(s.checkin.accuracy)} m)` : ""}` : " · location not shared"}</span></span></span>
            ) : (
              <button className="btn" onClick={checkIn} disabled={locating}><Icon name="pin" />{locating ? "Finding your location…" : `Check in at the ${settings.unitLabel.toLowerCase()}`}</button>
            )}
            <span className="sub" style={{ fontSize: 12.5 }}>Records your arrival time{s.checkin ? "" : " and, if you allow it, your location"}. Time on site runs to submission.</span>
          </div>
        )}
      </div>

      <Msg kind={msg?.kind}>{msg?.text}</Msg>
      <InspectionForm def={def} state={form} onChange={(f) => setS((x) => ({ ...x, answers: f.answers, items: f.items }))} onPhoto={onPhoto} photoUrl={photoUrl} highlight={hl} />

      {(def.signatures.inspector || def.signatures.site) && (
        <section id="signatures" className="isec mt2" aria-labelledby="sig-h">
          <div className="isec-h"><span className="isec-n" aria-hidden="true"><Icon name="pen" width={14} height={14} /></span><div className="grow"><h2 id="sig-h">Sign off</h2><p className="sub">Signed on this screen. Signing records your name and the time.</p></div></div>
          {def.signatures.inspector && (
            <div className="icard"><div className="iq" style={{ marginBottom: 10 }}>Inspector: {actor.name}</div>
              <SignaturePad label="Inspector's signature" value={s.signatures.inspector?.data ?? ""} onChange={(data) => setS((x) => ({ ...x, signatures: { ...x.signatures, inspector: data ? { name: actor.name, data, at: new Date().toISOString() } : undefined } }))} /></div>
          )}
          {def.signatures.site && (
            <div className="icard">
              <label className="field" style={{ marginTop: 0 }}><span>{settings.unitLabel} manager's name</span><input className="input" value={s.signatures.site?.name ?? ""} onChange={(e) => setS((x) => ({ ...x, signatures: { ...x.signatures, site: { name: e.target.value, data: x.signatures.site?.data ?? "", at: x.signatures.site?.at ?? new Date().toISOString() } } }))} placeholder="Who accompanied the visit" /></label>
              <div className="mt"><SignaturePad label={`${settings.unitLabel} manager's signature`} value={s.signatures.site?.data ?? ""} onChange={(data) => setS((x) => ({ ...x, signatures: { ...x.signatures, site: { name: x.signatures.site?.name || "", data, at: new Date().toISOString() } } }))} /></div>
            </div>
          )}
        </section>
      )}

      <div className="capfoot">
        <button className="iconbtn" onClick={discard} aria-label="Delete this draft" title="Delete draft"><Icon name="trash" /></button>
        <span className="sub grow" style={{ fontSize: 13, lineHeight: 1.3 }}>{score.missing.length ? `${score.missing.length} still to answer` : "Ready to submit"}{score.result === "fail" && !score.missing.length ? " · this inspection fails" : ""}</span>
        <button className="btn primary" onClick={submit} disabled={submitting}><Icon name="send" />{submitting ? "Submitting…" : "Submit for approval"}</button>
      </div>
    </div>
  );
}
