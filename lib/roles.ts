// Who may do what. People are the company's members on Pulsus Platform; each
// holds one or more Quality roles granted here (Settings → People and roles),
// optionally scoped to some units (branches). There are no shared passwords.
//
// Separation of duties, enforced on the server (lib/reviews.ts, lib/actions.ts)
// and tested:
//   • an inspector cannot approve their own review;
//   • whoever raised a corrective action cannot verify or close it, nor can the
//     person who submitted it for verification, nor its owner;
//   • granting yourself a role changes none of that: the rules look at who did
//     the work, not at what roles they hold.
// Pure: used by the server and the browser alike.

export const ROLES = ["admin", "supervisor", "inspector", "branch_manager", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; blurb: string }> = {
  admin: { label: "Quality admin", blurb: "Sets up the programme, people, bands and imports. Can do everything a supervisor can." },
  supervisor: { label: "Supervisor", blurb: "Approves reviews, resolves defects, raises actions and verifies other people's closures." },
  inspector: { label: "Inspector", blurb: "Keys reviews for a supervisor to approve, and works actions for their branches." },
  branch_manager: { label: "Branch manager", blurb: "Works the actions for their branches and submits them, with evidence, for verification." },
  viewer: { label: "Viewer", blurb: "Reads the dashboards and reports for their branches. Free under the pricing rules." },
};

export const isRole = (x: unknown): x is Role => typeof x === "string" && (ROLES as readonly string[]).includes(x);

export type TenantKind = "institution" | "company" | "demo";

export interface Actor {
  tenant: string;
  tenantName: string;
  kind: TenantKind;
  email: string;
  name: string;
  roles: Role[];
  /** Units this person is scoped to; empty means every unit. */
  unitIds: string[];
  /** The member's role on Pulsus Platform (owner, admin, editor, viewer), or "staff" for the institution's own people. */
  platformRole: string;
  operator: boolean;
  plan: { standing: "trial" | "active" | "past_due" | "suspended" | "ended"; trialEndsAt: string | null } | null;
}

export const has = (a: Pick<Actor, "roles">, ...roles: Role[]) => roles.some((r) => a.roles.includes(r));
export const isAdmin = (a: Pick<Actor, "roles">) => has(a, "admin");
export const isSupervisor = (a: Pick<Actor, "roles">) => has(a, "admin", "supervisor");

/** Whether the person's scope covers a unit. */
export function inScope(a: Pick<Actor, "unitIds">, unitId: string | null | undefined): boolean {
  if (!a.unitIds.length) return true;
  return !!unitId && a.unitIds.includes(unitId);
}

export const can = {
  view: (a: Actor) => a.roles.length > 0,
  keyReviews: (a: Actor) => has(a, "admin", "supervisor", "inspector"),
  approveReviews: (a: Actor) => isSupervisor(a),
  resolveDefects: (a: Actor) => isSupervisor(a),
  raiseActions: (a: Actor) => isSupervisor(a),
  planActions: (a: Actor) => isSupervisor(a),
  workActions: (a: Actor) => has(a, "admin", "supervisor", "inspector", "branch_manager"),
  verifyActions: (a: Actor) => isSupervisor(a),
  deleteActions: (a: Actor) => isAdmin(a),
  manage: (a: Actor) => isAdmin(a),
  sendToRisk: (a: Actor) => isSupervisor(a),
  buildTemplates: (a: Actor) => isSupervisor(a),
  inspect: (a: Actor) => has(a, "admin", "supervisor", "inspector"),
  approveInspections: (a: Actor) => isSupervisor(a),
};

/** The roles a member starts with, from their role on Pulsus Platform. */
export function defaultRolesForPlatformRole(platformRole: string): Role[] {
  if (platformRole === "owner" || platformRole === "admin") return ["admin"];
  if (platformRole === "editor") return ["inspector"];
  return ["viewer"];
}

/** Why someone may not verify an action, or null when they may. */
export function verifyBlocker(a: Pick<Actor, "email" | "roles">, action: { raisedBy: string; ownerEmail: string | null; submittedBy: string | null }): string | null {
  if (!isSupervisor(a)) return "A supervisor verifies and closes actions.";
  const me = a.email.toLowerCase();
  if (action.raisedBy.toLowerCase() === me) return "You raised this action, so someone else must verify it.";
  if (action.submittedBy && action.submittedBy.toLowerCase() === me) return "You submitted this closure, so someone else must verify it.";
  if (action.ownerEmail && action.ownerEmail.toLowerCase() === me) return "You own this action, so someone else must verify it.";
  return null;
}

/** Why someone may not approve a review, or null when they may. */
export function approveBlocker(a: Pick<Actor, "email" | "roles">, review: { inspectorEmail: string }, noun = "review"): string | null {
  if (!isSupervisor(a)) return `A supervisor approves ${noun}s.`;
  if (review.inspectorEmail.toLowerCase() === a.email.toLowerCase()) return noun === "review" ? "You keyed this review, so another supervisor must approve it." : `You carried out this ${noun}, so another supervisor must approve it.`;
  return null;
}
