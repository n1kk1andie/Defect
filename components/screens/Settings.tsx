"use client";
import Link from "next/link";
// Settings: one organisation, grouped, drill-down (the Pulsus suite standard).
// A menu of groups; each row shows its current state in one line and opens its
// own page with a Back control and a deep link (#settings-<id>). Viewers see
// read-only summaries; admin-only items say why they're locked.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, useApp } from "@/components/app-context";
import { BandPill, Card, Empty, Field, fmtDate, fmtDateTime, Msg, PageHead } from "@/components/ui";
import { SECTOR_INFO } from "@/lib/templates/model";
import { Icon, type IconName } from "@/components/icons";
import { BANDS, CUT_KEYS, FAMILIES, cutoffsFor, legend, type Cutoffs, type FamilyKey, AUDIT_GRADES } from "@/lib/bands";
import { ROLES, ROLE_INFO, can, isAdmin, type Role } from "@/lib/roles";
import { trialDaysLeft } from "@/lib/trial";
import { money, qualityPrice, type QualityPrice } from "@/lib/pricing";
import { SEVERITIES } from "@/lib/settings";
import type { MemberRow, Program } from "@/lib/company";
import type { HistoryRow } from "@/lib/audit";
import type { PlanSummary } from "@/lib/migrator";
import type { UploadPreview } from "@/lib/imports";
import type { ScorecardDef } from "@/lib/scorecard";
import { Developer } from "@/components/screens/Developer";
import { BulkImport } from "@/components/screens/BulkImport";

export interface SettingsData {
  members: MemberRow[];
  history: HistoryRow[];
  historyCount: number;
  imports: { id: string; kind: string; status: string; createdBy: string; createdAt: string; committedBy: string | null; committedAt: string | null }[];
  outbox: { id: string; title: string; severity: string; recordRef: string; status: string; createdBy: string; createdAt: string }[];
  connections: { keys: number; email: boolean; cron: boolean; turnstile: boolean };
  database: { applied: string[]; pending: string[]; kind: string; isolation: string } | null;
  legacyAvailable: boolean;
  scorecard: ScorecardDef | null;
  riskConnected: boolean;
}

type ItemId = "plan" | "setup" | "bands" | "people" | "data" | "bulk" | "measured" | "integrations" | "api" | "alerts" | "history" | "approvals" | "appearance" | "about" | "help";
interface Item { id: ItemId; title: string; icon: IconName; summary: string; admin?: boolean }

