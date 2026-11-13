"use client";
// "More" on phones: every section the tab bar has no room for, as one list
// (the same pattern as Pulsus Risk).
import Link from "next/link";
import { NAV } from "@/components/Shell";
import { Icon } from "@/components/icons";
import { PageHead } from "@/components/ui";
import { useApp } from "@/components/app-context";

const BLURB: Record<string, string> = {
  "/": "Defect rate, scorecard and the trend",
  "/register": "The counts behind every rate, and each defect",
  "/history": "Heat-maps by month",
  "/insights": "Watchlist, recurring issues, resolution gap",
  "/inspect": "Inspections and field visits",
  "/review": "Monthly reviews and approvals",
  "/templates": "Checklists and the template library",
  "/scorecards": "Design the scorecard",
  "/actions": "Corrective and preventive actions",
  "/report": "The executive report",
  "/settings": "Company set-up, people, bands, data",
};

export function MoreMenu() {
  const app = useApp();
  return (
    <>
      <PageHead eyebrow="Pulsus Quality" title="Everything" lede={app.actor.tenantName} />
      <nav className="card flush" aria-label="All sections">
        {NAV.filter((n) => n.href !== "/scorecards" || app.actor.roles.includes("admin")).map((n) => (
          <Link key={n.href} href={n.href} className="sitem">
            <span className="badge sm" aria-hidden="true"><Icon name={n.icon} /></span>
            <span className="grow"><span className="t1" style={{ display: "block" }}>{n.label}</span><span className="t2" style={{ display: "block" }}>{BLURB[n.href]}</span></span>
            <Icon name="chevron" />
          </Link>
        ))}
        {!app.demo && <a href={app.platformUrl} target="_top" className="sitem"><span className="badge sm" aria-hidden="true"><Icon name="globe" /></span><span className="grow"><span className="t1" style={{ display: "block" }}>Back to Pulsus</span><span className="t2" style={{ display: "block" }}>Pulsus Platform</span></span><Icon name="chevron" /></a>}
      </nav>
    </>
  );
}
