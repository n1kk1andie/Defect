// Data safety: tenant transactions run as quality_app even though the login role
// bypasses row-level security (PGlite's login role is a superuser, as Neon's owner
// role bypasses RLS); a failed role check is fatal in production; the
// cross-company system path stays in cron jobs; and the nightly backup.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { withTenant, rowsOf, connection, resetConnectionForTests, TenantIsolationError } = await import("@/lib/db/client");
const { systemTx } = await import("@/lib/db/system");
const { sql } = await import("drizzle-orm");

const ROLE = "quality_app";
const COMPANY_IDS = ["acme", "globex"];
const SYSTEM_USE = /\bsystemTx\b|db\/system/;
const SYSTEM_ALLOWED = ["lib/backup.ts"];
const fails = (p, re) => assert.rejects(p, (e) => re.test(String(e?.message)) || re.test(String(e?.cause?.message)));

before(async () => {
  for (const id of COMPANY_IDS) {
    await withTenant(id, (tx) => tx.execute(sql`insert into companies (company_id, name, kind) values (${id}, ${id}, 'company') on conflict do nothing`));
  }
});

test("the login role bypasses row-level security, yet a tenant transaction sees only its own company", async () => {
  const c = await connection();
  const [login] = rowsOf(await c.db.execute(sql`select rolsuper or rolbypassrls as bypass from pg_roles where rolname = current_user`));
  assert.equal(login.bypass, true, "the test's login role must be a bypass role for this to prove anything");
  assert.equal(rowsOf(await c.db.execute(sql`select company_id from companies`)).length, 2, "the login role alone sees both");
  assert.equal(c.appRole, true);
  const [who] = rowsOf(await withTenant("acme", (tx) => tx.execute(sql`select current_user as role, (select rolbypassrls or rolsuper from pg_roles where rolname = current_user) as bypass`)));
  assert.deepEqual({ ...who }, { role: ROLE, bypass: false });
  const seen = rowsOf(await withTenant("acme", (tx) => tx.execute(sql`select company_id from companies`)));
  assert.deepEqual(seen.map((r) => r.company_id), ["acme"]);
  await fails(withTenant("acme", (tx) => tx.execute(sql`insert into companies (company_id, name, kind) values ('planted', 'x', 'company')`)), /row-level security/);
});

test("the app role may only insert and read the change history", async () => {
  const c = await connection();
  const [p] = rowsOf(await c.db.execute(sql`select has_table_privilege(${ROLE}, 'audit_log', 'INSERT') as i, has_table_privilege(${ROLE}, 'audit_log', 'SELECT') as s,
    has_table_privilege(${ROLE}, 'audit_log', 'UPDATE') as u, has_table_privilege(${ROLE}, 'audit_log', 'DELETE') as d`));
  assert.deepEqual({ ...p }, { i: true, s: true, u: false, d: false });
});

test("a tenant transaction is refused in production when its role could bypass row-level security", async () => {
  const c = await connection();
  const env = process.env.NODE_ENV;
  await c.db.execute(sql.raw(`alter role ${ROLE} bypassrls`));
  process.env.NODE_ENV = "production";
  const orig = console.error;
  const errs = [];
  console.error = (...a) => errs.push(a.join(" "));
  try {
    await assert.rejects(withTenant("acme", (tx) => tx.execute(sql`select 1`)), TenantIsolationError);
    assert.ok(errs.some((e) => /bypass row-level security/.test(e)), "the refusal is logged");
  } finally {
    console.error = orig;
    process.env.NODE_ENV = env;
    await c.db.execute(sql.raw(`alter role ${ROLE} nobypassrls`));
  }
  assert.equal(rowsOf(await withTenant("acme", (tx) => tx.execute(sql`select company_id from companies`))).length, 1);
});

