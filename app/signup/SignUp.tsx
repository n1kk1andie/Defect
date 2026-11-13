"use client";
// The free trial. The company and its owner are created by the Pulsus account
// service, called from this page with CORS as the sign-in page does. Its
// confirmation email links back here (?token=…), where the owner chooses a
// password and goes straight into Pulsus Quality. The human check is Cloudflare
// Turnstile when the account service hands out a site key, else its signed sum.
// A demo has no sign-up: it opens straight into the fictional company.
import { useCallback, useEffect, useRef, useState } from "react";
import { AccountFrame, hubPost } from "@/components/account/AccountFrame";
import { Msg } from "@/components/ui";
import { TURNSTILE_JS, turnstileKey } from "@/lib/turnstile";
import { money, qualityPrice, type QualityPrice } from "@/lib/pricing";
import { CURRENCY_BY_COUNTRY, countryOptions, currencyOptions, guessRegion } from "@/lib/regionOptions";

interface Check { turnstile?: string; a?: number; b?: number; exp?: number; sig?: string }
interface TurnstileApi { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id?: string) => void }

const ERR: Record<string, string> = {
  signup_closed: "Sign-up isn't open yet. Contact us to get started.",
  company_required: "Enter your company's name.",
  name_required: "Enter your name.",
  email_required: "Enter a valid work email.",
  email_in_use: "That email already has a Pulsus account. Sign in instead, or ask your company's owner to invite you.",
  email_reserved: "That email already has a Pulsus account. Sign in instead.",
  email_taken: "That email already belongs to a company on Pulsus. Sign in instead.",
  terms_required: "Please accept the Terms of Use to continue.",
  challenge: "The verification check didn't pass. Please try it again.",
  challenge_expired: "The quick check expired. Please answer the new one.",
  too_many: "Too many attempts. Please wait a while and try again.",
  email_failed: "We couldn't send the confirmation email just now. Please try again.",
  link_invalid: "This link is invalid or has expired. Start again below.",
  link_used: "This link has already been used. Sign in with the password you chose.",
  weak_password: "Choose a password of at least 12 characters.",
  mismatch: "The passwords don't match.",
  storage: "Couldn't save your password just now. Please try again.",
  forbidden: "Sign-up isn't available from this address.",
  generic: "Something went wrong. Please try again.",
};

