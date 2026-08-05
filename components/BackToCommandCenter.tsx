"use client";

import { useEffect, useState } from "react";

// Floating "← Command Center" chip. It appears ONLY when the readable pulsus_home
// breadcrumb cookie is present — i.e. the person reached this app from inside the
// Pulsus platform — and links back to the Command Center. Standalone visitors
// (no platform session) never see it. Carries no auth; reads a non-secret cookie.
export function BackToCommandCenter() {
  const [home, setHome] = useState("");
  useEffect(() => {
    const m = document.cookie.match(/(?:^|; )pulsus_home=([^;]*)/);
    let h = m ? decodeURIComponent(m[1]) : "";
    if (h && !/^https:\/\/[a-z0-9.-]*pulsus\.tech\/?$/i.test(h)) h = "https://executive.pulsus.tech";
    setHome(h);
  }, []);
  if (!home) return null;
  return (
    <a
      href={home}
      aria-label="Back to the Pulsus Command Center"
      style={{
        position: "fixed",
        top: 10,
        left: 10,
        zIndex: 2147483000,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 12px",
        borderRadius: 999,
        background: "rgba(17,24,39,.9)",
        color: "#fff",
        font: "600 12.5px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif",
        textDecoration: "none",
        boxShadow: "0 2px 10px rgba(0,0,0,.28)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>←</span> Command Center
    </a>
  );
}