export function Settings({ s }: { s: SettingsData }) {
  const app = useApp();
  const { actor, settings, program, data, demo } = app;
  const admin = isAdmin(actor);
  const [open, setOpen] = useState<ItemId | null>(null);
  useEffect(() => {
    const read = () => { const m = window.location.hash.match(/^#settings-([a-z]+)$/); setOpen(m ? (m[1] as ItemId) : null); };
    read(); window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const go = (id: ItemId | null) => { window.location.hash = id ? `settings-${id}` : ""; if (!id) history.replaceState(null, "", window.location.pathname); setOpen(id); window.scrollTo({ top: 0 }); };
  const days = actor.plan?.standing === "trial" ? trialDaysLeft(actor.plan.trialEndsAt, Date.now()) : null;
  const custom = FAMILIES.filter((f) => settings.bands[f.key]).length;
  const lastImport = s.imports.find((i) => i.status === "committed");
  const GROUPS: { title: string; items: Item[] }[] = [
    { title: "Organisation", items: [
      { id: "plan", title: "Plan and trial", icon: "card", summary: demo ? "Demo: no plan needed" : actor.kind === "institution" ? "Your institution's own licence" : actor.plan?.standing === "trial" ? `Free trial · ${days ?? "?"} days left` : actor.plan?.standing ? `Plan ${actor.plan.standing.replace("_", " ")}` : "Plan and billing on Pulsus" },
      { id: "setup", title: "Company set-up", icon: "building", summary: `${program.units.filter((u) => u.active).length} ${settings.unitPlural.toLowerCase()} · ${program.areas.length} process areas · ${program.areas.reduce((n, a) => n + a.checks.length, 0)} checks` },
      { id: "bands", title: "Colour bands and targets", icon: "palette", summary: custom ? `${custom} of ${FAMILIES.length} measure families set by your company` : `Pulsus defaults for ${FAMILIES.length} measure families` },
      { id: "people", title: "People and roles", icon: "users", summary: `${s.members.filter((m) => m.status === "active").length} people · ${s.members.filter((m) => m.roles.includes("admin")).length} admin${s.members.filter((m) => m.roles.includes("admin")).length === 1 ? "" : "s"}` },
    ] },
    { title: "Data", items: [
      { id: "data", title: "Data and uploads", icon: "upload", summary: lastImport ? `Last import ${fmtDate(lastImport.committedAt)} by ${lastImport.committedBy}` : s.legacyAvailable ? "Previous version's data ready to import" : "Templates, workbook upload, imports", admin: true },
      { id: "bulk", title: "Bulk import", icon: "file", summary: "Locations, people or actions from Excel or CSV, with column mapping and a preview", admin: true },
      { id: "measured", title: "How it's measured", icon: "target", summary: `${settings.instanceBasis === "check" ? "Each check performed" : `Each ${settings.itemLabel.toLowerCase()}`} is a possible instance · recurring after ${settings.recurringMonths} months` },
    ] },
    { title: "Connections", items: [
      { id: "integrations", title: "Integrations", icon: "link", summary: `Pulsus Platform feed · Pulsus Risk ${s.riskConnected ? "connected" : "proposals stored until Risk connects"} (${s.outbox.length})` },
      { id: "api", title: "API keys", icon: "key", summary: demo ? "Sample keys for the REST API" : `${s.connections.keys} active key${s.connections.keys === 1 ? "" : "s"} for the REST API`, admin: true },
      { id: "alerts", title: "Email alerts", icon: "mail", summary: demo ? "The bell shows what needs you; the demo sends no email" : !s.connections.email ? "The bell shows what needs you; email isn't set up here" : settings.emailAlerts ? "A daily email of what needs each person" : "Daily email off for the company" },
    ] },
    { title: "Governance", items: [
      { id: "history", title: "Change history", icon: "scroll", summary: `${s.historyCount.toLocaleString("en-US")} entries, hash-chained`, admin: true },
      { id: "approvals", title: "Approvals and sign-off rules", icon: "stamp", summary: "Reviews need a supervisor; actions need an independent verifier" },
    ] },
    { title: "Preferences", items: [{ id: "appearance", title: "Appearance", icon: app.theme === "dark" ? "moon" : "sun", summary: app.theme === "dark" ? "Night" : "Day" }] },
    { title: "About", items: [
      { id: "about", title: "About Pulsus Quality", icon: "info", summary: "What it does, pricing, and how it fits Pulsus" },
      { id: "help", title: "Help", icon: "help", summary: "Getting started and support" },
    ] },
  ];
  const item = GROUPS.flatMap((g) => g.items).find((i) => i.id === open);
  if (item) {
    const locked = item.admin && !admin;
    return (
      <>
        <button className="btn sm ghost" onClick={() => go(null)} style={{ paddingLeft: 0 }}><Icon name="back" />Settings</button>
        <PageHead eyebrow="Settings" title={item.title} />
        {locked ? <Card><Empty icon="lock" title="For Quality admins">{item.summary}. Ask a Quality admin if something here needs changing.</Empty></Card> : <Page id={item.id} s={s} />}
      </>
    );
  }
  return (
    <>
      <PageHead eyebrow="Settings" title="Set it up once." accent="Run it every day." lede={`${actor.tenantName}${admin ? "" : " · you can read these settings; a Quality admin changes them"}.`} />
      {GROUPS.map((g) => (
        <section key={g.title} className="sgroup" aria-labelledby={`g-${g.title}`}>
          <h2 id={`g-${g.title}`}>{g.title}</h2>
          <div className="card flush">
            {g.items.map((i) => (
              <a key={i.id} className="sitem" href={`#settings-${i.id}`} onClick={(e) => { e.preventDefault(); go(i.id); }}>
                <span className="badge" aria-hidden="true"><Icon name={i.icon} /></span>
                <span className="grow"><span className="t1" style={{ display: "block" }}>{i.title}</span><span className="t2">{i.summary}</span></span>
                {i.admin && !admin && <span className="lock"><Icon name="lock" width={14} height={14} />Admins</span>}
                <Icon name="chevron" />
              </a>
            ))}
          </div>
        </section>
      ))}
      <p className="sub mt2">Data as of {data.periods.length ? fmtDate(data.periods[data.periods.length - 1]) : "—"}.</p>
    </>
  );
}

function Page({ id, s }: { id: ItemId; s: SettingsData }) {
  switch (id) {
    case "plan": return <PlanPage />;
    case "setup": return <SetupPage />;
    case "bands": return <BandsPage history={s.history} />;
    case "people": return <PeoplePage members={s.members} />;
    case "data": return <DataPage s={s} />;
    case "bulk": return <BulkImport />;
    case "api": return <Developer />;
    case "alerts": return <AlertsPage s={s} />;
    case "measured": return <MeasuredPage scorecard={s.scorecard} />;
    case "integrations": return <IntegrationsPage s={s} />;
    case "history": return <HistoryPage s={s} />;
    case "approvals": return <ApprovalsPage />;
    case "appearance": return <AppearancePage />;
    case "about": return <AboutPage s={s} />;
    case "help": return <HelpPage />;
  }
}

function usePrice() {
  const { platformUrl } = useApp();
  const [p, setP] = useState<QualityPrice | null>(null);
  useEffect(() => { fetch(platformUrl + "/api/pricing", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((l) => setP(qualityPrice(l))).catch(() => {}); }, [platformUrl]);
  return p;
}

function PlanPage() {
  const { actor, billingUrl, platformUrl, demo } = useApp();
  const price = usePrice();
  const days = actor.plan?.standing === "trial" ? trialDaysLeft(actor.plan.trialEndsAt, Date.now()) : null;
  const owner = actor.platformRole === "owner" || actor.platformRole === "admin";
  return (
    <div className="stack">
      <Card title={demo ? "Demo" : actor.plan?.standing === "trial" ? "Free trial" : actor.kind === "institution" ? "Institution licence" : "Your plan"}>
        {demo ? <p>The demo is free to explore and resets to its sample data. Nothing in it is real.</p>
          : actor.plan?.standing === "trial" ? <p><strong>{days === 0 ? "Your free trial ends today." : `${days} days left in your free trial.`}</strong> Everything in Pulsus Quality is open during the trial. Choose a plan before it ends and your team keeps working without a break; your reviews, actions and settings stay exactly as they are.</p>
          : actor.kind === "institution" ? <p>Pulsus Quality runs under your institution's own licence.</p>
          : <p>Your company's plan is <strong>{actor.plan?.standing?.replace("_", " ") ?? "managed on Pulsus"}</strong>.</p>}
        {price && <p className="sub">{price.product}: {money(price.monthly, price.currency)} a month{price.includes ? `, including ${price.includes}` : ""}. Prices are set on Pulsus Platform.</p>}
        {!demo && actor.kind === "company" && <div className="row wrap mt">
          {owner ? <a className="btn primary" href={billingUrl} target="_top">{actor.plan?.standing === "trial" ? "Choose a plan" : "View plan & billing"}</a> : <span className="sub">Ask your company's owner to manage the plan.</span>}
          <a className="btn" href={`${platformUrl}/company#members`} target="_top">Manage the team on Pulsus</a>
        </div>}
      </Card>
    </div>
  );
}

function SetupPage() {
  const { actor, settings, program, refresh } = useApp();
  const admin = can.manage(actor);
  const [labels, setLabels] = useState({ unitLabel: settings.unitLabel, unitPlural: settings.unitPlural, itemLabel: settings.itemLabel, itemTypes: settings.itemTypes.join(", ") });
  const [units, setUnits] = useState(program.units.filter((u) => u.active).map((u) => u.name).join("\n"));
  const [areas, setAreas] = useState<Program["areas"]>(program.areas);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const saveLabels = async () => { setBusy(true); setMsg(null); try { await api("/api/settings", "PATCH", { ...labels, itemTypes: labels.itemTypes.split(",").map((x) => x.trim()).filter(Boolean) }); setMsg({ kind: "ok", text: "Labels saved." }); refresh(); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); } setBusy(false); };
  const saveProgram = async () => {
    setBusy(true); setMsg(null);
    try { await api("/api/program", "PUT", { units: units.split("\n").map((u) => u.trim()).filter(Boolean), areas: areas.map((a) => ({ name: a.name, checks: a.checks.map((c) => ({ code: c.code, label: c.label, severity: c.severity })), natures: a.natures.map((n) => ({ label: n.label, category: n.category })) })) }); setMsg({ kind: "ok", text: "Programme saved. Existing reviews keep the checks they were keyed against." }); refresh(); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  const setArea = (i: number, p: Partial<Program["areas"][number]>) => setAreas((xs) => xs.map((a, j) => (j === i ? { ...a, ...p } : a)));
  if (!admin) return (
    <Card title="Your programme">
      <dl className="kv"><dt>{settings.unitPlural}</dt><dd>{program.units.filter((u) => u.active).map((u) => u.name).join(", ") || "—"}</dd>{program.areas.map((a) => <Fragment key={a.id}><dt>{a.name}</dt><dd>{a.checks.map((c) => `${c.label} (${c.severity})`).join(" · ")}</dd></Fragment>)}</dl>
    </Card>
  );
  return (
    <div className="stack">
      <Card title="Set-up wizard" sub={`Sector: ${SECTOR_INFO[settings.sector].label}. Choose a sector, name your sites, add locations by pasting a list, and pick starter checklists and a scorecard. It only adds.`} actions={<Link className="btn sm primary" href="/setup"><Icon name="play" />Open the wizard</Link>}><span className="sub">Checklists are built under <Link href="/templates">Templates</Link>; the monthly score under <Link href="/scorecards">Scorecards</Link>.</span></Card>
      <Card title="Labels" sub="What your company calls things. Every screen follows them.">
        <div className="grid g4" style={{ gap: 0, columnGap: 12 }}>
          <Field label="A unit is a"><input className="input" value={labels.unitLabel} onChange={(e) => setLabels({ ...labels, unitLabel: e.target.value })} /></Field>
          <Field label="Plural"><input className="input" value={labels.unitPlural} onChange={(e) => setLabels({ ...labels, unitPlural: e.target.value })} /></Field>
          <Field label="What is sampled"><input className="input" value={labels.itemLabel} onChange={(e) => setLabels({ ...labels, itemLabel: e.target.value })} /></Field>
          <Field label="Item types"><input className="input" value={labels.itemTypes} onChange={(e) => setLabels({ ...labels, itemTypes: e.target.value })} /></Field>
        </div>
        <button className="btn mt" disabled={busy} onClick={saveLabels}>Save labels</button>
      </Card>
      <Card title={settings.unitPlural} sub="One per line. Removing one hides it from new work; its history stays.">
        <textarea className="textarea" style={{ minHeight: 160 }} aria-label={settings.unitPlural} value={units} onChange={(e) => setUnits(e.target.value)} />
      </Card>
      <Card title="Process areas, checklists and severities" sub="Each check is pass, fail or not applicable; its severity weights the compliance score." actions={<button className="btn sm" onClick={() => setAreas((xs) => [...xs, { id: `new-${xs.length}`, name: "New process area", checks: [{ id: "", code: "", label: "New check", severity: "major" }], natures: [] }])}><Icon name="plus" />Add area</button>}>
        {areas.map((a, i) => (
          <fieldset key={a.id} className="card" style={{ padding: 14, marginTop: 10 }}>
            <legend className="sr">{a.name}</legend>
            <div className="row"><Field label="Process area"><input className="input" value={a.name} onChange={(e) => setArea(i, { name: e.target.value })} /></Field><button className="btn sm ghost" style={{ marginTop: 28 }} onClick={() => setAreas((xs) => xs.filter((_, j) => j !== i))}>Remove area</button></div>
            {a.checks.map((c, ci) => (
              <div key={ci} className="row wrap" style={{ marginTop: 8 }}>
                <input className="input grow" style={{ minWidth: 200 }} aria-label={`Check ${ci + 1} wording`} value={c.label} onChange={(e) => setArea(i, { checks: a.checks.map((x, k) => (k === ci ? { ...x, label: e.target.value } : x)) })} />
                <select className="select" aria-label={`Check ${ci + 1} severity`} value={c.severity} onChange={(e) => setArea(i, { checks: a.checks.map((x, k) => (k === ci ? { ...x, severity: e.target.value as typeof c.severity } : x)) })}>{SEVERITIES.map((sv) => <option key={sv} value={sv}>{sv}</option>)}</select>
                <button className="iconbtn" aria-label={`Remove check ${ci + 1}`} onClick={() => setArea(i, { checks: a.checks.filter((_, k) => k !== ci) })}><Icon name="close" /></button>
              </div>
            ))}
            <button className="btn sm mt" onClick={() => setArea(i, { checks: [...a.checks, { id: "", code: "", label: "", severity: "major" }] })}><Icon name="plus" />Add check</button>
            <Field label="Defect natures (comma separated)"><input className="input" value={a.natures.map((n) => n.label).join(", ")} onChange={(e) => setArea(i, { natures: e.target.value.split(",").map((x) => ({ id: "", label: x.trim(), category: a.natures.find((n) => n.label === x.trim())?.category || "Process" })).filter((n) => n.label || e.target.value.endsWith(",")) })} /></Field>
          </fieldset>
        ))}
        <Msg kind={msg?.kind}>{msg?.text}</Msg>
        <button className="btn primary mt" disabled={busy} onClick={saveProgram}>Save programme</button>
      </Card>
    </div>
  );
}

function BandsPage({ history }: { history: HistoryRow[] }) {
  const { actor, settings, refresh } = useApp();
  const admin = can.manage(actor);
  const changes = history.filter((h) => h.action === "settings.update" && /bands/.test(h.summary));
  return (
    <div className="stack">
      <p className="lede" style={{ marginTop: 0 }}>The six Pulsus bands, cut for Quality's own measures. Lower is better for defect and recurring rates; higher for resolution and the {settings.scorecard ? "Operational Standard score" : "scorecard"}. Audit grades, the 1–5 rating and severities keep their own labels and borrow the colours.</p>
      {FAMILIES.map((f) => <BandFamily key={f.key} fam={f.key} admin={admin} onSaved={refresh} />)}
      <Card title="Domain scales" sub="Their own labels, the band colours">
        <div className="row wrap">{AUDIT_GRADES.map((g) => <BandPill key={g.grade} band={g.band}>Audit {g.grade}</BandPill>)}</div>
        <div className="row wrap mt">{[5, 4, 3, 2, 1].map((r) => <BandPill key={r} band={(["escalate", "attention", "watch", "strong", "worldClass"] as const)[r - 1]}>Rating {r}</BandPill>)}<BandPill band="escalate">critical</BandPill><BandPill band="attention">major</BandPill><BandPill band="watch">minor</BandPill></div>
      </Card>
      <Card title="Who changed them, and when">
        {changes.length ? <ul className="list">{changes.map((c) => <li key={c.seq}><span className="grow">{c.summary}<br /><span className="sub">{c.actor} · {fmtDateTime(c.at)}</span></span></li>)}</ul> : <p className="sub">Your company uses the Pulsus defaults: nobody has changed them.</p>}
      </Card>
    </div>
  );
}

function BandFamily({ fam, admin, onSaved }: { fam: FamilyKey; admin: boolean; onSaved: () => void }) {
  const { settings } = useApp();
  const f = FAMILIES.find((x) => x.key === fam)!;
  const cur = cutoffsFor(fam, settings.bands);
  const isCustom = !!settings.bands[fam];
  const toForm = (c: Cutoffs) => Object.fromEntries(CUT_KEYS.map((k) => [k, f.unit === "rate" ? String(+(c[k] * 100).toFixed(2)) : String(c[k])])) as Record<string, string>;
  const [form, setForm] = useState(toForm(cur));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const save = async (reset = false) => {
    setBusy(true); setMsg(null);
    try {
      const body = reset ? null : Object.fromEntries(CUT_KEYS.map((k) => [k, f.unit === "rate" ? Number(form[k]) / 100 : Number(form[k])]));
      await api("/api/settings", "PATCH", { bands: { [fam]: body } });
      if (reset) setForm(toForm(f.defaults));
      setMsg({ kind: "ok", text: reset ? "Back to the Pulsus defaults." : "Saved." }); onSaved();
    } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  const lg = legend(fam, settings.bands);
  return (
    <Card title={f.label} sub={`${f.direction === "down" ? "Lower is better" : "Higher is better"} · ${isCustom ? "your company's values" : "Pulsus defaults"}`}>
      <div className="scale" role="img" aria-label={`${f.label} bands: ${lg.map((b) => `${b.label} ${b.range}`).join(", ")}`}>
        {lg.map((b) => <div key={b.key} data-band={b.key}><span>{b.label}<br />{b.range}</span></div>)}
      </div>
      <p className="sub" style={{ marginTop: 10 }}><strong>Applies to:</strong> {f.appliesTo.join(" · ")}</p>
      <p className="sub"><strong>Why:</strong> {f.basis}</p>
      {isCustom && <p className="sub">Default: {legend(fam).filter((b) => b.key !== "escalate").map((b) => `${b.label} ${b.range}`).join(", ")}</p>}
      {admin && (
        <>
          <div className="grid g4" style={{ gap: 0, columnGap: 10, gridTemplateColumns: "repeat(5,minmax(0,1fr))" }}>
            {CUT_KEYS.map((k) => <Field key={k} label={`${BANDS.find((b) => b.key === k)!.label} ${f.direction === "down" ? "≤" : "≥"}${f.unit === "rate" ? " %" : ""}`}><input className="input" inputMode="decimal" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></Field>)}
          </div>
          <div className="row wrap mt"><button className="btn primary sm" disabled={busy} onClick={() => save()}>Save {f.label.toLowerCase()} bands</button>{isCustom && <button className="btn sm" disabled={busy} onClick={() => save(true)}>Reset to default</button>}</div>
        </>
      )}
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
    </Card>
  );
}

function PeoplePage({ members }: { members: MemberRow[] }) {
  const { actor, program, settings, refresh, platformUrl, demo } = useApp();
  const admin = can.manage(actor);
  const [edit, setEdit] = useState<{ email: string; name: string; roles: Role[]; unitIds: string[]; isNew: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const units = new Map(program.units.map((u) => [u.id, u.name]));
  const save = async (status = "active") => {
    if (!edit) return;
    setBusy(true); setMsg(null);
    try { await api("/api/members", "POST", { ...edit, status }); setMsg({ kind: "ok", text: status === "removed" ? `${edit.email} removed.` : `${edit.email} saved.` }); setEdit(null); refresh(); }
    catch (e) { setMsg({ kind: "err", text: (e as Error).message }); }
    setBusy(false);
  };
  return (
    <div className="stack">
      <p className="lede" style={{ marginTop: 0 }}>Everyone signs in as themselves with their Pulsus account (Microsoft sign-in included). Their Quality role is set here, optionally limited to some {settings.unitPlural.toLowerCase()}. {!demo && actor.kind === "company" && <a href={`${platformUrl}/company#members`} target="_top">Invite or remove people on Pulsus</a>}</p>
      <div className="grid g3">{ROLES.map((r) => <div key={r} className="minitile" style={{ display: "block" }}><strong>{ROLE_INFO[r].label}</strong><div className="sub">{ROLE_INFO[r].blurb}</div></div>)}</div>
      <Card flush title="People" actions={admin ? <button className="btn sm primary" onClick={() => setEdit({ email: "", name: "", roles: ["viewer"], unitIds: [], isNew: true })}><Icon name="plus" />Add person</button> : undefined}>
        <div className="tablewrap" tabIndex={0}><table className="t stack">
          <thead><tr><th scope="col">Person</th><th scope="col">Roles</th><th scope="col">{settings.unitPlural}</th><th scope="col">Last seen</th>{admin && <th scope="col"><span className="sr">Edit</span></th>}</tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.email} style={m.status === "removed" ? { opacity: 0.55 } : undefined}>
              <td data-label="Person"><strong>{m.name || m.email}</strong><div className="sub">{m.email}</div></td>
              <td data-label="Roles">{m.status === "removed" ? "Removed" : m.roles.map((r) => ROLE_INFO[r].label).join(", ") || "None"}</td>
              <td data-label={settings.unitPlural}>{m.unitIds.length ? m.unitIds.map((u) => units.get(u) || "?").join(", ") : "All"}</td>
              <td data-label="Last seen">{m.lastSeenAt ? fmtDate(m.lastSeenAt) : "—"}</td>
              {admin && <td><button className="btn sm" onClick={() => setEdit({ email: m.email, name: m.name, roles: m.roles, unitIds: m.unitIds, isNew: false })}>Edit</button></td>}
            </tr>
          ))}</tbody>
        </table></div>
      </Card>
      <Msg kind={msg?.kind}>{msg?.text}</Msg>
      {edit && (
        <Card title={edit.isNew ? "Add a person" : `Edit ${edit.email}`}>
          {edit.isNew && <><Field label="Work email"><input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field><Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field></>}
          <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}><legend className="eyebrow">Roles</legend>
            <div className="row wrap" style={{ marginTop: 6 }}>{ROLES.map((r) => <label key={r} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={edit.roles.includes(r)} onChange={(e) => setEdit({ ...edit, roles: e.target.checked ? [...edit.roles, r] : edit.roles.filter((x) => x !== r) })} />{ROLE_INFO[r].label}</label>)}</div>
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}><legend className="eyebrow">{settings.unitPlural} (none ticked = all)</legend>
            <div className="row wrap" style={{ marginTop: 6 }}>{program.units.filter((u) => u.active).map((u) => <label key={u.id} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={edit.unitIds.includes(u.id)} onChange={(e) => setEdit({ ...edit, unitIds: e.target.checked ? [...edit.unitIds, u.id] : edit.unitIds.filter((x) => x !== u.id) })} />{u.name}</label>)}</div>
          </fieldset>
          <div className="row wrap mt"><button className="btn primary" disabled={busy} onClick={() => save()}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button>{!edit.isNew && edit.email !== actor.email && <button className="btn ghost" disabled={busy} onClick={() => save("removed")}>Remove access</button>}</div>
        </Card>
      )}
    </div>
  );
}

function DataPage({ s }: { s: SettingsData }) {
  const { refresh } = useApp();
  const [mig, setMig] = useState<{ id: string; summary: PlanSummary; alreadyImported: { at: string; by: string } | null } | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(null);
  const [up, setUp] = useState<UploadPreview | null>(null);
  const [upOk, setUpOk] = useState(false);
  const run = async (f: () => Promise<void>) => { setBusy(true); setMsg(null); try { await f(); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); } setBusy(false); };
  const committed = s.imports.find((i) => i.kind === "legacy" && i.status === "committed");
  return (
    <div className="stack">
      <Card title="Move in the previous version's data" sub="A dry run first: nothing is written until you've checked the preview and confirmed it. The previous version's files are only read, never changed.">
        {committed ? <Msg kind="ok">Imported on {fmtDateTime(committed.committedAt)} by {committed.committedBy}.</Msg> : (
          <>
            <button className="btn primary" disabled={busy} onClick={() => run(async () => { setMig(await api("/api/migrate", "POST", { action: "preview" })); setOk(false); })}><Icon name="eye" />{mig ? "Run the preview again" : "Preview the import"}</button>
            {!s.legacyAvailable && !mig && <p className="sub">No previous-version data was found for this company.</p>}
            {mig && (
              <div className="mt">
                <div className="eyebrow">{mig.summary.source}</div>
                <div className="grid g4 mt" style={{ gap: 8 }}>{Object.entries(mig.summary.counts).map(([k, v]) => <div key={k} className="minitile"><span className="sub">{k.replace(/([A-Z])/g, " $1").toLowerCase()}</span><strong>{v.toLocaleString("en-US")}</strong></div>)}</div>
                {mig.summary.figures.length > 0 && <div className="tablewrap mt" tabIndex={0}><table className="t"><caption className="sr">Figures before and after</caption><thead><tr><th scope="col">Figure</th><th scope="col" className="num">Previous version</th><th scope="col" className="num">This version</th><th scope="col">Match</th></tr></thead>
                  <tbody>{mig.summary.figures.map((f) => <tr key={f.label}><td>{f.label}</td><td className="num">{f.before}</td><td className="num"><strong>{f.after}</strong></td><td>{f.same ? <BandPill band="worldClass">Same</BandPill> : <BandPill band="watch">Corrected</BandPill>}</td></tr>)}</tbody></table></div>}
                {mig.summary.warnings.map((w) => <Msg key={w} kind="info">{w}</Msg>)}
                {mig.summary.notCarried.map((w) => <p key={w} className="sub">Not carried over: {w}</p>)}
                {mig.alreadyImported ? <Msg>Already imported on {fmtDateTime(mig.alreadyImported.at)}.</Msg> : (
                  <>
                    <label className="row mt"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />I've checked the preview and want to import it.</label>
                    <button className="btn navy mt" disabled={!ok || busy} onClick={() => run(async () => { const r = await api<{ files: { copied: number; missing: number } }>("/api/migrate", "POST", { action: "commit", id: mig.id, confirm: true }); setMsg({ kind: "ok", text: `Imported. ${r.files.copied} evidence files copied${r.files.missing ? `, ${r.files.missing} missing from the old store` : ""}.` }); setMig(null); refresh(); })}>Import now</button>
                  </>
                )}
              </div>
            )}
          </>
        )}
        <Msg kind={msg?.kind}>{msg?.text}</Msg>
      </Card>
      <Card title="Upload a workbook" sub="The consolidated Branch Defects or Operational Standards workbook. It replaces the imported history of that kind after you confirm; published reviews are kept.">
        <div className="row wrap">
          <label className="btn"><Icon name="upload" />Choose a workbook (.xlsx)<input type="file" accept=".xlsx" className="sr" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; run(async () => { const fd = new FormData(); fd.append("file", f); const r = await api<{ preview: UploadPreview }>("/api/import", "POST", fd); setUp(r.preview); setUpOk(false); }); e.target.value = ""; }} /></label>
          <a className="btn ghost" href="/api/workbooks?what=defects"><Icon name="download" />Branch Defects template</a>
          <a className="btn ghost" href="/api/workbooks?what=opstd"><Icon name="download" />Operational Standards template</a>
        </div>
        {up && (
          <div className="mt">
            <p><strong>{up.fileName}</strong>: {up.rows} rows{up.periods ? `, ${up.periods[0].slice(0, 7)} to ${up.periods[1].slice(0, 7)}` : ""}. {up.figures.map((f) => `${f.label} ${f.value}`).join(" · ")}</p>
            {up.newUnits.length > 0 && <p className="sub">New units to be added: {up.newUnits.join(", ")}</p>}
            {up.newAreas.length > 0 && <p className="sub">New process areas: {up.newAreas.join(", ")}</p>}
            {up.problems.length > 0 && <Msg kind="info">{up.problems.length} row note{up.problems.length === 1 ? "" : "s"}: {up.problems.slice(0, 5).map((p) => `row ${p.row}: ${p.message}`).join("; ")}{up.problems.length > 5 ? "…" : ""}</Msg>}
            <div className="tablewrap mt" tabIndex={0}><table className="t"><tbody>{up.sample.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{String(c ?? "")}</td>)}</tr>)}</tbody></table></div>
            <label className="row mt"><input type="checkbox" checked={upOk} onChange={(e) => setUpOk(e.target.checked)} />Replace the imported {up.kind === "workbook_defects" ? "Branch Defects history" : "Operational Standard entries"} with this workbook.</label>
            <button className="btn navy mt" disabled={!upOk || busy} onClick={() => run(async () => { const r = await api<{ rows: number }>("/api/import", "POST", { commit: up.id, confirm: true }); setMsg({ kind: "ok", text: `Imported ${r.rows} rows.` }); setUp(null); refresh(); })}>Import workbook</button>
          </div>
        )}
      </Card>
      <Card title="Imports" sub="Every preview and import, newest first">
        {s.imports.length ? <ul className="list">{s.imports.map((i) => <li key={i.id}><span className="grow"><strong>{i.kind === "legacy" ? "Previous version's data" : i.kind === "workbook_defects" ? "Branch Defects workbook" : "Operational Standards workbook"}</strong><br /><span className="sub">{i.status} · {i.createdBy} · {fmtDateTime(i.createdAt)}</span></span></li>)}</ul> : <p className="sub">None yet.</p>}
      </Card>
    </div>
  );
}

