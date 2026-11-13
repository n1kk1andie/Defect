// A tenant's set-up: the company row, its settings, its programme (units,
// process areas, checks with severities, defect natures) and its members with
// their Quality roles. Every write is recorded in the change history.
import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { withTenant, type Tx } from "@/lib/db/client";
import { areas, checks, companies, companySettings, members, natures, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { cleanSettings, SEVERITIES, type CompanySettings, type Severity } from "@/lib/settings";
import { isRole, type Actor, type Role, type TenantKind } from "@/lib/roles";

/** The owner's own institution: this deployment's original tenant. Can't collide with a platform company id. */
export const OWN = "_own";
/** The demo's fictional company (in the demo deployment's own database). */
export const DEMO = "_demo";

export async function ensureCompany(tx: Tx, id: string, name: string, kind: TenantKind): Promise<void> {
  await tx.insert(companies).values({ companyId: id, name: name || id, kind }).onConflictDoNothing();
}

// ── settings ─────────────────────────────────────────────────────────────────

export async function loadSettings(tx: Tx, companyId: string): Promise<CompanySettings> {
  const r = await tx.select().from(companySettings).where(eq(companySettings.companyId, companyId)).limit(1);
  return cleanSettings(r[0]?.data);
}

export async function getSettings(companyId: string): Promise<CompanySettings> {
  return withTenant(companyId, (tx) => loadSettings(tx, companyId));
}

export async function writeSettings(tx: Tx, companyId: string, next: CompanySettings, by: string): Promise<void> {
  await tx.insert(companySettings).values({ companyId, data: next, updatedBy: by, updatedAt: new Date() })
    .onConflictDoUpdate({ target: companySettings.companyId, set: { data: next, updatedBy: by, updatedAt: new Date() } });
}

/** Change some settings, recording before → after. */
export async function updateSettings(actor: Actor, patch: Partial<CompanySettings>, summary: string, requestId?: string): Promise<CompanySettings> {
  return withTenant(actor.tenant, async (tx) => {
    const before = await loadSettings(tx, actor.tenant);
    const next = cleanSettings({ ...before, ...patch });
    await writeSettings(tx, actor.tenant, next, actor.email);
    const changed = Object.fromEntries(Object.keys(patch).map((k) => [k, (before as unknown as Record<string, unknown>)[k]]));
    const after = Object.fromEntries(Object.keys(patch).map((k) => [k, (next as unknown as Record<string, unknown>)[k]]));
    await record(tx, actor.tenant, { actor: actor.email, action: "settings.update", entityType: "settings", summary, before: changed, after, requestId });
    return next;
  });
}

// ── programme ────────────────────────────────────────────────────────────────

export interface ProgramCheck { id: string; code: string; label: string; severity: Severity }
export interface ProgramArea { id: string; name: string; checks: ProgramCheck[]; natures: { id: string; label: string; category: string }[] }
export interface Program { units: { id: string; name: string; region: string | null; active: boolean }[]; areas: ProgramArea[] }

export async function loadProgram(tx: Tx, companyId: string): Promise<Program> {
  const [u, a, c, n] = await Promise.all([
    tx.select().from(units).where(eq(units.companyId, companyId)).orderBy(asc(units.sort), asc(units.name)),
    tx.select().from(areas).where(eq(areas.companyId, companyId)).orderBy(asc(areas.sort), asc(areas.name)),
    tx.select().from(checks).where(and(eq(checks.companyId, companyId), eq(checks.active, true))).orderBy(asc(checks.sort)),
    tx.select().from(natures).where(eq(natures.companyId, companyId)),
  ]);
  return {
    units: u.map((x) => ({ id: x.id, name: x.name, region: x.region, active: x.active })),
    areas: a.filter((x) => x.active).map((x) => ({
      id: x.id, name: x.name,
      checks: c.filter((k) => k.areaId === x.id).map((k) => ({ id: k.id, code: k.code, label: k.label, severity: (SEVERITIES.includes(k.severity as Severity) ? k.severity : "major") as Severity })),
      natures: n.filter((k) => k.areaId === x.id || k.areaId == null).map((k) => ({ id: k.id, label: k.label, category: k.category })),
    })),
  };
}

export async function getProgram(companyId: string): Promise<Program> {
  return withTenant(companyId, (tx) => loadProgram(tx, companyId));
}

const clean = (v: unknown, max = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "check";
export const NATURE_CATEGORIES = ["Process", "Documentation", "Data", "People", "Systems", "Other"];

/** Upsert units by name (inside a transaction): returns name → id. */
export async function ensureUnits(tx: Tx, companyId: string, names: string[]): Promise<Map<string, string>> {
  const have = await tx.select().from(units).where(eq(units.companyId, companyId));
  const map = new Map(have.map((u) => [u.name, u.id]));
  let sort = have.length;
  for (const name of names) {
    if (!name || map.has(name)) continue;
    const id = randomUUID();
    await tx.insert(units).values({ id, companyId, name, sort: sort++ });
    map.set(name, id);
  }
  return map;
}

/** Upsert process areas by name: returns name → id. */
export async function ensureAreas(tx: Tx, companyId: string, names: string[]): Promise<Map<string, string>> {
  const have = await tx.select().from(areas).where(eq(areas.companyId, companyId));
  const map = new Map(have.map((a) => [a.name, a.id]));
  let sort = have.length;
  for (const name of names) {
    if (!name || map.has(name)) continue;
    const id = randomUUID();
    await tx.insert(areas).values({ id, companyId, name, sort: sort++ });
    map.set(name, id);
  }
  return map;
}

/** Replace an area's checklist and natures (checks are deactivated, never deleted, so old reviews still read). */
export async function setAreaChecklist(tx: Tx, companyId: string, areaId: string, list: { code?: string; label: string; severity: Severity }[], natureList: { label: string; category?: string }[]): Promise<void> {
  const existing = await tx.select().from(checks).where(and(eq(checks.companyId, companyId), eq(checks.areaId, areaId)));
  const keep = new Set<string>();
  let sort = 0;
  for (const c of list) {
    let code = slug(c.code || c.label);
    while (keep.has(code)) code = (code + "-2").slice(0, 40);
    keep.add(code);
    const found = existing.find((e) => e.code === code);
    if (found) await tx.update(checks).set({ label: c.label, severity: c.severity, sort: sort++, active: true }).where(eq(checks.id, found.id));
    else await tx.insert(checks).values({ id: randomUUID(), companyId, areaId, code, label: c.label, severity: c.severity, sort: sort++ });
  }
  for (const e of existing) if (!keep.has(e.code) && e.active) await tx.update(checks).set({ active: false }).where(eq(checks.id, e.id));
  await tx.delete(natures).where(and(eq(natures.companyId, companyId), eq(natures.areaId, areaId)));
  for (const n of natureList) await tx.insert(natures).values({ id: randomUUID(), companyId, areaId, label: n.label, category: NATURE_CATEGORIES.includes(n.category || "") ? n.category! : "Process" });
}

/** Save the programme an admin edited: units, areas, checks, natures. */
export async function saveProgram(actor: Actor, raw: unknown, requestId?: string): Promise<{ ok: true; program: Program } | { ok: false; error: string }> {
  const o = (raw && typeof raw === "object" ? raw : {}) as { units?: unknown[]; areas?: unknown[] };
  const unitNames = Array.from(new Set((o.units || []).map((u) => clean((u as { name?: string })?.name ?? u)).filter(Boolean)));
  if (unitNames.length > 500) return { ok: false, error: "Up to 500 units." };
  const areaList: { name: string; checks: { code?: string; label: string; severity: Severity }[]; natures: { label: string; category?: string }[] }[] = [];
  for (const a of (o.areas || []) as Record<string, unknown>[]) {
    const name = clean(a?.name);
    if (!name) return { ok: false, error: "Every process area needs a name." };
    if (areaList.some((x) => x.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `“${name}” is listed twice.` };
    const cl = (Array.isArray(a.checks) ? a.checks : []) as Record<string, unknown>[];
    if (!cl.length) return { ok: false, error: `Add at least one check to “${name}”.` };
    if (cl.length > 60) return { ok: false, error: "Up to 60 checks per area." };
    const list = cl.map((c) => ({ code: clean(c?.code, 40) || undefined, label: clean(c?.label, 160), severity: (SEVERITIES.includes(c?.severity as Severity) ? c.severity : "major") as Severity }));
    if (list.some((c) => !c.label)) return { ok: false, error: `A check in “${name}” has no wording.` };
    const nl = ((Array.isArray(a.natures) ? a.natures : []) as unknown[]).map((n) => typeof n === "string" ? { label: clean(n) } : { label: clean((n as { label?: string })?.label), category: clean((n as { category?: string })?.category, 20) }).filter((n) => n.label).slice(0, 40);
    areaList.push({ name, checks: list, natures: nl });
  }
  if (areaList.length > 60) return { ok: false, error: "Up to 60 process areas." };
  return withTenant(actor.tenant, async (tx) => {
    const before = await loadProgram(tx, actor.tenant);
    await ensureUnits(tx, actor.tenant, unitNames);
    for (const u of before.units) await tx.update(units).set({ active: unitNames.includes(u.name), sort: Math.max(0, unitNames.indexOf(u.name)) }).where(eq(units.id, u.id));
    const areaIds = await ensureAreas(tx, actor.tenant, areaList.map((a) => a.name));
    const allAreas = await tx.select().from(areas).where(eq(areas.companyId, actor.tenant));
    for (const a of allAreas) await tx.update(areas).set({ active: areaList.some((x) => x.name === a.name), sort: Math.max(0, areaList.findIndex((x) => x.name === a.name)) }).where(eq(areas.id, a.id));
    for (const a of areaList) await setAreaChecklist(tx, actor.tenant, areaIds.get(a.name)!, a.checks, a.natures);
    const after = await loadProgram(tx, actor.tenant);
    await record(tx, actor.tenant, {
      actor: actor.email, action: "program.update", entityType: "program",
      summary: `${after.units.filter((u) => u.active).length} units, ${after.areas.length} process areas, ${after.areas.reduce((s, a) => s + a.checks.length, 0)} checks`,
      before: summariseProgram(before), after: summariseProgram(after), requestId,
    });
    return { ok: true as const, program: after };
  });
}

const summariseProgram = (p: Program) => ({
  units: p.units.filter((u) => u.active).map((u) => u.name),
  areas: p.areas.map((a) => ({ name: a.name, checks: a.checks.map((c) => `${c.label} (${c.severity})`), natures: a.natures.map((n) => n.label) })),
});

// ── members ──────────────────────────────────────────────────────────────────

export interface MemberRow { email: string; name: string; roles: Role[]; unitIds: string[]; status: string; source: string; lastSeenAt: string | null; createdAt: string }

const toMember = (m: typeof members.$inferSelect): MemberRow => ({
  email: m.email, name: m.name, roles: m.roles.filter(isRole), unitIds: m.unitIds, status: m.status, source: m.source,
  lastSeenAt: m.lastSeenAt ? m.lastSeenAt.toISOString() : null, createdAt: m.createdAt.toISOString(),
});

export async function listMembers(companyId: string): Promise<MemberRow[]> {
  return withTenant(companyId, async (tx) => (await tx.select().from(members).where(eq(members.companyId, companyId)).orderBy(asc(members.email))).map(toMember));
}

export async function findMember(tx: Tx, companyId: string, email: string): Promise<MemberRow | null> {
  const r = await tx.select().from(members).where(and(eq(members.companyId, companyId), eq(members.email, email))).limit(1);
  return r[0] ? toMember(r[0]) : null;
}

/** Add a member the first time they arrive, with their starting roles (recorded). */
export async function provisionMember(tx: Tx, companyId: string, email: string, name: string, roles: Role[], source: string): Promise<MemberRow> {
  await tx.insert(members).values({ companyId, email, name, roles, source, lastSeenAt: new Date() }).onConflictDoNothing();
  await record(tx, companyId, { actor: email, action: "member.join", entityType: "member", entityId: email, summary: `${email} joined with ${roles.join(", ") || "no"} access`, after: { roles } });
  return (await findMember(tx, companyId, email))!;
}

/** An admin grants roles and scope (or removes someone). */
export async function setMember(actor: Actor, input: { email: unknown; name?: unknown; roles: unknown; unitIds?: unknown; status?: unknown }, requestId?: string): Promise<{ ok: true; member: MemberRow } | { ok: false; error: string }> {
  const email = clean(input.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter the person's work email." };
  const roles = Array.from(new Set((Array.isArray(input.roles) ? input.roles : []).filter(isRole)));
  const unitIds = Array.isArray(input.unitIds) ? input.unitIds.map(String).slice(0, 500) : [];
  const status = input.status === "removed" ? "removed" : "active";
  return withTenant(actor.tenant, async (tx) => {
    const before = await findMember(tx, actor.tenant, email);
    if (before && email === actor.email.toLowerCase() && before.roles.includes("admin") && !roles.includes("admin")) {
      return { ok: false as const, error: "You can't remove your own admin role. Ask another admin." };
    }
    const valid = new Set((await tx.select({ id: units.id }).from(units).where(eq(units.companyId, actor.tenant))).map((u) => u.id));
    const scope = unitIds.filter((u) => valid.has(u));
    const name = clean(input.name, 120) || before?.name || "";
    await tx.insert(members).values({ companyId: actor.tenant, email, name, roles, unitIds: scope, status, source: before?.source ?? "admin" })
      .onConflictDoUpdate({ target: [members.companyId, members.email], set: { name, roles, unitIds: scope, status, updatedAt: new Date() } });
    const after = (await findMember(tx, actor.tenant, email))!;
    await record(tx, actor.tenant, {
      actor: actor.email, action: before ? "member.update" : "member.add", entityType: "member", entityId: email,
      summary: status === "removed" ? `Removed ${email}` : `${email}: ${roles.join(", ") || "no roles"}${scope.length ? ` · ${scope.length} units` : ""}`,
      before: before ? { roles: before.roles, unitIds: before.unitIds, status: before.status } : null, after: { roles, unitIds: scope, status }, requestId,
    });
    return { ok: true as const, member: after };
  });
}
