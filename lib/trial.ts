/** Whole days left until a trial ends (0 on its last day, and after), or null when there is no end date. */
export function trialDaysLeft(endsAt: string | null | undefined, nowMs: number): number | null {
  const t = endsAt ? Date.parse(endsAt) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.ceil((t - nowMs) / 86_400_000)) : null;
}