function MeasuredPage({ scorecard }: { scorecard: ScorecardDef | null }) {
  const { actor, settings, refresh } = useApp();
  const admin = can.manage(actor);
  const [w, setW] = useState(settings.severityWeights);
  const [months, setMonths] = useState(String(settings.recurringMonths));
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const save = async (body: Record<string, unknown>) => { setMsg(null); try { await api("/api/settings", "PATCH", body); setMsg({ kind: "ok", text: "Saved." }); refresh(); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); } };
  const tpl = async (template: string) => { try { await api("/api/scorecard", "POST", { template }); refresh(); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); } };
  return (
    <div className="stack">
      <Card title="The three rates">
        <dl className="kv">
          <dt>Defect rate</dt><dd>Defects ÷ possible instances. {settings.instanceBasis === "check" ? "Each check performed (pass or fail; not N/A) is one possible instance, and each failed check a defect." : `Each ${settings.itemLabel.toLowerCase()} sampled is one possible instance; the inspector records its defects.`}</dd>
          <dt>Resolution rate</dt><dd>Resolved ÷ resolvable defects. A row can't claim more resolved than resolvable.</dd>
          <dt>Recurring rate</dt><dd>Defects marked recurring ÷ defects found.</dd>
          <dt>Recurring issue</dt><dd>The same defect nature at the same {settings.unitLabel.toLowerCase()} for {settings.recurringMonths} or more months running.</dd>
          <dt>Watchlist</dt><dd>60% defect rate, 25% unresolved share and 15% recurring rate, each scaled to the worst {settings.unitLabel.toLowerCase()} in scope.</dd>
        </dl>
      </Card>
      <Card title="Severities and the recurring rule" sub="A check's severity weights the compliance score">
        <div className="grid g4" style={{ gap: 0, columnGap: 12 }}>
          {SEVERITIES.map((sv) => <Field key={sv} label={`${sv} weight`}><input className="input" inputMode="decimal" disabled={!admin} value={w[sv]} onChange={(e) => setW({ ...w, [sv]: Number(e.target.value) || 0 })} /></Field>)}
          <Field label="Recurring after (months)"><input className="input" inputMode="numeric" disabled={!admin} value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
        </div>
        {admin && <button className="btn mt" onClick={() => save({ severityWeights: w, recurringMonths: Number(months) })}>Save</button>}
        <Msg kind={msg?.kind}>{msg?.text}</Msg>
      </Card>
      <Card title={scorecard ? `${scorecard.name} scorecard` : "Scorecard"} sub={scorecard ? `Target ${scorecard.target}. Computed measures average the ones beneath them.` : "A configurable branch-standards scorecard, scored 0–100 each month."}>
        {scorecard ? (
          <ul className="list">{scorecard.measures.map((m) => <li key={m.key}><span className="grow"><strong>{m.label}</strong>{m.kind === "computed" && <div className="sub">{m.round ? "Rounded mean" : "Mean"} of {(m.of || []).map((k) => (k === "@audit" ? "audit points" : scorecard.measures.find((x) => x.key === k)?.label || k)).join(", ")}</div>}</span><span className="pill">{m.kind === "computed" ? "Computed" : m.group || "Keyed"}</span></li>)}</ul>
        ) : admin ? (
          <div className="row wrap"><button className="btn primary" onClick={() => tpl("operational-standard")}>Start from the Operational Standard</button><button className="btn" onClick={() => tpl("branch-standards")}>Start from Branch Standards</button></div>
        ) : <p className="sub">Not set up yet.</p>}
      </Card>
    </div>
  );
}

