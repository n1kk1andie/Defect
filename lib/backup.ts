// The nightly logical backup (app/api/cron/backup): every company's rows, one
// gzipped JSON file per company, written to a SEPARATE Blob store (its own
// token, BACKUP_BLOB_READ_WRITE_TOKEN) under
//   backups/quality/<yyyy-mm-dd>/<company>.json.gz
// with backups/quality/<yyyy-mm-dd>/manifest.json beside them. Files older than
// RETENTION_DAYS are deleted, only under backups/quality/ in that store.
//
// Reads go through the system path, read-only, one repeatable-read transaction
// per company (a consistent snapshot of that company). A run stops at its
// deadline; the next run for the same day lists the files already written and
// carries on from there (the route chains runs until the day is complete).
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { sql } from "drizzle-orm";
import { systemTx } from "./db/system";
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
export async function exportCompany(companyId: string): Promise<{ body: Buffer; rows: Record<string, number> }> {
  return systemTx(async (tx) => {
    const tables: Record<string, unknown[]> = {};
    const rows: Record<string, number> = {};
    for (const t of await tablesOf(tx)) {
      const r = rowsOf<unknown>(await tx.execute(sql`select * from ${sql.identifier(t.name)} where ${sql.identifier(t.key)} = ${companyId}`));
      tables[t.name] = r;
      rows[t.name] = r.length;
    }
    const doc = { app: BACKUP_APP, company: companyId, exportedAt: new Date().toISOString(), format: 1, tables };
    return { body: gzipSync(Buffer.from(encode(doc))), rows };
  }, { readOnly: true });
}

async function companyIds(): Promise<string[]> {
  return systemTx(async (tx) => rowsOf<{ id: string }>(
    await tx.execute(sql`select ${sql.identifier(COMPANIES.key)} as id from ${sql.identifier(COMPANIES.table)} order by 1`),
  ).map((r) => String(r.id)), { readOnly: true });
}

const fileOf = (day: string, companyId: string) => `${ROOT}${day}/${encodeURIComponent(companyId)}.json.gz`;
export const today = (now = new Date()) => now.toISOString().slice(0, 10);

interface Manifest {
  app: string; date: string; format: 1; updatedAt: string; complete: boolean; retentionDays: number;
  companies: number; written: number; missing: string[];
  files: Record<string, { path: string; bytes: number; sha256?: string; rows?: Record<string, number>; at: string }>;
}

export interface BackupResult { date: string; complete: boolean; companies: number; done: number; wroteNow: number; failed: string[]; pruned: number }

/**
 * Back up every company not yet backed up for `date`, stopping at `deadline`
 * (ms since epoch). Safe to run again for the same day: it resumes.
 */
export async function runBackup(store: BackupStore, opts: { date?: string; deadline: number; now?: Date }): Promise<BackupResult> {
  const date = opts.date && DAY.test(opts.date) ? opts.date : today(opts.now);
  const prefix = `${ROOT}${date}/`;
  const ids = await companyIds();
  const present = new Map((await store.list(prefix)).map((f) => [f.pathname, f]));
  const prev = await store.get(`${prefix}manifest.json`).then((b) => (b ? (JSON.parse(b.toString("utf8")) as Manifest) : null)).catch(() => null);
  const files: Manifest["files"] = { ...(prev?.files ?? {}) };
  const failed: string[] = [];
  let wroteNow = 0;
  for (const id of ids) {
    const path = fileOf(date, id);
    if (present.has(path)) {
      const f = present.get(path)!;
      files[id] = { ...files[id], path, bytes: f.size, at: files[id]?.at ?? f.uploadedAt.toISOString() };
      continue;
    }
    if (Date.now() >= opts.deadline) break;
    try {
      const { body, rows } = await exportCompany(id);
      await store.put(path, body, "application/gzip");
      files[id] = { path, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex"), rows, at: new Date().toISOString() };
      wroteNow++;
    } catch (e) {
      failed.push(id);
      console.error(`backup: ${BACKUP_APP} company ${id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  for (const k of Object.keys(files)) if (!ids.includes(k)) delete files[k];
  const missing = ids.filter((id) => !files[id]);
  const complete = missing.length === 0;
  const manifest: Manifest = {
    app: BACKUP_APP, date, format: 1, updatedAt: new Date().toISOString(), complete, retentionDays: RETENTION_DAYS,
    companies: ids.length, written: ids.length - missing.length, missing, files,
  };
  await store.put(`${prefix}manifest.json`, Buffer.from(JSON.stringify(manifest, null, 1)), "application/json");
  const pruned = complete ? await prune(store, date, opts.deadline) : 0;
  console.info(`backup: ${BACKUP_APP} ${date}: ${manifest.written}/${ids.length} companies (${wroteNow} this run)${complete ? ", complete" : ""}${pruned ? `, ${pruned} old files deleted` : ""}`);
  return { date, complete, companies: ids.length, done: manifest.written, wroteNow, failed, pruned };
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
