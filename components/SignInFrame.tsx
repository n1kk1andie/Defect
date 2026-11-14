import type { ReactNode } from "react";

// The Pulsus sign-in standard (app/signin-standard.css): one centred card on a
// plain page — the family paper by day, navy by night — with the app's emblem
// big at the top (the night artwork by night), its name ("Pulsus" navy, the
// app's word red), its subtitle in capitals and "Live. Signal. Clarity.", then
// the form. Every sign-in-like page uses it: sign in, two-step, forgot and reset
// password, sign up.
export interface FrameBrand {
  word: string; sub: string; desc?: string; emblem: string; emblemNight: string;
  /** Artwork that already carries the name and subtitle: shown as one image instead. */
  logo?: string; logoNight?: string;
}

/** A longer name gets a size that keeps it on one line on a phone. */
export const nameSize = (word: string) => { const n = word.length + 7; return n >= 15 ? " sf-xlong" : n >= 12 ? " sf-long" : ""; };

export function SignInFrame({ brand, title, lead, heading, children, foot, L = (s) => s }: { brand: FrameBrand; title?: ReactNode; lead?: ReactNode; /** The sign-in page itself: no visible heading, this hidden h1 names the page. */ heading?: string; children?: ReactNode; foot?: ReactNode; L?: (text: string) => string }) {
  const Name = heading ? "p" : "h1";
  return (
    <main id="main" className="sf pf pf-page pf-auto">
      <div className="sf-card pf-card">
        {heading ? <h1 className="pf-sr">{heading}</h1> : null}
        {brand.logo ? (
          <h1 className="sf-brand" style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sf-logo sf-day" src={brand.logo} alt={`Pulsus ${brand.word} — ${L(brand.sub)}`} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sf-logo sf-night" src={brand.logoNight || brand.logo} alt={`Pulsus ${brand.word} — ${L(brand.sub)}`} />
          </h1>
        ) : (
          <div className="sf-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sf-emblem sf-day" src={brand.emblem} alt="" width={200} height={200} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="sf-emblem sf-night" src={brand.emblemNight} alt="" width={200} height={200} />
            <Name className={`sf-name${nameSize(brand.word)}`}>Pulsus <span className="sf-word">{brand.word}</span></Name>
            <p className="sf-sub pf-sub">{L(brand.sub)}</p>
          </div>
        )}
        <p className="sf-tag pf-tag">{L("Live.")} <span className="sf-word">{L("Signal.")}</span> {L("Clarity.")}</p>
        {title ? <h2 className="sf-title" id="sf-title">{title}</h2> : null}
        {lead ? <p className="sf-lead">{lead}</p> : null}
        {children}
      </div>
      {foot ? <footer className="sf-foot pf-foot">{foot}</footer> : null}
    </main>
  );
}

/** Microsoft's sign-in button: the four-square logo and "Sign in with Microsoft". */
export function MicrosoftButton({ onClick, disabled, label = "Sign in with Microsoft" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="sf-ms pf-ms" onClick={onClick} disabled={disabled}>
      <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>
      <span>{label}</span>
    </button>
  );
}
