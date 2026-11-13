// Bulk import of locations, people and actions from a spreadsheet: the file is
// read into columns (lib/table.ts), an admin maps columns to fields, previews
// every row (new, update or error, with the reason), then commits. Commit
// re-checks everything; rows with errors are skipped, never half-written.
import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { withTenant } from "@/lib/db/client";
import { actions, entities, members, units } from "@/lib/db/schema";
import { record } from "@/lib/audit";
import { loadSettings, setMember, writeSettings } from "@/lib/company";
import { cleanMappings } from "@/lib/settings";
import { createAction } from "@/lib/actions";
import { can, isRole, type Actor, type Role } from "@/lib/roles";

import { BULK_FIELDS, BULK_KINDS, type BulkField, type BulkKind, type BulkPreview, type BulkRow } from "@/lib/bulkInfo";
export { BULK_FIELDS, BULK_KINDS, type BulkField, type BulkKind, type BulkPreview, type BulkRow };

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number };
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const ROLE_WORDS: Record<string, Role> = { admin: "admin", administrator: "admin", "quality admin": "admin", supervisor: "supervisor", reviewer: "supervisor", inspector: "inspector", auditor: "inspector", "branch manager": "branch_manager", "site manager": "branch_manager", "ward manager": "branch_manager", manager: "branch_manager", branch_manager: "branch_manager", viewer: "viewer", read: "viewer", "read only": "viewer" };

/** A date as YYYY-MM-DD from 2026-12-01, 01/12/2026 (day first), 1 Dec 2026 or an Excel serial. */
export function toIsoDate(v: string): string | null {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return Number.isNaN(Date.parse(s.slice(0, 10) + "T00:00:00Z")) ? null : s.slice(0, 10);
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) { const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])); return d.getUTCDate() === +m[1] ? d.toISOString().slice(0, 10) : null; }
  if (/^\d{5}$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 864e5); return d.toISOString().slice(0, 10); }
  m = /^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/.exec(s);
  if (m) { const t = Date.parse(`${m[1]} ${m[2]} ${m[3]} UTC`); return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); }
  return null;
}

export function parseRoles(v: string): { roles: Role[]; unknown: string[] } {
  const roles = new Set<Role>(), unknown: string[] = [];
  for (const w of v.split(/[,;/|]+/).map(norm).filter(Boolean)) { const r = ROLE_WORDS[w] ?? (isRole(w) ? w : null); if (r) roles.add(r); else unknown.push(w); }
  return { roles: Array.from(roles), unknown };
}

const clip = (rows: unknown): Record<string, string>[] => (Array.isArray(rows) ? rows.slice(0, 5000) : []).map((r) => Object.fromEntries(Object.entries((r && typeof r === "object" ? r : {}) as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "").trim().slice(0, 2000)])));

