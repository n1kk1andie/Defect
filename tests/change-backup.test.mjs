// Change-triggered backups: a write for a real company marks it; the check after
// the response backs it up at most once per 15 minutes; the daily sweep stops at
// one cheap question when nothing is pending; demo data never triggers anything.
import { test, before, beforeEach, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { withTenant, rowsOf, connection } = await import("@/lib/db/client");
const { backupIfDue, sweepPending, anyPending, BACKUP_APP, resetBackupWarningsForTests } = await import("@/lib/backup");
const { sql } = await import("drizzle-orm");

const COMPANIES = ["acme", "globex"];
const DEMO_COMPANY = "demo-corvell";
const root = `backups/${BACKUP_APP}/`;
const savedEnv = { DEMO_MODE: process.env.DEMO_MODE, BACKUP_BLOB_READ_WRITE_TOKEN: process.env.BACKUP_BLOB_READ_WRITE_TOKEN, CRON_SECRET: process.env.CRON_SECRET };
const scheduled = [];
globalThis.__qualityBackupAfter = (task) => scheduled.push(task);

/** An in-memory backup store that records every call made to it. */
function memoryStore() {
  const files = new Map();
  const calls = [];
  return {
    files, calls,
    async list(prefix) { calls.push(["list", prefix]); return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ pathname: k, size: files.get(k).length, uploadedAt: new Date() })); },
    async folders(prefix) {
      calls.push(["folders", prefix]);
      const out = new Set();
      for (const k of files.keys()) if (k.startsWith(prefix)) { const rest = k.slice(prefix.length); if (rest.includes("/")) out.add(prefix + rest.slice(0, rest.indexOf("/") + 1)); }
      return [...out];
    },
    async put(p, body) { calls.push(["put", p]); files.set(p, Buffer.from(body)); },
    async get(p) { calls.push(["get", p]); return files.get(p) ?? null; },
    async del(list) { calls.push(["del"]); for (const f of list) files.delete(f.pathname); },
  };
}

const write = (id) => withTenant(id, (tx) => tx.execute(sql`update companies set name = name where company_id = ${id}`));
const read = (id) => withTenant(id, (tx) => tx.execute(sql`select count(*) from companies`));
async function state(id) {
  const c = await connection();
  return rowsOf(await c.db.execute(sql`select pending, change_seq::int as seq, last_backup_at from backup_state where company_id = ${id}`))[0];
}
async function clearMarks() {
  const c = await connection();
  await c.db.execute(sql`delete from backup_state`);
}
const backupFiles = (store, id) => [...store.calls].filter(([op, p]) => op === "put" && p?.endsWith(`/${id}.json.gz`));
const at = (min) => new Date(Date.parse("2026-11-14T09:00:00Z") + min * 60_000);

