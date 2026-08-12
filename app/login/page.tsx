"use client";

import { useState } from "react";

// Standalone sign-in for direct visitors to quality.pulsus.tech. (Anyone arriving
// via the Command Center is already past the gate and uses the in-app login.)
// Posts to /api/login — either a staff role login or the admin login — then
// continues to wherever they were headed.
export default function LoginPage() {
  const [mode, setMode] = useState<"staff" | "admin">("staff");
  const [role, setRole] = useState<"inspector" | "supervisor">("inspector");
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const nextPath = (): string => {
    try {
      const q = new URLSearchParams(window.location.search).get("next");
      if (q && q.startsWith("/") && !q.startsWith("//")) return q;
    } catch { /* ignore */ }
    return "/";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const body = mode === "admin"
      ? { username, password }
      : { role, name: name.trim(), branch: branch.trim(), password };
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok) { window.location.href = nextPath(); return; }
      setError(j.error || "Sign-in failed.");
    } catch { setError("Could not reach the sign-in service."); }
    setBusy(false);
  };

  const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" };
  const input: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 10, border: "1px solid #d5d9e0", fontSize: 15, fontFamily: "inherit", marginBottom: 12 };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "linear-gradient(160deg, var(--red, #E4012B), var(--red-dark, #A60020))", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#fff", borderRadius: 16, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pulsus-quality.png" alt="Pulsus Quality" style={{ width: "82%", maxWidth: 300, height: "auto", display: "block", margin: "0 auto 16px" }} />
        <h1 style={{ margin: "0 0 6px", fontFamily: "'Sora', system-ui, sans-serif", fontSize: 22, fontWeight: 800, color: "#111827" }}>Sign in</h1>
        <p style={{ margin: "0 0 20px", fontSize: 14, color: "#6b7280", lineHeight: 1.5 }}>
          This dashboard is restricted. Sign in to continue.
        </p>

        {error && (
          <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13, lineHeight: 1.4 }}>
            {error}
          </div>
        )}

        <form onSubmit={submit}>
          {mode === "staff" ? (
            <>
              <label style={label} htmlFor="role">Role</label>
              <select id="role" value={role} onChange={(e) => setRole(e.target.value as "inspector" | "supervisor")} style={input}>
                <option value="inspector">Officer — key branch reviews</option>
                <option value="supervisor">Supervisor — review &amp; sign-off</option>
              </select>
              <label style={label} htmlFor="name">Your name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" style={input} />
              <label style={label} htmlFor="branch">Branch {role === "supervisor" ? "(optional — all branches)" : ""}</label>
              <input id="branch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder={role === "supervisor" ? "All branches" : "Your branch"} style={input} />
            </>
          ) : (
            <>
              <label style={label} htmlFor="username">Username <span style={{ fontWeight: 400, color: "#9ca3af" }}>(optional)</span></label>
              <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="admin" style={input} />
            </>
          )}
          <label style={label} htmlFor="pw">Password</label>
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" style={input} />
          <button type="submit" disabled={busy || !password} style={{ width: "100%", padding: "12px 16px", borderRadius: 10, border: "none", background: "var(--red, #E4012B)", color: "#fff", fontFamily: "inherit", fontWeight: 600, fontSize: 15, cursor: busy || !password ? "not-allowed" : "pointer", opacity: busy || !password ? 0.7 : 1, marginTop: 2 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => { setMode(mode === "staff" ? "admin" : "staff"); setError(""); }}
          style={{ display: "inline-block", marginTop: 14, background: "none", border: "none", padding: 0, color: "var(--red, #E4012B)", fontFamily: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          {mode === "staff" ? "Admin sign-in" : "← Back to staff sign-in"}
        </button>
      </div>
    </div>
  );
}
