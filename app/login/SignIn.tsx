"use client";
// Pulsus Quality's own sign-in page (quality.pulsus.tech/login). The account is
// the Pulsus account (one for every Pulsus product): this page calls the
// account service's sign-in from the browser, which answers this address with
// CORS and sets the shared session cookie on .pulsus.tech, so the visitor never
// leaves Quality. Steps: email + password → (two-step code) → in. The human
// check is Cloudflare Turnstile when the account service offers it, out of
// sight unless Cloudflare needs a click; never a sum (components/HumanCheck).
// "Sign in with Microsoft" shows only when the account service has Microsoft
// sign-in switched on (its GET /api/login says sso: true). A company that
// requires single sign-on is sent straight to its identity provider.
import { useCallback, useEffect, useState } from "react";
import { AccountFrame, hubPost, MicrosoftButton } from "@/components/account/AccountFrame";
import { HumanCheckBox, useHumanCheck, type HumanOffer } from "@/components/HumanCheck";
import { SIGNIN_ERRORS } from "@/lib/turnstile";

type Mode = "signin" | "activate" | "mfa" | "forgot" | "sent" | "reset";
type Challenge = NonNullable<HumanOffer> & { sso?: boolean };
const GENERIC = "Something went wrong. Please try again.";
const isDemo = (process.env.NEXT_PUBLIC_DEMO_MODE || "") === "1";

