"use client";
// The set-up wizard: from sign-up to the first inspection in a few minutes.
// 1 sector · 2 what you call things · 3 your locations · 4 starter checklists ·
// 5 a scorecard · 6 review. Everything stays editable afterwards (Templates,
// Scorecards, Settings → Company set-up), and it never removes anything.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Card, Field, Msg, PageHead } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";
import { LIBRARY } from "@/lib/templates/library";
import { SCORECARD_LIBRARY } from "@/lib/scorecards/library";
import { SECTORS, SECTOR_INFO, type Sector } from "@/lib/templates/model";
import { plural } from "@/lib/settings";
import { can } from "@/lib/roles";

const STEPS = ["Sector", "Names", "Locations", "Checklists", "Scorecard", "Finish"];
const SECTOR_ICON: Record<Sector, IconName> = { banking: "card", healthcare: "users", government: "building", higher_ed: "globe", general: "layers" };
const UNIT_CHOICES: Record<Sector, string[]> = {
  banking: ["Branch", "Office", "Agency", "Store"], healthcare: ["Ward", "Clinic", "Department", "Unit", "Facility"], government: ["Office", "Agency", "Service centre", "Depot"],
  higher_ed: ["Campus", "Building", "Faculty", "Department"], general: ["Site", "Store", "Location", "Facility", "Plant"],
};

function parse(text: string) {
  const out: { name: string; group: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const [n, g] = line.split(/\t|,|;/).map((x) => (x || "").replace(/\s+/g, " ").trim());
    if (!n || /^(name|site|branch|location|ward|campus|office)s?$/i.test(n) || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase()); out.push({ name: n.slice(0, 80), group: (g || "").slice(0, 80) });
  }
  return out.slice(0, 500);
}

