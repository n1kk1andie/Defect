// The database connection and the one way to use it: withTenant().
//
//   DATABASE_URL set   → Postgres (Neon) through node-postgres. Migrations use
//                        DATABASE_URL_UNPOOLED when present.
//   otherwise          → PGlite, Postgres compiled to WebAssembly, in process:
//                        on disk under .data/pglite for local development, in
//                        memory for the tests (PGLITE_MEMORY=1). A hosted
//                        deployment without DATABASE_URL refuses to start a
//                        throwaway database.
//
// Migrations (lib/db/migrations.generated.ts) run once per process, under a
// transaction-scoped advisory lock, before the first query: safe on every
// deploy and on many cold starts at once. Admins can also run them from
// Settings → About (POST /api/admin/database).
//
// withTenant(companyId, fn) opens a transaction, assumes the quality_app role
// where it can and sets app.company_id, so row-level security admits only that
// company's rows (drizzle/0001_tenancy.sql). Nothing reads or writes outside it.
import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations.generated";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

interface Conn { db: Db; kind: "postgres" | "pglite"; appRole: boolean; close: () => Promise<void> }
const g = globalThis as unknown as { __pqDb?: Promise<Conn> };

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/^["']+|["']+$/g, "").trim() : "");
export function databaseUrl(): string { return clean(process.env.DATABASE_URL) || clean(process.env.POSTGRES_URL); }

async function openPostgres(url: string): Promise<{ db: Db; close: () => Promise<void>; migrateDb: Db; closeMigrate: () => Promise<void> }> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const ssl = /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)/.test(url) ? undefined : { rejectUnauthorized: true };
  const pool = new Pool({ connectionString: url, max: 5, ssl, idleTimeoutMillis: 10_000 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  const unpooled = clean(process.env.DATABASE_URL_UNPOOLED) || clean(process.env.POSTGRES_URL_NON_POOLING);
  if (unpooled && unpooled !== url) {
    const mpool = new Pool({ connectionString: unpooled, max: 1, ssl });
    return { db, close: () => pool.end(), migrateDb: drizzle(mpool, { schema }) as unknown as Db, closeMigrate: () => mpool.end() };
  }
  return { db, close: () => pool.end(), migrateDb: db, closeMigrate: async () => {} };
}

async function openPglite(): Promise<{ db: Db; close: () => Promise<void> }> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const memory = clean(process.env.PGLITE_MEMORY) === "1";
  const dir = memory ? undefined : clean(process.env.PGLITE_DIR) || ".data/pglite" + (clean(process.env.DEMO_MODE) === "1" ? "-demo" : "");
  if (dir) { const fs = await import("node:fs"); fs.mkdirSync(dir, { recursive: true }); }
  const client = dir ? new PGlite(dir) : new PGlite();
  return { db: drizzle(client, { schema }) as unknown as Db, close: () => client.close() };
}

/** Apply any migrations not yet applied. Returns the ids it applied. */
export async function migrate(db: Db): Promise<string[]> {
  const applied: string[] = [];
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(727001)`);
    await tx.execute(sql`create table if not exists _migrations (id text primary key, applied_at timestamptz not null default now())`);
    const done = new Set(((await tx.execute(sql`select id from _migrations`)) as unknown as { rows: { id: string }[] }).rows.map((r) => r.id));
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      for (const stmt of m.statements) await tx.execute(sql.raw(stmt));
      await tx.execute(sql`insert into _migrations (id) values (${m.id})`);
      applied.push(m.id);
    }
  });
  return applied;
}

/** The migrations applied to this database, oldest first, and those still pending. */
export async function migrationStatus(): Promise<{ applied: string[]; pending: string[]; kind: string; isolation: string }> {
  const c = await connection();
  const rows = ((await c.db.execute(sql`select id from _migrations order by id`)) as unknown as { rows: { id: string }[] }).rows.map((r) => r.id);
  return {
    applied: rows,
    pending: MIGRATIONS.map((m) => m.id).filter((id) => !rows.includes(id)),
    kind: c.kind,
    isolation: c.appRole ? "Row-level security, as the quality_app role" : "Row-level security, forced on the owner role",
  };
}

async function probeAppRole(db: Db): Promise<boolean> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`set local role quality_app`);
      throw new Error("__probe_ok__");
    });
  } catch (e) {
    return e instanceof Error && e.message === "__probe_ok__";
  }
  return false;
}

async function open(): Promise<Conn> {
  const url = databaseUrl();
  if (url) {
    const p = await openPostgres(url);
    await migrate(p.migrateDb);
    await p.closeMigrate();
    return { db: p.db, kind: "postgres", appRole: await probeAppRole(p.db), close: p.close };
  }
  if (process.env.VERCEL && clean(process.env.ALLOW_EPHEMERAL_DB) !== "1") {
    throw new Error("DATABASE_URL is not set: Pulsus Quality needs its Postgres database on a hosted deployment.");
  }
  const p = await openPglite();
  await migrate(p.db);
  return { db: p.db, kind: "pglite", appRole: await probeAppRole(p.db), close: p.close };
}

/** The process's connection, opened and migrated on first use. */
export function connection(): Promise<Conn> {
  if (!g.__pqDb) g.__pqDb = open().catch((e) => { g.__pqDb = undefined; throw e; });
  return g.__pqDb;
}

/** For the tests: drop the connection so the next call opens a fresh database. */
export async function resetConnectionForTests(): Promise<void> {
  const c = g.__pqDb;
  g.__pqDb = undefined;
  if (c) await (await c).close().catch(() => {});
}

const TENANT_ID = /^(?:_own|_demo|[a-z0-9][a-z0-9-]{0,39})$/;

/** Run fn in a transaction that can see and change only this company's rows. */
export async function withTenant<T>(companyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!TENANT_ID.test(companyId)) throw new Error("Invalid tenant");
  const c = await connection();
  return c.db.transaction(async (tx) => {
    if (c.appRole) await tx.execute(sql`set local role quality_app`);
    await tx.execute(sql`select set_config('app.company_id', ${companyId}, true)`);
    return fn(tx);
  });
}

/** Rows from a raw tx.execute(), whichever driver ran it. */
export function rowsOf<T>(r: unknown): T[] {
  return ((r as { rows?: T[] })?.rows ?? (r as T[])) || [];
}

/**
 * The ids of every tenant, for the scheduled sweep only. Runs under the reserved
 * setting "__registry__", which a read-only policy on the companies table admits
 * (drizzle/0009_m4_tenancy.sql); every other table stays closed to it.
 */
export async function listTenantIds(): Promise<string[]> {
  const c = await connection();
  return c.db.transaction(async (tx) => {
    if (c.appRole) await tx.execute(sql`set local role quality_app`);
    await tx.execute(sql`select set_config('app.company_id', '__registry__', true)`);
    return rowsOf<{ company_id: string }>(await tx.execute(sql`select company_id from companies order by company_id`)).map((r) => r.company_id).filter((id) => TENANT_ID.test(id));
  });
}