/** Check every row against what is already there. */
export async function previewBulk(a: Actor, kind: BulkKind, raw: unknown): Promise<Result<BulkPreview>> {
  if (!can.manage(a)) return { ok: false, error: "Only a Quality admin imports in bulk.", status: 403 };
  const rows = clip(raw);
  if (!rows.length) return { ok: false, error: "There are no rows to import.", status: 400 };
  const ctx = await withTenant(a.tenant, async (tx) => ({
    units: await tx.select().from(units).where(eq(units.companyId, a.tenant)),
    people: await tx.select({ email: members.email }).from(members).where(eq(members.companyId, a.tenant)),
    open: kind === "actions" ? await tx.select({ unitId: actions.unitId, title: actions.title, ref: actions.ref }).from(actions).where(and(eq(actions.companyId, a.tenant), ne(actions.status, "closed"))) : [],
  }));
  const byName = new Map(ctx.units.map((u) => [norm(u.name), u]));
  const known = new Set(ctx.people.map((p) => p.email.toLowerCase()));
  const seen = new Set<string>();
  const out: BulkRow[] = rows.map((v, i) => {
    const row: BulkRow = { n: i + 2, values: v, status: "new", message: "" };
    const err = (m: string) => { row.status = "error"; row.message = m; return row; };
    for (const f of BULK_FIELDS[kind]) if (f.required && !v[f.key]) return err(`${f.label} is missing.`);
    if (kind === "locations") {
      const k = norm(v.name);
      if (v.name.length > 80) return err("The name is longer than 80 characters.");
      if (seen.has(k)) return err("This name appears twice in the file."); seen.add(k);
      if (v.active && !/^(y|yes|true|1|active|open|n|no|false|0|inactive|closed)$/i.test(v.active)) return err("Active should be yes or no.");
      if (byName.has(k)) { row.status = "update"; row.message = "Already there: its code, region, entity and status will be updated."; }
      else row.message = "Will be added.";
    } else if (kind === "people") {
      const email = v.email.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err("The email doesn't look right.");
      if (seen.has(email)) return err("This person appears twice in the file."); seen.add(email);
      const { roles, unknown } = parseRoles(v.roles || "");
      if (unknown.length) return err(`Unknown role: ${unknown.join(", ")}.`);
      if (email === a.email.toLowerCase() && !roles.includes("admin")) return err("You can't remove your own admin role here.");
      const sites = (v.sites || "").split(/[,;|]+/).map(norm).filter(Boolean);
      const missing = sites.filter((s) => !byName.has(s));
      if (missing.length) return err(`No site called ${missing.slice(0, 3).join(", ")}.`);
      if (known.has(email)) { row.status = "update"; row.message = `Roles become ${roles.join(", ") || "none (viewer access removed)"}.`; }
      else row.message = `Will be added as ${roles.join(", ") || "viewer"}${sites.length ? ` for ${sites.length} site${sites.length === 1 ? "" : "s"}` : ""}.`;
    } else {
      if (!byName.has(norm(v.site))) return err(`No site called ${v.site}.`);
      if (!toIsoDate(v.due)) return err("The due date isn't a date (use 2026-12-01 or 01/12/2026).");
      if (v.priority && !["high", "medium", "low"].includes(norm(v.priority))) return err("Priority should be high, medium or low.");
      if (v.kind && !["containment", "corrective", "preventive"].includes(norm(v.kind))) return err("Kind should be containment, corrective or preventive.");
      if (v.title.length > 160) return err("The issue is longer than 160 characters; put the rest in Details.");
      const site = byName.get(norm(v.site))!;
      const key = `${site.id}|${norm(v.title)}`;
      if (seen.has(key)) { row.status = "skip"; row.message = "Duplicate: the same issue at the same site appears earlier in the file."; return row; }
      seen.add(key);
      const dup = ctx.open.find((x) => x.unitId === site.id && norm(x.title) === norm(v.title));
      if (dup) { row.status = "skip"; row.message = `Duplicate: ${dup.ref} is already open at ${site.name} with this issue.`; return row; }
      row.message = "A new action will be raised.";
    }
    return row;
  });
  const counts = { new: 0, update: 0, error: 0, skip: 0 };
  for (const r of out) counts[r.status]++;
  return { ok: true, value: { kind, rows: out, counts } };
}

