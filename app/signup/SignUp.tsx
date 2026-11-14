"use client";
// The free trial. The company and its owner are created by the Pulsus account
// service, called from this page with CORS as the sign-in page does. Its
// confirmation email links back here (?token=…), where the owner chooses a
// password and goes straight into Pulsus Quality. The human check is Cloudflare
// Turnstile when the account service hands out a site key, else its signed
// one-time check, which the page completes itself — never a sum (components/HumanCheck).
// A demo has no sign-up: it opens straight into the fictional company.
import { useCallback, useEffect, useState } from "react";
import { AccountFrame, hubPost } from "@/components/account/AccountFrame";
import { HumanCheckBox, useHumanCheck, type HumanOffer } from "@/components/HumanCheck";
import { money, qualityPrice, type QualityPrice } from "@/lib/pricing";
import { CURRENCY_BY_COUNTRY, countryOptions, currencyOptions, guessRegion } from "@/lib/regionOptions";

type Check = NonNullable<HumanOffer>;

const ERR: Record<string, string> = {
  signup_closed: "Sign-up isn't open yet. Contact us to get started.",
  company_required: "Enter your company's name.",
  name_required: "Enter your name.",
  email_required: "Enter a valid work email.",
  email_in_use: "That email already has a Pulsus account. Sign in instead, or ask your company's owner to invite you.",
  email_reserved: "That email already has a Pulsus account. Sign in instead.",
  email_taken: "That email already belongs to a company on Pulsus. Sign in instead.",
  terms_required: "Please accept the Terms of Use to continue.",
  challenge: "The security check didn't pass. Please try again.",
  challenge_expired: "The security check timed out. Please try again.",
  check_failed: "The security check couldn't load. Please refresh the page and try again.",
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
  const [terms, setTerms] = useState(false);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ link?: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [price, setPrice] = useState<QualityPrice | null>(null);
  const [countries, setCountries] = useState<[string, string][]>([]);
  const [currencies, setCurrencies] = useState<[string, string][]>([]);
  const fail = (c?: unknown) => setMsg(ERR[String(c)] || ERR.generic);

  const human = useHumanCheck(demo ? null : check);
  const loadCheck = useCallback(async () => {
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

  const start = async () => {
    if (busy || !check) return;
    setBusy(true); setMsg("");
    try {
      const origin = window.location.origin;
      const proof = await human.fields();
      human.next();
      const r = await hubPost(hub, "/api/signup", { action: "start", company, name, email, acceptTerms: terms, country, currency, timezone, ...proof, product: "quality", return: origin + "/", page: origin + "/signup" });
      if (r.body.ok) setSent({ link: typeof r.body.link === "string" ? r.body.link : undefined });
      else { fail(r.body.error); await loadCheck(); }
    } catch (e) { fail(e); await loadCheck(); }
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

  const note = msg ? <p className="sf-msg err" role="alert">{msg}</p> : null;
  if (demo) return <AccountFrame title="No sign-up needed for the demo" sub="The demo opens straight into a fictional company's quality data."><div className="sf-form"><a className="sf-btn2" href="/">Open the demo</a></div></AccountFrame>;
  if (token) return (
    <AccountFrame title="Finish setting up Pulsus Quality" sub="Choose a password of at least 12 characters.">
      <form className="sf-form" noValidate onSubmit={(e) => { e.preventDefault(); complete(); }}>
        <label className="sf-field"><span>Password</span><input className="sf-input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="sf-field"><span>Confirm password</span><input className="sf-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {note}
        <button className="sf-btn" disabled={busy}>{busy ? "Setting up…" : "Open Pulsus Quality"}</button>
      </form>
    </AccountFrame>
  );
  if (sent) return (
    <AccountFrame title="Check your email" sub={`We sent a confirmation link to ${email}. Open it within 24 hours to finish setting up ${company}.`}>
      {sent.link && <p className="sf-msg info" role="status">Test mode: no email is sent here. <a href={sent.link}>Continue setting up</a></p>}
      <div className="sf-links"><a href="/login">Back to sign in</a></div>
    </AccountFrame>
  );
  return (
    <AccountFrame title="Start your free trial" sub={<>Free for {price?.trialDays ?? 14} days. No card needed.{price ? <> After the trial, {price.product} is {money(price.monthly, price.currency)} a month{price.includes ? ` and includes ${price.includes}` : ""}.</> : null}</>}>
      <form className="sf-form" noValidate onSubmit={(e) => { e.preventDefault(); start(); }}>
        <label className="sf-field"><span>Company name</span><input className="sf-input" value={company} autoComplete="organization" onChange={(e) => setCompany(e.target.value)} /></label>
        <label className="sf-field"><span>Your name</span><input className="sf-input" value={name} autoComplete="name" onChange={(e) => setName(e.target.value)} /></label>
        <label className="sf-field"><span>Work email</span><input className="sf-input" type="email" value={email} autoComplete="email" placeholder="you@company.com" onChange={(e) => setEmail(e.target.value)} /></label>
        <div className="sf-row">
          <label className="sf-field" style={{ flex: 1.4 }}><span>Country</span>
            <select className="sf-input" value={country} onChange={(e) => { setCountry(e.target.value); if (CURRENCY_BY_COUNTRY[e.target.value]) setCurrency(CURRENCY_BY_COUNTRY[e.target.value]); }}><option value="">Choose…</option>{countries.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
          <label className="sf-field"><span>Currency</span>
            <select className="sf-input" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">Choose…</option>{currencies.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select></label>
        </div>
        <label className="sf-check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>I agree to the <a href={`${hub}/legal/terms`} target="_blank" rel="noreferrer">Terms of Use</a> and <a href={`${hub}/legal/privacy`} target="_blank" rel="noreferrer">Privacy Policy</a> on behalf of my company.</span>
        </label>
        <HumanCheckBox check={human} />
        {note}
        <button className="sf-btn" disabled={busy || !check}>{busy ? "Sending…" : "Start free trial"}</button>
      </form>
      <div className="sf-links"><p>Already on Pulsus? <a href="/login">Sign in</a></p></div>
    </AccountFrame>
  );
}
