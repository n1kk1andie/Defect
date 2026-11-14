"use client";
// The frame around Pulsus Quality's own sign-in and sign-up pages: the family
// look — the family paper, the wordmark, a big two-line headline — with the form on
// a white card beside it (stacked on a phone).
import type { ReactNode } from "react";
import { FooterLines, Tagline, Wordmark } from "@/components/Brand";
import { Icon } from "@/components/icons";

export function AccountFrame({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <main id="main" className="acct">
      <section className="acct-hero" aria-label="Pulsus Quality">
        <Wordmark size={0.9} />
        <h1 className="headline" style={{ marginTop: 28, fontSize: "clamp(28px,4vw,40px)", lineHeight: 1.1 }}>Know where quality stands. <span className="accent">Every day.</span></h1>
        <p className="lede">Branch reviews, defects and corrective actions across every location, signed off and evidenced, in one view.</p>
        <ul className="list" style={{ maxWidth: 420 }}>
          {[["eye", "See hidden issues", "Defect, resolution and recurring rates by branch and process."], ["repeat", "Catch what keeps coming back", "Recurring issues found before they escalate."], ["actions", "Close with confidence", "Actions verified by someone other than whoever raised them."]].map(([i, t, s]) => (
            <li key={t} style={{ borderBottom: 0, padding: "8px 0" }}><span className="badge" aria-hidden="true"><Icon name={i as "eye"} /></span><span><strong style={{ display: "block" }}>{t}</strong><span className="sub">{s}</span></span></li>
          ))}
        </ul>
        <Tagline className="mt2" />
      </section>
      <section className="acct-card card" aria-labelledby="acct-title">
        <h2 id="acct-title" className="h2" style={{ fontSize: 22 }}>{title}</h2>
        {sub && <p className="sub" style={{ fontSize: 14, margin: "4px 0 0" }}>{sub}</p>}
        {children}
        <p className="sub" style={{ marginTop: 22, fontSize: 12 }}>
          <a href="https://pulsus.tech/terms" style={{ color: "inherit" }}>Terms of Use</a> · <a href="https://pulsus.tech/privacy" style={{ color: "inherit" }}>Privacy Policy</a> · <a href="mailto:support@pulsus.tech" style={{ color: "inherit" }}>support@pulsus.tech</a>
        </p>
        <p className="sub foot-lines" style={{ marginTop: 6, fontSize: 12 }}><FooterLines /></p>
      </section>
    </main>
  );
}

/** POST JSON to the Pulsus account service from this page, with its cookies. */
export async function hubPost(hub: string, path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const r = await fetch(hub + path, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", cache: "no-store", body: JSON.stringify(body) });
  return { status: r.status, body: ((await r.json().catch(() => ({}))) || {}) as Record<string, unknown> };
}

/** Microsoft's sign-in button (its four-square logo and wording, per Microsoft's branding guidelines). */
export function MicrosoftButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="msbtn" onClick={onClick} disabled={disabled}>
      <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" /><rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" /></svg>
      <span>Sign in with Microsoft</span>
    </button>
  );
}