function IntegrationsPage({ s }: { s: SettingsData }) {
  const { settings } = useApp();
  return (
    <div className="stack">
      <Card title="Pulsus Platform" sub="The company brief and the Quality driver read these">
        <dl className="kv"><dt>/api/data</dt><dd>The dataset in its original row shapes (kept unchanged for the brief).</dd><dt>/api/pulse</dt><dd>A quality summary (defect, resolution and recurring rates, Operational Standard, branches below standard, open and overdue actions, recurring issues) and the inspections block (results, sampling, risk bands, visits) under the suite&apos;s service grant for quality.pulse.</dd></dl>
      </Card>
      <Card title="Pulsus Risk" sub={s.riskConnected ? "Connected: proposals go to Risk's review queue" : "Risk's intake isn't connected yet: proposals are stored here and sent once it is"}>
        <p style={{ marginTop: 0 }}>A supervisor can send a serious or recurring defect to Pulsus Risk as a proposed issue. A Risk Officer accepts or rejects it there; nothing enters Risk unreviewed.</p>
        {s.outbox.length ? <ul className="list">{s.outbox.map((o) => <li key={o.id}><span className="grow"><strong>{o.title}</strong><br /><span className="sub">{o.severity} · {o.createdBy} · {fmtDateTime(o.createdAt)}</span></span><span className={`status ${o.status === "sent" ? "st-closed" : o.status === "failed" ? "st-open" : "st-draft"}`}>{o.status === "stubbed" ? "Waiting for Risk" : o.status}</span></li>)}</ul> : <p className="sub">Nothing proposed yet. Send one from Insights → Recurring issues.</p>}
      </Card>
      <Card title="Report an issue" sub={s.connections.turnstile ? "Protected by Cloudflare Turnstile" : "Protected by a hidden trap field and a per-phone limit"}>
        <p className="sub" style={{ margin: 0 }}>Each {settings.unitLabel.toLowerCase()} has a public link and QR poster under <Link href="/issues?tab=links">Issues</Link>. Anyone can report an observation, hazard, near miss or complaint without signing in; a supervisor triages it.</p>
      </Card>
      <Card title="REST API" sub="Other systems read and raise records with an API key">
        <p className="sub" style={{ margin: 0 }}>Admins create and revoke keys under <a href="#settings-api">API keys</a>.</p>
      </Card>
    </div>
  );
}

