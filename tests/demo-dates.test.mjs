// Nothing the demo records happens after the demo's "today": every recorded
// event (created, submitted, approved, verified, uploaded, used…) is on or
// before the moment it was seeded. Only genuinely forward-looking dates may be
// later: an action's due date, an effectiveness check's due date, a key's
// expiry and a planned visit.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { seedDemo, clearDemo } = await import("@/lib/demo/seed");
const { withTenant, rowsOf } = await import("@/lib/db/client");
const { sql } = await import("drizzle-orm");

/** Columns that are plans or deadlines, not records of something that happened. */
const FORWARD = new Set(["actions.due_date", "api_keys.expires_at", "programmes.start_date"]);

async function futureRecords(seededAt) {
  // A few minutes' grace: rows stamped by the database itself while the seed runs.
  const now = new Date(seededAt.getTime() + 5 * 60e3);
  return withTenant("_demo", async (tx) => {
    const cols = rowsOf(await tx.execute(sql`select table_name as t, column_name as c, data_type as d from information_schema.columns
      where table_schema = 'public' and data_type in ('timestamp with time zone', 'timestamp without time zone', 'date')
        and table_name in (select table_name from information_schema.columns where table_schema = 'public' and column_name = 'company_id')`));
    const out = [];
    for (const { t, c, d } of cols) {
      if (FORWARD.has(`${t}.${c}`)) continue;
      const limit = d === "date" ? seededAt.toISOString().slice(0, 10) : now.toISOString();
      const [r] = rowsOf(await tx.execute(sql.raw(`select count(*)::int as n, max("${c}")::text as m from "${t}" where company_id = '_demo' and "${c}" > '${limit}'`)));
      if (r.n) out.push(`${t}.${c}: ${r.n} after ${limit} (latest ${r.m})`);
    }
    // Dates kept inside JSON: signatures, check-ins and evaluations.
    const [j] = rowsOf(await tx.execute(sql`select
      (select count(*) from inspections where company_id = '_demo' and ((signatures->'inspector'->>'at') > ${now.toISOString()} or (signatures->'site'->>'at') > ${now.toISOString()} or (checkin->>'at') > ${now.toISOString()}))::int as ins,
      (select count(*) from sampling_plans where company_id = '_demo' and (evaluation->>'at') > ${now.toISOString()})::int as smp`));
    if (j.ins) out.push(`inspections signatures/check-ins: ${j.ins} after today`);
    if (j.smp) out.push(`sampling_plans.evaluation: ${j.smp} after today`);
    return out;
  });
}

for (const [name, now] of [
  ["today", new Date()],
  ["early in a month", (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 2, 0, 30)); })()],
  ["the first of a month", (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 1, 7, 5)); })()],
  ["late in a month", (() => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 28, 23, 0)); })()],
]) {
  test(`no recorded event in the demo is after today (seeded ${name})`, async () => {
    await withTenant("_demo", async (tx) => { await clearDemo(tx); await seedDemo(tx, now); });
    assert.deepEqual(await futureRecords(now), []);
  });
}

test("a demo stored by an earlier release, with records ahead of today, is brought back to today", async () => {
  const { upgradeDemo, recordsAfter, DEMO_SEED_VERSION } = await import("@/lib/demo/seed");
  // As an earlier release left it: this month's inspections up to a week ahead.
  const ahead = new Date(Date.now() + 7 * 864e5);
  await withTenant("_demo", async (tx) => { await clearDemo(tx); await seedDemo(tx, ahead); await tx.execute(sql`update counters set value = 5 where company_id = '_demo' and name = 'demo_seed'`); });
  assert.ok(await withTenant("_demo", (tx) => recordsAfter(tx)));
  await withTenant("_demo", (tx) => upgradeDemo(tx));
  assert.equal(await withTenant("_demo", (tx) => recordsAfter(tx)), false);
  const [v] = rowsOf(await withTenant("_demo", (tx) => tx.execute(sql`select value from counters where company_id = '_demo' and name = 'demo_seed'`)));
  assert.equal(Number(v.value), DEMO_SEED_VERSION);
});
