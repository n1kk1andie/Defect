"use client";
// Review: keying a review and the approval gate. An inspector samples items at
// one unit for one month and tests each against its process area's checklist
// (yes / no / not applicable, each check with its severity); failed checks are
// the defects. The draft is saved on this device as it is typed, so a lost
// connection loses nothing. Submitted reviews wait for a supervisor who didn't
// key them to approve (publish) or return them.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, fmtDate, fmtDateTime, Msg, PageHead, Seg, Sheet } from "@/components/ui";
import { approveBlocker, can } from "@/lib/roles";
import { monthLabel, pct } from "@/lib/metrics";
import { SEVERITY_BAND } from "@/lib/bands";
import type { ReviewView } from "@/lib/reviews";
import type { ScorecardDef } from "@/lib/scorecard";
import { Icon } from "@/components/icons";

type Item = { areaId: string; itemType: string; reference: string; checks: Record<string, string>; defects: number; nature: string; recurring: boolean; status: string };
interface Draft { id?: string; kind: "checklist" | "scorecard"; unitId: string; period: string; entryDate: string; items: Item[]; values: Record<string, string>; auditGrade: string; savedAt?: string }

const STATUS: Record<string, string> = { draft: "Draft", submitted: "Awaiting approval", returned: "Returned", published: "Published" };
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) + "-01"; };

