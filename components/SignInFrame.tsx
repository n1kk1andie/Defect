import type { ReactNode } from "react";

// The Pulsus sign-in standard (app/signin-standard.css): one centred card on a
// plain page — the family paper by day, navy by night — with the app's emblem
// big at the top (the night artwork by night), its name ("Pulsus" navy, the
// app's word red), its subtitle in capitals and "Live. Signal. Clarity.", then
// the form. Every sign-in-like page uses it: sign in, two-step, forgot and reset
// password, sign up.
export interface FrameBrand { word: string; sub: string; desc?: string; emblem: string; emblemNight: string }

/** A longer name gets a size that keeps it on one line on a phone. */
export const nameSize = (word: string) => { const n = word.length + 7; return n >= 15 ? " sf-xlong" : n >= 12 ? " sf-long" : ""; };

export function SignInFrame({ brand, title, lead, children, foot }: { brand: FrameBrand; title?: ReactNode; lead?: ReactNode; children?: ReactNode; foot?: ReactNode }) {
  return (
    <main id="main" className="sf">
      <div className="sf-card">
        <div className="sf-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sf-emblem sf-day" src={brand.emblem} alt="" width={240} height={240} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="sf-emblem sf-night" src={brand.emblemNight} alt="" width={240} height={240} />
          <h1 className={`sf-name${nameSize(brand.word)}`}>Pulsus <span className="sf-word">{brand.word}</span></h1>
          <p className="sf-sub">{brand.sub}</p>
        </div>
        <p className="sf-tag">Live. <span className="sf-word">Signal.</span> Clarity.</p>
        {brand.desc ? <p className="sf-desc">{brand.desc}</p> : null}
        {title ? <h2 className="sf-title" id="sf-title">{title}</h2> : null}
        {lead ? <p className="sf-lead">{lead}</p> : null}
        {children}
      </div>
      {foot ? <footer className="sf-foot">{foot}</footer> : null}
    </main>
  );
}

/** Microsoft's sign-in button: the four-square logo and "Sign in with Microsoft". */
export function MicrosoftButton({ onClick, disabled, label = "Sign in with Microsoft" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="sf-ms" onClick={onClick} disabled={disabled}>
      <svg width="21" height="21" viewBox="0 0 21 21" aria-hidden><rect x="1" y="1" width="9" height="9" fill="#f25022" /><rect x="11" y="1" width="9" height="9" fill="#7fba00" /><rect x="1" y="11" width="9" height="9" fill="#00a4ef" /><rect x="11" y="11" width="9" height="9" fill="#ffb900" /></svg>
      {label}
    </button>
  );
}
