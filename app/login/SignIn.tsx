"use client";
// Pulsus Quality's own sign-in page (quality.pulsus.tech/login). The account is
// the Pulsus account (one for every Pulsus product): this page calls the
// account service's sign-in from the browser, which answers this address with
// CORS and sets the shared session cookie on .pulsus.tech, so the visitor never
// leaves Quality. Steps: email + password + quick check → (two-step code) → in.
// "Sign in with Microsoft" shows only when the account service has Microsoft
// sign-in switched on (its GET /api/login says sso: true). A company that
// requires single sign-on is sent straight to its identity provider.
import { useCallback, useEffect, useState } from "react";
import { AccountFrame, hubPost, MicrosoftButton } from "@/components/account/AccountFrame";
import { Msg } from "@/components/ui";
import { SIGNIN_ERRORS } from "@/lib/turnstile";

type Mode = "signin" | "activate" | "mfa" | "forgot" | "sent" | "reset";
interface Challenge { a: number; b: number; exp: number; sig: string; sso?: boolean }
const GENERIC = "Something went wrong. Please try again.";
const isDemo = (process.env.NEXT_PUBLIC_DEMO_MODE || "") === "1";

export function SignIn({ hub, next, error }: { hub: string; next: string; error: string }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [answer, setAnswer] = useState("");
  const [code, setCode] = useState("");
  const [ch, setCh] = useState<Challenge | null>(null);
  const [sso, setSso] = useState(false);
  const [ticket, setTicket] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "err" | "ok" | "info"; text: string } | null>(error ? { kind: "err", text: SIGNIN_ERRORS[error] || GENERIC } : null);
  const fail = (c?: unknown) => setMsg({ kind: "err", text: SIGNIN_ERRORS[String(c)] || GENERIC });

  const loadChallenge = useCallback(async () => {
    setAnswer("");
    try {
      const r = await fetch(hub + "/api/login", { cache: "no-store", credentials: "include" });
      const d = (await r.json()) as Partial<Challenge>;
      setCh(typeof d.a === "number" ? (d as Challenge) : null);
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
  const quick = ch ? { answer: Number(answer), exp: ch.exp, sig: ch.sig } : {};
  const toSso = (path: string) => { window.location.href = hub + path; };

  const signIn = async () => {
    if (busy) return;
    if (!email.trim() || !pw) return fail("credentials");
    if (!ch || !answer) return setMsg({ kind: "err", text: "Answer the quick check first." });
    if (mode === "activate") { if (pw.length < 12) return fail("weak_password"); if (pw !== confirm) return fail("mismatch"); }
    setBusy(true); setMsg(null);
    try {
      const r = await hubPost(hub, "/api/login", { email: email.trim(), password: pw, ...quick, ...(mode === "activate" ? { confirm } : {}), product: "quality" });
      const b = r.body;
      if (b.ok) return go();
      if (b.mfa === "verify" && typeof b.ticket === "string") { setTicket(b.ticket); setMode("mfa"); setBusy(false); return; }
      if (b.mfa === "enrol") { window.location.href = `${hub}/login?return=${encodeURIComponent(window.location.origin + next)}`; return; }
      if (b.error === "sso_required" && typeof b.sso === "string" && b.sso.startsWith("/")) { setMsg({ kind: "info", text: "Your company signs in with single sign-on. Taking you there…" }); return toSso(b.sso); }
      if (b.activate) { setMode("activate"); setMsg({ kind: "info", text: "First time signing in: choose a password of at least 12 characters and confirm it." }); }
      else fail(b.error);
      await loadChallenge();
    } catch { fail(); await loadChallenge(); }
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
    if (!ch || !answer) return setMsg({ kind: "err", text: "Answer the quick check first." });
    setBusy(true); setMsg(null);
    try {
      const r = await hubPost(hub, "/api/login", { action: "requestReset", email: email.trim(), ...quick, product: "quality", login: window.location.origin + "/login" });
      if (r.body.ok) setMode("sent"); else { fail(r.body.error); await loadChallenge(); }
    } catch { fail(); }
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

  const enter = (f: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter") f(); };

  if (isDemo) return (
    <AccountFrame title="The demo opens straight in" sub="No sign-in needed: everything in the demo is a fictional company's sample data.">
      <a className="btn primary mt2" style={{ width: "100%" }} href="/">Open the demo</a>
    </AccountFrame>
  );

  if (mode === "reset") return (
    <AccountFrame title="Set a new password" sub="At least 12 characters.">
      <label className="field"><span>New password</span><input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
      <label className="field"><span>Confirm password</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={enter(setNewPassword)} /></label>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <button className="btn primary mt" style={{ width: "100%" }} disabled={busy} onClick={setNewPassword}>{busy ? "Saving…" : "Save and sign in"}</button>
    </AccountFrame>
  );

  if (mode === "mfa") return (
    <AccountFrame title="Two-step sign-in" sub="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
      <label className="field"><span>Code</span><input className="input" style={{ letterSpacing: ".2em", textAlign: "center" }} inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={enter(verifyCode)} /></label>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <button className="btn primary mt" style={{ width: "100%" }} disabled={busy} onClick={verifyCode}>{busy ? "Checking…" : "Verify"}</button>
      <p className="mt"><button className="linkbtn" onClick={() => { setMode("signin"); setCode(""); setPw(""); setMsg(null); loadChallenge(); }}>Back</button></p>
    </AccountFrame>
  );

  if (mode === "sent") return (
    <AccountFrame title="Check your email" sub="If that address has a Pulsus account, we've emailed it a link to set a new password. The link works for one hour.">
      <p className="mt"><button className="linkbtn" onClick={() => { setMode("signin"); setMsg(null); loadChallenge(); }}>Back to sign in</button></p>
    </AccountFrame>
  );

  const forgot = mode === "forgot";
  return (
    <AccountFrame title={forgot ? "Reset your password" : "Sign in to Pulsus Quality"} sub={forgot ? "We'll email you a link to set a new password." : "Use your Pulsus account."}>
      <label className="field"><span>Work email</span><input id="si-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      {!forgot && <>
        <label className="field"><span>{mode === "activate" ? "Choose a password" : "Password"}</span><input className="input" type="password" autoComplete={mode === "activate" ? "new-password" : "current-password"} value={pw} onChange={(e) => setPw(e.target.value)} /></label>
        {mode === "activate" && <label className="field"><span>Confirm password</span><input className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
      </>}
      <label className="field"><span>Quick check</span>
        <span className="row"><span className="sora" style={{ fontWeight: 700, whiteSpace: "nowrap" }} aria-hidden="true">{ch ? `${ch.a} + ${ch.b} =` : "…"}</span>
          <input className="input" inputMode="numeric" autoComplete="off" aria-label={ch ? `What is ${ch.a} plus ${ch.b}?` : "Quick check answer"} value={answer} onChange={(e) => setAnswer(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={enter(forgot ? requestReset : signIn)} /></span>
      </label>
      {msg && <Msg kind={msg.kind}>{msg.text}</Msg>}
      <button className="btn primary mt" style={{ width: "100%" }} disabled={busy || !ch} onClick={forgot ? requestReset : signIn}>
        {busy ? "Please wait…" : forgot ? "Email me a link" : mode === "activate" ? "Set password and sign in" : "Sign in"}
      </button>
      {!forgot && sso && <><div className="or">or</div><MicrosoftButton onClick={microsoft} disabled={busy} /></>}
      <p className="mt" style={{ fontSize: 14 }}>
        {forgot ? <button className="linkbtn" onClick={() => { setMode("signin"); setMsg(null); }}>Back to sign in</button> : <button className="linkbtn" onClick={() => { setMode("forgot"); setMsg(null); }}>Forgot password?</button>}
      </p>
      {!forgot && <p className="sub" style={{ fontSize: 14 }}>New to Pulsus Quality? <a href="/signup" style={{ fontWeight: 700 }}>Start a free trial</a></p>}
    </AccountFrame>
  );
}
