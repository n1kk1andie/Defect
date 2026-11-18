// Who may sign work off. Pure: shared by the server and its tests.
//
// An officer (inspector) keys a review; a supervisor reviews and approves it
// (or returns it) and marks its defects resolved. An admin sets the tracker up
// (data, accounts, role passwords) and approves, returns or resolves nothing by
// being admin: only an admin account explicitly given the supervisor right
// ("also supervisor") does. And nobody approves the work they keyed.

export interface Signer { role: string; username: string; supervisor?: boolean }

/** Holds the supervisor right: the supervisor role, or an admin account also made a supervisor. */
export function canSignOff(s: Signer | null | undefined): boolean {
  return !!s && (s.role === "supervisor" || (s.role === "admin" && s.supervisor === true));
}

/** Why this person may not approve or return a submission, or null when they may. */
export function reviewBlocker(s: Signer | null | undefined, sub: { inspector: string }): string | null {
  if (!canSignOff(s)) return s?.role === "admin" ? "An admin doesn’t approve submissions unless their account is also a supervisor." : "A supervisor reviews submissions.";
  if ((sub.inspector || "").trim().toLowerCase() === s!.username.trim().toLowerCase()) return "You keyed this submission, so another supervisor must review it.";
  return null;
}

/** Why this person may not mark defects resolved, or null when they may. */
export function resolveBlocker(s: Signer | null | undefined): string | null {
  if (canSignOff(s)) return null;
  return s?.role === "admin" ? "An admin doesn’t resolve defects unless their account is also a supervisor." : "Only supervisors can change resolution status.";
}
