import { test } from "node:test";
import assert from "node:assert/strict";
import { actor, setupCompany } from "./support/fixtures.mjs";
const { buildProposal, validateProposal, sendToRisk, outbox, RISK_SCHEMA } = await import("@/lib/riskLink");
const { parseUpload, buildXlsx, toCsv, defectsTemplate } = await import("@/lib/workbook");
const { previewUpload, commitUpload } = await import("@/lib/imports");
const { getDataset } = await import("@/lib/dataset");
const { pulseFor } = await import("@/lib/pulse");

const sup = actor("acme", "sue@acme.com", ["supervisor"]);
await setupCompany("acme");

test("a recurring issue becomes a valid Pulsus Risk proposal, stored while Risk isn't connected", async () => {
  delete process.env.RISK_INTAKE_URL;
  const p = buildProposal(sup, { recordType: "recurring_issue", recordRef: "u|a|Missing ID", title: "Recurring: Missing ID", description: "3 months", severity: "high", unitName: "Summit", unitType: "Branch", area: "Payments", detectedAt: "2026-10-01T00:00:00Z", recurrence: { months: 3, first_period: "2026-08", last_period: "2026-10", defects: 12 }, path: "/insights" });
  assert.equal(p.schema, RISK_SCHEMA);
  assert.deepEqual(validateProposal(p), []);
  assert.equal(p.proposed.kind, "risk_event");
  assert.equal(p.id, buildProposal(sup, { recordType: "recurring_issue", recordRef: "u|a|Missing ID", title: "t", description: "", severity: "low", unitName: "S", unitType: "B", area: null, detectedAt: "2026-10-01T00:00:00Z", path: "/" }).id, "idempotent id");
  const r = await sendToRisk(sup, p);
  assert.ok(r.ok);
  assert.equal(r.status, "stubbed");
  assert.equal((await outbox("acme")).length, 1);
  assert.equal((await sendToRisk(actor("acme", "i@acme.com", ["inspector"]), p)).ok, false);
  assert.ok(validateProposal({ ...p, proposed: { ...p.proposed, severity: "huge" } }).length > 0);
});

test("a Branch Defects workbook is previewed, then replaces the imported history on confirm", async () => {
  const header = ["Period", "Branch", "Process Area", "# of Items Reviewed", "# of Possible Instances", "# of Defects", "# of Resolvable Defects", "# of Defects Resolved", "# of Recurring Defects"];
  const buf = await buildXlsx([{ name: "Branch Defects", header, rows: [["2026-01-01", "Harbour", "Payments", 10, 50, 5, 5, 9, 1], ["2026-02-01", "Summit", "Payments", 10, 50, 2, 2, 2, 0]] }]);
  const parsed = await parseUpload(buf);
  assert.equal(parsed.kind, "defects");
  assert.equal(parsed.rows[0][7], 5, "resolved capped at resolvable");
  const admin = actor("acme", "admin@acme.com", ["admin"]);
  const p = await previewUpload(admin, "defects.xlsx", buf);
  assert.equal(p.rows, 2);
  assert.equal((await getDataset("acme")).rows.length, 0);
  const c = await commitUpload(admin, p.id);
  assert.ok(c.ok);
  assert.equal((await getDataset("acme")).rows.length, 2);
  assert.equal((await commitUpload(admin, p.id)).ok, false);
  await assert.rejects(parseUpload(await buildXlsx([{ name: "x", header: ["Period", "Branch", "Process Area", "# of Defects"], rows: [] }])), /Missing column/);
  assert.ok((await defectsTemplate(["A"], ["B"])).length > 1000);
});

test("CSV cells that could run as formulas are neutralised", () => {
  const csv = toCsv(["a"], [["=HYPERLINK(1)"], ["plain, text"]]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /"plain, text"/);
});

test("the platform pulse summarises the latest month", async () => {
  const p = await pulseFor("acme");
  assert.equal(p.app, "quality");
  assert.equal(p.period, "2026-02");
  assert.equal(p.defectRate.value, 0.04);
  assert.ok(["strong", "healthy", "watch", "attention", "escalate", "worldClass"].includes(p.defectRate.band));
});