export function SetupWizard() {
  const app = useApp();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [sector, setSector] = useState<Sector>(app.settings.setupDone ? app.settings.sector : "healthcare");
  const [unit, setUnit] = useState(app.settings.setupDone ? app.settings.unitLabel : SECTOR_INFO.healthcare.unit);
  const [units, setUnits] = useState(app.settings.setupDone ? app.settings.unitPlural : SECTOR_INFO.healthcare.units);
  const [group, setGroup] = useState(app.settings.setupDone ? app.settings.groupLabel : SECTOR_INFO.healthcare.group);
  const [item, setItem] = useState(app.settings.setupDone ? app.settings.itemLabel : SECTOR_INFO.healthcare.item);
  const [text, setText] = useState("");
  const [one, setOne] = useState({ name: "", group: "" });
  const [list, setList] = useState<{ name: string; group: string }[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set(LIBRARY.filter((e) => e.sector === "healthcare").slice(0, 4).map((e) => e.key)));
  const [card, setCard] = useState<string>("ward-quality");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ units: number; templates: number; scorecard: boolean } | null>(null);

  const chooseSector = (s: Sector) => {
    setSector(s);
    const i = SECTOR_INFO[s];
    setUnit(i.unit); setUnits(i.units); setGroup(i.group); setItem(i.item);
    setPicked(new Set(LIBRARY.filter((e) => e.sector === s).slice(0, 4).map((e) => e.key)));
    setCard(SCORECARD_LIBRARY.find((x) => x.sector === s)?.key ?? "");
  };
  const existing = new Set(app.program.units.map((u) => u.name.toLowerCase()));
  const all = useMemo(() => { const seen = new Set<string>(); return [...list, ...parse(text)].filter((l) => { const k = l.name.toLowerCase(); if (seen.has(k) || existing.has(k)) return false; seen.add(k); return true; }); }, [list, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = Array.from(new Set(all.map((l) => l.group).filter(Boolean)));

  if (!can.manage(app.actor)) return <Card><p>Only a Quality admin sets the organisation up.</p></Card>;

  const finish = async () => {
    setBusy(true); setErr(null);
    try {
      const j = await api<{ summary: { units: number; templates: number; scorecard: boolean } }>("/api/setup", "POST", { sector, unitLabel: unit, unitPlural: units, groupLabel: group, itemLabel: item, locations: all, templates: Array.from(picked), scorecard: card });
      setDone(j.summary); router.refresh();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  if (done) return (
    <div className="wizard">
      <div className="hero" style={{ marginBottom: 18 }}>
        <div className="eyebrow">Set up</div>
        <div className="hero-big" style={{ fontSize: 40 }}>You're ready.</div>
        <div className="hero-sub">{done.units} {units.toLowerCase()} added · {done.templates} checklists published · {done.scorecard ? "your scorecard is on the dashboards" : "no scorecard yet"}.</div>
      </div>
      <div className="grid g3">
        <Link className="stat" href="/inspect"><div className="stat-row"><span className="badge sm" aria-hidden="true"><Icon name="play" /></span><div><div className="h2" style={{ fontSize: 15 }}>Start the first inspection</div><div className="stat-l">On a phone, even offline</div></div></div></Link>
        <Link className="stat" href="/templates"><div className="stat-row"><span className="badge sm" aria-hidden="true"><Icon name="layers" /></span><div><div className="h2" style={{ fontSize: 15 }}>Adapt your checklists</div><div className="stat-l">Questions, weights, logic</div></div></div></Link>
        <Link className="stat" href="/settings#settings-people"><div className="stat-row"><span className="badge sm" aria-hidden="true"><Icon name="users" /></span><div><div className="h2" style={{ fontSize: 15 }}>Give people their roles</div><div className="stat-l">Inspectors, supervisors, managers</div></div></div></Link>
      </div>
    </div>
  );

  const top = () => { try { window.scrollTo({ top: 0 }); } catch { /* */ } };
  const next = () => { setStep((s) => Math.min(STEPS.length - 1, s + 1)); top(); };
  const back = () => { setStep((s) => Math.max(0, s - 1)); top(); };
  return (
    <div className="wizard">
      <PageHead eyebrow={`Set up · step ${step + 1} of ${STEPS.length}`} title="Make Pulsus Quality" accent="yours." lede="A few choices and you're inspecting. Everything here stays editable." />
      <ol className="wsteps" aria-label="Progress">{STEPS.map((s, i) => <li key={s} className={i < step ? "done" : i === step ? "now" : ""} aria-current={i === step ? "step" : undefined}><div className="bar" /><div className="lbl">{s}</div></li>)}</ol>

      {step === 0 && (
        <Card title="What kind of organisation are you?" sub="This sets sensible starting labels, checklists and a scorecard. You can change all of them.">
          <div className="pickgrid" role="radiogroup" aria-label="Sector">
            {SECTORS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={sector === s} className="pick" onClick={() => chooseSector(s)}>
                <span className="badge sm" aria-hidden="true"><Icon name={SECTOR_ICON[s]} /></span>
                <span><span className="t" style={{ display: "block" }}>{SECTOR_INFO[s].label}</span><span className="s" style={{ display: "block" }}>{SECTOR_INFO[s].blurb}</span></span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="What do you call things?" sub="These words appear everywhere: on the dashboards, the forms and the reports.">
          <div className="field" style={{ marginTop: 0 }}><span>A place you inspect is a…</span>
            <div className="chips" role="group" aria-label="Suggestions">{UNIT_CHOICES[sector].map((u) => <button key={u} type="button" className="chip" aria-pressed={unit === u} onClick={() => { setUnit(u); setUnits(plural(u)); }}>{u}</button>)}</div>
          </div>
          <div className="grid g2" style={{ gap: 12 }}>
            <Field label="Singular"><input className="input" value={unit} onChange={(e) => { setUnit(e.target.value); setUnits(plural(e.target.value || "Site")); }} /></Field>
            <Field label="Plural"><input className="input" value={units} onChange={(e) => setUnits(e.target.value)} /></Field>
            <Field label={`${units} are grouped by`} hint="Region, Hospital, Agency, Faculty… (optional)"><input className="input" value={group} onChange={(e) => setGroup(e.target.value)} /></Field>
            <Field label="A sampled record is a" hint="For file and record reviews: File, Chart, Case file, Record…"><input className="input" value={item} onChange={(e) => setItem(e.target.value)} /></Field>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card title={`Add your ${units.toLowerCase()}`} sub={`One at a time, or paste a list from Excel: one per line, with the ${group.toLowerCase() || "group"} after a comma or tab.`}>
          <div className="row wrap" style={{ alignItems: "flex-end", gap: 10 }}>
            <Field label={`${unit} name`}><input className="input" value={one.name} onChange={(e) => setOne({ ...one, name: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && one.name.trim()) { setList((l) => [...l, { name: one.name.trim(), group: one.group.trim() }]); setOne({ name: "", group: one.group }); } }} /></Field>
            <Field label={group || "Group"}><input className="input" value={one.group} onChange={(e) => setOne({ ...one, group: e.target.value })} /></Field>
            <button className="btn" style={{ marginBottom: 1 }} disabled={!one.name.trim()} onClick={() => { setList((l) => [...l, { name: one.name.trim(), group: one.group.trim() }]); setOne({ name: "", group: one.group }); }}><Icon name="plus" />Add</button>
          </div>
          <Field label="Or paste a list"><textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={sector === "healthcare" ? "Ward 4A, St Mary's Hospital\nWard 4B, St Mary's Hospital\nEmergency Department, General Hospital" : sector === "higher_ed" ? "North Campus, Engineering\nCity Campus, Arts" : "Downtown, North region\nHarbour, South region"} /></Field>
          {app.program.units.length > 0 && <p className="sub">You already have {app.program.units.length} {units.toLowerCase()}; they're kept.</p>}
          <div className="mt">
            <div className="eyebrow">{all.length} to add{groups.length ? ` · ${groups.length} ${(group || "group").toLowerCase()}${groups.length === 1 ? "" : "s"}` : ""}</div>
            {all.length > 0 && <div className="chips static mt" style={{ marginTop: 8 }}>{all.slice(0, 60).map((l) => <span key={l.name} className="pill">{l.name}{l.group && <span className="sub" style={{ fontWeight: 500 }}> · {l.group}</span>}</span>)}{all.length > 60 && <span className="pill">+{all.length - 60} more</span>}</div>}
          </div>
        </Card>
      )}

      {step === 3 && (
        <Card title="Pick your starter checklists" sub={`Published straight away so inspectors can start; adapt them in the builder any time. Showing ${SECTOR_INFO[sector].label.toLowerCase()} first.`}>
          {[sector, ...SECTORS.filter((s) => s !== sector)].map((s) => (
            <div key={s} className="mt">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{SECTOR_INFO[s].label}</div>
              <div className="pickgrid">
                {LIBRARY.filter((e) => e.sector === s).map((e) => {
                  const on = picked.has(e.key);
                  return (
                    <button key={e.key} type="button" role="checkbox" aria-checked={on} className="pick" onClick={() => setPicked((p) => { const n = new Set(p); if (on) n.delete(e.key); else n.add(e.key); return n; })}>
                      <span className={`tick`} aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 6, border: "2px solid var(--dim)", display: "grid", placeItems: "center", background: on ? "var(--red)" : "transparent", borderColor: on ? "var(--red)" : undefined, color: "#fff", flex: "none" }}>{on && <Icon name="check" width={14} height={14} />}</span>
                      <span><span className="t" style={{ display: "block" }}>{e.def.name}</span><span className="s" style={{ display: "block" }}>{e.def.sections.reduce((t, x) => t + x.questions.length, 0)} questions · {e.def.category}{e.def.sampling ? " · sampled" : ""}</span></span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}

      {step === 4 && (
        <Card title="Choose a scorecard" sub="One monthly score per site. Measures can read your checklists' inspections. Design your own later under Scorecards.">
          <div className="pickgrid" role="radiogroup" aria-label="Scorecard">
            {[...SCORECARD_LIBRARY.filter((x) => x.sector === sector), ...SCORECARD_LIBRARY.filter((x) => x.sector !== sector)].map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={card === s.key} className="pick" onClick={() => setCard(s.key)}>
                <span className="badge sm navy" aria-hidden="true"><Icon name="target" /></span>
                <span><span className="t" style={{ display: "block" }}>{s.def.name}</span><span className="s" style={{ display: "block" }}>{s.blurb}</span></span>
              </button>
            ))}
            <button type="button" role="radio" aria-checked={card === ""} className="pick" onClick={() => setCard("")}>
              <span className="badge sm" aria-hidden="true"><Icon name="close" /></span>
              <span><span className="t" style={{ display: "block" }}>Not now</span><span className="s" style={{ display: "block" }}>Use inspection scores only.</span></span>
            </button>
          </div>
        </Card>
      )}

      {step === 5 && (
        <Card title="Ready to go" sub="This adds; it never removes. The change history records it.">
          <dl className="kv">
            <dt>Sector</dt><dd>{SECTOR_INFO[sector].label}</dd>
            <dt>Labels</dt><dd>{unit} / {units}{group ? ` · grouped by ${group}` : ""} · sampled {item.toLowerCase()}s</dd>
            <dt>{units}</dt><dd>{all.length ? `${all.length} new: ${all.slice(0, 6).map((l) => l.name).join(", ")}${all.length > 6 ? "…" : ""}` : "None new"}</dd>
            <dt>Checklists</dt><dd>{picked.size ? LIBRARY.filter((e) => picked.has(e.key)).map((e) => e.def.name).join(" · ") : "None"}</dd>
            <dt>Scorecard</dt><dd>{SCORECARD_LIBRARY.find((x) => x.key === card)?.def.name ?? "Not now"}</dd>
          </dl>
          {!all.length && !app.program.units.length && <Msg kind="info">You haven't added any {units.toLowerCase()} yet. Inspections need at least one.</Msg>}
          <Msg kind="err">{err}</Msg>
        </Card>
      )}

      <div className="row mt2" style={{ justifyContent: "space-between" }}>
        <button className="btn" onClick={back} disabled={step === 0}><Icon name="back" />Back</button>
        {step < STEPS.length - 1 ? <button className="btn primary" onClick={next}>Continue<Icon name="chevron" /></button> : <button className="btn primary" disabled={busy || (!all.length && !app.program.units.length)} onClick={finish}><Icon name="check" />{busy ? "Setting up…" : "Finish set-up"}</button>}
      </div>
    </div>
  );
}
