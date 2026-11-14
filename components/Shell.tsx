"use client";
// The frame around every screen, as in Pulsus Risk: the sidebar (desktop) or
// the tab bar with "More" (phone), the top bar (where you are, trial chip,
// day/night, export, alerts bell, you) and the trial banner.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Icon, type IconName } from "@/components/icons";
import { FooterLines, QualityMark } from "@/components/Brand";
import { trialDaysLeft } from "@/lib/trial";
import { monthLabel, lastActive } from "@/lib/metrics";
import { ROLE_INFO, isAdmin } from "@/lib/roles";
import { PERSONAS } from "@/lib/demo/personas";
import DemoGuard from "@/components/DemoGuard";
import { ALERT_KINDS, type AlertItem } from "@/lib/alertInfo";

type Badge = "approvals" | "verify" | "inspections" | "issues";
export const NAV: { href: string; label: string; icon: IconName; badge?: Badge; build?: boolean }[] = [
  { href: "/", label: "Pulse", icon: "pulse" },
  { href: "/inspect", label: "Inspect", icon: "clipboard", badge: "inspections" },
  { href: "/schedule", label: "Schedule", icon: "calendar" },
  { href: "/sampling", label: "Sampling", icon: "hash" },
  { href: "/risk", label: "Risk", icon: "alert" },
  { href: "/issues", label: "Issues", icon: "flag", badge: "issues" },
  { href: "/compare", label: "Compare", icon: "compare" },
  { href: "/review", label: "Review", icon: "review", badge: "approvals" },
  { href: "/actions", label: "Actions", icon: "actions", badge: "verify" },
  { href: "/register", label: "Register", icon: "register" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/report", label: "Report", icon: "report" },
  { href: "/templates", label: "Templates", icon: "layers", build: true },
  { href: "/scorecards", label: "Scorecards", icon: "target", build: true },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function TrialChip() {
  const { actor, billingUrl, demo } = useApp();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  if (demo || actor.plan?.standing !== "trial" || now === null) return null;
  const days = trialDaysLeft(actor.plan.trialEndsAt, now);
  const label = days === null ? "Free trial" : days <= 0 ? "Trial ends today" : days === 1 ? "Trial · 1 day left" : `Trial · ${days} days left`;
  return <a className={`trialchip${days !== null && days <= 3 ? " soon" : ""}`} href={billingUrl} target="_top">{label}</a>;
}

/** "Your free trial ends in N days." — last 7 days, and once on the first visit; dismissible for the day except on the last day. */
function TrialBanner() {
  const { actor, billingUrl, demo } = useApp();
  const [show, setShow] = useState(false);
  const [days, setDays] = useState<number | null>(null);
  const key = `pq-trial-banner:${actor.tenant}`;
  useEffect(() => {
    if (demo || actor.plan?.standing !== "trial") return;
    const d = trialDaysLeft(actor.plan.trialEndsAt, Date.now());
    setDays(d);
    let seen: { first?: boolean; day?: string } = {};
    try { seen = JSON.parse(localStorage.getItem(key) || "{}"); } catch { /* blocked */ }
    const today = new Date().toISOString().slice(0, 10);
    const firstVisit = !seen.first;
    if (d === 0 || ((d === null || d <= 7) && seen.day !== today) || firstVisit) setShow(true);
    try { localStorage.setItem(key, JSON.stringify({ ...seen, first: true })); } catch { /* blocked */ }
  }, [actor.plan, demo, key]);
  if (!show) return null;
  const owner = actor.platformRole === "owner" || actor.platformRole === "admin";
  const text = days === 0 ? "Your free trial ends today." : days === 1 ? "Your free trial ends in 1 day." : days === null ? "You're on a free trial." : `Your free trial ends in ${days} days.`;
  const dismiss = () => {
    try { const s = JSON.parse(localStorage.getItem(key) || "{}"); localStorage.setItem(key, JSON.stringify({ ...s, day: new Date().toISOString().slice(0, 10) })); } catch { /* blocked */ }
    setShow(false);
  };
  return (
    <div className="trialbanner" role="region" aria-label="Free trial">
      <div className={`trialbanner-in${days !== null && days <= 3 ? " soon" : ""}`}>
        <p>{text}</p>
        {owner ? <a className="btn primary sm" href={billingUrl} target="_top">Choose a plan</a> : <span className="sub">Ask your administrator to choose a plan.</span>}
        {days !== 0 && <button type="button" className="iconbtn" style={{ width: 34, height: 34 }} onClick={dismiss} aria-label="Dismiss for today"><Icon name="close" /></button>}
      </div>
    </div>
  );
}

/** The alerts bell: what needs you now (lib/notify.ts), grouped by kind, each a link. */
function AlertsBell() {
  const path = usePathname();
  const { now } = useApp();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/alerts", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setItems(j.items); }).catch(() => {});
    return () => { live = false; };
  }, [path, now]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const n = items?.length ?? 0;
  const groups = ALERT_KINDS.map((k) => ({ ...k, items: (items ?? []).filter((i) => i.kind === k.key) })).filter((g) => g.items.length);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="iconbtn bell" aria-haspopup="true" aria-expanded={open} aria-label={n ? `Alerts: ${n} need${n === 1 ? "s" : ""} you` : "Alerts: nothing needs you"} title="Alerts" onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />{n > 0 && <span className="bell-n" aria-hidden="true">{n > 99 ? "99+" : n}</span>}
      </button>
      {open && (
        <div className="menu alerts-pop" role="region" aria-label="Alerts">
          <div className="who"><strong style={{ color: "var(--ink)", display: "block", fontSize: 15 }}>{n ? `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you` : "You're up to date"}</strong>{n ? "Most urgent first." : "Nothing is waiting on you."}</div>
          {groups.map((g) => (
            <div key={g.key} className="alerts-g">
              <div className="alerts-h"><Icon name={g.icon} width={14} height={14} />{g.label} <span className="sub">({g.items.length})</span></div>
              {g.items.slice(0, 6).map((i) => (
                <Link key={i.kind + i.id} href={i.href} onClick={() => setOpen(false)}>
                  <span className="grow" style={{ minWidth: 0 }}><strong className="alerts-t">{i.title}</strong><small className="sub alerts-d">{i.detail}</small></span>
                </Link>
              ))}
              {g.items.length > 6 && <p className="sub alerts-more">and {g.items.length - 6} more</p>}
            </div>
          ))}
          <hr />
          <Link href="/settings#settings-alerts" onClick={() => setOpen(false)}><Icon name="mail" />Email alerts</Link>
        </div>
      )}
    </div>
  );
}