before(async () => {
  delete process.env.DEMO_MODE;
  for (const id of [...COMPANIES, DEMO_COMPANY]) {
    await withTenant(id, (tx) => tx.execute(sql`insert into companies (company_id, name, kind) values (${id}, ${id}, ${id.startsWith("demo-") ? "demo" : "company"}) on conflict do nothing`));
  }
});
beforeEach(async () => {
  delete process.env.DEMO_MODE;
  delete process.env.BACKUP_BLOB_READ_WRITE_TOKEN;
  for (const t of scheduled.splice(0)) await t(); // drain the queue (no token: each is a no-op)
  process.env.BACKUP_BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_backup_store";
  await clearMarks();
});
afterAll(() => {
  for (const [k, v] of Object.entries(savedEnv)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  delete globalThis.__qualityBackupAfter;
});

test("a write marks its company; a read marks nothing", async () => {
  await read("acme");
  assert.equal(await state("acme"), undefined);
  await write("acme");
  assert.equal((await state("acme")).pending, true);
  assert.equal(await state("globex"), undefined, "another company is not marked");
  // A thousand-row transaction marks once.
  await withTenant("acme", async (tx) => { for (let i = 0; i < 20; i++) await tx.execute(sql`update companies set name = name where company_id = 'acme'`); });
  assert.equal((await state("acme")).seq, 2);
  // A rolled-back write leaves no mark.
  await clearMarks();
  await assert.rejects(withTenant("acme", async (tx) => { await tx.execute(sql`update companies set name = name where company_id = 'acme'`); throw new Error("rollback"); }));
  assert.equal(await state("acme"), undefined);
});

test("no real data: demo mode and demo companies mark nothing, schedule nothing, and the daily sweep touches no storage", async () => {
  process.env.DEMO_MODE = "1";
  await write("acme");
  await write("_demo").catch(() => {}); // the demo's own tenant (no row here: a no-op write)
  delete process.env.DEMO_MODE;
  await write(DEMO_COMPANY);
  const c = await connection();
  assert.equal(rowsOf(await c.db.execute(sql`select count(*)::int as n from backup_state`))[0].n, 0, "nothing marked");
  assert.equal(scheduled.length, 0, "no after-response check scheduled");
  assert.equal(await anyPending(), false);
  const store = memoryStore();
  const r = await sweepPending(store, { deadline: Date.now() + 60_000 });
  assert.equal(r.idle, true);
  assert.deepEqual(store.calls, [], "the idle sweep makes no store call: no list, no folders, no get, no put");
});

test("the daily sweep route, when nothing is pending, answers idle without touching the store", async () => {
  const { GET } = await import("../app/api/cron/backup/route.ts");
  process.env.CRON_SECRET = "s3cret";
  const realFetch = globalThis.fetch;
  const fetched = [];
  globalThis.fetch = async (...a) => { fetched.push(String(a[0])); throw new Error("no network in the idle sweep"); };
  try {
    const r = await GET(new Request("http://localhost/api/cron/backup", { headers: { authorization: "Bearer s3cret" } }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.idle, true);
    assert.equal(body.pending, 0);
    assert.deepEqual(fetched, [], "no Blob API call (list or otherwise) and no chained run");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("first real write backs that company up once; 10 writes in 5 minutes give one backup; a write 20 minutes later gives a second; another company is untouched", async () => {
  const store = memoryStore();
  await write("acme");
  assert.equal(scheduled.length > 0, true, "the write scheduled a check after the response");
  assert.equal((await backupIfDue("acme", { store, now: at(0) })).company, "acme");
  assert.equal(backupFiles(store, "acme").length, 1);
  assert.equal((await state("acme")).pending, false);
  for (let i = 1; i <= 10; i++) {
    await write("acme");
    const r = await backupIfDue("acme", { store, now: at(i * 0.5) });
    assert.equal(r.skipped, "not due", `write ${i}: throttled`);
  }
  assert.equal(backupFiles(store, "acme").length, 1, "one backup for the burst");
  assert.equal((await state("acme")).pending, true, "the burst stays marked for the next check");
  await write("acme");
  assert.equal((await backupIfDue("acme", { store, now: at(20) })).company, "acme");
  assert.equal(backupFiles(store, "acme").length, 2, "a second backup 20 minutes later");
  assert.equal((await state("acme")).pending, false);
  // Nothing new since: a later check does nothing.
  assert.equal((await backupIfDue("acme", { store, now: at(60) })).skipped, "not due");
  assert.equal(backupFiles(store, "globex").length, 0, "another company untouched");
  assert.equal((await backupIfDue("globex", { store, now: at(60) })).skipped, "not due");
  assert.equal(backupFiles(store, "globex").length, 0);
});

test("withTenant queues at most one check per company until it runs", async () => {
  await write("acme");
  await write("acme");
  await read("acme");
  await write("globex");
  assert.equal(scheduled.length, 2, "one for acme, one for globex");
  delete process.env.BACKUP_BLOB_READ_WRITE_TOKEN;
  for (const t of scheduled.splice(0)) await t();
  await write("acme");
  assert.equal(scheduled.length, 1, "a new check after the last one ran");
});

test("a change committed while a backup runs keeps the company pending", async () => {
  const store = memoryStore();
  const put = store.put;
  let wrote = false;
  store.put = async (p, body) => { if (!wrote && p.endsWith("/acme.json.gz")) { wrote = true; await write("acme"); } return put(p, body); };
  await write("acme");
  assert.equal((await backupIfDue("acme", { store, now: at(0) })).company, "acme");
  assert.equal((await state("acme")).pending, true, "the change after the snapshot is not lost");
});

test("without BACKUP_BLOB_READ_WRITE_TOKEN: marks are still recorded, nothing is backed up, one log line", async () => {
  delete process.env.BACKUP_BLOB_READ_WRITE_TOKEN;
  resetBackupWarningsForTests();
  const orig = console.warn;
  const logs = [];
  console.warn = (...a) => logs.push(a.join(" "));
  try {
    for (let i = 0; i < 3; i++) {
      await write("acme");
      assert.match((await backupIfDue("acme", { now: at(30 * i) })).skipped, /BACKUP_BLOB_READ_WRITE_TOKEN/);
    }
  } finally {
    console.warn = orig;
  }
  assert.equal((await state("acme")).pending, true);
  assert.equal((await state("acme")).last_backup_at, null);
  assert.equal(logs.filter((l) => /BACKUP_BLOB_READ_WRITE_TOKEN/.test(l)).length, 1);
});

test("the daily sweep backs up only the pending companies, then is idle", async () => {
  const store = memoryStore();
  await write("acme");
  await backupIfDue("acme", { store, now: at(0) });
  await write("acme"); // a trailing edit within 15 minutes of the backup
  assert.equal((await backupIfDue("acme", { store, now: at(5) })).skipped, "not due");
  store.calls.length = 0;
  const r = await sweepPending(store, { deadline: Date.now() + 60_000, now: at(6) });
  assert.deepEqual(r.backedUp, ["acme"], "the trailing edit is backed up; globex (no changes) is not");
  assert.equal(backupFiles(store, "globex").length, 0);
  store.calls.length = 0;
  assert.equal((await sweepPending(store, { deadline: Date.now() + 60_000 })).idle, true);
  assert.deepEqual(store.calls, []);
});

test("every company table carries the change trigger", async () => {
  const c = await connection();
  const missing = rowsOf(await c.db.execute(sql`
    select c.table_name as name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name = 'company_id' and c.table_name <> 'backup_state'
      and not exists (select 1 from information_schema.triggers g where g.event_object_table = c.table_name and g.trigger_name = 'backup_mark')`));
  assert.deepEqual(missing.map((r) => r.name), [], "a company table without the backup_mark trigger: add it in a migration");
  // The app role can read and mark only its own company's row.
  await write("acme");
  await write("globex");
  const seen = rowsOf(await withTenant("acme", (tx) => tx.execute(sql`select company_id from backup_state`)));
  assert.deepEqual(seen.map((r) => r.company_id), ["acme"]);
});