export function Review({ reviews, scorecard }: { reviews: ReviewView[]; scorecard: ScorecardDef | null }) {
  const app = useApp();
  const { actor, settings, counts } = app;
  const supervisor = can.approveReviews(actor);
  const mine = reviews.filter((r) => r.inspectorEmail === actor.email && r.status !== "published");
  const queue = reviews.filter((r) => r.status === "submitted" && !approveBlocker(actor, r));
  const published = reviews.filter((r) => r.status === "published").slice(0, 30);
  const [tab, setTab] = useState<"queue" | "mine" | "published">(supervisor && queue.length ? "queue" : "mine");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [viewing, setViewing] = useState<ReviewView | null>(null);
  const [local, setLocal] = useState<Draft | null>(null);
  const LOCAL = `pq-review-draft:${actor.tenant}:${actor.email}`;
  useEffect(() => { try { const d = JSON.parse(localStorage.getItem(LOCAL) || "null"); if (d && d.unitId) setLocal(d); } catch { /* blocked */ } }, [LOCAL]);

  const fresh = (kind: Draft["kind"]): Draft => ({ kind, unitId: app.program.units.find((u) => u.active && (!actor.unitIds.length || actor.unitIds.includes(u.id)))?.id || "", period: lastMonth(), entryDate: new Date().toISOString().slice(0, 10), items: [], values: {}, auditGrade: "" });
  const fromReview = (r: ReviewView): Draft => ({ id: r.id, kind: r.kind, unitId: r.unitId, period: r.period, entryDate: r.entryDate, items: r.items.map((i) => ({ areaId: i.areaId, itemType: i.itemType, reference: i.reference, checks: i.checks, defects: i.defects, nature: i.nature, recurring: i.recurring, status: i.status })), values: Object.fromEntries(Object.entries(r.scorecardValues || {}).map(([k, v]) => [k, v == null ? "" : String(v)])), auditGrade: r.auditGrade || "" });

  return (
    <>
      <PageHead eyebrow="Review" title="Sample it. Test it." accent="Sign it off."
        lede={supervisor ? `${counts.awaitingApproval} review${counts.awaitingApproval === 1 ? "" : "s"} waiting for your approval. Nothing reaches the dashboards until a supervisor who didn't key it publishes it.` : "Key a review: nothing reaches the dashboards until a supervisor approves it."}
        right={can.keyReviews(actor) ? <>
          <button className="btn primary" onClick={() => setEditing(fresh("checklist"))} disabled={!app.program.areas.length}><Icon name="plus" />New review</button>
          {scorecard && settings.scorecard && <button className="btn" onClick={() => setEditing(fresh("scorecard"))}><Icon name="target" />{scorecard.name} entry</button>}
        </> : undefined} />
      {!app.program.areas.length && <Msg kind="info">There's no checklist yet. A Quality admin sets up {settings.unitPlural.toLowerCase()}, process areas and checks under Settings → Company set-up.</Msg>}
      {local && !editing && (
        <Msg kind="info"><span className="row wrap"><span className="grow">You have an unsent review saved on this device ({app.unitName(local.unitId)}, {monthLabel(local.period)}, {local.items.length} items).</span><button className="btn sm" onClick={() => setEditing(local)}>Carry on</button><button className="btn sm ghost" onClick={() => { try { localStorage.removeItem(LOCAL); } catch { /* */ } setLocal(null); }}>Discard</button></span></Msg>
      )}
      <div style={{ maxWidth: 560, margin: "6px 0 14px" }}>
        <Seg label="Reviews" value={tab} onChange={setTab} options={[...(supervisor ? [{ value: "queue" as const, label: `To approve (${queue.length})` }] : []), { value: "mine" as const, label: `Mine (${mine.length})` }, { value: "published" as const, label: "Published" }]} />
      </div>
      <Card flush>
        <ReviewTable rows={tab === "queue" ? queue : tab === "mine" ? mine : published} empty={tab === "queue" ? "Nothing waiting for approval." : tab === "mine" ? "No drafts or returned reviews." : "Nothing published yet."}
          onOpen={(r) => (r.inspectorEmail === actor.email && (r.status === "draft" || r.status === "returned") ? setEditing(fromReview(r)) : setViewing(r))} />
      </Card>
      {editing && <Editor draft={editing} scorecard={scorecard} storageKey={LOCAL} onClose={() => { setEditing(null); try { const d = JSON.parse(localStorage.getItem(LOCAL) || "null"); setLocal(d && d.unitId ? d : null); } catch { setLocal(null); } }} returnedNote={reviews.find((r) => r.id === editing.id)?.note} />}
      {viewing && <Viewer r={viewing} scorecard={scorecard} onClose={() => setViewing(null)} />}
    </>
  );
}

function ReviewTable({ rows, empty, onOpen }: { rows: ReviewView[]; empty: string; onOpen: (r: ReviewView) => void }) {
  const { settings, band } = useApp();
  if (!rows.length) return <Empty icon="review" title={empty} />;
  return (
    <div className="tablewrap">
      <table className="t stack">
        <caption className="sr">Reviews</caption>
        <thead><tr><th scope="col">Review</th><th scope="col">{settings.unitLabel}</th><th scope="col">Month</th><th scope="col">Inspector</th><th scope="col" className="num">Sample</th><th scope="col" className="num">Defect rate</th><th scope="col">Status</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className="clickable" onClick={() => onOpen(r)}>
            <td data-label="Review"><button type="button" className="linkbtn" style={{ textDecoration: "none", fontWeight: 800, color: "var(--ink)" }} onClick={(e) => { e.stopPropagation(); onOpen(r); }}>{r.ref}</button>{r.kind === "scorecard" && <span className="sub"> · scorecard</span>}</td>
            <td data-label={settings.unitLabel}>{r.unitName}</td>
            <td data-label="Month">{monthLabel(r.period)}</td>
            <td data-label="Inspector">{r.inspectorEmail}</td>
            <td data-label="Sample" className="num">{r.kind === "checklist" ? r.totals.sample : "—"}</td>
            <td data-label="Defect rate" className="num">{r.kind === "checklist" ? <BandPill band={band("defectRate", r.totals.defectRate)}>{pct(r.totals.defectRate)}</BandPill> : "—"}</td>
            <td data-label="Status"><span className={`status st-${r.status}`}>{STATUS[r.status]}</span></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Editor({ draft, scorecard, storageKey, onClose, returnedNote }: { draft: Draft; scorecard: ScorecardDef | null; storageKey: string; onClose: () => void; returnedNote?: string }) {
  const { program, settings, actor, refresh } = useApp();
  const [d, setD] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(returnedNote ? { kind: "info", text: `Returned: ${returnedNote}` } : null);
  const units = program.units.filter((u) => u.active && (!actor.unitIds.length || actor.unitIds.includes(u.id)));
  // Saved on this device as it is typed: survives a dropped connection or a closed tab.
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify({ ...d, savedAt: new Date().toISOString() })); } catch { /* */ } }, [d, storageKey]);
  const area = (id: string) => program.areas.find((a) => a.id === id);
  const addItem = () => {
    const a = program.areas[0];
    setD((x) => ({ ...x, items: [...x.items, { areaId: x.items[x.items.length - 1]?.areaId || a.id, itemType: settings.itemTypes[0] || "", reference: "", checks: {}, defects: 0, nature: "", recurring: false, status: "open" }] }));
  };
  const setItem = (i: number, p: Partial<Item>) => setD((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, ...p } : it)) }));
  const failed = (it: Item) => (area(it.areaId)?.checks || []).filter((c) => it.checks[c.code] === "no").length;
  const totals = useMemo(() => {
    let inst = 0, def = 0;
    for (const it of d.items) {
      const a = area(it.areaId);
      inst += settings.instanceBasis === "check" ? (a?.checks || []).filter((c) => (it.checks[c.code] ?? "yes") !== "na").length : 1;
      def += settings.instanceBasis === "check" ? failed(it) : Math.max(failed(it), it.defects);
    }
    return { inst, def };
  }, [d.items]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async (submit: boolean) => {
    setBusy(true); setMsg(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) { setMsg({ kind: "info", text: "You're offline. The review is saved on this device; send it when you're back online." }); setBusy(false); return; }
    try {
      const j = await api<{ review: ReviewView }>("/api/reviews", "POST", { ...d, submit });
      try { localStorage.removeItem(storageKey); } catch { /* */ }
      refresh();
      if (submit) { onClose(); return; }
      setD((x) => ({ ...x, id: j.review.id }));
      setMsg({ kind: "ok", text: `Saved as ${j.review.ref}. Submit it when it's complete.` });
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  }, [d, onClose, refresh, storageKey]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !d.id) return;
    setBusy(true);
    try { for (const f of Array.from(files)) { const fd = new FormData(); fd.append("file", f); fd.append("entityType", "review"); fd.append("entityId", d.id); await api("/api/evidence", "POST", fd); } setMsg({ kind: "ok", text: "Evidence added to the review." }); refresh(); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };

  const months = Array.from({ length: 18 }, (_, i) => { const x = new Date(); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() - i); return x.toISOString().slice(0, 7) + "-01"; });
  return (
    <Sheet title={d.kind === "scorecard" ? `${scorecard?.name} entry` : d.id ? "Edit review" : "New review"} sub={`Saved on this device as you type${d.id ? "" : ". Save it to add photos and evidence"}.`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn" disabled={busy} onClick={() => save(false)}>Save draft</button><button className="btn primary" disabled={busy || (d.kind === "checklist" && !d.items.length)} onClick={() => save(true)}>Submit for approval</button></>}>
      <div className="grid g3" style={{ gap: 0, columnGap: 12 }}>
        <Field label={settings.unitLabel}><select className="select" style={{ width: "100%" }} value={d.unitId} onChange={(e) => setD({ ...d, unitId: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Month reviewed"><select className="select" style={{ width: "100%" }} value={d.period} onChange={(e) => setD({ ...d, period: e.target.value })}>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select></Field>
        <Field label="Date keyed"><input className="input" type="date" value={d.entryDate} onChange={(e) => setD({ ...d, entryDate: e.target.value })} /></Field>
      </div>
      {d.kind === "scorecard" && scorecard ? (
        <>
          {Array.from(new Set(scorecard.measures.filter((m) => m.kind === "input").map((m) => m.group || "Measures"))).map((g) => (
            <fieldset key={g} className="card" style={{ marginTop: 14, padding: 14 }}>
              <legend className="eyebrow" style={{ padding: "0 6px" }}>{g}</legend>
              <div className="grid g2" style={{ gap: 0, columnGap: 12 }}>
                {scorecard.measures.filter((m) => m.kind === "input" && (m.group || "Measures") === g).map((m) => (
                  <Field key={m.key} label={m.label}><input className="input" inputMode="decimal" value={d.values[m.key] ?? ""} onChange={(e) => setD({ ...d, values: { ...d.values, [m.key]: e.target.value.replace(/[^0-9.]/g, "") } })} placeholder="0–100" /></Field>
                ))}
              </div>
            </fieldset>
          ))}
          {scorecard.audit && <Field label="Audit grade"><select className="select" value={d.auditGrade} onChange={(e) => setD({ ...d, auditGrade: e.target.value })}><option value="">No audit this month</option>{["A", "B+", "B", "C", "D"].map((g) => <option key={g}>{g}</option>)}</select></Field>}
        </>
      ) : (
        <>
          <div className="row between mt2"><div className="eyebrow">{d.items.length} {settings.itemLabel.toLowerCase()}{d.items.length === 1 ? "" : "s"} · {totals.def} defects · {totals.inst ? pct(totals.def / totals.inst) : "—"}</div><button className="btn sm" onClick={addItem}><Icon name="plus" />Add {settings.itemLabel.toLowerCase()}</button></div>
          {d.items.map((it, i) => {
            const a = area(it.areaId);
            const f = failed(it);
            return (
              <fieldset key={i} className="card" style={{ marginTop: 10, padding: 14 }}>
                <legend className="eyebrow" style={{ padding: "0 6px" }}>{settings.itemLabel} {i + 1}</legend>
                <div className="grid g3" style={{ gap: 0, columnGap: 10 }}>
                  <Field label="Process area"><select className="select" style={{ width: "100%" }} value={it.areaId} onChange={(e) => setItem(i, { areaId: e.target.value, checks: {}, nature: "" })}>{program.areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
                  <Field label="Type"><select className="select" style={{ width: "100%" }} value={it.itemType} onChange={(e) => setItem(i, { itemType: e.target.value })}>{settings.itemTypes.map((t) => <option key={t}>{t}</option>)}</select></Field>
                  <Field label="Reference"><input className="input" value={it.reference} onChange={(e) => setItem(i, { reference: e.target.value })} placeholder="File or transaction no." /></Field>
                </div>
                <ul className="list" style={{ marginTop: 8 }}>
                  {(a?.checks || []).map((c) => {
                    const v = it.checks[c.code] ?? "yes";
                    return (
                      <li key={c.code} style={{ flexWrap: "wrap", padding: "8px 0" }}>
                        <span className="grow" style={{ minWidth: 180 }}>{c.label} <span className="pill" data-band={SEVERITY_BAND[c.severity]}>{c.severity}</span></span>
                        <span className="chips" role="radiogroup" aria-label={c.label}>
                          {(["yes", "no", "na"] as const).map((o) => <button type="button" key={o} role="radio" aria-checked={v === o} className={`chip ${v === o ? "on" : ""}`} onClick={() => setItem(i, { checks: { ...it.checks, [c.code]: o } })}>{o === "yes" ? "Pass" : o === "no" ? "Fail" : "N/A"}</button>)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {settings.instanceBasis === "item" && <Field label="Defects on this item"><input className="input" type="number" min={0} max={99} value={Math.max(f, it.defects)} onChange={(e) => setItem(i, { defects: Number(e.target.value) || 0 })} /></Field>}
                {(f > 0 || it.defects > 0) && (
                  <div className="grid g2" style={{ gap: 0, columnGap: 10 }}>
                    <Field label="Nature of the defect">
                      <input className="input" list={`natures-${i}`} value={it.nature} onChange={(e) => setItem(i, { nature: e.target.value })} />
                      <datalist id={`natures-${i}`}>{(a?.natures || []).map((n) => <option key={n.id} value={n.label} />)}</datalist>
                    </Field>
                    <div className="row wrap" style={{ marginTop: 30 }}>
                      <label className="row"><input type="checkbox" checked={it.recurring} onChange={(e) => setItem(i, { recurring: e.target.checked })} />Recurring</label>
                      <label className="row"><input type="checkbox" checked={it.status === "resolved"} onChange={(e) => setItem(i, { status: e.target.checked ? "resolved" : "open" })} />Already fixed</label>
                    </div>
                  </div>
                )}
                <button className="btn sm ghost mt" onClick={() => setD((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))}>Remove</button>
              </fieldset>
            );
          })}
          {!d.items.length && <Empty icon="review" title={`Add the first ${settings.itemLabel.toLowerCase()} you sampled`}>Each one is tested against its process area's checklist.</Empty>}
        </>
      )}
      {d.id && (
        <label className="btn sm mt"><Icon name="camera" />Add photos or evidence<input type="file" multiple accept="image/*,application/pdf" capture="environment" className="sr" onChange={(e) => upload(e.target.files)} /></label>
      )}
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
    </Sheet>
  );
}

function Viewer({ r, scorecard, onClose }: { r: ReviewView; scorecard: ScorecardDef | null; onClose: () => void }) {
  const { actor, program, refresh, areaName } = useApp();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const canDecide = r.status === "submitted" && !approveBlocker(actor, r);
  const label = (areaId: string, code: string) => program.areas.find((a) => a.id === areaId)?.checks.find((c) => c.code === code)?.label || code;
  const decide = async (decision: "approve" | "return") => {
    setBusy(true); setMsg(null);
    try { await api(`/api/reviews/${r.id}/decision`, "POST", { decision, note }); refresh(); onClose(); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); setBusy(false); }
  };
  return (
    <Sheet title={`${r.ref} · ${r.unitName}`} sub={`${monthLabel(r.period)} · keyed by ${r.inspectorEmail} on ${fmtDate(r.entryDate)}`} onClose={onClose}
      footer={canDecide ? <><button className="btn" disabled={busy} onClick={() => decide("return")}>Return with note</button><button className="btn primary" disabled={busy} onClick={() => decide("approve")}>Approve and publish</button></> : undefined}>
      <div className="row wrap"><span className={`status st-${r.status}`}>{STATUS[r.status]}</span>{r.kind === "checklist" && <span className="sub">{r.totals.sample} sampled · {r.totals.defects} defects · {pct(r.totals.defectRate)}</span>}</div>
      {r.note && <Msg kind="info">Supervisor note: {r.note}</Msg>}
      {r.kind === "scorecard" && scorecard ? (
        <dl className="kv mt">{scorecard.measures.filter((m) => m.kind === "input").map((m) => <Fragment key={m.key}><dt>{m.label}</dt><dd>{r.scorecardValues?.[m.key] ?? "—"}</dd></Fragment>)}{scorecard.audit && <><dt>Audit grade</dt><dd>{r.auditGrade || "—"}</dd></>}</dl>
      ) : (
        <div className="tablewrap mt"><table className="t">
          <thead><tr><th scope="col">#</th><th scope="col">Area</th><th scope="col">Failed checks</th><th scope="col">Nature</th></tr></thead>
          <tbody>{r.items.map((i) => { const fails = Object.entries(i.checks).filter(([, v]) => v === "no").map(([k]) => label(i.areaId, k)); return (
            <tr key={i.idx}><td>{i.idx + 1}{i.reference && <div className="sub">{i.reference}</div>}</td><td>{areaName(i.areaId)}</td><td>{fails.length ? fails.join(", ") : i.defects ? `${i.defects} defect(s)` : <span className="sub">All passed</span>}</td><td>{i.nature || "—"}{i.recurring && <div><span className="pill" data-band="attention">Recurring</span></div>}</td></tr>); })}</tbody>
        </table></div>
      )}
      {r.evidence.length > 0 && <><div className="eyebrow mt2">Evidence</div><ul className="list">{r.evidence.map((e) => <li key={e.id}><Icon name="file" /><a href={`/api/evidence/${e.id}?inline=1`} target="_blank" rel="noreferrer">{e.name}</a></li>)}</ul></>}
      {canDecide && <Field label="Note to the inspector (required to return)"><textarea className="textarea" value={note} onChange={(e) => setNote(e.target.value)} /></Field>}
      {r.status === "submitted" && !canDecide && <Msg kind="info">{approveBlocker(actor, r)}</Msg>}
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
      <div className="eyebrow mt2">History</div>
      <ol className="timeline mt">{r.history.slice().reverse().map((h, i) => <li key={i}><strong>{STATUS[h.status] || h.status}</strong> · {h.by}<br /><span className="sub">{fmtDateTime(h.at)}</span>{h.note && <div>{h.note}</div>}</li>)}</ol>
    </Sheet>
  );
}
