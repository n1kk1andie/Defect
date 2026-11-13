// API keys for the REST API (/api/v1). A key reads
//   pq_<company id, base64url>.<32 random bytes, base64url>
// and only its SHA-256 is stored; the secret is shown once, when it is made.
// The company part only says which tenant to look in; without the secret it
// opens nothing. Each key carries scopes, can expire, and is revoked or
// rotated by an admin. Rotating issues a new key with the same name and
// scopes and keeps the old one working for 24 hours, so a deployment can
// switch over without an outage.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { apiKeys } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { can, type Actor, type Role } from "@/lib/roles";

import { SCOPES, SCOPE_INFO, type Scope } from "@/lib/integrationInfo";
export { SCOPES, SCOPE_INFO, type Scope };

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const TENANT_ID = /^(?:_own|_demo|[a-z0-9][a-z0-9-]{0,39})$/;
const demoMode = () => (process.env.DEMO_MODE || "").trim() === "1";
export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function makeKey(companyId: string): string {
  return `pq_${Buffer.from(companyId).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
}

/** The tenant a key claims (before it is checked), or null when it isn't a key's shape. */
export function keyTenant(key: string): string | null {
  const m = /^pq_([A-Za-z0-9_-]{1,60})\.([A-Za-z0-9_-]{43})$/.exec(key.trim());
  if (!m) return null;
  const tenant = Buffer.from(m[1], "base64url").toString("utf8");
  return TENANT_ID.test(tenant) ? tenant : null;
}

import type { KeyView } from "@/lib/integrationInfo";
export type { KeyView };

const stateOf = (k: typeof apiKeys.$inferSelect, now = Date.now()): KeyView["state"] => k.revokedAt ? "revoked" : k.expiresAt && k.expiresAt.getTime() <= now ? "expired" : k.expiresAt ? "expiring" : "active";

export async function listKeys(a: Actor): Promise<KeyView[]> {
  if (!can.manage(a)) return [];
  return withTenant(a.tenant, async (tx) => (await tx.select().from(apiKeys).where(eq(apiKeys.companyId, a.tenant)).orderBy(desc(apiKeys.createdAt))).map((k) => ({
    id: k.id, name: k.name, hint: k.hint, scopes: k.scopes as Scope[], createdBy: k.createdBy, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, replacedBy: k.replacedBy, state: stateOf(k),
  })));
}

const cleanScopes = (v: unknown): Scope[] => Array.from(new Set(Array.isArray(v) ? v.filter((s): s is Scope => (SCOPES as readonly string[]).includes(String(s))) : []));

/** Create a key (admins). The secret is returned once. */
export async function createKey(a: Actor, input: { name?: unknown; scopes?: unknown; expiresInDays?: unknown }, requestId?: string): Promise<Result<{ id: string; key: string }>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin creates API keys.", status: 403 };
  if (demoMode()) return { ok: false, error: "The demo doesn't issue API keys.", status: 403 };
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) return { ok: false, error: "Name the key after what will use it.", status: 400 };
  const scopes = cleanScopes(input.scopes);
  if (!scopes.length) return { ok: false, error: "Choose at least one scope.", status: 400 };
  const days = Math.round(Number(input.expiresInDays) || 0);
  const expiresAt = days > 0 && days <= 730 ? new Date(Date.now() + days * 864e5) : null;
  const key = makeKey(a.tenant), id = randomUUID();
  await withTenant(a.tenant, async (tx) => {
    await tx.insert(apiKeys).values({ id, companyId: a.tenant, name, hint: `…${key.slice(-4)}`, hash: hashKey(key), scopes, createdBy: a.email, expiresAt });
    await record(tx, a.tenant, { actor: a.email, action: "apikey.create", entityType: "api_key", entityId: id, summary: `API key created: ${name} (${scopes.join(", ")})`, after: { name, scopes, expiresAt }, requestId });
  });
  return { ok: true, value: { id, key } };
}

/** Revoke now, or rotate: a new key with the same name and scopes; the old one works for 24 more hours. */
export async function changeKey(a: Actor, id: string, op: "revoke" | "rotate", requestId?: string): Promise<Result<{ key?: string; id?: string }>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin manages API keys.", status: 403 };
  if (demoMode()) return { ok: false, error: "The demo doesn't change API keys.", status: 403 };
  return withTenant(a.tenant, async (tx) => {
    const k = (await tx.select().from(apiKeys).where(and(eq(apiKeys.companyId, a.tenant), eq(apiKeys.id, id))).limit(1))[0];
    if (!k) return { ok: false as const, error: "Key not found.", status: 404 };
    if (k.revokedAt) return { ok: false as const, error: "This key is already revoked.", status: 409 };
    if (op === "revoke") {
      await tx.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
      await record(tx, a.tenant, { actor: a.email, action: "apikey.revoke", entityType: "api_key", entityId: id, summary: `API key revoked: ${k.name} (${k.hint})`, requestId });
      return { ok: true as const, value: {} };
    }
    const key = makeKey(a.tenant), nid = randomUUID();
    const grace = new Date(Date.now() + 864e5);
    await tx.insert(apiKeys).values({ id: nid, companyId: a.tenant, name: k.name, hint: `…${key.slice(-4)}`, hash: hashKey(key), scopes: k.scopes, createdBy: a.email, expiresAt: k.expiresAt && k.expiresAt > new Date() ? k.expiresAt : null });
    await tx.update(apiKeys).set({ expiresAt: k.expiresAt && k.expiresAt < grace ? k.expiresAt : grace, replacedBy: nid }).where(eq(apiKeys.id, id));
    await record(tx, a.tenant, { actor: a.email, action: "apikey.rotate", entityType: "api_key", entityId: id, summary: `API key rotated: ${k.name}; the old key (${k.hint}) stops working ${grace.toISOString().slice(0, 16).replace("T", " ")} UTC`, requestId });
    return { ok: true as const, value: { key, id: nid } };
  });
}

export interface KeyActor { actor: Actor; keyId: string; scopes: Scope[] }

/** Check a bearer key and build the actor it acts as. Roles follow its scopes; it is never a person and never verifies or approves. */
export async function authenticateKey(header: string | null): Promise<KeyActor | null> {
  const key = (header || "").replace(/^Bearer\s+/i, "").trim();
  const tenant = keyTenant(key);
  if (!tenant) return null;
  const hash = hashKey(key);
  const row = await withTenant(tenant, async (tx) => {
    const k = (await tx.select().from(apiKeys).where(and(eq(apiKeys.companyId, tenant), eq(apiKeys.hash, hash))).limit(1))[0];
    if (!k || k.revokedAt || (k.expiresAt && k.expiresAt.getTime() <= Date.now())) return null;
    if (!k.lastUsedAt || Date.now() - k.lastUsedAt.getTime() > 60_000) await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, k.id));
    return k;
  });
  if (!row) return null;
  const scopes = row.scopes as Scope[];
  const roles: Role[] = scopes.includes("actions:write") ? ["supervisor"] : ["viewer"];
  return {
    keyId: row.id, scopes,
    actor: { tenant, tenantName: tenant, kind: tenant === "_own" ? "institution" : tenant === "_demo" ? "demo" : "company", email: `api-key:${row.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`, name: `API key "${row.name}"`, roles, unitIds: [], platformRole: "api", operator: false, plan: null },
  };
}

/** A simple per-key rate limit: 120 requests a minute in this process. */
const hits = new Map<string, { at: number; n: number }>();
export function rateLimited(keyId: string, perMinute = 120): boolean {
  const now = Date.now(), h = hits.get(keyId);
  if (!h || now - h.at > 60_000) { hits.set(keyId, { at: now, n: 1 }); return false; }
  h.n++;
  return h.n > perMinute;
}
