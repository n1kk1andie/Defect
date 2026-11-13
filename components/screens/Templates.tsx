"use client";
// Templates: the organisation's own checklists, and the library of starter
// templates by sector (banking, healthcare, government, higher education,
// general). Add one from the library, start blank, import a spreadsheet, or
// open one in the builder. Publishing locks a version; inspections keep theirs.
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Empty, Msg, PageHead, Seg, Sheet, fmtDate } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { InspectionForm, type FormState } from "@/components/inspect/Form";
import { LIBRARY, type LibraryEntry } from "@/lib/templates/library";
import { SECTORS, SECTOR_INFO, type Sector, type TemplateDef } from "@/lib/templates/model";
import type { TemplateDetail, TemplateSummary } from "@/lib/templates/store";
import { can } from "@/lib/roles";

const ICON = (k: string): IconName => (["building", "card", "file", "alert", "eye", "help", "check", "lock", "users", "database", "globe", "link", "review"].includes(k) ? (k as IconName) : "review");

export function statusOf(t: Pick<TemplateSummary, "status" | "version" | "dirty">): { label: string; cls: string } {
  if (t.status === "archived") return { label: "Archived", cls: "st-draft" };
  if (!t.version) return { label: "Draft", cls: "st-draft" };
  if (t.dirty) return { label: `v${t.version} · changes not published`, cls: "st-submitted" };
  return { label: `Published · v${t.version}`, cls: "st-published" };
}

