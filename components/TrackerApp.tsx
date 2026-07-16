"use client";

import { useEffect, useRef } from "react";
import { initTracker } from "@/lib/engine";

type Session = { role: "inspector" | "supervisor" | "admin"; username: string; branch: string | null } | null;

export default function TrackerApp({ datasets, initialSession }: { datasets: any; initialSession: Session }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // guard StrictMode / re-mounts
    started.current = true;
    const teardown = initTracker({ datasets, initialSession });
    return () => { started.current = false; teardown && teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The shell — the engine renders into these elements by id (same structure as the
  // original static app, so the tested rendering logic is reused unchanged).
  return (
    <>
    <div className="shell">
      <div className="app">
        <div className="appbar">
          <svg height={26} viewBox="0 0 500 340" fill="none" style={{ display: "block", flexShrink: 0 }}>
            <path d="M14 130 L48 74 L112 280 L213 76 L272 204 L341 76 L446 280 L486 216" stroke="#E4012B" strokeWidth={42} strokeLinejoin="miter" strokeMiterlimit={3} />
          </svg>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="brand">VM Building Society</div>
            <div className="sub" style={{ fontWeight: 500 }} id="appbar-sub">Branch Defects</div>
          </div>
          <span className="srcbadge live" id="src-badge">Loading…</span>
          <button className="lockbtn" id="export-btn" title="Download data (CSV, Excel, PDF)" aria-label="Download data">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </button>
          <span id="auth-slot" />
        </div>

        <div style={{ padding: "2px 16px 8px" }}>
          <div className="toggle" id="mode-toggle">
            <button data-mode="defects" className="on">Branch Defects</button>
            <button data-mode="opstd">Operational Standard</button>
          </div>
        </div>

        <div className="content" id="content" />
        <div className="tabbar" id="tabbar" />
      </div>
    </div>
    <div id="modal-root" />
    </>
  );
}