/** Apply every row that previews cleanly. */
export async function commitBulk(a: Actor, kind: BulkKind, raw: unknown, requestId?: string, mapping?: unknown): Promise<Result<{ added: number; updated: number; skipped: number; errors: { n: number; message: string }[] }>> {
  const p = await previewBulk(a, kind, raw);
  if (!p.ok) return p;
  let added = 0, updated = 0;
  const errors: { n: number; message: string }[] = [];
  const good = p.value.rows.filter((r) => r.status === "new" || r.status === "update");
  if (kind === "locations") {
    await withTenant(a.tenant, async (tx) => {
      const us = await tx.select().from(units).where(eq(units.companyId, a.tenant));
      const es = await tx.select().from(entities).where(eq(entities.companyId, a.tenant));
      const entityId = async (name: string) => {
        if (!name) return null;
        const hit = es.find((e) => norm(e.name) === norm(name));
        if (hit) return hit.id;
        const id = randomUUID(); await tx.insert(entities).values({ id, companyId: a.tenant, name: name.slice(0, 80), sort: es.length }); es.push({ id, companyId: a.tenant, name, code: null, sort: es.length, createdAt: new Date() });
        return id;
      };
      let sort = us.reduce((m, u) => Math.max(m, u.sort), 0) + 1;
      for (const r of good) {
        const v = r.values;
        const active = !v.active || /^(y|yes|true|1|active|open)$/i.test(v.active);
        const ex = us.find((u) => norm(u.name) === norm(v.name));
        const eid = v.entity !== undefined ? await entityId(v.entity) : ex?.entityId ?? null;
        if (ex) { await tx.update(units).set({ code: v.code || ex.code, region: v.region || ex.region, entityId: eid, active }).where(eq(units.id, ex.id)); updated++; }
        else { await tx.insert(units).values({ id: randomUUID(), companyId: a.tenant, name: v.name.slice(0, 80), code: v.code || null, region: v.region || null, entityId: eid, active, sort: sort++ }); added++; }
      }
      await record(tx, a.tenant, { actor: a.email, action: "bulk.locations", entityType: "unit", summary: `Bulk import of locations: ${added} added, ${updated} updated`, after: { added, updated }, requestId });
    });
  } else if (kind === "people") {
    const us = await withTenant(a.tenant, async (tx) => tx.select().from(units).where(eq(units.companyId, a.tenant)));
    for (const r of good) {
      const v = r.values;
      const { roles } = parseRoles(v.roles || "");
      const sites = (v.sites || "").split(/[,;|]+/).map(norm).filter(Boolean).map((s) => us.find((u) => norm(u.name) === s)!.id);
      const res = await setMember(a, { email: v.email, name: v.name, roles: roles.length ? roles : ["viewer"], unitIds: sites }, requestId);
      if (res.ok) r.status === "new" ? added++ : updated++; else errors.push({ n: r.n, message: res.error });
    }
  } else {
    const us = await withTenant(a.tenant, async (tx) => tx.select().from(units).where(eq(units.companyId, a.tenant)));
    for (const r of good) {
      const v = r.values;
      const owner = v.owner || "";
      const res = await createAction(a, {
        title: v.title, unitId: us.find((u) => norm(u.name) === norm(v.site))!.id, dueDate: toIsoDate(v.due), priority: norm(v.priority || "medium"), kind: norm(v.kind || "corrective"),
        details: v.details, rootCause: v.rootCause, ownerEmail: owner.includes("@") ? owner : "", ownerName: owner.includes("@") ? "" : owner || "To be assigned", sourceType: "import",
      }, requestId);
      if (res.ok) added++; else errors.push({ n: r.n, message: res.error });
    }
  }
  const saved = cleanMappings({ [kind]: mapping })[kind];
  if (saved && (added || updated)) await withTenant(a.tenant, async (tx) => { const st = await loadSettings(tx, a.tenant); await writeSettings(tx, a.tenant, { ...st, bulkMappings: { ...st.bulkMappings, [kind]: saved } }, a.email); });
  if (kind !== "locations") await withTenant(a.tenant, (tx) => record(tx, a.tenant, { actor: a.email, action: `bulk.${kind}`, entityType: kind === "people" ? "member" : "action", summary: `Bulk import of ${kind}: ${added} added, ${updated} updated, ${errors.length + p.value.counts.error} skipped`, requestId }));
  return { ok: true, value: { added, updated, skipped: p.value.counts.error + p.value.counts.skip + errors.length, errors: [...p.value.rows.filter((r) => r.status === "error").map((r) => ({ n: r.n, message: r.message })), ...errors].slice(0, 100) } };
}