export function Templates({ templates }: { templates: TemplateSummary[] }) {
  const app = useApp();
  const router = useRouter();
  const builder = can.buildTemplates(app.actor);
  const [tab, setTab] = useState<"ours" | "library">(templates.length ? "ours" : "library");
  const [sector, setSector] = useState<Sector | "all">(app.settings.sector || "all");
  const [preview, setPreview] = useState<{ def: TemplateDef; key?: string; id?: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const ours = templates.filter((t) => showArchived || t.status !== "archived");
  const archived = templates.filter((t) => t.status === "archived").length;
  const added = new Set(templates.map((t) => t.origin));
  const lib = useMemo(() => LIBRARY.filter((e) => sector === "all" || e.sector === sector), [sector]);

  const create = async (body: Record<string, unknown>, label: string) => {
    setBusy(label); setMsg(null);
    try { const j = await api<{ template: TemplateDetail }>("/api/templates", "POST", body); router.push(`/templates/${j.template.id}`); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); setBusy(""); }
  };
  const importFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy("import"); setMsg(null);
    const fd = new FormData(); fd.append("file", f);
    try { const j = await api<{ template: TemplateDetail }>("/api/templates/import", "POST", fd); router.push(`/templates/${j.template.id}`); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); setBusy(""); }
  };

  return (
    <>
      <PageHead eyebrow="Templates" title="Your checklists," accent="built in minutes."
        lede={`Every inspection, field visit and file review starts from a template: sections, questions, weights, critical items, logic and evidence. Publish a version and your ${app.settings.unitPlural.toLowerCase()} can use it straight away.`}
        right={builder ? <>
          <Link className="btn" href="/scorecards"><Icon name="target" />Scorecards</Link>
          <button className="btn" disabled={!!busy} onClick={() => file.current?.click()}><Icon name="upload" />Import</button>
          <input ref={file} type="file" accept=".xlsx,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr" aria-label="Import a template (Excel or JSON)" onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="btn primary" disabled={!!busy} onClick={() => create({ from: "blank", sector: app.settings.sector, name: "Untitled template" }, "blank")}><Icon name="plus" />New template</button>
        </> : undefined} />
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
      <div className="row wrap between" style={{ margin: "4px 0 16px" }}>
        <Seg label="Templates" value={tab} onChange={setTab} options={[{ value: "ours", label: `Ours (${templates.filter((t) => t.status !== "archived").length})` }, { value: "library", label: `Library (${LIBRARY.length})` }]} />
        {tab === "ours" && archived > 0 && <label className="toggle"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived ({archived})</label>}
      </div>

      {tab === "ours" ? (
        ours.length ? (
          <div className="tgrid">
            {ours.map((t) => {
              const st = statusOf(t);
              return (
                <article key={t.id} className="tcard">
                  <div className="row" style={{ alignItems: "flex-start" }}>
                    <span className="badge sm" aria-hidden="true"><Icon name={t.binding?.kind === "scorecard" ? "target" : t.sampled ? "file" : "clipboard"} /></span>
                    <div className="grow"><h3>{t.name}</h3><div className="sub" style={{ fontSize: 12.5 }}>{t.category}{t.binding?.kind === "defects" ? ` · feeds ${app.settings.unitLabel} Defects` : t.binding?.kind === "scorecard" ? " · feeds the scorecard" : ""}</div></div>
                  </div>
                  <p>{t.description || "No description yet."}</p>
                  <div className="tmeta"><span className={`status ${st.cls}`}>{st.label}</span><span>{t.questions} questions</span>{t.sampled && <span>· sampled</span>}<span>· {t.inspections} inspection{t.inspections === 1 ? "" : "s"}</span></div>
                  <div className="sub" style={{ fontSize: 12 }}>Updated {fmtDate(t.updatedAt)}{t.updatedBy ? ` by ${t.updatedBy}` : ""}</div>
                  <div className="row wrap tfoot">
                    {t.version > 0 && t.status !== "archived" && can.inspect(app.actor) && <Link className="btn sm primary" href={`/inspect/new?template=${t.id}`}><Icon name="play" />Start</Link>}
                    {builder ? <Link className="btn sm" href={`/templates/${t.id}`}><Icon name="pen" />{t.version ? "Edit" : "Build"}</Link> : <Link className="btn sm" href={`/templates/${t.id}`}><Icon name="eye" />View</Link>}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Card><Empty icon="layers" title="No templates yet">Add one from the library, start from blank, or import the checklist you already keep in Excel.</Empty>
            <div className="row" style={{ justifyContent: "center" }}><button className="btn primary" onClick={() => setTab("library")}><Icon name="layers" />Browse the library</button></div></Card>
        )
      ) : (
        <>
          <div className="chips scroll" role="group" aria-label="Sector">
            {(["all", ...SECTORS] as const).map((s) => <button key={s} type="button" className="chip" aria-pressed={sector === s} onClick={() => setSector(s)}>{s === "all" ? "All sectors" : SECTOR_INFO[s].label}{s === app.settings.sector && <span className="sub" style={{ fontSize: 11, color: "inherit", opacity: .75 }}> · yours</span>}</button>)}
          </div>
          {(sector === "all" ? SECTORS : [sector]).map((s) => {
            const list = lib.filter((e) => e.sector === s);
            if (!list.length) return null;
            return (
              <section key={s} aria-labelledby={`sector-${s}`}>
                <div className="sectorhead"><h2 id={`sector-${s}`}>{SECTOR_INFO[s].label}</h2><span className="sub">{SECTOR_INFO[s].blurb}</span></div>
                <div className="tgrid">
                  {list.map((e) => <LibraryCard key={e.key} e={e} added={added.has(`library:${e.key}`)} canAdd={builder} busy={busy === e.key} onPreview={() => setPreview({ def: e.def, key: e.key })} onAdd={() => create({ from: "library", libraryKey: e.key }, e.key)} />)}
                </div>
              </section>
            );
          })}
        </>
      )}
      {preview && <PreviewSheet def={preview.def} onClose={() => setPreview(null)} footer={builder && preview.key ? <button className="btn primary" disabled={!!busy} onClick={() => create({ from: "library", libraryKey: preview.key }, preview.key!)}><Icon name="plus" />Add to our templates</button> : undefined} />}
    </>
  );
}

function LibraryCard({ e, added, canAdd, busy, onPreview, onAdd }: { e: LibraryEntry; added: boolean; canAdd: boolean; busy: boolean; onPreview: () => void; onAdd: () => void }) {
  const q = e.def.sections.reduce((t, s) => t + s.questions.length, 0);
  const crit = e.def.sections.reduce((t, s) => t + s.questions.filter((x) => x.critical).length, 0);
  return (
    <article className="tcard">
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="badge sm" aria-hidden="true"><Icon name={ICON(e.icon)} /></span>
        <div className="grow"><h3>{e.def.name}</h3><div className="sub" style={{ fontSize: 12.5 }}>{e.def.category}</div></div>
      </div>
      <p>{e.def.description}</p>
      <div className="tmeta"><span>{q} questions</span><span>· {crit} critical</span><span>· about {e.minutes} min</span>{e.def.sampling && <span>· sampled by {e.def.sampling.itemLabel.toLowerCase()}</span>}</div>
      <div className="row wrap tfoot">
        <button className="btn sm" onClick={onPreview} aria-label={`Preview ${e.def.name}`}><Icon name="eye" />Preview</button>
        {canAdd && <button className="btn sm primary" disabled={busy} onClick={onAdd} aria-label={`${added ? "Add another copy" : "Add"}: ${e.def.name}`}><Icon name="plus" />{added ? "Add another copy" : "Add"}</button>}
        {added && <span className="pill sm" data-band="strong">Added</span>}
      </div>
    </article>
  );
}

export function PreviewSheet({ def, onClose, footer }: { def: TemplateDef; onClose: () => void; footer?: React.ReactNode }) {
  const [state, setState] = useState<FormState>({ answers: {}, items: def.sections.some((s) => s.perItem) ? [{ ref: "", answers: {} }] : [] });
  return (
    <Sheet title={def.name} sub={`Preview · ${def.sections.length} section${def.sections.length === 1 ? "" : "s"} · pass mark ${def.scoring.passMark}%`} onClose={onClose} footer={footer}>
      {def.description && <p className="sub" style={{ marginTop: 0 }}>{def.description}</p>}
      <InspectionForm def={def} state={state} onChange={setState} preview />
    </Sheet>
  );
}