function AlertsPage({ s }: { s: SettingsData }) {
  const app = useApp();
  const { actor, settings, demo } = app;
  const admin = isAdmin(actor);
  const [mine, setMine] = useState<boolean | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ items: unknown[]; email: { mine: boolean } }>("/api/alerts", "GET").then((r) => { setMine(r.email.mine); setCount(r.items.length); }).catch(() => {}); }, []);
  const run = async (f: () => Promise<void>) => { setBusy(true); setMsg(null); try { await f(); } catch (e) { setMsg({ kind: "err", text: (e as Error).message }); } setBusy(false); };
  return (
    <div className="stack">
      <Card title="The bell" sub="In the top bar, on every screen">
        <p style={{ marginTop: 0 }}>The bell counts what needs you now: inspections and reviews to approve, actions to verify, your overdue actions and those due in three days, effectiveness checks that have fallen due, and reported issues to triage. {count !== null && <strong>{count === 0 ? "Nothing needs you right now." : `${count} thing${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} you now.`}</strong>}</p>
      </Card>
      <Card title="Daily email" sub={demo ? "The demo never sends email" : s.connections.email ? (s.connections.cron ? "Sent each morning at about 06:20 UTC" : "Ready, but the daily schedule isn't set up (CRON_SECRET)") : "Not set up on this deployment"}>
        <p style={{ marginTop: 0 }}>One email a day to each person with something waiting, grouped by kind, from Pulsus Quality &lt;support@pulsus.tech&gt;. Nobody gets an empty email.</p>
        {!s.connections.email && !demo && <Msg kind="info">Email is sent through Resend once the deployment has a RESEND_API_KEY. Until then, the bell shows the same list.</Msg>}
        {admin && (
          <label className="row mt"><input type="checkbox" checked={settings.emailAlerts} disabled={busy} onChange={(e) => { const on = e.target.checked; run(async () => { await api("/api/settings", "PATCH", { emailAlerts: on }); app.refresh(); setMsg({ kind: "ok", text: on ? "The daily email is on for the company." : "The daily email is off for everyone." }); }); }} />Send the daily email to {actor.tenantName}&apos;s people</label>
        )}
        {!admin && !settings.emailAlerts && <p className="sub">A Quality admin has turned the daily email off for the company.</p>}
        {mine !== null && (
          <label className="row mt"><input type="checkbox" checked={mine} disabled={busy} onChange={(e) => { const on = e.target.checked; run(async () => { const r = await api<{ mine: boolean }>("/api/alerts", "POST", { emailAlerts: on }); setMine(r.mine); setMsg({ kind: "ok", text: on ? "You'll get the daily email." : "You won't get the daily email." }); }); }} />Send it to me ({actor.email})</label>
        )}
        {s.connections.email && !demo && <button type="button" className="btn mt" disabled={busy} onClick={() => run(async () => { const r = await api<{ message: string }>("/api/alerts", "POST", { test: true }); setMsg({ kind: "ok", text: r.message }); })}><Icon name="mail" />Send me today&apos;s email now</button>}
        <Msg kind={msg?.kind}>{msg?.text}</Msg>
      </Card>
    </div>
  );
}

