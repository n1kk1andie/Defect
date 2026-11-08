// The app's business date.
//
// A demo deployment (DEMO_MODE=1) is LOCKED to a fixed date so its data never
// goes stale: whenever the demo is opened, "today" is 30 Oct 2026 (overridable
// with DEMO_AS_OF=yyyy-mm-dd) and the fictional data runs right up to it. Every
// BUSINESS use of the current date — the entry-date default, report "generated"
// dates, the current year, submission and review stamps — goes through these
// helpers. Infrastructure time (session expiry, cookies, JWT checks, caches) keeps
// using the real clock and must NOT use them.
//
// Production never sets DEMO_MODE, so there these return the real current date.
//
// Self-contained on purpose (no imports) so the edge, the client props and the
// tests can all use it.

export const DEMO_AS_OF_DEFAULT = "2026-10-30";

function demoMode(): boolean {
  return (process.env.DEMO_MODE || "").trim() === "1";
}

/** The demo's locked date (yyyy-mm-dd), or null outside a demo deployment. */
export function demoAsOf(): string | null {
  if (!demoMode()) return null;
  const v = (process.env.DEMO_AS_OF || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) ? v : DEMO_AS_OF_DEFAULT;
}

/** "Now" for business purposes: in a demo, the locked date at the current
 *  (UTC) time of day, so stamps still order realistically; otherwise the real now. */
export function appNow(real: Date = new Date()): Date {
  const asOf = demoAsOf();
  if (!asOf) return real;
  return new Date(asOf + "T" + real.toISOString().slice(11));
}

/** Today's business date as yyyy-mm-dd (UTC calendar date outside a demo). */
export function appTodayISO(real: Date = new Date()): string {
  return demoAsOf() || real.toISOString().slice(0, 10);
}