export function SignUp({ hub, demo }: { hub: string; demo: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [currency, setCurrency] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [answer, setAnswer] = useState("");
  const [cf, setCf] = useState("");
  const [terms, setTerms] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ link?: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [price, setPrice] = useState<QualityPrice | null>(null);
  const [countries, setCountries] = useState<[string, string][]>([]);
  const [currencies, setCurrencies] = useState<[string, string][]>([]);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const fail = (c?: unknown) => setMsg(ERR[String(c)] || ERR.generic);

  const loadCheck = useCallback(async () => {
    setAnswer("");
    try { const r = await fetch(hub + "/api/signup", { cache: "no-store", credentials: "include" }); setCheck((await r.json()) as Check); } catch { setCheck(null); }
  }, [hub]);

  useEffect(() => {
    if (demo) return;
    const tk = new URLSearchParams(window.location.search).get("token");
    if (tk) { setToken(tk); return; }
    loadCheck();
    fetch(hub + "/api/pricing", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((l) => setPrice(qualityPrice(l))).catch(() => {});
    setCountries(countryOptions()); setCurrencies(currencyOptions());
    const g = guessRegion();
    setTimezone(g.timezone);
    if (g.country) { setCountry(g.country); setCurrency(CURRENCY_BY_COUNTRY[g.country] || "USD"); }
  }, [loadCheck, demo, hub]);

  const siteKey = turnstileKey(check, demo);
  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    const w = window as unknown as { turnstile?: TurnstileApi };
    const draw = () => {
      if (gone || !box.current || !w.turnstile) return;
      widget.current = w.turnstile.render(box.current, { sitekey: siteKey, callback: (v: string) => { setCf(v); setMsg(""); }, "expired-callback": () => setCf(""), "error-callback": () => { setCf(""); setMsg("The verification check couldn't load. Please refresh the page and try again."); } });
    };
    if (w.turnstile) draw();
    else { const s = document.createElement("script"); s.src = TURNSTILE_JS; s.async = true; s.onload = draw; s.onerror = () => setMsg("The verification check couldn't load. Please refresh the page and try again."); document.head.appendChild(s); }
    return () => { gone = true; if (widget.current && w.turnstile) w.turnstile.remove(widget.current); widget.current = null; };
  }, [siteKey]);

  const again = async () => {
    const w = window as unknown as { turnstile?: TurnstileApi };
    if (siteKey) { setCf(""); if (widget.current && w.turnstile) w.turnstile.reset(widget.current); } else await loadCheck();
  };

  const start = async () => {
    if (busy || !check) return;
    setBusy(true); setMsg("");
    try {
      const origin = window.location.origin;
      const r = await hubPost(hub, "/api/signup", { action: "start", company, name, email, acceptTerms: terms, country, currency, timezone, ...(siteKey ? { turnstile: cf } : { answer: Number(answer), exp: check.exp, sig: check.sig }), product: "quality", return: origin + "/", page: origin + "/signup" });
      if (r.body.ok) setSent({ link: typeof r.body.link === "string" ? r.body.link : undefined });
      else { fail(r.body.error); await again(); }
    } catch { fail(); await again(); }
    setBusy(false);
  };

  const complete = async () => {
    if (busy || !token) return;
    if (pw.length < 12) return fail("weak_password");
    if (pw !== confirm) return fail("mismatch");
    setBusy(true); setMsg("");
    try {
      const r = await hubPost(hub, "/api/signup", { action: "complete", token, password: pw, confirm });
      if (r.body.ok) { const to = typeof r.body.redirect === "string" ? r.body.redirect : "/"; window.location.replace(/^https:\/\/[a-z0-9.-]+\.pulsus\.tech(?:[/?#]|$)/i.test(to) || /^\/(?![\/\\])/.test(to) ? to : "/"); return; }
      fail(r.body.error);
    } catch { fail(); }
    setBusy(false);
  };

  if (demo) return <AccountFrame title="No sign-up needed for the demo" sub="The demo opens straight into a fictional company's quality data."><a className="btn primary mt2" style={{ width: "100%" }} href="/">Open the demo</a></AccountFrame>;
  if (token) return (
    <AccountFrame title="Finish setting up Pulsus Quality" sub="Choose a password of at least 12 characters.">
      <label className="field"><span>Password</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="field"><span>Confirm password</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") complete(); }} /></label>
      <Msg>{msg}</Msg>
      <button className="btn primary mt" style={{ width: "100%" }} disabled={busy} onClick={complete}>{busy ? "Setting up…" : "Open Pulsus Quality"}</button>
    </AccountFrame>
  );
  if (sent) return (
    <AccountFrame title="Check your email" sub={`We sent a confirmation link to ${email}. Open it within 24 hours to finish setting up ${company}.`}>
      {sent.link && <Msg kind="info">Test mode: no email is sent here. <a href={sent.link}>Continue setting up</a></Msg>}
    </AccountFrame>
  );
  const ready = !!check && (siteKey ? !!cf : !!answer);
  return (
    <AccountFrame title="Start your free Pulsus Quality trial" sub={`Free for ${price?.trialDays ?? 14} days. No card needed.`}>
      {price && <p className="sub" style={{ marginTop: 4 }}>After the trial, {price.product} is {money(price.monthly, price.currency)} a month{price.includes ? ` and includes ${price.includes}` : ""}.</p>}
      <label className="field"><span>Company name</span><input className="input" value={company} autoComplete="organization" onChange={(e) => setCompany(e.target.value)} /></label>
      <label className="field"><span>Your name</span><input className="input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>Work email</span><input className="input" type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} /></label>
      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        <label className="field grow" style={{ minWidth: 160 }}><span>Country</span>
          <select className="select" style={{ width: "100%" }} value={country} onChange={(e) => { setCountry(e.target.value); if (CURRENCY_BY_COUNTRY[e.target.value]) setCurrency(CURRENCY_BY_COUNTRY[e.target.value]); }}><option value="">Choose…</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        <label className="field grow" style={{ minWidth: 120 }}><span>Currency</span>
          <select className="select" style={{ width: "100%" }} value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">Choose…</option>{currencies.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
      </div>
      <div className="field"><span>Verify you&apos;re human</span>
        {siteKey ? <div ref={box} style={{ minHeight: 65 }} /> : (
          <span className="row"><span className="sora" style={{ fontWeight: 700 }} aria-hidden="true">{check && typeof check.a === "number" ? `${check.a} + ${check.b} =` : "…"}</span>
            <input className="input" inputMode="numeric" autoComplete="off" aria-label={check && typeof check.a === "number" ? `What is ${check.a} plus ${check.b}?` : "Quick check answer"} value={answer} onChange={(e) => setAnswer(e.target.value.replace(/[^0-9]/g, ""))} /></span>
        )}
      </div>
      <label className="row mt" style={{ alignItems: "flex-start", fontSize: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 4 }} />
        <span>I agree to the <a href={`${hub}/legal/terms`} target="_blank" rel="noreferrer">Terms of Use</a> and <a href={`${hub}/legal/privacy`} target="_blank" rel="noreferrer">Privacy Policy</a> on behalf of my company.</span>
      </label>
      <Msg>{msg}</Msg>
      <button className="btn primary mt" style={{ width: "100%" }} disabled={busy || !ready} onClick={start}>{busy ? "Sending…" : "Start free trial"}</button>
      <p className="sub mt" style={{ fontSize: 14 }}>Already on Pulsus? <a href="/login" style={{ fontWeight: 700 }}>Sign in</a></p>
    </AccountFrame>
  );
}
