"use client";
// Scorecards: the organisation's own monthly site score (the Operational
// Standard is one ready-made example), and ready-made scorecards by sector to
// copy and adapt in the designer. One scorecard is shown on the dashboards.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Empty, Msg, PageHead, fmtDate } from "@/components/ui";
import { Icon } from "@/components/icons";
import { SCORECARD_LIBRARY } from "@/lib/scorecards/library";
import { SECTOR_INFO } from "@/lib/templates/model";
import type { ScorecardView } from "@/lib/scorecards/store";
import { can } from "@/lib/roles";

export function Scorecards({ scorecards }: { scorecards: ScorecardView[] }) {
  const app = useApp();
  const router = useRouter();
  const admin = can.manage(app.actor);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const create = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setErr(null);
    try { const j = await api<{ scorecard: ScorecardView }>("/api/scorecards", "POST", body); router.push(`/scorecards/${j.scorecard.id}`); }
    catch (e) { setErr((e as Error).message); setBusy(""); }
  };
  const lib = [...SCORECARD_LIBRARY].sort((a, b) => (a.sector === app.settings.sector ? -1 : 0) - (b.sector === app.settings.sector ? -1 : 0));
  return (
    <>
      <PageHead eyebrow="Scorecards" title="Your score," accent="your way."
        lede={`One monthly score for every ${app.settings.unitLabel.toLowerCase()}: measures you enter, measures computed from others, and measures taken straight from approved inspections. Weights, a target and rounding are yours; published versions are locked.`}
        right={admin ? <button className="btn primary" disabled={!!busy} onClick={() => create({ from: "blank", name: "New scorecard" }, "blank")}><Icon name="plus" />New scorecard</button> : undefined} />
      <Msg kind="err">{err}</Msg>
      <h2 className="h2" style={{ margin: "8px 0 10px" }}>Ours</h2>
      {scorecards.length ? (
        <div className="tgrid">
          {scorecards.map((s) => (
            <article key={s.id} className="tcard">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <span className="badge sm" aria-hidden="true"><Icon name="target" /></span>
                <div className="grow"><h3>{s.name}</h3><div className="sub" style={{ fontSize: 12.5 }}>{s.definition.measures.length} measures · target {s.definition.target}</div></div>
              </div>
              <div className="tmeta">
                {s.active && <span className="pill sm" data-band="strong">On the dashboards</span>}
                <span className={`status ${!s.version ? "st-draft" : s.dirty ? "st-submitted" : "st-published"}`}>{!s.version ? "Draft" : s.dirty ? `v${s.version} · changes not published` : `Published · v${s.version}`}</span>
                <span>· {s.entries} monthly entries</span>
              </div>
              <div className="sub" style={{ fontSize: 12 }}>Updated {fmtDate(s.updatedAt)}{s.updatedBy ? ` by ${s.updatedBy}` : ""}</div>
              <div className="row wrap tfoot">
                <Link className="btn sm" href={`/scorecards/${s.id}`}><Icon name={admin ? "pen" : "eye"} />{admin ? "Design" : "View"}</Link>
                {admin && <button className="btn sm" disabled={!!busy} onClick={() => create({ from: "copy", copyOf: s.id }, s.id)}><Icon name="copy" />Copy</button>}
              </div>
            </article>
          ))}
        </div>
      ) : <Card><Empty icon="target" title="No scorecard yet">Copy a ready-made one below, or start from blank.</Empty></Card>}
      <h2 className="h2" style={{ margin: "26px 0 10px" }}>Ready-made</h2>
      <div className="tgrid">
        {lib.map((e) => (
          <article key={e.key} className="tcard">
            <div className="row" style={{ alignItems: "flex-start" }}>
              <span className="badge sm navy" aria-hidden="true"><Icon name="target" /></span>
              <div className="grow"><h3>{e.def.name}</h3><div className="sub" style={{ fontSize: 12.5 }}>{SECTOR_INFO[e.sector].label}</div></div>
            </div>
            <p>{e.blurb}</p>
            <div className="tmeta"><span>{e.def.measures.filter((m) => m.kind !== "computed").length} measures</span><span>· {e.def.measures.filter((m) => m.kind === "computed").length} computed</span>{e.def.measures.some((m) => m.kind === "inspection") && <span>· reads checklists</span>}<span>· target {e.def.target}</span></div>
            {admin && <div className="row wrap tfoot"><button className="btn sm primary" disabled={!!busy} onClick={() => create({ from: "library", libraryKey: e.key }, e.key)} aria-label={`Copy and adapt: ${e.def.name}`}><Icon name="copy" />Copy and adapt</button></div>}
          </article>
        ))}
      </div>
    </>
  );
}
