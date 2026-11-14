// Quiet daily jobs: the daily alert email stops at once while there is no real
// company (none, or only demo ones), and behaves as before once there is one.
// Its "sent today" counter is housekeeping and never marks a company for backup.
import { test, after as afterAll } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { withTenant, rowsOf, connection } = await import("@/lib/db/client");
const notify = await import("@/lib/notify");
const { GET } = await import("../app/api/cron/notify/route.ts");
const { sql } = await import("drizzle-orm");

const saved = { DEMO_MODE: process.env.DEMO_MODE, RESEND_API_KEY: process.env.RESEND_API_KEY, CRON_SECRET: process.env.CRON_SECRET };
globalThis.__qualityBackupAfter = () => {};
const sentMail = [];
notify.__setFetch(async (url) => { sentMail.push(String(url)); return new Response("{}", { status: 200 }); });
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  delete globalThis.__qualityBackupAfter;
});

const call = async () => (await GET(new Request("http://localhost/api/cron/notify", { headers: { authorization: "Bearer s3cret" } }))).json();
const addCompany = (id, kind = "company") => withTenant(id, (tx) => tx.execute(sql`insert into companies (company_id, name, kind) values (${id}, ${id}, ${kind}) on conflict do nothing`));

test("the daily alert email returns at once with no company, and with only demo companies", async () => {
  delete process.env.DEMO_MODE;
  process.env.CRON_SECRET = "s3cret";
  process.env.RESEND_API_KEY = "re_test";
  assert.deepEqual(await call(), { companies: 0, sent: 0, failed: 0, skipped: "no real companies" });
  await addCompany("_demo", "demo");
  await addCompany("demo-north", "demo");
  assert.equal((await call()).skipped, "no real companies");
  assert.deepEqual(sentMail, []);
  const c = await connection();
  assert.equal(rowsOf(await c.db.execute(sql`select count(*)::int as n from counters`))[0].n, 0, "no per-company work at all");
});

test("on a demo deployment the alert email never runs", async () => {
  process.env.DEMO_MODE = "1";
  try {
    assert.equal(await notify.hasRealCompany(), false);
    assert.match((await call()).skipped, /email not set up/);
  } finally {
    delete process.env.DEMO_MODE;
  }
});

test("once a real company exists, the alert email runs as before, and its counter marks nothing for backup", async () => {
  process.env.RESEND_API_KEY = "re_test";
  await addCompany("acme");
  const c = await connection();
  await c.db.execute(sql`delete from backup_state`);
  const r = await call();
  assert.equal(r.skipped, undefined);
  assert.ok(r.companies >= 1, "the per-company run happened");
  assert.equal(rowsOf(await c.db.execute(sql`select count(*)::int as n from counters where name = 'digest_day' and company_id = 'acme'`))[0].n, 1);
  assert.equal(rowsOf(await c.db.execute(sql`select count(*)::int as n from backup_state`))[0].n, 0, "the digest counter is not a change worth a backup");
});
