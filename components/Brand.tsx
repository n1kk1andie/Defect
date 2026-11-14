// The Pulsus Quality marks: the emblem (day and night artwork), the PULSUS /
// QUALITY wordmark and the suite tagline.

export function QualityMark({ className = "brand-mark" }: { className?: string }) {
  // The owner's Pulsus Quality emblem (rosette with a tick over a heartbeat in
  // the navy and red ring); the night artwork by night. Decorative: the name sits beside it.
  return (
    <span className={`${className} brand-emblem`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mark-day" src="/pulsus-quality-icon-192.png" alt="" width={40} height={40} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="mark-night" src="/pulsus-quality-icon-night-192.png" alt="" width={40} height={40} />
    </span>
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

// The app footer, the same two lines across the Pulsus Intelligence Suite: the
// product and the suite, then the studio and the company.
export const FOOTER_SUITE = "Part of the Pulsus Intelligence Suite";
export const FOOTER_STUDIO = "A product of Tumblehill Labs, a product studio of Tumblehill Holdings LLC.";

export function FooterLines() {
  return (
    <>
      <span>Pulsus Quality · {FOOTER_SUITE}</span>
      <span>{FOOTER_STUDIO}</span>
    </>
  );
}

export function Tagline({ className = "" }: { className?: string }) {
  return (
    <p className={`tagline ${className}`} style={{ margin: 0 }}>
      Live. <em>Signal.</em> Clarity.
    </p>
  );
}
