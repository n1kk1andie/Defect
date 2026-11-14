// Change-triggered logical backups: a company's rows, one gzipped JSON file,
// written to a SEPARATE Blob store (its own token, BACKUP_BLOB_READ_WRITE_TOKEN)
// under
//   backups/quality/<yyyy-mm-dd>/<company>.json.gz
// with backups/quality/<yyyy-mm-dd>/manifest.json beside them (a later backup the
// same day replaces that day's file). Days older than RETENTION_DAYS are
// deleted, only under backups/quality/ in that store, and only as part of a backup
// that actually happened (the first one of each day).
//
// When: a write for a real company marks it in backup_state (a trigger, see
// drizzle/0011_backup_state.sql); after the response, lib/backup-after.ts calls
// backupIfDue(), which backs that company up if it has unsaved changes and its
// last backup is at least 15 minutes old. The once-a-day sweep
// (app/api/cron/backup) catches trailing edits: it asks one cheap question,
// "is anything pending?", and stops there when nothing is: no store calls, no
// per-company loop. No real changes, no runs, no cost.
//
// Reads go through the system path, read-only, one repeatable-read transaction
// per company (a consistent snapshot of that company).
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { systemTx } from "./db/system";
import { vercelBlobToken as liveBlobToken } from "./storage";
import { BACKUP_THROTTLE_MS, isDemoMode, tracksChanges } from "./backup-policy";
import type { Tx } from "./db/client";

/** The table that lists the companies, and its id column. */
const COMPANIES = { table: "companies", key: "company_id" };

export const BACKUP_APP = "quality";
export const RETENTION_DAYS = 35;
const ROOT = `backups/${BACKUP_APP}/`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface BackupFile { pathname: string; size: number; uploadedAt: Date; url?: string }
/** Where backups go: the backup Blob store in production, memory in the tests. */
export interface BackupStore {
  list(prefix: string): Promise<BackupFile[]>;
  /** The "folders" directly under prefix (each ends with "/"). */
  folders(prefix: string): Promise<string[]>;
  put(pathname: string, body: Buffer, contentType: string): Promise<void>;
  get(pathname: string): Promise<Buffer | null>;
  del(files: BackupFile[]): Promise<void>;
}

/** The backup Blob store, private, through its own token (never the app's own store). */
export function blobBackupStore(token: string): BackupStore {
  return {
    async list(prefix) {
      const { list } = await import("@vercel/blob");
      const out: BackupFile[] = [];
      let cursor: string | undefined;
      do {
        const r = await list({ prefix, cursor, limit: 1000, token });
        for (const b of r.blobs) out.push({ pathname: b.pathname, size: b.size, uploadedAt: new Date(b.uploadedAt), url: b.url });
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
    async folders(prefix) {
      const { list } = await import("@vercel/blob");
      const out: string[] = [];
      let cursor: string | undefined;
      do {
        const r = await list({ prefix, cursor, limit: 1000, mode: "folded", token });
        out.push(...r.folders);
        cursor = r.hasMore ? r.cursor : undefined;
      } while (cursor);
      return out;
    },
    async put(pathname, body, contentType) {
      const { put } = await import("@vercel/blob");
      await put(pathname, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType, token });
    },
    async get(pathname) {
      const { get } = await import("@vercel/blob");
      const r = await get(pathname, { access: "private", token, useCache: false }).catch(() => null);
      if (!r || r.statusCode !== 200 || !r.stream) return null;
      return Buffer.from(await new Response(r.stream).arrayBuffer());
    },
    async del(files) {
      const { del } = await import("@vercel/blob");
      for (let i = 0; i < files.length; i += 100) await del(files.slice(i, i + 100).map((f) => f.url || f.pathname), { token });
    },
  };
}

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: T[] })?.rows ?? (r as T[])) || [];

/** JSON that survives the types a row can hold (bigint, bytea). */
function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Uint8Array) return { $bytes: Buffer.from(v).toString("base64") };
    if (v && typeof v === "object" && (v as { type?: string }).type === "Buffer" && Array.isArray((v as { data?: unknown }).data)) {
      return { $bytes: Buffer.from((v as { data: number[] }).data).toString("base64") };
    }
    return v;
  });
}