function HistoryPage({ s }: { s: SettingsData }) {
  const [v, setV] = useState<{ ok: boolean; count: number; brokenAt?: number; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const rows = useMemo(() => s.history.filter((h) => !q || `${h.actor} ${h.action} ${h.summary}`.toLowerCase().includes(q.toLowerCase())), [s.history, q]);
  return (
    <div className="stack">
      <Card title="Tamper-evident" sub="Each entry carries a hash of the one before it, so a changed, removed or reordered entry breaks the chain. The table is append-only in the database too.">
        <div className="row wrap">
          <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { setV(await api("/api/audit?verify=1", "GET")); } finally { setBusy(false); } }}><Icon name="check" />Check the chain</button>
          <a className="btn ghost" href="/api/export?what=changes&format=csv"><Icon name="download" />Export CSV</a>
        </div>
        {v && (v.ok ? <Msg kind="ok">All {v.count.toLocaleString("en-US")} entries check out.</Msg> : <Msg>Broken at entry {v.brokenAt}: {v.reason}</Msg>)}
      </Card>
      <Card flush title="Latest changes" actions={<label><span className="sr">Search the history</span><input className="input" type="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} /></label>}>
        <div className="tablewrap" tabIndex={0}><table className="t stack">
          <thead><tr><th scope="col">#</th><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th></tr></thead>
          <tbody>{rows.map((h) => <tr key={h.seq}><td data-label="#" className="num">{h.seq}</td><td data-label="When" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(h.at)}</td><td data-label="Who">{h.actor}</td><td data-label="What"><strong>{h.action}</strong> · {h.summary}</td></tr>)}</tbody>
        </table></div>
      </Card>
    </div>
  );
}

