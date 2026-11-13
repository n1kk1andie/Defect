// The demo's sample data seeds cleanly, with Milestone 2's templates,
// inspections and scorecards consistent with the rest of the story.
import { test } from "node:test";
import assert from "node:assert/strict";
import "./support/fixtures.mjs";
const { seedDemo } = await import("@/lib/demo/seed");
const { withTenant, rowsOf } = await import("@/lib/db/client");
const { listInspections } = await import("@/lib/inspections");
const { inspectionStats } = await import("@/lib/inspectionStats");
const { verify } = await import("@/lib/audit");
const { sql } = await import("drizzle-orm");
const { actor } = await import("./support/fixtures.mjs");

test("the demo seeds templates, versioned inspections, actions and scorecards", async () => {
  await withTenant("_demo", (tx) => seedDemo(tx));
  const [c] = rowsOf(await withTenant("_demo", (tx) => tx.execute(sql`select
    (select count(*) from templates where version > 0)::int as published,
    (select count(*) from templates where version = 0)::int as drafts,
    (select count(*) from inspections)::int as inspections,
    (select count(distinct template_version) from inspections i join templates t on t.id = i.template_id where t.name = 'Branch operations review')::int as versions,
    (select count(*) from actions where source_type = 'inspection')::int as actions,
    (select count(*) from scorecards)::int as scorecards`)));
  assert.ok(c.published >= 13, "library + programme + scorecard templates are published");
  assert.equal(c.drafts, 1);
  assert.ok(c.inspections > 80);
  assert.equal(c.versions, 2, "older inspections keep version 1");
  assert.ok(c.actions > 0);
  assert.equal(c.scorecards, 2);
  const sup = { ...actor("_demo", "taylor.reid@demo.pulsus.tech", ["supervisor"]), kind: "demo" };
  const list = await listInspections(sup);
  assert.ok(list.some((r) => r.status === "submitted" && r.inspectorEmail !== sup.email), "something waits for approval");
  const st = await inspectionStats(sup);
  assert.equal(st.sites[0].name, "Summit", "Summit has the lowest inspection score");
  assert.ok(st.questions.length > 0);
  assert.ok((await verify("_demo")).ok);
});
