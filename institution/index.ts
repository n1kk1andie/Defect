// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER'S OWN INSTITUTION — everything that names or identifies it.
//
// This folder (institution/) is the ONE place the real institution's identity
// lives: its name, its email domain and default supervisor, its named
// administrators, its branch-name spellings, its bundled history workbooks
// (seed-*.json, converted by institution/scripts/), and the names of the
// browser keys and cookie its people's sessions already use.
//
// It is read on the SERVER only, and only for this deployment's own tenant:
//   • A Pulsus platform company (lib/company.ts, currentCompany()) never gets any
//     of it — company requests take neutral defaults instead (see the call sites).
//   • A demo build (DEMO_MODE=1) does not compile this folder at all: the demo
//     branch aliases it to fictional stand-ins in next.config.mjs.
// Nothing outside this folder should spell any of these values out.
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

export const INSTITUTION = {
  /** Display name. */
  name: "VM Building Society",
  /** The work email domain whose people may sign in with Microsoft as inspectors
   *  (ALLOWED_EMAIL_DOMAIN overrides). */
  emailDomain: "myvmgroup.com",
  /** The default supervisor(s) for Microsoft sign-in (SUPERVISOR_EMAILS overrides). */
  supervisorEmails: ["sanchia.henry@myvmgroup.com"],
  /** The app's own sign-in cookie. Renaming it would sign everyone out. */
  sessionCookie: "vmbs_session",
  /** Local-development signing fallback when SESSION_SECRET is unset. */
  devSessionSecret: "vmbs-dev-secret-change-me",
  /** Prefix of the browser storage keys (remembered view, remembered sign-in). */
  storagePrefix: "vmbs",
  /** Spellings in uploaded workbooks normalised to the roster's names. */
  branchAliases: { "Duke St": "Duke Street" } as Record<string, string>,
};

// ── Named administrators ────────────────────────────────────────────────────
// The people who may unlock the admin screens with the account they are already
// signed in as, instead of typing the shared admin password. This is the
// DIRECTORY (who they are), not a credential store, kept in step with the same
// roster in the sibling Pulsus apps so the SAME people are administrators
// everywhere. Add or remove someone here and redeploy.
//
// It grants nothing on its own. Someone listed here still has to be signed in —
// the Command Center platform session, or this app's own Microsoft sign-in,
// proves who they are — and then ASK to continue as themselves, which is what
// mints the admin session. resolveRole() in lib/msauth.ts still never returns
// "admin".
//
// Emails follow first.last@<domain>, hyphenated surnames included. Nexus is the
// one entry off that pattern. These addresses must match what the Command Center
// asserts in its session token — verify a new entry against /api/whoami rather
// than the directory or a display name (a roster miss and a wrong password look
// identical: a password prompt).
export const ADMINS: AdminPerson[] = [
  { email: "nexus@tumblehillholdings.com", name: "Nexus", role: "Owner" },
  { email: "nicola.anderson@myvmgroup.com", name: "Nicola Anderson", role: "Owner (COO)" },
  { email: "odelia.miller-downer@myvmgroup.com", name: "Odelia Miller-Downer", role: "Executive" },
  { email: "lesa.robinson@myvmgroup.com", name: "Lesa Robinson", role: "Executive" },
  // Supplied as addresses only — names derived from the address, role unstated.
  { email: "carlton.brown@myvmgroup.com", name: "Carlton Brown" },
  { email: "mark.barnaby@myvmgroup.com", name: "Mark Barnaby" },
  { email: "dwayne.grant@myvmgroup.com", name: "Dwayne Grant" },
];

/**
 * Look up a roster entry by email, or undefined. Exact address match only: the
 * address always arrives from a signature-verified session.
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
