"use client";

/**
 * The green "Demo" pill shown in a demo deployment's header.
 *
 * Renders nothing unless NEXT_PUBLIC_DEMO_MODE is "1". That value is inlined at
 * build time from the server-only DEMO_MODE (see next.config.mjs), so production
 * builds compile this away to nothing — a client component cannot read DEMO_MODE
 * directly, since only NEXT_PUBLIC_* vars reach the browser.
 *
 * It exists so a fictional dataset is never mistaken for the real one. Every
 * Pulsus demo app carries the same badge in the same place.
 */
export default function DemoBadge() {
  if ((process.env.NEXT_PUBLIC_DEMO_MODE || "") !== "1") return null;
  return (
    <span className="srcbadge demo" title="Fictional demo data — Meridian Building Society">
      Demo
    </span>
  );
}