test("in production, a role check that fails is fatal instead of falling back to the login role", async () => {
  const { checkAppRole } = await import("@/lib/db/client");
  const c = await connection();
  const env = process.env.NODE_ENV;
  await c.db.execute(sql.raw(`alter role ${ROLE} rename to ${ROLE}_away`));
  const orig = { error: console.error, warn: console.warn };
  const logs = [];
  console.error = console.warn = (...a) => logs.push(a.join(" "));
  try {
    process.env.NODE_ENV = "production";
    await assert.rejects(checkAppRole(c.db), TenantIsolationError);
    assert.ok(logs.some((l) => /Refusing to serve/.test(l)));
    process.env.NODE_ENV = "development";
    assert.equal(await checkAppRole(c.db), false, "development warns and falls back");
    assert.ok(logs.some((l) => /Development only/.test(l)));
  } finally {
    Object.assign(console, orig);
    process.env.NODE_ENV = env;
    await c.db.execute(sql.raw(`alter role ${ROLE}_away rename to ${ROLE}`));
  }
  assert.equal(await checkAppRole(c.db), true);
});

test("the system path refuses to run on a login role that cannot bypass row-level security, and can be read-only", async () => {
  const c = await connection();
  await c.db.execute(sql.raw(`set role ${ROLE}`));
  try {
    await assert.rejects(systemTx(async () => 1), /does not bypass row-level security/);
  } finally {
    await c.db.execute(sql`reset role`);
  }
  assert.equal((await systemTx(async (tx) => rowsOf(await tx.execute(sql`select company_id from companies`)), { readOnly: true })).length, 2);
  await fails(systemTx((tx) => tx.execute(sql`insert into companies (company_id, name, kind) values ('ro', 'x', 'company')`), { readOnly: true }), /read-only/);
});
// ── The nightly backup ───────────────────────────────────────────────────────

function memoryStore() {
  const files = new Map();
  const at = new Map();
  return {
    files,
    async list(prefix) { return [...files.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ pathname: k, size: files.get(k).length, uploadedAt: at.get(k) })); },
    async folders(prefix) {
      const out = new Set();
      for (const k of files.keys()) if (k.startsWith(prefix)) { const rest = k.slice(prefix.length); if (rest.includes("/")) out.add(prefix + rest.slice(0, rest.indexOf("/") + 1)); }
      return [...out];
    },
    async put(p, body) { files.set(p, Buffer.from(body)); at.set(p, new Date()); },
    async get(p) { return files.get(p) ?? null; },
    async del(list) { for (const f of list) files.delete(f.pathname); },
  };
}

const cronReq = (headers = {}) => new Request("http://localhost/api/cron/backup", { headers });

test("the backup route refuses a call without the cron secret", async () => {
  const { GET } = await import("../app/api/cron/backup/route.ts");
  delete process.env.CRON_SECRET;
  assert.equal((await GET(cronReq({ authorization: "Bearer anything" }))).status, 401);
  process.env.CRON_SECRET = "s3cret";
  assert.equal((await GET(cronReq())).status, 401);
  assert.equal((await GET(cronReq({ authorization: "Bearer wrong" }))).status, 401);
});

test("the backup route does nothing without BACKUP_BLOB_READ_WRITE_TOKEN, and nothing on a demo", async () => {
  const { GET } = await import("../app/api/cron/backup/route.ts");
  process.env.CRON_SECRET = "s3cret";
  delete process.env.BACKUP_BLOB_READ_WRITE_TOKEN;
  const r = await GET(cronReq({ authorization: "Bearer s3cret" }));
  assert.equal(r.status, 200);
  assert.match((await r.json()).skipped, /BACKUP_BLOB_READ_WRITE_TOKEN/);
  process.env.DEMO_MODE = "1";
  process.env.BACKUP_BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
  try {
    assert.equal((await (await GET(cronReq({ authorization: "Bearer s3cret" }))).json()).skipped, "demo");
  } finally {
    delete process.env.DEMO_MODE;
    delete process.env.BACKUP_BLOB_READ_WRITE_TOKEN;
  }
});

