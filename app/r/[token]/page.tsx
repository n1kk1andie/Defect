// Report an issue: the public page behind a site's QR code or link. No sign-in;
// the token names the site (lib/issues.ts). Works on any phone.
import type { Metadata } from "next";
import { resolveLink, turnstileSiteKey } from "@/lib/issues";
import { ReportForm } from "./ReportForm";
import { Wordmark } from "@/components/Brand";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report an issue · Pulsus Quality", robots: { index: false, follow: false } };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ via?: string }> }) {
  const { token } = await params;
  const { via } = await searchParams;
  const site = await resolveLink(token).catch(() => null);
  return (
    <main id="main" className="rpt">
      <header className="rpt-h"><Wordmark size={0.72} /></header>
      {site ? (
        <section className="card rpt-card" aria-labelledby="rpt-title">
          <p className="eyebrow" style={{ margin: 0 }}>{site.companyName}</p>
          <h1 id="rpt-title" className="h2" style={{ fontSize: 24, margin: "4px 0 2px" }}>Report an issue at {site.unitName}</h1>
          <p className="sub" style={{ margin: 0 }}>Tell the {site.unitLabel.toLowerCase()} team about something that isn&apos;t right. You don&apos;t need an account, and your name is optional.</p>
          <ReportForm token={token} via={via === "qr" ? "qr" : "link"} siteKey={turnstileSiteKey()} unit={site.unitName} />
        </section>
      ) : (
        <section className="card rpt-card" aria-labelledby="rpt-title">
          <h1 id="rpt-title" className="h2" style={{ fontSize: 22 }}>This link isn&apos;t active</h1>
          <p className="sub">The poster or link may have been replaced. Ask someone at the site for the current one, or tell a member of staff directly.</p>
        </section>
      )}
      <p className="sub rpt-foot">Pulsus Quality · <a href="https://pulsus.tech/privacy">Privacy</a> · In an emergency, call your local emergency number first.</p>
    </main>
  );
}
