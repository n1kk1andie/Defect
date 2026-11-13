import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { actor } from "./support/fixtures.mjs";
const { preview, commit } = await import("@/lib/migrator");
const { getDataset } = await import("@/lib/dataset");
const { listActions } = await import("@/lib/actions");
const { listReviews } = await import("@/lib/reviews");
const { listMembers } = await import("@/lib/company");

// The previous version's store for one company (Blob JSON under companies/<id>/).
const dir = path.join(process.env.DATA_DIR, (process.env.DEMO_MODE || "").trim() === "1" ? "demo" : "", "companies", "acme");
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "program.json"), JSON.stringify({ unitLabel: "Store", unitPlural: "Stores", itemLabel: "Order", units: ["North", "South"], areas: [{ name: "Tills", checks: [{ id: "count", label: "Till counted", severity: "critical" }, { id: "signed", label: "Signed off", severity: "minor" }], natures: ["Uncounted"] }], people: [{ email: "lead@acme.com", role: "supervisor", unit: "North" }] }));
writeFileSync(path.join(dir, "submissions.json"), JSON.stringify({ submissions: [
  { id: "s1", dataset: "defects", branch: "North", period: "2026-05-01", entryDate: "2026-05-20", status: "published", inspector: "ann@acme.com", supervisor: "lead@acme.com", note: "", attachments: [{ id: "att1", name: "photo.jpg", size: 3, type: "image/jpeg" }], items: [{ area: "Tills", txnType: "New", checks: { count: "no", signed: "yes" }, defects: 1, defectArea: "Uncounted", recurring: false, status: "open" }], history: [{ status: "draft", by: "ann@acme.com", at: "2026-05-20T10:00:00Z" }, { status: "published", by: "lead@acme.com", at: "2026-05-21T10:00:00Z" }], createdAt: "2026-05-20T10:00:00Z", updatedAt: "2026-05-21T10:00:00Z" },
  { id: "s2", dataset: "defects", branch: "South", period: "2026-06-01", status: "draft", inspector: "Ann", items: [], history: [], createdAt: "2026-06-02T10:00:00Z", updatedAt: "2026-06-02T10:00:00Z" },
] }));
writeFileSync(path.join(dir, "actions.json"), JSON.stringify({ actions: [{ id: "a1", ref: "ACT-0007", branch: "North", area: "Tills", title: "Count tills daily", details: "", priority: "high", owner: "Store lead", dueDate: "2026-06-30", status: "closed", closureNote: "Done and checked.", evidence: [], createdBy: "lead@acme.com", verifiedBy: "boss@acme.com", history: [{ status: "open", by: "lead@acme.com", at: "2026-05-22T10:00:00Z" }], createdAt: "2026-05-22T10:00:00Z", updatedAt: "2026-06-20T10:00:00Z" }] }));
writeFileSync(path.join(dir, "attachment-att1"), Buffer.from("jpg"));

const admin = actor("acme", "admin@acme.com", ["admin"]);

test("the dry run writes nothing and describes everything", async () => {
  const p = await preview(admin);
  assert.equal(p.summary.counts.units, 2);
  assert.equal(p.summary.counts.reviews, 2);
  assert.equal(p.summary.counts.actions, 1);
  assert.equal(p.summary.counts.files, 1);
  assert.equal(p.summary.counts.members, 1);
  assert.equal((await getDataset("acme")).rows.length, 0, "nothing imported yet");
  assert.equal((await listActions(admin)).length, 0);
});

test("a commit needs the preview, imports it all, and can't run twice", async () => {
  assert.equal((await commit(admin, "not-a-preview")).ok, false);
  const p = await preview(admin);
  const c = await commit(admin, p.id);
  assert.ok(c.ok, c.error);
  assert.deepEqual(c.files, { copied: 1, missing: 0 });
  const d = await getDataset("acme");
  assert.deepEqual(d.units.map((u) => u.name).sort(), ["North", "South"]);
  assert.equal(d.rows.length, 1, "the published review is on the dashboards");
  const acts = await listActions(admin);
  assert.equal(acts[0].ref, "ACT-0007");
  assert.equal(acts[0].status, "closed");
  const reviews = await listReviews(admin);
  assert.equal(reviews.length, 2);
  assert.equal(reviews.find((r) => r.status === "published").evidence.length, 1);
  assert.ok((await listMembers("acme")).some((m) => m.email === "lead@acme.com" && m.roles.includes("supervisor")));
  const again = await commit(admin, (await preview(admin)).id);
  assert.equal(again.ok, false, "a second import is refused");
});
