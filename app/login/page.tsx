// Shown to a direct visitor to quality.pulsus.tech. The solution is licensed and
// accessed through the Enterprise Launcher (the Pulsus Command Center); anyone
// arriving via the launcher is already past the gate and never sees this page.

export default function LoginPage() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "linear-gradient(160deg, var(--red, #E4012B), var(--red-dark, #A60020))", fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <div style={{ width: "100%", maxWidth: 380, background: "#fff", borderRadius: 16, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/pulsus-quality.png" alt="Pulsus Quality" style={{ width: "82%", maxWidth: 300, height: "auto", display: "block", margin: "0 auto 18px" }} />
        <h1 style={{ margin: "0 0 10px", fontFamily: "'Sora', system-ui, sans-serif", fontSize: 22, fontWeight: 800, color: "#111827" }}>Licence Required</h1>
        <p style={{ margin: "0 0 14px", fontSize: 14, color: "#6b7280", lineHeight: 1.55 }}>
          This solution requires an active licence. If your organisation is licensed, please access the solution through your Enterprise Launcher.
        </p>
        <p style={{ margin: 0, fontSize: 14, color: "#6b7280", lineHeight: 1.55 }}>
          For licensing assistance, contact Tumblehill Holdings Limited at{" "}
          <a href="mailto:support@pulsus.tech" style={{ color: "var(--red, #E4012B)", fontWeight: 600, textDecoration: "none" }}>support@pulsus.tech</a>.
        </p>
      </div>
    </div>
  );
}
