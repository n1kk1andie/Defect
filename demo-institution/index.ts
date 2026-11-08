// ─────────────────────────────────────────────────────────────────────────────
// Demo stand-in for institution/ (the owner's own institution).
//
// A demo build (DEMO_MODE=1) never compiles institution/: next.config.mjs aliases
// "@/institution" to this file and "@/institution/data" to ./data.ts, so no real
// name, address, person, branch or figure can reach a demo bundle, page or API.
// Same exports, neutral values; the fictional Meridian Society identity itself
// lives in lib/demo.ts.
// ─────────────────────────────────────────────────────────────────────────────

export interface AdminPerson { email: string; name: string; role?: string }

export const INSTITUTION = {
  name: "",
  emailDomain: "none",
  supervisorEmails: [] as string[],
  sessionCookie: "pq_session",
  devSessionSecret: "pulsus-quality-dev-secret-change-me",
  storagePrefix: "pq",
  branchAliases: {} as Record<string, string>,
};

export const ADMINS: AdminPerson[] = [];

export function findAdmin(_email: string | null | undefined): AdminPerson | undefined {
  return undefined;
}

export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}
