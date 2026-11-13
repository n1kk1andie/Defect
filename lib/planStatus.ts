// Whether a company's plan lets it use Quality: the one rule the licence wall
// (proxy.ts) and the REST API (lib/restApi.ts) both apply. Pure and edge-safe.
// The plan comes from the Pulsus Platform session (the standing and trial end
// the platform signs into it); the API, which has no session, reads the copy
// cached on the company row each time a member's session is seen.
export type Standing = "trial" | "active" | "past_due" | "suspended" | "ended";
export interface PlanState { standing: Standing; trialEndsAt: string | null }

/** The licence wall's rule: a suspended or ended plan stops use. No plan (the institution, the demo) never does. */
export function licenceLapsed(plan: PlanState | null | undefined): "suspended" | "ended" | null {
  return plan && (plan.standing === "suspended" || plan.standing === "ended") ? plan.standing : null;
}

/**
 * The same rule for a cached copy of the plan (the REST API's): the platform
 * moves a trial to "ended" when it runs out, but a copy cached before then
 * still says "trial", so a trial whose end has passed counts as ended too.
 */
export function cachedLicenceLapsed(plan: PlanState | null | undefined, now = Date.now()): "suspended" | "ended" | "trial_ended" | null {
  const wall = licenceLapsed(plan);
  if (wall) return wall;
  if (plan?.standing === "trial" && plan.trialEndsAt) { const t = Date.parse(plan.trialEndsAt); if (Number.isFinite(t) && t <= now) return "trial_ended"; }
  return null;
}

export const LICENCE_MESSAGE = "Your company's Pulsus Quality plan isn't active. An owner or admin can choose a plan on Pulsus (Plan & billing); existing API keys work again as soon as it is.";
