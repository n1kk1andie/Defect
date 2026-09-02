// ─────────────────────────────────────────────────────────────────────────────
// Named administrators — the people who may unlock the admin screens with the
// account they are already signed in as, instead of typing the shared admin
// password.
//
// This file is the DIRECTORY (who they are), not a credential store. It is kept
// deliberately in step with the same roster in the sibling Pulsus apps — see
// My-Risk config/admins.ts and VM config/admins.js — so the SAME people are
// administrators everywhere. Add or remove someone here and redeploy; there is
// nothing else to change.
//
// It grants nothing on its own. Someone listed here still has to be signed in —
// the Command Center platform session, or this app's own Microsoft sign-in,
// proves who they are — and then ASK to continue as themselves, which is what
// mints the admin session. Being listed is permission to elevate, not admin.
//
// Note what this does NOT change: resolveRole() in lib/msauth.ts still never
// returns "admin". Signing in with Microsoft cannot make you an administrator by
// itself, exactly as before; the roster is a separate, deliberate second step.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminPerson {
  /** Canonical sign-in identity — the person's work email. */
  email: string;
  name: string;
  /**
   * Standing in the Command Center directory, recorded so the roster reads the
   * same in both places. It is a LABEL: every administrator here holds the same
   * powers, because this app has no admin tiers.
   */
  role?: string;
}

/**
 * Platform super-admins (Command Center SSO everywhere), as supplied by the COO.
 * Emails follow first.last@myvmgroup.com except where the directory differs
 * (Odelia Miller-Downer signs in as odelia.downer-miller@ — note the halves are
 * the other way round from her display name).
 */
export const ADMINS: AdminPerson[] = [
  { email: "nexus@tumblehillholdings.com", name: "Nexus", role: "Owner" },
  { email: "nicola.anderson@myvmgroup.com", name: "Nicola Anderson", role: "Owner (COO)" },
  { email: "odelia.downer-miller@myvmgroup.com", name: "Odelia Miller-Downer", role: "Executive" },
  { email: "lesa.robinson@myvmgroup.com", name: "Lesa Robinson", role: "Executive" },
  // Supplied as addresses only — names derived from the address, role unstated.
  { email: "carlton.brown@myvmgroup.com", name: "Carlton Brown" },
  { email: "mark.barnaby@myvmgroup.com", name: "Mark Barnaby" },
  { email: "dwayne.grant@myvmgroup.com", name: "Dwayne Grant" },
];

/**
 * Look up a roster entry by email, or undefined.
 *
 * Exact address match only. Unlike My-Risk's findAdmin — which also accepts the
 * local part, because there a person TYPES an identifier at the padlock — the
 * address here always arrives from a signature-verified session, so there is
 * nothing to be lenient about.
 */
export function findAdmin(email: string | null | undefined): AdminPerson | undefined {
  const addr = String(email || "").trim().toLowerCase();
  if (!addr) return undefined;
  return ADMINS.find((a) => a.email.toLowerCase() === addr);
}

/** Extra administrator addresses from deployment config, unioned with the roster. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}
