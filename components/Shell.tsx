"use client";
// The frame around every screen: the top bar (logo, where you are, trial chip,
// day/night, exports, you), the trial banner, and the navigation (a floating
// pill on desktop, a tab bar on phones).
import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api, useApp } from "@/components/app-context";
import { Icon, type IconName } from "@/components/icons";
import { ShieldMark } from "@/components/Brand";
import { trialDaysLeft } from "@/lib/trial";
import { monthLabel, lastActive } from "@/lib/metrics";
import { ROLE_INFO, isAdmin } from "@/lib/roles";
import { PERSONAS } from "@/lib/demo/personas";
import DemoGuard from "@/components/DemoGuard";

const NAV: { href: string; label: string; icon: IconName; badge?: "approvals" | "verify" }[] = [
  { href: "/", label: "Pulse", icon: "pulse" },
  { href: "/register", label: "Register", icon: "register" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/insights", label: "Insights", icon: "insights" },
  { href: "/review", label: "Review", icon: "review", badge: "approvals" },
  { href: "/actions", label: "Actions", icon: "actions", badge: "verify" },
  { href: "/report", label: "Report", icon: "report" },
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
      <div className="trialbanner-in">
        <p>{text}</p>
        {owner ? <a className="btn primary sm" href={billingUrl} target="_top">Choose a plan</a> : <span className="sub">Ask your administrator to choose a plan.</span>}
        {days !== 0 && <button type="button" className="iconbtn" style={{ width: 34, height: 34 }} onClick={dismiss} aria-label="Dismiss for today"><Icon name="close" /></button>}
      </div>
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
              <a role="menuitem" href={platformUrl} target="_top"><Icon name="globe" />Pulsus home</a>
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
  const section = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)))?.label || "Pulse";
  const li = lastActive(app.data);
  const latest = li >= 0 ? monthLabel(app.data.periods[li]) : null;
  const modeLabel = app.filters.mode === "standard" && app.data.scorecard ? app.data.scorecard.name : "Branch Defects";
  const badge = (b?: "approvals" | "verify") => (b === "approvals" ? app.counts.awaitingApproval : b === "verify" ? app.counts.awaitingVerification : 0);
  return (
    <div className="shell">
      <DemoGuard />
      <a href="#main" className="skip">Skip to content</a>
      <header className="topbar">
        <div className="topbar-in">
          <Link href="/" className="brand">
            <ShieldMark />
            <span className="brand-txt">
              <span className="brand-name">Pulsus <b>Quality</b></span>
              <span className="brand-sub" style={{ display: "block" }}>{section === "Pulse" || section === "Register" || section === "History" ? modeLabel : section}{latest ? ` · Latest data ${latest}` : ""}</span>
            </span>
          </Link>
          <div className="tb-right">
            {app.demo && <span className="demochip hide-sm" title="Sample data: Meridian Society is fictional">Demo</span>}
            <span className="hide-sm"><TrialChip /></span>
            <button type="button" className="iconbtn" onClick={app.toggleTheme} aria-label={app.theme === "dark" ? "Switch to day" : "Switch to night"} title={app.theme === "dark" ? "Day" : "Night"}>
              <Icon name={app.theme === "dark" ? "sun" : "moon"} />
            </button>
            <a className="iconbtn hide-sm" href={`/api/export?what=register&format=xlsx&year=${app.filters.year}&unit=${app.filters.unit}&area=${app.filters.area}`} aria-label="Download the register (Excel)" title="Download (Excel)"><Icon name="download" /></a>
            <AvatarMenu />
          </div>
        </div>
      </header>
      <TrialBanner />
      <main id="main" className="main" tabIndex={-1}>{children}</main>
      <footer className="foot">
        <span>Pulsus Quality · {app.actor.tenantName}{app.demo ? " (fictional sample data)" : ""}</span>
        <span><span className="tagline">Live. <em>Signal.</em> Clarity.</span> · © 2026 Tumblehill Holdings LLC</span>
      </footer>
      <nav className="nav" aria-label="Sections">
        {NAV.map((n) => {
          const on = n.href === "/" ? path === "/" : path.startsWith(n.href);
          const count = badge(n.badge);
          return (
            <Link key={n.href} href={n.href} className="navbtn" aria-current={on ? "page" : undefined} title={n.label}>
              <Icon name={n.icon} />
              <span className="lbl">{n.label}</span>
              {count > 0 && <span className="navbadge" aria-label={`${count} waiting`}>{count > 99 ? "99+" : count}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
