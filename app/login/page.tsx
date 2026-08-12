import type { CSSProperties } from "react";
import { ssoEnabled } from "@/lib/msauth";

// Standalone sign-in for direct visitors to quality.pulsus.tech. Outside the
// Command Center there is no password login — only Microsoft SSO (enabled once
// Azure is configured; a "· soon" placeholder until then). Anyone arriving via
// the Command Center is already past the gate and never sees this page.

const ERRORS: Record<string, string> = {
  not_authorized: "That account isn't allowed to view this dashboard. Please contact an administrator.",
  admin_password: "Administrators sign in inside the app.",
  sso: "Microsoft sign-in isn't available yet.",
  sso_state: "Sign-in expired or was interrupted. Please try again.",
  sso_token: "Couldn't verify your Microsoft sign-in. Please try again.",
  sso_email: "Your Microsoft account didn't return an email address.",
};

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string; sso_error?: string } }) {
  const sso = ssoEnabled();
  const nextRaw = typeof searchParams?.next === "string" ? searchParams.next : "";
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "";
  const startHref = `/api/auth/microsoft/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;
  const code = searchParams?.sso_error || searchParams?.error;
  const err = code ? (ERRORS[code] || "Sign-in failed. Please try again.") : "";

  const msLogo = (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );

  const btnBase: CSSProperties = {
    marginTop: 4, width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center",
    gap: 10, padding: "12px 16px", borderRadius: 10, border: "1px solid #d5d9e0", background: "#fff",
    fontFamily: "inherit", fontWeight: 600, fontSize: 15,
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "linear-gradient(160deg, var(--red, #E4012B), var(--red-dark, #A60020))", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pulsus-quality.png" alt="Pulsus Quality" style={{ width: "82%", maxWidth: 300, height: "auto", display: "block", margin: "0 auto 16px" }} />
        <h1 style={{ margin: "0 0 6px", fontFamily: "'Sora', system-ui, sans-serif", fontSize: 22, fontWeight: 800, color: "#111827" }}>Sign in</h1>
        <p style={{ margin: "0 0 22px", fontSize: 14, color: "#6b7280", lineHeight: 1.5 }}>
          This dashboard requires you to sign in with your company Microsoft account.
        </p>

        {err && (
          <div role="alert" style={{ margin: "0 0 16px", padding: "10px 12px", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", fontSize: 13, lineHeight: 1.4 }}>
            {err}
          </div>
        )}

        {sso ? (
          <a href={startHref} style={{ ...btnBase, color: "#1a2230", cursor: "pointer", textDecoration: "none" }}>
            {msLogo} Sign in with Microsoft
          </a>
        ) : (
          <button type="button" disabled style={{ ...btnBase, color: "#9ca3af", cursor: "default" }}>
            {msLogo} Sign in with Microsoft <span style={{ fontWeight: 600, color: "#9ca3af" }}>· soon</span>
          </button>
        )}
      </div>
    </div>
  );
}
