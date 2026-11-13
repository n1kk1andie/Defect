// Writing and reading the change history (the table and its hash chain:
// lib/db/schema.ts auditLog, lib/auditchain.ts). Every create, change,
// approval, role grant, import and export is recorded with who, when and
// before → after, inside the same transaction as the change itself, so a
// change can't land without its record.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { auditLog } from "@/lib/db/schema";
import { rowsOf, withTenant, type Tx } from "@/lib/db/client";
import { entryHash, GENESIS, verifyChain, type ChainEntry } from "@/lib/auditchain";

export interface AuditInput {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

/** Plain JSON (dates as ISO strings), so what is hashed is what is stored. */
const plain = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** Append one entry to the company's change history, inside the caller's transaction. */
export async function record(tx: Tx, companyId: string, e: AuditInput): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"audit:" + companyId}))`);
  const last = await tx.select({ seq: auditLog.seq, hash: auditLog.hash }).from(auditLog).where(eq(auditLog.companyId, companyId)).orderBy(desc(auditLog.seq)).limit(1);
  const prev = last[0]?.hash ?? GENESIS;
  const entry: ChainEntry = {
    seq: (last[0]?.seq ?? 0) + 1,
    at: new Date().toISOString(),
    actor: e.actor,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    summary: (e.summary ?? "").slice(0, 500),
    before: plain(e.before),
    after: plain(e.after),
    requestId: e.requestId ?? null,
  };
  await tx.insert(auditLog).values({ companyId, ...entry, at: new Date(entry.at), prevHash: prev, hash: entryHash(prev, companyId, entry) });
}

export interface HistoryRow { seq: number; at: string; actor: string; action: string; entityType: string; entityId: string | null; summary: string; before: unknown; after: unknown }

/** The latest entries, newest first, optionally for one record. */
export async function history(companyId: string, opts: { limit?: number; entityType?: string; entityId?: string } = {}): Promise<HistoryRow[]> {
  return withTenant(companyId, async (tx) => {
    const where = [eq(auditLog.companyId, companyId)];
    if (opts.entityType) where.push(eq(auditLog.entityType, opts.entityType));
    if (opts.entityId) where.push(eq(auditLog.entityId, opts.entityId));
    const rows = await tx.select().from(auditLog).where(and(...where)).orderBy(desc(auditLog.seq)).limit(Math.min(opts.limit ?? 200, 2000));
    return rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), actor: r.actor, action: r.action, entityType: r.entityType, entityId: r.entityId, summary: r.summary, before: r.before, after: r.after }));
  });
}

/** Check the whole chain for this company. */
export async function verify(companyId: string) {
  return withTenant(companyId, async (tx) => {
    const rows = await tx.select().from(auditLog).where(eq(auditLog.companyId, companyId)).orderBy(asc(auditLog.seq));
    return verifyChain(companyId, rows.map((r) => ({
      seq: r.seq, at: r.at.toISOString(), actor: r.actor, action: r.action, entityType: r.entityType, entityId: r.entityId,
      summary: r.summary, before: r.before, after: r.after, requestId: r.requestId, prevHash: r.prevHash, hash: r.hash,
    })));
  });
}

/** Count of entries (for Settings summaries). */
export async function historyCount(companyId: string): Promise<number> {
  return withTenant(companyId, async (tx) => Number(rowsOf<{ n: string }>(await tx.execute(sql`select count(*)::text as n from audit_log`))[0]?.n ?? 0));
}
