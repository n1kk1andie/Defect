// The Pulsus Quality marks: the shield with its heartbeat (navy by day, light
// by night), the PULSUS / QUALITY wordmark and the suite tagline.

export function ShieldMark({ className = "brand-mark", title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d="M24 3.5 40 9.3v12.4c0 10.6-6.8 18.7-16 22.8C14.8 40.4 8 32.3 8 21.7V9.3z" fill="none" stroke="var(--navy)" strokeWidth="3.2" strokeLinejoin="round" />
      <path d="M5 23h9.5l2.6-6.5 3.6 12.5 3.3-16 3.4 13.5 2.4-3.5H43" fill="none" stroke="#E4012B" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 34.5l4 3.6 7-7" fill="none" stroke="var(--navy)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ size = 1 }: { size?: number }) {
  return (
    <div style={{ display: "inline-block", textAlign: "center", lineHeight: 1 }} aria-label="Pulsus Quality" role="img">
      <div style={{ fontFamily: "Sora, sans-serif", fontWeight: 800, fontSize: 44 * size, letterSpacing: "0.02em", color: "var(--navy)" }} aria-hidden="true">
        PULS<span style={{ position: "relative" }}>U<span style={{ position: "absolute", left: "50%", top: "18%", width: 9 * size, height: 9 * size, marginLeft: -4.5 * size, borderRadius: "50%", background: "#E4012B" }} /></span>S
      </div>
      <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 10 * size, justifyContent: "center", marginTop: 6 * size }}>
        <span style={{ height: 2, width: 34 * size, background: "#C2410C", opacity: 0.7 }} />
        <span style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15 * size, letterSpacing: "0.42em", color: "var(--red-ink)", marginRight: -6 * size }}>QUALITY</span>
        <span style={{ height: 2, width: 34 * size, background: "#C2410C", opacity: 0.7 }} />
      </div>
    </div>
  );
}

export function Tagline({ className = "" }: { className?: string }) {
  return (
    <p className={`tagline ${className}`} style={{ margin: 0 }}>
      Live. <em>Signal.</em> Clarity.
    </p>
  );
}
