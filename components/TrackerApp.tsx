"use client";

import { useEffect, useRef, useState } from "react";
import { initTracker } from "@/lib/engine";

type Session = { role: "inspector" | "supervisor" | "admin"; username: string; branch: string | null } | null;

export default function TrackerApp({ datasets, initialSession, ssoEnabled }: { datasets: any; initialSession: Session; ssoEnabled?: boolean }) {
  const started = useRef(false);
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (started.current) return; // guard StrictMode / re-mounts
    started.current = true;
    const teardown = initTracker({ datasets, initialSession, ssoEnabled });
    return () => { started.current = false; teardown && teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the About panel on Escape.
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setHelpOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen]);

  // The shell — the engine renders into these elements by id (same structure as the
  // original static app, so the tested rendering logic is reused unchanged).
  return (
    <>
    <div className="shell">
      <div className="app">
        <div className="appbar">
          <img src="/pulsus-quality-icon.png" alt="Pulsus Quality" style={{ height: 40, width: "auto", display: "block", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="brand" style={{ fontSize: 18, fontWeight: 700 }}>Pulsus <span style={{ color: "var(--red)" }}>Quality</span></div>
            <div className="sub" style={{ fontWeight: 500 }} id="appbar-sub">Branch Defects</div>
          </div>
          <span className="srcbadge live" id="src-badge">Loading…</span>
          <button className="lockbtn" id="help-btn" title="About & how to use" aria-label="About & how to use" onClick={() => setHelpOpen(true)}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx={12} cy={12} r={10} /><path d="M12 16v-4M12 8h.01" />
            </svg>
          </button>
          <button className="lockbtn" id="export-btn" title="Download data (CSV, Excel, PDF)" aria-label="Download data">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          <span id="auth-slot" />
        </div>

        <div style={{ padding: "2px 16px 8px" }} id="mode-toggle-wrap">
          <div className="toggle" id="mode-toggle">
            <button data-mode="defects" className="on">Branch Defects</button>
            <button data-mode="opstd">Operational Standard</button>
          </div>
        </div>

        <div className="content" id="content" />
        <div className="tabbar" id="tabbar" />
      </div>
    </div>
    {helpOpen && <AboutHowTo onClose={() => setHelpOpen(false)} />}
    <div id="modal-root" />
    </>
  );
}

/** About & How-To-Use panel. Self-contained (inline-styled) so it renders
 *  consistently regardless of the app's stylesheet. */
function AboutHowTo({ onClose }: { onClose: () => void }) {
  const accent = "var(--red, #c8102e)";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="About & how to use Pulsus Quality"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", color: "#0f172a", width: "100%", maxWidth: 640, maxHeight: "86vh", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ display: "inline-flex", color: accent }} aria-hidden>
            <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <circle cx={12} cy={12} r={10} /><path d="M12 16v-4M12 8h.01" />
            </svg>
          </span>
          <div style={{ flex: 1, fontSize: 17, fontWeight: 700 }}>About &amp; how to use</div>
          <button onClick={onClose} aria-label="Close" style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 22, lineHeight: 1, color: "#64748b", padding: 4 }}>&times;</button>
        </div>

        <div style={{ padding: "18px 20px", overflowY: "auto" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 15, color: accent }}>About Pulsus Quality</h3>
          <p style={{ margin: "0 0 10px", lineHeight: 1.55, fontSize: 14 }}>
            Pulsus Quality is the branch-defects and operational-standard monitor for the network. It gives inspectors,
            supervisors and management one live view of outstanding branch defects and operational-standard checks —
            what&rsquo;s open, where, and for how long — so issues are tracked to closure rather than lost in email.
          </p>
          <p style={{ margin: "0 0 16px", lineHeight: 1.55, fontSize: 13, color: "#475569" }}>
            Pulsus Quality is part of the Pulsus platform, licensed by Tumblehill Holdings Limited. For support or
            licensing, contact <a href="mailto:support@pulsus.tech" style={{ color: accent }}>support@pulsus.tech</a>.
          </p>

          <h3 style={{ margin: "0 0 8px", fontSize: 15, color: accent }}>How to use</h3>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.55, fontSize: 14, display: "grid", gap: 8 }}>
            <li><strong>Access.</strong> Open Pulsus Quality from the Pulsus Command Center (your Enterprise Launcher). Your role — inspector, supervisor or admin — sets what you can do.</li>
            <li><strong>Choose a view.</strong> Use the toggle under the header to switch between <em>Branch Defects</em> (issues raised against individual branches) and <em>Operational Standard</em> (the operational-standard checks).</li>
            <li><strong>Read the board.</strong> Each row is a defect or check with its branch, status and age. Use the tabs at the bottom to move between the different breakdowns.</li>
            <li><strong>Log &amp; resolve (Inspectors).</strong> Raise a new defect, add the detail, and mark it resolved once it&rsquo;s fixed.</li>
            <li><strong>Review &amp; sign off (Supervisors).</strong> Check what inspectors raise and confirm closures.</li>
            <li><strong>Export.</strong> Use the download icon in the header to export the current data as CSV, Excel or PDF.</li>
          </ol>
        </div>

        <div style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", textAlign: "right" }}>
          <button onClick={onClose} style={{ border: "none", background: accent, color: "#fff", fontWeight: 600, fontSize: 14, padding: "9px 18px", borderRadius: 9, cursor: "pointer" }}>Got it</button>
        </div>
      </div>
    </div>
  );
}