const Rule = ({ t, children }: { t: string; children: ReactNode }) => <li><span className="badge sm" aria-hidden="true"><Icon name="check" /></span><span className="grow"><strong>{t}</strong><div className="sub">{children}</div></span></li>;
function ApprovalsPage() {
  return (
    <Card title="Enforced on the server, for everyone">
      <ul className="list">
        <Rule t="Reviews are approved before they count">A review reaches the dashboards only when a supervisor publishes it. A returned review comes back with a note.</Rule>
        <Rule t="Nobody approves their own review">The supervisor who approves must not be the inspector who keyed it.</Rule>
        <Rule t="Independent verification of actions">Whoever raised an action, whoever submitted its closure and its owner can never verify it.</Rule>
        <Rule t="Granting yourself a role changes nothing">The rules look at who did the work, not at the roles someone holds.</Rule>
        <Rule t="Evidence before closure">A closure says what was done; photos and files attach to the action, hashed and kept private.</Rule>
      </ul>
    </Card>
  );
}

function AppearancePage() {
  const { theme, toggleTheme } = useApp();
  return (
    <Card title="Day or night" sub="The same choice as the button in the top bar, shared with the rest of Pulsus on this device.">
      <div className="row wrap"><button className="chip" aria-pressed={theme === "light"} onClick={() => theme !== "light" && toggleTheme()}><Icon name="sun" width={16} height={16} /> Day</button><button className="chip" aria-pressed={theme === "dark"} onClick={() => theme !== "dark" && toggleTheme()}><Icon name="moon" width={16} height={16} /> Night</button></div>
    </Card>
  );
}