/** The tables to back up: every public table with a company_id column, and the companies table. */
async function tablesOf(tx: Tx): Promise<{ name: string; key: string }[]> {
  const rows = rowsOf<{ table_name: string; column_name: string }>(await tx.execute(sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'company_id'
    order by c.table_name`));
  const out = rows.map((r) => ({ name: r.table_name, key: "company_id" }));
  if (COMPANIES.key !== "company_id") out.push({ name: COMPANIES.table, key: COMPANIES.key });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One company's rows, every table, in one consistent read-only snapshot. */
export async function exportCompany(companyId: string): Promise<{ body: Buffer; rows: Record<string, number>; seq: number }> {
  return systemTx(async (tx) => {
    // The change count this snapshot includes: a mark after it keeps the company pending.
    const seq = Number(rowsOf<{ seq: string }>(await tx.execute(sql`select change_seq::text as seq from backup_state where company_id = ${companyId}`))[0]?.seq ?? 0);
    const tables: Record<string, unknown[]> = {};
    const rows: Record<string, number> = {};
    for (const t of await tablesOf(tx)) {
      const r = rowsOf<unknown>(await tx.execute(sql`select * from ${sql.identifier(t.name)} where ${sql.identifier(t.key)} = ${companyId}`));
      tables[t.name] = r;
      rows[t.name] = r.length;
    }
    const doc = { app: BACKUP_APP, company: companyId, exportedAt: new Date().toISOString(), format: 1, tables };
    return { body: gzipSync(Buffer.from(encode(doc))), rows, seq };
  }, { readOnly: true });
}

const fileOf = (day: string, companyId: string) => `${ROOT}${day}/${encodeURIComponent(companyId)}.json.gz`;
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

interface Manifest {
  app: string; date: string; format: 2; updatedAt: string; retentionDays: number; companies: number;
  files: Record<string, { path: string; bytes: number; sha256: string; rows: Record<string, number>; at: string }>;
}

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^["']+|["']+$/g, "").trim() : "");
let warnedNoToken = false;
export const resetBackupWarningsForTests = () => { warnedNoToken = false; };

/**
 * The backup store from the environment, or why there is none. Without
 * BACKUP_BLOB_READ_WRITE_TOKEN: nothing (one log line per process). A token
 * equal to the live store's is refused: a backup kept in the live store is no
 * backup, and pruning there must never run.
 */
export function backupStoreFromEnv(): { store: BackupStore } | { skipped: string } | { error: string } {
  if (isDemoMode()) return { skipped: "demo" };
  const token = clean(process.env.BACKUP_BLOB_READ_WRITE_TOKEN);
  if (!token) {
    if (!warnedNoToken) { warnedNoToken = true; console.warn("backup: BACKUP_BLOB_READ_WRITE_TOKEN is not set; changes are marked but not backed up"); }
    return { skipped: "BACKUP_BLOB_READ_WRITE_TOKEN is not set" };
  }
  if (token === clean(liveBlobToken())) {
    console.error("backup: BACKUP_BLOB_READ_WRITE_TOKEN is the live Blob store's token; refusing to back up into the live store");
    return { error: "The backup store must be separate from the live store" };
  }
  return { store: blobBackupStore(token) };
}

/** A claim older than this is taken to have died (a failed backup is retried after it). */
const STALE_CLAIM_MS = 5 * 60_000;

/**
 * Claim a company's backup: only if it has unsaved changes, no other backup of
 * it is running, and (unless `throttle` is false) its last backup is at least
 * BACKUP_THROTTLE_MS old. One UPDATE; true if this caller won the claim.
 */
async function claim(companyId: string, now: Date, throttle: boolean): Promise<boolean> {
  const stale = new Date(now.getTime() - STALE_CLAIM_MS);
  const due = new Date(now.getTime() - (throttle ? BACKUP_THROTTLE_MS : 0));
  return systemTx(async (tx) => rowsOf<{ id: string }>(await tx.execute(sql`
    update backup_state set backup_started_at = ${now}
    where company_id = ${companyId} and pending
      and (backup_started_at is null or backup_started_at < ${stale})
      and (last_backup_at is null or last_backup_at <= ${due})
    returning company_id as id`)).length > 0);
}

export interface CompanyBackup { company: string; path: string; bytes: number; pruned: number }

/** Back up one company (already claimed) now: its file, the day's manifest, retention on the day's first backup, then clear its mark. */
async function backupClaimed(store: BackupStore, companyId: string, now: Date): Promise<CompanyBackup> {
  const date = today(now);
  const prefix = `${ROOT}${date}/`;
  const path = fileOf(date, companyId);
  const { body, rows, seq } = await exportCompany(companyId);
  await store.put(path, body, "application/gzip");
  const prev = await store.get(`${prefix}manifest.json`).then((b) => (b ? (JSON.parse(b.toString("utf8")) as Manifest) : null)).catch(() => null);
  const files: Manifest["files"] = { ...(prev?.files ?? {}) };
  files[companyId] = { path, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), rows, at: new Date().toISOString() };
  const manifest: Manifest = { app: BACKUP_APP, date, format: 2, updatedAt: new Date().toISOString(), retentionDays: RETENTION_DAYS, companies: Object.keys(files).length, files };
  await store.put(`${prefix}manifest.json`, Buffer.from(JSON.stringify(manifest, null, 1)), "application/json");
  // Retention runs only when a backup happened, once a day (the day's first).
  const pruned = prev ? 0 : await prune(store, date);
  // Clear the mark only if nothing was marked after this backup's snapshot.
  await systemTx((tx) => tx.execute(sql`
    update backup_state set last_backup_at = ${now}, backed_up_seq = ${seq}, backup_started_at = null, pending = (change_seq > ${seq})
    where company_id = ${companyId}`));
  console.info(`backup: ${BACKUP_APP} ${companyId} -> ${path} (${body.length} bytes)${pruned ? `, ${pruned} old files deleted` : ""}`);
  return { company: companyId, path, bytes: body.length, pruned };
}

/**
 * After a request for this company: back it up if it has unsaved changes and
 * its last backup is at least 15 minutes old. Returns what it did.
 */
export async function backupIfDue(companyId: string, opts: { store?: BackupStore; now?: Date } = {}): Promise<CompanyBackup | { skipped: string }> {
  if (!tracksChanges(companyId)) return { skipped: "demo" };
  let store = opts.store;
  if (!store) {
    const env = backupStoreFromEnv();
    if (!("store" in env)) return { skipped: "skipped" in env ? env.skipped : env.error };
    store = env.store;
  }
  const now = opts.now ?? new Date();
  if (!(await claim(companyId, now, true))) return { skipped: "not due" };
  return backupClaimed(store, companyId, now);
}

/** The one cheap question the daily sweep asks first: has any company unsaved changes? */
export async function anyPending(): Promise<boolean> {
  return systemTx(async (tx) => rowsOf<{ any: boolean }>(await tx.execute(sql`select exists (select 1 from backup_state where pending) as any`))[0]?.any === true, { readOnly: true });
}

export interface SweepResult { idle: boolean; pending: number; backedUp: string[]; failed: string[]; left: number }

/**
 * The daily sweep: if nothing is pending, stop (no store calls at all).
 * Otherwise back up each pending company (no 15-minute wait), until `deadline`.
 */
export async function sweepPending(store: BackupStore, opts: { deadline: number; now?: Date }): Promise<SweepResult> {
  if (!(await anyPending())) return { idle: true, pending: 0, backedUp: [], failed: [], left: 0 };
  const ids = await systemTx(async (tx) => rowsOf<{ id: string }>(await tx.execute(sql`select company_id as id from backup_state where pending order by last_change_at nulls first`)).map((r) => String(r.id)), { readOnly: true });
  const backedUp: string[] = [];
  const failed: string[] = [];
  let left = 0;
  for (const id of ids) {
    if (!tracksChanges(id)) continue;
    if (Date.now() >= opts.deadline) { left++; continue; }
    const now = opts.now ?? new Date();
    try {
      if (!(await claim(id, now, false))) continue;
      await backupClaimed(store, id, now);
      backedUp.push(id);
    } catch (e) {
      failed.push(id);
      console.error(`backup: ${BACKUP_APP} company ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  console.info(`backup: ${BACKUP_APP} sweep: ${backedUp.length} of ${ids.length} pending companies backed up${left ? `, ${left} left for the next run` : ""}`);
  return { idle: false, pending: ids.length, backedUp, failed, left };
}

/** Delete the backup days older than RETENTION_DAYS before `date`, only under backups/quality/. */
export async function prune(store: BackupStore, date: string, deadline = Infinity): Promise<number> {
  const cutoff = new Date(`${date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  const keepFrom = today(cutoff);
  let pruned = 0;
  for (const folder of await store.folders(ROOT)) {
    const full = folder.startsWith(ROOT) ? folder : ROOT + folder;
    const day = full.slice(ROOT.length).replace(/\/$/, "");
    if (!DAY.test(day) || day >= keepFrom) continue;
    if (Date.now() >= deadline) break;
    const old = (await store.list(`${ROOT}${day}/`)).filter((f) => f.pathname.startsWith(`${ROOT}${day}/`));
    if (old.length) await store.del(old);
    pruned += old.length;
  }
  return pruned;
}