export function SignIn({ hub, next, error }: { hub: string; next: string; error: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [ch, setCh] = useState<Challenge | null>(null);
  const [sso, setSso] = useState(false);
  const [ticket, setTicket] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(error ? { kind: "err", text: SIGNIN_ERRORS[error] || GENERIC } : null);
  const fail = (c?: unknown) => setMsg({ kind: "err", text: SIGNIN_ERRORS[String(c)] || GENERIC });

  const human = useHumanCheck(isDemo ? null : ch);
  const loadChallenge = useCallback(async () => {
    try {
      const r = await fetch(hub + "/api/login", { cache: "no-store", credentials: "include" });
      const d = (await r.json()) as Challenge;
      setCh(d);
      setSso(d.sso === true);
    } catch { setCh(null); }
  }, [hub]);

  useEffect(() => {
    if (isDemo) return;
    const rt = new URLSearchParams(window.location.search).get("reset");
    if (rt) { setResetToken(rt); setMode("reset"); return; }
    loadChallenge();
  }, [loadChallenge]);

  const go = () => window.location.replace(next);
  // The human check's fields for one send (each is single-use).
  const quick = async () => { const f = await human.fields(); human.next(); return f; };
  const toSso = (path: string) => { window.location.href = hub + path; };

  const signIn = async () => {
    if (busy) return;
    if (!email.trim() || !pw) return fail("credentials");
    if (mode === "activate") { if (pw.length < 12) return fail("weak_password"); if (pw !== confirm) return fail("mismatch"); }
    setBusy(true); setMsg(null);
    try {
      const r = await hubPost(hub, "/api/login", { email: email.trim(), password: pw, ...(await quick()), ...(mode === "activate" ? { confirm } : {}), product: "quality" });
      const b = r.body;
      if (b.ok) return go();
      if (b.mfa === "verify" && typeof b.ticket === "string") { setTicket(b.ticket); setMode("mfa"); setBusy(false); return; }
      if (b.mfa === "enrol") { window.location.href = `${hub}/login?return=${encodeURIComponent(window.location.origin + next)}`; return; }
      if (b.error === "sso_required" && typeof b.sso === "string" && b.sso.startsWith("/")) { setMsg({ kind: "info", text: "Your company signs in with single sign-on. Taking you there…" }); return toSso(b.sso); }
      if (b.activate) { setMode("activate"); setMsg({ kind: "info", text: "First time signing in: choose a password of at least 12 characters and confirm it." }); }
      else fail(b.error);
      await loadChallenge();
    } catch (e) { fail(e); await loadChallenge(); }
    setBusy(false);
  };

  const microsoft = () => {
    const e = email.trim();
    if (!e || !e.includes("@")) { setMsg({ kind: "err", text: "Enter your work email first, then choose Sign in with Microsoft." }); document.getElementById("si-email")?.focus(); return; }
    const app = window.location.origin + next;
    const self = window.location.origin + "/login?next=" + encodeURIComponent(next);
    window.location.href = `${hub}/api/auth/microsoft/start?return=${encodeURIComponent(app)}&login=${encodeURIComponent(self)}&login_hint=${encodeURIComponent(e)}`;
  };

  const verifyCode = async () => {
    if (busy || !code.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const r = await hubPost(hub, "/api/login", { action: "mfaVerify", ticket, code: code.trim() });
      if (r.body.ok) return go();
      fail(r.body.error);
      if (r.body.error === "mfa_expired") { setMode("signin"); setCode(""); setPw(""); await loadChallenge(); }
    } catch { fail(); }
    setBusy(false);
  };

  const requestReset = async () => {
    if (busy) return;
    if (!email.trim()) return setMsg({ kind: "err", text: "Enter your email address first." });
    setBusy(true); setMsg(null);
    try {
      const r = await hubPost(hub, "/api/login", { action: "requestReset", email: email.trim(), ...(await quick()), product: "quality", login: window.location.origin + "/login" });
      if (r.body.ok) setMode("sent"); else { fail(r.body.error); await loadChallenge(); }
    } catch (e) { fail(e); await loadChallenge(); }
    setBusy(false);
  };

  const setNewPassword = async () => {
    if (busy) return;
    if (pw.length < 12) return fail("weak_password");
    if (pw !== confirm) return fail("mismatch");
    setBusy(true); setMsg(null);
    try {
      const r = await hubPost(hub, "/api/login", { resetToken, password: pw, confirm });
      if (r.body.ok) return go();
      if (r.body.mfa === "verify" && typeof r.body.ticket === "string") { setTicket(r.body.ticket); setMode("mfa"); setBusy(false); return; }
      fail(r.body.error);
    } catch { fail(); }
    setBusy(false);
  };

  const note = msg ? <p className={`sf-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</p> : null;
  const form = (onSubmit: () => void, children: React.ReactNode) => <form className="sf-form" noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{children}</form>;

  if (isDemo) return (
    <AccountFrame title="The demo opens straight in" sub="No sign-in needed: everything in the demo is a fictional company's sample data.">
      <div className="sf-form"><a className="sf-btn2" href="/">Open the demo</a></div>
    </AccountFrame>
  );

  if (mode === "reset") return (
    <AccountFrame title="Set a new password" sub="At least 12 characters.">
      {form(setNewPassword, <>
        <label className="sf-field"><span>New password</span><input className="sf-input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        <label className="sf-field"><span>Confirm password</span><input className="sf-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
        {note}
        <button className="sf-btn" disabled={busy}>{busy ? "Saving…" : "Save and sign in"}</button>
      </>)}
    </AccountFrame>
  );

  if (mode === "mfa") return (
    <AccountFrame title="Two-step sign-in" sub="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
      {form(verifyCode, <>
        <label className="sf-field"><span>Code</span><input className="sf-input" style={{ letterSpacing: ".2em", textAlign: "center" }} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        {note}
        <button className="sf-btn" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
      </>)}
      <div className="sf-links"><button type="button" className="sf-link" onClick={() => { setMode("signin"); setCode(""); setPw(""); setMsg(null); loadChallenge(); }}>Back</button></div>
    </AccountFrame>
  );

  if (mode === "sent") return (
    <AccountFrame title="Check your email" sub="If that address has a Pulsus account, we've emailed it a link to set a new password. The link works for one hour.">
      <div className="sf-links"><button type="button" className="sf-link" onClick={() => { setMode("signin"); setMsg(null); loadChallenge(); }}>Back to sign in</button></div>
    </AccountFrame>
  );

  const forgot = mode === "forgot";
  return (
    <AccountFrame title={forgot ? "Reset your password" : "Sign in"} sub={forgot ? "We'll email you a link to set a new password." : undefined}>
      {form(forgot ? requestReset : signIn, <>
        <label className="sf-field"><span>Work email</span><input id="si-email" className="sf-input" type="email" autoComplete="username" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {!forgot && <>
          <label className="sf-field"><span>{mode === "activate" ? "Choose a password" : "Password"}</span><input className="sf-input" type="password" autoComplete={mode === "activate" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          {mode === "activate" && <label className="sf-field"><span>Confirm password</span><input className="sf-input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
        </>}
        <HumanCheckBox check={human} />
        {note}
        <button className="sf-btn" disabled={busy || !ch}>
          {busy ? "Please wait…" : forgot ? "Email me a link" : mode === "activate" ? "Set password and sign in" : "Sign in"}
        </button>
        {!forgot && sso && <><div className="sf-or">or</div><MicrosoftButton onClick={microsoft} disabled={busy} /></>}
      </>)}
      <div className="sf-links">
        {forgot ? <button type="button" className="sf-link" onClick={() => { setMode("signin"); setMsg(null); }}>Back to sign in</button> : <button type="button" className="sf-link" onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>}
        {!forgot && <p>New to Pulsus Quality? <a href="/signup">Start a 14-day free trial</a></p>}
      </div>
    </AccountFrame>
  );
}
