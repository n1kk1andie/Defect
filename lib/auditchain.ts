// The change history's hash chain. Each entry's hash covers the previous
// entry's hash and the entry itself (canonical JSON), so altering, removing or
// reordering any entry breaks every hash after it. verifyChain() walks a
// company's history and reports the first break. (The table is also
// append-only in Postgres: drizzle/0001_tenancy.sql.) Pure; Node crypto.
import { createHash } from "node:crypto";

export const GENESIS = "0".repeat(64);

export interface ChainEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
}

/** JSON with object keys sorted, so the same entry always hashes the same. */
export function canonical(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function entryHash(prevHash: string, companyId: string, e: ChainEntry): string {
  return createHash("sha256").update(`${prevHash}|${companyId}|${canonical(e)}`).digest("hex");
}

/** Walk the chain (oldest first). ok, or where it first breaks. */
export function verifyChain(companyId: string, rows: (ChainEntry & { prevHash: string; hash: string })[]): { ok: true; count: number } | { ok: false; count: number; brokenAt: number; reason: string } {
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.seq !== i + 1) return { ok: false, count: rows.length, brokenAt: r.seq, reason: "An entry is missing or out of order." };
    if (r.prevHash !== prev) return { ok: false, count: rows.length, brokenAt: r.seq, reason: "An entry doesn't follow the one before it." };
    const { prevHash: _p, hash: _h, ...entry } = r;
    if (entryHash(prev, companyId, entry) !== r.hash) return { ok: false, count: rows.length, brokenAt: r.seq, reason: "An entry was changed after it was written." };
    prev = r.hash;
  }
  return { ok: true, count: rows.length };
}