function AboutPage({ s }: { s: SettingsData }) {
  const { actor, refresh } = useApp();
  const price = usePrice();
  const [db, setDb] = useState(s.database);
  return (
    <div className="stack">
      <Card title="Pulsus Quality" sub="Inspections · Standards · Corrective Actions">
        <p style={{ marginTop: 0 }}>Branch and operational quality for multi-site organisations: reviews sampled against your own checklists and signed off by a supervisor, defect, resolution and recurring rates by branch and process, a configurable standards scorecard, and corrective and preventive actions verified independently. It feeds Pulsus Platform's company brief and proposes serious or recurring issues to Pulsus Risk.</p>
        {price && <p className="sub">{price.product}: {money(price.monthly, price.currency)} a month{price.includes ? `, including ${price.includes}` : ""}.</p>}
        <p className="tagline">Live. <em>Signal.</em> Clarity.</p>
      </Card>
      {db && (
        <Card title="Database" sub="Postgres, isolated per company">
          <dl className="kv"><dt>Engine</dt><dd>{db.kind === "pglite" ? "PGlite (local)" : "Postgres"}</dd><dt>Isolation</dt><dd>{db.isolation}</dd><dt>Migrations</dt><dd>{db.applied.length} applied{db.pending.length ? `, ${db.pending.length} pending` : ", none pending"}</dd></dl>
          {can.manage(actor) && db.pending.length > 0 && <button className="btn mt" onClick={async () => { setDb(await api("/api/admin/database", "POST")); refresh(); }}>Apply migrations</button>}
        </Card>
      )}
      <p className="sub">© 2026 Tumblehill Holdings LLC.</p>
    </div>
  );
}

function HelpPage() {
  return (
    <Card title="Getting started">
      <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
        <li>A Quality admin sets up {"units"}, process areas and checklists (Company set-up), and grants roles (People and roles).</li>
        <li>Inspectors key reviews on Review; a supervisor approves them.</li>
        <li>Pulse, Register, History and Insights update as reviews are published.</li>
        <li>Supervisors raise actions from defects or recurring issues; another supervisor verifies the closure.</li>
      </ol>
      <p>Questions: <a href="mailto:support@pulsus.tech">support@pulsus.tech</a></p>
    </Card>
  );
}