function AvatarMenu() {
  const { actor, demo, platformUrl, refresh } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const initial = (actor.name || actor.email).trim().charAt(0).toUpperCase();
  const persona = async (email: string) => { setBusy(true); try { await api("/api/demo", "POST", { persona: email }); setOpen(false); refresh(); } finally { setBusy(false); } };
  const signOut = async () => { await fetch("/api/logout", { method: "POST" }).catch(() => {}); window.location.href = "/login"; };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="avatar" aria-haspopup="menu" aria-expanded={open} aria-label={`${actor.name}: account menu`} onClick={() => setOpen((o) => !o)}>{initial}</button>
      {open && (
        <div className="menu" role="menu">
          <div className="who"><strong style={{ color: "var(--ink)", display: "block" }}>{actor.name}</strong>{actor.email}<br />{actor.roles.map((r) => ROLE_INFO[r].label).join(", ") || "No access"} · {actor.tenantName}</div>
          {demo ? (
            <>
              <hr />
              <div className="who" style={{ paddingBottom: 4 }}>Try the demo as</div>
              {PERSONAS.map((p) => (
                <button key={p.email} role="menuitemradio" aria-checked={p.email === actor.email} disabled={busy} onClick={() => persona(p.email)}>
                  <span className="badge sm" aria-hidden="true" style={{ width: 28, height: 28 }}>{p.name.charAt(0)}</span>
                  <span className="grow"><strong>{p.name}</strong><br /><small className="sub">{p.title}</small></span>
                  {p.email === actor.email && <Icon name="check" />}
                </button>
              ))}
              {isAdmin(actor) && <><hr /><button role="menuitem" disabled={busy} onClick={async () => { if (!confirm("Reset the demo to its sample data?")) return; setBusy(true); try { await api("/api/demo", "POST", { reset: true }); refresh(); setOpen(false); } finally { setBusy(false); } }}><Icon name="repeat" />Reset the demo data</button></>}
            </>
          ) : (
            <>
              <hr />
              <a role="menuitem" href={platformUrl}><Icon name="globe" />Pulsus home</a>
              <button role="menuitem" onClick={signOut}><Icon name="lock" />Sign out</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const app = useApp();
  const path = usePathname() || "/";
  const on = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const current = [...NAV, { href: "/more", label: "More" }, { href: "/setup", label: "Set up" }].find((n) => on(n.href))?.label || "Pulse";
  const li = lastActive(app.data);
  const latest = li >= 0 ? monthLabel(app.data.periods[li]) : null;
  const modeLabel = app.filters.mode === "standard" && app.data.scorecard ? app.data.scorecard.name : `${app.settings.unitLabel} Defects`;
  const context = ["Pulse", "Register", "History"].includes(current) ? `${modeLabel}${latest ? ` · latest data ${latest}` : ""}` : app.actor.tenantName;
  const badge = (b?: Badge) => (b === "approvals" ? app.counts.awaitingApproval : b === "verify" ? app.counts.awaitingVerification : b === "inspections" ? app.counts.awaitingInspections : b === "issues" ? app.counts.newIssues : 0);
  const main = NAV.filter((n) => n.href !== "/settings" && !n.build);
  const build = NAV.filter((n) => n.build && (n.href === "/templates" || isAdmin(app.actor)));
  const tabs = [NAV[0], NAV.find((n) => n.href === "/inspect")!, NAV.find((n) => n.href === "/actions")!, NAV.find((n) => n.href === "/risk")!, { href: "/more", label: "More", icon: "more" as IconName }];
  const moreOn = ["/issues", "/compare", "/register", "/history", "/insights", "/report", "/review", "/schedule", "/sampling", "/templates", "/scorecards", "/settings", "/more"].some(on);
  const initial = (app.actor.name || app.actor.email).trim().charAt(0).toUpperCase();
  return (
    <div className="shell">
      <DemoGuard />
      <a href="#main" className="skip">Skip to content</a>
      <aside className="side" aria-label="Pulsus Quality">
        <Link href="/" className="brand">
          <QualityMark />
          <span className="brand-txt">
            <span className="brand-name" style={{ display: "block" }}>Pulsus <b>Quality</b></span>
            <span className="brand-sub" style={{ display: "block" }}>{app.actor.tenantName}</span>
          </span>
        </Link>
        <nav className="sidenav" aria-label="Main">
          {main.map((n) => {
            const count = badge(n.badge);
            return (
              <Link key={n.href} href={n.href} aria-current={on(n.href) ? "page" : undefined}>
                <Icon name={n.icon} />
                <span>{n.label}</span>
                {count > 0 && <span className="count" aria-label={`${count} waiting`}>{count > 99 ? "99+" : count}</span>}
              </Link>
            );
          })}
          <span className="nav-label">Build</span>
          {build.map((n) => <Link key={n.href} href={n.href} aria-current={on(n.href) ? "page" : undefined}><Icon name={n.icon} /><span>{n.label}</span></Link>)}
          <span className="nav-label">Organisation</span>
          <Link href="/settings" aria-current={on("/settings") ? "page" : undefined}><Icon name="settings" /><span>Settings</span></Link>
          {!app.demo && <a href={app.platformUrl}><Icon name="globe" /><span>Back to Pulsus</span></a>}
        </nav>
        <div className="side-foot">
          <div className="me">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.actor.name}</span>
              <span className="sub" style={{ display: "block", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{app.actor.roles.map((r) => ROLE_INFO[r].label).join(", ") || "No access"}</span>
            </span>
          </div>
          <p className="sub" style={{ margin: 0, padding: "4px 8px", fontSize: 12 }}><span className="tagline">Live. Signal. Clarity.</span></p>
        </div>
      </aside>
      <div className="mainwrap">
        <header className="topbar">
          <Link href="/" className="brand mobile-only" aria-label="Pulsus Quality, Pulse">
            <QualityMark />
            <span className="brand-name">Pulsus <b>Quality</b></span>
          </Link>
          <span className="title grow" style={{ minWidth: 0 }}>{current}<small>{context}</small></span>
          <div className="tb-right">
            {app.demo && <span className="demochip hide-sm" title="Meridian Financial Group is fictional: sample data for the demo">Demo · sample data</span>}
            <span className="hide-sm"><TrialChip /></span>
            <button type="button" className="iconbtn" onClick={app.toggleTheme} aria-label={app.theme === "dark" ? "Switch to day" : "Switch to night"} title={app.theme === "dark" ? "Day" : "Night"}>
              <Icon name={app.theme === "dark" ? "sun" : "moon"} />
            </button>
            <a className="iconbtn hide-sm" href={`/api/export?what=register&format=xlsx&year=${app.filters.year}&unit=${app.filters.unit}&area=${app.filters.area}`} aria-label="Download the register (Excel)" title="Download (Excel)"><Icon name="download" /></a>
            <AlertsBell />
            <AvatarMenu />
          </div>
        </header>
        {app.demo && <p className="demonote mobile-only">Demo · fictional sample data</p>}
        <TrialBanner />
        {isAdmin(app.actor) && app.actor.kind === "company" && !app.settings.setupDone && !path.startsWith("/setup") && (
          <div className="trialbanner" role="region" aria-label="Set up"><div className="trialbanner-in" style={{ background: "var(--info-tint)", color: "var(--info-ink)", borderColor: "transparent" }}>
            <p>Welcome. Set up in a few minutes: your sector, what you call your sites, your locations, and starter checklists.</p>
            <Link className="btn primary sm" href="/setup">Start set-up</Link>
          </div></div>
        )}
        <main id="main" className="main" tabIndex={-1}>{children}</main>
        <footer className="foot">
          <FooterLines />
        </footer>
      </div>
      <nav className="tabbar" aria-label="Main">
        {tabs.map((n) => {
          const active = n.href === "/more" ? moreOn : on(n.href);
          const count = badge((n as { badge?: Badge }).badge);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {count > 0 && <span className="count" aria-label={`${count} waiting`}>{count > 99 ? "99+" : count}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
