// A demo database seeded by Milestone 1 (before templates and inspections
// existed) is brought up to the Milestone 2 sample data on the next request,
// in place, without touching anything outside the demo tenant, and only once.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
process.env.DEMO_MODE = "1";
const { seedDemo, ensureDemoSeeded, DEMO_SEED_VERSION } = await import("@/lib/demo/seed");
const { withTenant, rowsOf } = await import("@/lib/db/client");
const { setupCompany } = await import("./support/fixtures.mjs");
const { verify } = await import("@/lib/audit");
const { sql } = await import("drizzle-orm");

const count = async (tenant, q) => Number(rowsOf(await withTenant(tenant, (tx) => tx.execute(sql.raw(q))))[0].n);

test("an M1-seeded demo is upgraded with the M2 data, idempotently", async () => {
  const other = await setupCompany("acme");
  // Seed, then strip everything Milestone 2 added: what a demo deployed before #38 holds.
  await withTenant("_demo", async (tx) => {
    await seedDemo(tx);
    for (const t of ["sampling_plans", "programmes", "unit_factors", "inspection_events", "inspections", "template_versions", "templates", "scorecard_versions"]) await tx.execute(sql.raw(`delete from ${t}`));
    await tx.execute(sql`delete from actions where source_type = 'inspection'`);
    await tx.execute(sql`delete from action_events where action_id not in (select id from actions)`);
    await tx.execute(sql`delete from scorecards where active = false`);
    await tx.execute(sql`delete from counters where name in ('demo_seed', 'inspection', 'sampling')`);
    await tx.execute(sql`update counters set value = 50 where name = 'action'`); // visitors raised a few actions since
    await tx.execute(sql`update company_settings set data = data - 'sector' - 'setupDone' - 'groupLabel'`);
    await tx.execute(sql`update units set region = null`);
  });
  const reviewsBefore = await count("_demo", "select count(*)::int n from reviews");
  const actionsBefore = await count("_demo", "select count(*)::int n from actions");
  assert.equal(await count("_demo", "select count(*)::int n from templates"), 0, "the M1 state has no templates");
  const acmeBefore = await count("acme", "select count(*)::int n from units");

  await ensureDemoSeeded();
  assert.ok(await count("_demo", "select count(*)::int n from templates where version > 0") >= 14, "library, Branch Defects and Operational Standard templates");
  assert.equal(await count("_demo", "select count(*)::int n from templates where version = 0"), 1);
  const insp = await count("_demo", "select count(*)::int n from inspections");
  assert.ok(insp > 80);
  assert.ok(await count("_demo", "select count(*)::int n from actions where source_type = 'inspection'") > 0);
  assert.equal(await count("_demo", "select count(*)::int n from scorecards"), 2);
  assert.equal(await count("_demo", "select count(*)::int n from actions where source_type = 'inspection' and ref <= 'ACT-0050'"), 0, "new actions continue after the existing references");
  assert.equal(await count("_demo", "select count(*)::int n from reviews"), reviewsBefore, "M1 data untouched");
  assert.ok(await count("_demo", "select count(*)::int n from actions") > actionsBefore);
  assert.equal(await count("_demo", `select value n from counters where name = 'demo_seed'`), DEMO_SEED_VERSION);
  const s = rowsOf(await withTenant("_demo", (tx) => tx.execute(sql`select data from company_settings`)))[0].data;
  assert.equal(s.sector, "banking"); assert.equal(s.setupDone, true);

  await ensureDemoSeeded();
  assert.equal(await count("_demo", "select count(*)::int n from inspections"), insp, "runs once");
  assert.equal(await count("acme", "select count(*)::int n from units"), acmeBefore, "other tenants untouched");
  assert.equal(await count("acme", "select count(*)::int n from templates"), 0);
  assert.ok((await verify("_demo")).ok);
  void other;
});

test("a Milestone 2 demo gets the Milestone 3 data: programmes, sampling plans, risk factors", async () => {
  await withTenant("_demo", async (tx) => {
    for (const t of ["sampling_plans", "programmes", "unit_factors"]) await tx.execute(sql.raw(`delete from ${t}`));
    await tx.execute(sql`update counters set value = 2 where name = 'demo_seed'`);
  });
  const insp = await count("_demo", "select count(*)::int n from inspections");
  await ensureDemoSeeded();
  assert.equal(await count("_demo", "select count(*)::int n from programmes"), 4);
  assert.equal(await count("_demo", "select count(*)::int n from sampling_plans"), 3);
  assert.equal(await count("_demo", "select count(*)::int n from sampling_plans where status = 'evaluated'"), 2);
  assert.equal(await count("_demo", "select count(*)::int n from unit_factors"), 6);
  assert.equal(await count("_demo", "select count(*)::int n from inspections"), insp + 1, "the Summit sample's review");
  assert.equal(await count("_demo", "select value n from counters where name = 'demo_seed'"), DEMO_SEED_VERSION);
  const { riskBoard } = await import("@/lib/riskScore");
  const b = await riskBoard({ tenant: "_demo", tenantName: "Meridian", kind: "demo", email: "taylor.reid@demo.pulsus.tech", name: "Taylor", roles: ["supervisor"], unitIds: [], platformRole: "viewer", operator: false, plan: null });
  assert.equal(b.sites[0].name, "Summit", "Summit stays the weakest");
  assert.ok((await verify("_demo")).ok);
});

test("a version-3 demo (Meridian Society, member wording) is renamed in place to Meridian Financial Group, customers", async () => {
  await withTenant("_demo", async (tx) => {
    await tx.execute(sql`update companies set name = 'Meridian Society' where company_id = '_demo'`);
    await tx.execute(sql`update checks set label = 'Request signed by the member' where code = 'request-signed'`);
    await tx.execute(sql`update counters set value = 3 where name = 'demo_seed'`);
  });
  await ensureDemoSeeded();
  assert.equal(rowsOf(await withTenant("_demo", (tx) => tx.execute(sql`select name from companies where company_id = '_demo'`)))[0].name, "Meridian Financial Group");
  assert.equal(await count("_demo", "select count(*)::int n from checks where label like '%member%'"), 0, "no member wording left on the checklist");
  assert.ok(await count("_demo", "select count(*)::int n from checks where label = 'Request signed by the customer'") >= 1);
  assert.equal(await count("_demo", "select value n from counters where name = 'demo_seed'"), DEMO_SEED_VERSION);
  await ensureDemoSeeded();
  assert.equal(await count("_demo", "select value n from counters where name = 'demo_seed'"), DEMO_SEED_VERSION, "idempotent");
  assert.ok((await verify("_demo")).ok);
});
