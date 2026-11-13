// Who is asking. proxy.ts verifies the visitor's Pulsus Platform session (or,
// in the demo, picks a fictional persona) and passes the result on in trusted
// request headers, stripped from every incoming request first so they can't be
// forged. This module reads them back and adds the person's Quality roles from
// the database, provisioning a member on their first visit.
//
// The institution's people (a platform staff session) keep their path in:
// someone on the allow-list (the institution's email domain, its named
// administrators, ADMIN_EMAILS, or anyone an admin added under People and
// roles) gets in; anyone else sees "no access".
import { cache } from "react";
import { headers } from "next/headers";
import { withTenant } from "@/lib/db/client";
import { DEMO, ensureCompany, findMember, OWN, provisionMember } from "@/lib/company";
import { record } from "@/lib/audit";
import { defaultRolesForPlatformRole, type Actor, type Role, type TenantKind } from "@/lib/roles";
import { adminEmails, findAdmin, INSTITUTION } from "@/institution";
import { DEMO_COMPANY, personaFor } from "@/lib/demo/personas";
import { members } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";

/** The headers proxy.ts sets (and strips from every incoming request). */
export const H = {
  tenant: "x-pq-tenant",
  tenantName: "x-pq-tenant-name",
  email: "x-pq-email",
  name: "x-pq-name",
  platformRole: "x-pq-prole",
  operator: "x-pq-operator",
  plan: "x-pq-plan",
  requestId: "x-pq-request-id",
} as const;
export const TRUSTED_HEADERS = Object.values(H);

const dec = (v: string | null) => { try { return v ? decodeURIComponent(v) : ""; } catch { return ""; } };
const listEnv = (k: string) => (process.env[k] || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

/** The roles an institution person starts with: named admins, supervisors, then the email domain. */
export function institutionDefaultRoles(email: string, operator: boolean): Role[] | null {
  if (operator || findAdmin(email) || adminEmails().includes(email)) return ["admin"];
  if ([...INSTITUTION.supervisorEmails.map((e) => e.toLowerCase()), ...listEnv("SUPERVISOR_EMAILS")].includes(email)) return ["supervisor"];
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || INSTITUTION.emailDomain || "").trim().toLowerCase();
  if (domain && domain !== "none" && email.endsWith("@" + domain)) return ["inspector"];
  return null;
}

export interface RequestInfo { tenant: string; tenantName: string; kind: TenantKind; email: string; name: string; platformRole: string; operator: boolean; plan: Actor["plan"]; requestId: string }

/** The verified request identity from proxy.ts, or null. */
export const requestInfo = cache(async (): Promise<RequestInfo | null> => {
  const h = await headers();
  const tenant = h.get(H.tenant) || "";
  const email = (h.get(H.email) || "").toLowerCase();
  if (!tenant || !email) return null;
  const kind: TenantKind = tenant === OWN ? "institution" : tenant === DEMO ? "demo" : "company";
  const [standing, trialEndsAt] = (h.get(H.plan) || "").split("|");
  const plan = ["trial", "active", "past_due", "suspended", "ended"].includes(standing) ? { standing: standing as NonNullable<Actor["plan"]>["standing"], trialEndsAt: trialEndsAt || null } : null;
  return {
    tenant, kind, email,
    tenantName: dec(h.get(H.tenantName)) || (kind === "institution" ? INSTITUTION.name || "Quality" : kind === "demo" ? DEMO_COMPANY : tenant),
    name: dec(h.get(H.name)),
    platformRole: h.get(H.platformRole) || "viewer",
    operator: h.get(H.operator) === "1",
    plan,
    requestId: h.get(H.requestId) || "",
  };
});

/** The person asking, with their Quality roles; null when no verified session reached this request. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const info = await requestInfo();
  if (!info) return null;
  return resolveActor(info);
});

/** Resolve roles for a verified identity (exported for the tests). */
export async function resolveActor(info: RequestInfo): Promise<Actor> {
  return withTenant(info.tenant, async (tx) => {
    await ensureCompany(tx, info.tenant, info.tenantName, info.kind);
    // Cache the plan the platform signed into this session, for the REST API (lib/planCache.ts).
    if (info.kind === "company" && info.plan) { const v = JSON.stringify({ standing: info.plan.standing, trialEndsAt: info.plan.trialEndsAt ?? null }); await tx.execute(sql`update companies set plan = ${v}::jsonb, plan_seen_at = now() where company_id = ${info.tenant} and plan is distinct from ${v}::jsonb`); }
    let m = await findMember(tx, info.tenant, info.email);
    if (!m) {
      let roles: Role[] | null;
      if (info.kind === "demo") roles = personaFor(info.email)?.roles ?? ["viewer"];
      else if (info.kind === "institution") roles = institutionDefaultRoles(info.email, info.operator);
      else roles = defaultRolesForPlatformRole(info.platformRole);
      if (roles) m = await provisionMember(tx, info.tenant, info.email, info.name || personaFor(info.email)?.name || "", roles, info.kind === "demo" ? "demo" : info.kind === "institution" ? "allow-list" : "platform");
    } else if (!m.lastSeenAt || Date.now() - Date.parse(m.lastSeenAt) > 3600_000) {
      await tx.update(members).set({ lastSeenAt: new Date(), ...(info.name && !m.name ? { name: info.name } : {}) }).where(and(eq(members.companyId, info.tenant), eq(members.email, info.email)));
    }
    if (info.operator && info.kind === "institution" && m && !m.roles.includes("admin")) {
      // A platform operator's break-glass entry: admin for this session, always recorded.
      await record(tx, info.tenant, { actor: info.email, action: "access.break_glass", entityType: "member", entityId: info.email, summary: "Platform operator opened Quality as admin", requestId: info.requestId });
      m = { ...m, roles: ["admin"] };
    }
    const active = m && m.status === "active";
    return {
      tenant: info.tenant, tenantName: info.tenantName, kind: info.kind, email: info.email,
      name: m?.name || info.name || info.email.split("@")[0],
      roles: active ? m!.roles : [], unitIds: active ? m!.unitIds : [],
      platformRole: info.platformRole, operator: info.operator, plan: info.plan,
    };
  });
}