test("the backup writes one gzipped file per company and a manifest, resumes, and prunes only old days of its own prefix", async () => {
  const { runBackup, BACKUP_APP } = await import("../lib/backup.ts");
  const { gunzipSync } = await import("node:zlib");
  const store = memoryStore();
  const root = `backups/${BACKUP_APP}/`;
  await store.put(`${root}2026-09-01/old.json.gz`, Buffer.from("x"));   // older than 35 days: deleted
  await store.put(`${root}2026-10-20/kept.json.gz`, Buffer.from("x"));  // within 35 days: kept
  await store.put(`backups/other-app/2026-01-01/x.json.gz`, Buffer.from("x")); // another prefix: untouched
  await store.put(`companies/acme/evidence.pdf`, Buffer.from("x"));     // not a backup: untouched

  // A deadline already passed: nothing is written, the manifest says what is missing.
  const first = await runBackup(store, { date: "2026-11-13", deadline: 0 });
  assert.equal(first.complete, false);
  assert.equal(first.wroteNow, 0);
  assert.ok(store.files.has(`${root}2026-11-13/manifest.json`));
  assert.ok(store.files.has(`${root}2026-09-01/old.json.gz`), "no pruning before the day is complete");

  const done = await runBackup(store, { date: "2026-11-13", deadline: Date.now() + 60_000 });
  assert.equal(done.complete, true);
  assert.ok(done.companies >= 2);
  assert.equal(done.done, done.companies);
  const again = await runBackup(store, { date: "2026-11-13", deadline: Date.now() + 60_000 });
  assert.equal(again.wroteNow, 0, "a second run for the same day resumes: nothing rewritten");

  const manifest = JSON.parse(store.files.get(`${root}2026-11-13/manifest.json`).toString());
  assert.equal(manifest.complete, true);
  assert.deepEqual(manifest.missing, []);
  for (const id of COMPANY_IDS) {
    const doc = JSON.parse(gunzipSync(store.files.get(`${root}2026-11-13/${id}.json.gz`)).toString());
    assert.equal(doc.company, id);
    for (const [table, rows] of Object.entries(doc.tables)) {
      for (const row of rows) assert.equal(row.company_id ?? row.id, id, `${table} row from another company in ${id}'s backup`);
    }
    assert.ok(manifest.files[id].sha256);
  }
  assert.ok(!store.files.has(`${root}2026-09-01/old.json.gz`));
  assert.ok(store.files.has(`${root}2026-10-20/kept.json.gz`));
  assert.ok(store.files.has(`backups/other-app/2026-01-01/x.json.gz`));
  assert.ok(store.files.has(`companies/acme/evidence.pdf`));
});

// ── The system path stays out of request code ─────────────────────────────────

test("the system path is reachable only from cron routes that check CRON_SECRET", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(import.meta.dirname, "..");
  const walk = (d) => readdirSync(d).flatMap((f) => {
    const p = path.join(d, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs|js)$/.test(f) ? [p] : [];
  });
  const files = [...walk(path.join(root, "app")), ...walk(path.join(root, "lib")), ...(statSync(path.join(root, "proxy.ts"), { throwIfNoEntry: false }) ? [path.join(root, "proxy.ts")] : [])];
  const rel = (f) => path.relative(root, f).split(path.sep).join("/");
  const users = files.filter((f) => SYSTEM_USE.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !f.startsWith("lib/db/"));
  for (const f of users) assert.ok(SYSTEM_ALLOWED.includes(f), `${f} uses the cross-company system path; only cron jobs may`);
  // Whoever imports the backup module must itself be a cron route.
  const backupUsers = files.filter((f) => /from ["']@\/lib\/backup["']|from ["']\.\.?\/.*backup(\.ts)?["']/.test(readFileSync(f, "utf8"))).map(rel);
  for (const f of backupUsers) assert.match(f, /^app\/api\/cron\//, `${f} imports the backup module`);
  for (const f of [...users, ...backupUsers].filter((f) => f.startsWith("app/"))) {
    assert.match(readFileSync(path.join(root, f), "utf8"), /CRON_SECRET|cronAuthorized\(/, `${f} must check the cron secret`);
  }
});
